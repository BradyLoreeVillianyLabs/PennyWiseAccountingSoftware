import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = import.meta.dirname;
const builtRoot = resolve(root, "dist");
const assetRoot = await resolveAssetRoot();
const port = Number.parseInt(process.env.WEB_PORT ?? "3000", 10);
const host = process.env.WEB_HOST?.trim() || "127.0.0.1";
const apiBaseUrl = new URL(process.env.API_BASE_URL ?? "http://localhost:3001");
const appOrigin = new URL(process.env.APP_ORIGIN ?? `http://localhost:${port}`).origin;
const shareIdentityEmail = process.env.SHARE_IDENTITY_EMAIL?.trim().toLowerCase() || null;
const shareIdentityName = process.env.SHARE_IDENTITY_NAME?.trim() || shareIdentityEmail;
const shareOrganizationId = process.env.SHARE_ORGANIZATION_ID?.trim() || null;
const shareAccessUsername = process.env.SHARE_ACCESS_USERNAME?.trim() || null;
const shareAccessPassword = process.env.SHARE_ACCESS_PASSWORD ?? null;
if (Boolean(shareIdentityEmail) !== Boolean(shareOrganizationId))
  throw new Error("SHARE_IDENTITY_EMAIL and SHARE_ORGANIZATION_ID must be configured together.");
if (shareIdentityEmail && (!shareAccessUsername || !shareAccessPassword))
  throw new Error(
    "Controlled share mode requires SHARE_ACCESS_USERNAME and SHARE_ACCESS_PASSWORD before it can listen."
  );
if (!shareIdentityEmail && (shareAccessUsername || shareAccessPassword))
  throw new Error(
    "SHARE_ACCESS_USERNAME and SHARE_ACCESS_PASSWORD are valid only with controlled share identity settings."
  );
if (shareIdentityEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shareIdentityEmail))
  throw new Error("SHARE_IDENTITY_EMAIL must be a valid email address.");
if (
  shareOrganizationId &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    shareOrganizationId
  )
)
  throw new Error("SHARE_ORGANIZATION_ID must be a UUID.");
if (shareAccessUsername && !/^[A-Za-z0-9_-]{3,64}$/.test(shareAccessUsername))
  throw new Error("SHARE_ACCESS_USERNAME must be 3-64 safe characters.");
if (shareAccessPassword && (shareAccessPassword.length < 20 || /[\r\n]/.test(shareAccessPassword)))
  throw new Error(
    "SHARE_ACCESS_PASSWORD must be at least 20 characters and cannot contain line breaks."
  );
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/pwa.js", ["pwa.js", "text/javascript; charset=utf-8"]],
  ["/money.js", ["money.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
  ["/offline.html", ["offline.html", "text/html; charset=utf-8"]],
  ["/icons/clearledger.svg", ["icons/clearledger.svg", "image/svg+xml"]],
  ["/icons/clearledger-maskable.svg", ["icons/clearledger-maskable.svg", "image/svg+xml"]]
]);

createServer(async (request, response) => {
  try {
    if (!isAuthorizedControlledShare(request)) {
      response
        .writeHead(401, {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "www-authenticate": 'Basic realm="PennyWise Beta", charset="UTF-8"',
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY"
        })
        .end("PennyWise beta access is required.");
      return;
    }
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/public/")) {
      await proxyRequest(request, response, requestUrl);
      return;
    }
    const asset = assets.get(requestUrl.pathname);
    if (!asset) {
      response.writeHead(404).end("Not found");
      return;
    }
    const [file, contentType] = asset;
    let body = await readFile(resolve(assetRoot, file));
    if (file === "index.html" && shareIdentityEmail) {
      const html = body.toString("utf8");
      const runtimeMarker = 'data-runtime-mode="standard"';
      if (!html.includes(runtimeMarker))
        throw new Error("The web shell runtime marker is missing.");
      body = Buffer.from(html.replace(runtimeMarker, 'data-runtime-mode="controlled-share"'));
    }
    response.writeHead(200, {
      "content-type": contentType,
      // The controlled beta server reads assets from disk on every request.
      // Revalidate them on an ordinary browser refresh so UI updates do not
      // require restarting the Loclx tunnel or clearing a PWA cache.
      "cache-control": "no-cache",
      ...(requestUrl.pathname === "/service-worker.js" ? { "service-worker-allowed": "/" } : {}),
      "content-security-policy":
        "default-src 'self'; connect-src 'self'; img-src 'self' https: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    });
    response.end(body);
  } catch {
    response.writeHead(502).end("Request failed");
  }
}).listen(port, host, () => {
  console.log(`PennyWise Accounting identity web flow listening on ${host}:${port}`);
  if (shareIdentityEmail)
    console.log(
      "PennyWise Accounting controlled share mode is active for one configured organization behind the local access gate."
    );
});

function isAuthorizedControlledShare(request) {
  if (!shareIdentityEmail || !shareAccessUsername || !shareAccessPassword) return true;
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Basic ")) return false;
  let supplied;
  try {
    supplied = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return false;
  }
  return safeEqual(supplied, `${shareAccessUsername}:${shareAccessPassword}`);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function resolveAssetRoot() {
  try {
    await Promise.all(
      ["index.html", "app.js", "styles.css"].map((file) => access(resolve(builtRoot, file)))
    );
    return builtRoot;
  } catch {
    // Keep `node serve.mjs` dependable for a fresh checkout while making the
    // real server response use the same optimized assets that release checks
    // measure. The source verifier runs as part of this build script.
    await import("./scripts/build-assets.mjs");
    return builtRoot;
  }
}

async function proxyRequest(request, response, requestUrl) {
  const targetPath = requestUrl.pathname.startsWith("/api/")
    ? requestUrl.pathname.slice("/api".length)
    : requestUrl.pathname;
  const target = new URL(targetPath + requestUrl.search, apiBaseUrl);
  const body = await readRequestBody(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value && !["host", "content-length", "connection", "authorization"].includes(name)) {
      headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
  }
  if (shareIdentityEmail && shareOrganizationId) {
    for (const name of [
      "x-clearledger-user-email",
      "x-clearledger-user-name",
      "x-clearledger-email-verified",
      "x-clearledger-organization-id",
      "x-clearledger-recent-auth-at",
      "x-clearledger-mfa-authenticated"
    ])
      headers.delete(name);
    headers.set("x-clearledger-user-email", shareIdentityEmail);
    headers.set("x-clearledger-user-name", shareIdentityName);
    headers.set("x-clearledger-email-verified", "true");
    headers.set("x-clearledger-organization-id", shareOrganizationId);
    headers.set("x-clearledger-recent-auth-at", new Date().toISOString());
    headers.set("x-clearledger-mfa-authenticated", "true");
  }
  headers.set("origin", appOrigin);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: body.length > 0 ? body : undefined,
    redirect: "manual"
  });
  const responseHeaders = Object.fromEntries(upstream.headers.entries());
  const cookies = upstream.headers.getSetCookie();
  if (cookies.length > 0) responseHeaders["set-cookie"] = cookies;
  response.writeHead(upstream.status, responseHeaders);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
