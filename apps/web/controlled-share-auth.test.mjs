import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const accessUsername = "beta_tester";
const accessPassword = "test-only-pennywise-access-password";
const accessHeader = `Basic ${Buffer.from(`${accessUsername}:${accessPassword}`).toString("base64")}`;
const organizationId = "11111111-1111-4111-8111-111111111111";
let upstream;
let upstreamPort;
let upstreamHeaders = null;
let web;
let webPort;

before(async () => {
  upstream = createServer((request, response) => {
    upstreamHeaders = request.headers;
    response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  });
  upstreamPort = await listen(upstream);
  webPort = await unusedPort();
  web = spawn(process.execPath, ["apps/web/serve.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      WEB_HOST: "127.0.0.1",
      WEB_PORT: String(webPort),
      API_BASE_URL: `http://127.0.0.1:${String(upstreamPort)}`,
      APP_ORIGIN: "https://pennywise-beta.example.test",
      SHARE_IDENTITY_EMAIL: "beta.tester@example.test",
      SHARE_IDENTITY_NAME: "Beta Tester",
      SHARE_ORGANIZATION_ID: organizationId,
      SHARE_ACCESS_USERNAME: accessUsername,
      SHARE_ACCESS_PASSWORD: accessPassword
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  await waitFor(() => fetch(`${webUrl()}/`, { headers: { authorization: accessHeader } }));
});

after(async () => {
  if (web?.pid) {
    if (process.platform === "win32")
      spawnSync("taskkill.exe", ["/pid", String(web.pid), "/t", "/f"], { stdio: "ignore" });
    else web.kill("SIGTERM");
  }
  await new Promise((resolve) => upstream?.close(resolve));
});

test("controlled share rejects unauthenticated and incorrect credentials before serving assets", async () => {
  const unauthenticated = await fetch(`${webUrl()}/`, { redirect: "manual" });
  assert.equal(unauthenticated.status, 401);
  assert.equal(
    unauthenticated.headers.get("www-authenticate"),
    'Basic realm="PennyWise Beta", charset="UTF-8"'
  );

  const rejected = await fetch(`${webUrl()}/`, {
    headers: {
      authorization: `Basic ${Buffer.from("beta_tester:wrong-password").toString("base64")}`
    },
    redirect: "manual"
  });
  assert.equal(rejected.status, 401);
});

test("controlled share serves its assigned shell only after authentication", async () => {
  const accepted = await fetch(`${webUrl()}/`, { headers: { authorization: accessHeader } });
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /data-runtime-mode="controlled-share"/);
});

test("controlled share strips browser authorization and injects only its fixed identity upstream", async () => {
  upstreamHeaders = null;
  const response = await fetch(`${webUrl()}/api/health`, {
    headers: {
      authorization: accessHeader,
      "x-clearledger-user-email": "attacker@example.test",
      "x-clearledger-organization-id": "22222222-2222-4222-8222-222222222222"
    }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(upstreamHeaders?.authorization, undefined);
  assert.equal(upstreamHeaders?.["x-clearledger-user-email"], "beta.tester@example.test");
  assert.equal(upstreamHeaders?.["x-clearledger-organization-id"], organizationId);
  assert.equal(upstreamHeaders?.origin, "https://pennywise-beta.example.test");
});

function webUrl() {
  return `http://127.0.0.1:${String(webPort)}`;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a loopback TCP address.");
  return address.port;
}

async function unusedPort() {
  const probe = createNetServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor(request) {
  const deadline = Date.now() + 30_000;
  let lastError = "unavailable";
  while (Date.now() < deadline) {
    try {
      const response = await request();
      if (response.ok) return;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for controlled web server: ${lastError}`);
}
