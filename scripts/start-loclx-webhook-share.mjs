import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    subdomain: { type: "string" },
    reserved: { type: "boolean", default: false },
    "api-port": { type: "string", default: "3101" },
    "relay-port": { type: "string", default: "3500" }
  },
  strict: true
});

const subdomain = required("subdomain");
const apiPort = port("api-port", "3101");
const relayPort = port("relay-port", "3500");
if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain))
  fail("--subdomain must use lowercase letters, numbers, and hyphens.");

const allowedHeaders = new Set([
  "content-type",
  "user-agent",
  "x-request-id",
  "x-wc-webhook-delivery-id",
  "x-wc-webhook-id",
  "x-wc-webhook-signature",
  "x-wc-webhook-source",
  "x-wc-webhook-topic",
  "webhook-id",
  "webhook-signature",
  "webhook-timestamp"
]);
const pathPattern = /^\/(?:api\/)?v1\/webhooks\/commerce\/(woocommerce|etsy)\/([0-9a-f-]{36})$/i;
const maximumBodyBytes = 1_048_576;
const apiOrigin = `http://127.0.0.1:${String(apiPort)}`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://relay.invalid");
    const match = pathPattern.exec(url.pathname);
    if (request.method !== "POST" || !match) return plain(response, 404, "Not found");
    const body = await readBoundedBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (allowedHeaders.has(name) && value)
        headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
    const upstreamPath = `/v1/webhooks/commerce/${match[1].toLowerCase()}/${match[2]}`;
    const upstream = await fetch(new URL(upstreamPath + url.search, apiOrigin), {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(upstream.headers.get("retry-after")
        ? { "retry-after": upstream.headers.get("retry-after") }
        : {})
    });
    response.end(responseBody);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    plain(response, tooLarge ? 413 : 502, tooLarge ? "Payload too large" : "Delivery failed");
  }
});

let tunnel = null;
let stopping = false;
process.once("SIGINT", () => stopAndExit(0));
process.once("SIGTERM", () => stopAndExit(0));

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(relayPort, "127.0.0.1", resolve);
});

console.log(`Signed-webhook relay listening on http://127.0.0.1:${String(relayPort)}`);
console.log(`Public webhook origin: https://${subdomain}.loclx.io`);
console.log("Only native WooCommerce and Etsy webhook POST paths are exposed.");
console.log("Keep this window open. Press Ctrl+C to stop the webhook endpoint.\n");

const tunnelAddress = values.reserved
  ? ["--reserved-domain", `${subdomain}.loclx.io`]
  : ["--subdomain", subdomain];
tunnel = spawn(
  process.platform === "win32" ? "loclx.exe" : "loclx",
  [
    "tunnel",
    "http",
    "--to",
    `127.0.0.1:${String(relayPort)}`,
    ...tunnelAddress,
    "--rate-limit",
    "60",
    "--https-redirect"
  ],
  { stdio: "inherit", windowsHide: true }
);

try {
  await new Promise((resolve, reject) => {
    tunnel.once("error", reject);
    tunnel.once("exit", resolve);
  });
} finally {
  await stopAndExit(0);
}

function required(name) {
  const value = values[name]?.trim();
  if (!value) fail(`--${name} is required.`);
  return value;
}

function port(name, fallback) {
  const value = Number.parseInt(values[name] ?? fallback, 10);
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    fail(`--${name} must be a port from 1024 to 65535.`);
  return value;
}

function fail(message) {
  throw new Error(message);
}

function plain(response, status, message) {
  if (response.headersSent) return response.end();
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(message);
}

function readBoundedBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximumBodyBytes) {
        reject(new Error("BODY_TOO_LARGE"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }
  child.kill("SIGTERM");
}

async function stopAndExit(code) {
  if (stopping) return;
  stopping = true;
  stop(tunnel);
  await new Promise((resolve) => server.close(resolve));
  process.exitCode = code;
}
