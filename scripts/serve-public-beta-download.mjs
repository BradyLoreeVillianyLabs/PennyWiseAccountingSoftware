import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
const version = String(packageMetadata.version);
const archiveName = `ClearLedger-Public-Beta-${version}.zip`;
const outputRoot = resolve(repositoryRoot, "distribution", "public-beta", "output");
const archivePath = resolve(outputRoot, archiveName);
const checksumPath = `${archivePath}.sha256`;
const host = process.env.CLEARLEDGER_DOWNLOAD_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.CLEARLEDGER_DOWNLOAD_PORT ?? "8787", 10);
const maximumConcurrentDownloads = Number.parseInt(
  process.env.CLEARLEDGER_DOWNLOAD_CONCURRENCY ?? "8",
  10
);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid download port.");
if (
  !Number.isInteger(maximumConcurrentDownloads) ||
  maximumConcurrentDownloads < 1 ||
  maximumConcurrentDownloads > 100
)
  throw new Error("Invalid download concurrency limit.");
if (basename(archivePath) !== archiveName || dirname(archivePath) !== outputRoot)
  throw new Error("Download archive resolved outside the public-beta output directory.");

const archiveHandle = await open(archivePath, "r");
let archiveSnapshot;
let archiveSize;
let expectedSha256;
try {
  archiveSnapshot = await archiveHandle.stat({ bigint: true });
  if (!archiveSnapshot.isFile())
    throw new Error("The final public-beta archive has not been built.");
  if (archiveSnapshot.size < 1n || archiveSnapshot.size > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The final public-beta archive size is invalid or unsupported.");
  archiveSize = Number(archiveSnapshot.size);
  const checksumText = (await readFile(checksumPath, "utf8")).trim();
  const checksumMatch = /^([a-f0-9]{64})\s{2}([^\s]+)$/i.exec(checksumText);
  if (!checksumMatch || checksumMatch[2] !== archiveName)
    throw new Error("The public-beta checksum file is malformed or names another archive.");
  expectedSha256 = checksumMatch[1].toLowerCase();
  const actualSha256 = await hashOpenFile(archiveHandle, archiveSize);
  if (actualSha256 !== expectedSha256)
    throw new Error("The public-beta archive does not match its SHA-256 checksum.");
} catch (error) {
  await archiveHandle.close();
  throw error;
}

let activeDownloads = 0;
let shuttingDown = false;
const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (response.headersSent) response.destroy(error);
    else sendJson(response, 503, { error: "The verified download is temporarily unavailable." });
  });
});

async function handleRequest(request, response) {
  applyHeaders(response);
  let requestUrl;
  try {
    requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    sendJson(response, 400, { error: "Invalid request target." });
    return;
  }
  if (requestUrl.pathname === "/health" && request.method === "GET") {
    if (!(await archiveIsStable())) {
      sendJson(response, 503, {
        status: "unavailable",
        error: "Verified archive changed on disk."
      });
      return;
    }
    response.setHeader("cache-control", "no-store");
    sendJson(response, 200, {
      status: "ok",
      product: "ClearLedger Public Beta",
      version,
      archive: archiveName,
      bytes: archiveSize,
      sha256: expectedSha256
    });
    return;
  }
  if (requestUrl.pathname === `/downloads/${archiveName}.sha256`) {
    if (!allowReadMethod(request, response)) return;
    if (!(await archiveIsStable())) {
      sendJson(response, 503, { error: "Verified archive changed on disk." });
      return;
    }
    const body = Buffer.from(`${expectedSha256}  ${archiveName}\r\n`);
    response.setHeader("cache-control", "public, max-age=3600, immutable");
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(body.length),
      "content-disposition": `attachment; filename="${archiveName}.sha256"`
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
    return;
  }
  if (requestUrl.pathname !== `/downloads/${archiveName}`) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  if (!allowReadMethod(request, response)) return;
  if (request.method === "GET" && activeDownloads >= maximumConcurrentDownloads) {
    response.setHeader("retry-after", "30");
    sendJson(response, 503, { error: "Download capacity is temporarily full." });
    return;
  }
  if (!(await archiveIsStable())) {
    sendJson(response, 503, { error: "Verified archive changed on disk." });
    return;
  }
  const range = parseRange(request.headers.range, archiveSize);
  if (range === false) {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-range", `bytes */${archiveSize}`);
    response.writeHead(416).end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? archiveSize - 1;
  response.setHeader("cache-control", "public, max-age=3600, immutable");
  response.writeHead(range ? 206 : 200, {
    "accept-ranges": "bytes",
    "content-type": "application/zip",
    "content-length": String(end - start + 1),
    "content-disposition": `attachment; filename="${archiveName}"`,
    ...(range ? { "content-range": `bytes ${start}-${end}/${archiveSize}` } : {})
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  activeDownloads += 1;
  try {
    await sendPinnedRange(request, response, start, end);
  } finally {
    activeDownloads = Math.max(0, activeDownloads - 1);
  }
}
server.maxHeadersCount = 50;
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.on("clientError", (_error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});
server.listen(port, host, () => {
  console.log(`Verified ClearLedger beta download listening on http://${host}:${port}`);
  console.log(`Archive: ${archiveName}`);
  console.log(`SHA-256: ${expectedSha256}`);
});
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

function allowReadMethod(request, response) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  response.setHeader("cache-control", "no-store");
  response.setHeader("allow", "GET, HEAD");
  response.writeHead(405).end();
  return false;
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  )
    return false;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function applyHeaders(response) {
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("cross-origin-resource-policy", "same-site");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.setHeader("cache-control", "no-store");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length)
  });
  response.end(body);
}

async function archiveIsStable() {
  try {
    const [handleStat, pathStat] = await Promise.all([
      archiveHandle.stat({ bigint: true }),
      stat(archivePath, { bigint: true })
    ]);
    return (
      statIdentityMatches(handleStat, archiveSnapshot) &&
      statIdentityMatches(pathStat, archiveSnapshot)
    );
  } catch {
    return false;
  }
}

function statIdentityMatches(actual, expected) {
  return (
    actual.isFile() &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.size === expected.size &&
    actual.mtimeNs === expected.mtimeNs &&
    actual.ctimeNs === expected.ctimeNs
  );
}

async function hashOpenFile(handle, size) {
  const hash = createHash("sha256");
  let position = 0;
  while (position < size) {
    const length = Math.min(1024 * 1024, size - position);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead < 1) throw new Error("The public-beta archive ended during verification.");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function sendPinnedRange(request, response, start, end) {
  let position = start;
  while (position <= end) {
    if (request.aborted || response.destroyed)
      throw new Error("The client ended the download before it completed.");
    const length = Math.min(64 * 1024, end - position + 1);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await archiveHandle.read(buffer, 0, length, position);
    if (bytesRead < 1) throw new Error("The verified archive ended during download.");
    await writeChunk(response, buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  response.end();
}

function writeChunk(response, chunk) {
  return new Promise((resolveWrite, rejectWrite) => {
    response.write(chunk, (error) => {
      if (error) rejectWrite(error);
      else resolveWrite();
    });
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; stopping verified download service.`);
  server.close(async (error) => {
    try {
      await archiveHandle.close();
    } finally {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    }
  });
}
