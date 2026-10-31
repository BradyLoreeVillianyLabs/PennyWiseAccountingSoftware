import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

process.once("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    organization: { type: "string" },
    subdomain: { type: "string" },
    reserved: { type: "boolean", default: false },
    username: { type: "string", default: "viewer" },
    // Accepted solely to explain the secure replacement rather than letting a
    // password silently reach Windows process listings.
    password: { type: "string" },
    "web-port": { type: "string", default: "3100" },
    "api-port": { type: "string", default: "3101" },
    "webhook-base-url": { type: "string" }
  },
  strict: true
});

const email = required("email");
const displayName = values.name?.trim() || email;
const organizationId = required("organization");
const subdomain = required("subdomain");
const username = values.username ?? "viewer";
const password = process.env.SHARE_ACCESS_PASSWORD;
const webPort = port("web-port", "3100");
const apiPort = port("api-port", "3101");
const appOrigin = `https://${subdomain}.loclx.io`;
const webhookBaseUrl = optionalHttpsOrigin(values["webhook-base-url"]);
const databaseUrl = process.env.DATABASE_URL?.trim();
const loclxCommand =
  process.env.PENNYWISE_LOCLX_PATH?.trim() ??
  (process.platform === "win32" ? "loclx.exe" : "loclx");
const connectorCredentialEncryptionSecret =
  process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET?.trim();

validateEmail(email);
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)
)
  fail("--organization must be the UUID of the one organization you intend to share.");
if (!/^pennywise[a-z0-9-]+$/.test(subdomain))
  fail("--subdomain must be a PennyWise-branded lowercase LocalXpose name.");
if (!/^[A-Za-z0-9_-]{3,64}$/.test(username)) fail("--username must be 3-64 safe characters.");
if (values.password)
  fail(
    "--password is retired. Put the access password in SHARE_ACCESS_PASSWORD so it never appears in a command line."
  );
if (!password || password.length < 20 || /[\r\n]/.test(password))
  fail(
    "Set SHARE_ACCESS_PASSWORD to a stable access password of at least 20 characters without line breaks before starting a controlled share."
  );
if (!connectorCredentialEncryptionSecret || connectorCredentialEncryptionSecret.length < 32)
  fail(
    "Set CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET to a stable high-entropy value of at least 32 characters before starting a controlled share."
  );
if (
  process.env.PENNYWISE_BETA_SUPERVISED !== "1" &&
  process.env.PENNYWISE_ALLOW_ONE_OFF_SHARE !== "1"
)
  fail(
    "Start controlled browser shares through pennywise-beta-access.mjs. Set PENNYWISE_ALLOW_ONE_OFF_SHARE=1 only for deliberate short-lived maintenance."
  );
if (!databaseUrl)
  fail(
    "Set DATABASE_URL to the approved loopback PennyWise development database before starting a controlled share."
  );
validateDevelopmentDatabase(databaseUrl);
if (webPort === apiPort) fail("--web-port and --api-port must be different controlled-beta ports.");

const api = start("API", process.execPath, ["--import", "tsx", "apps/api/src/index.ts"], {
  DATABASE_URL: databaseUrl,
  HOST: "127.0.0.1",
  PORT: String(apiPort),
  APP_BASE_URL: appOrigin,
  API_BASE_URL: `http://127.0.0.1:${String(apiPort)}`,
  CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET: connectorCredentialEncryptionSecret,
  ...(webhookBaseUrl ? { CONNECTOR_WEBHOOK_BASE_URL: webhookBaseUrl } : {})
});
const web = start("web", process.execPath, ["apps/web/serve.mjs"], {
  API_BASE_URL: `http://127.0.0.1:${String(apiPort)}`,
  APP_ORIGIN: appOrigin,
  WEB_PORT: String(webPort),
  SHARE_IDENTITY_EMAIL: email,
  SHARE_IDENTITY_NAME: displayName,
  SHARE_ORGANIZATION_ID: organizationId,
  SHARE_ACCESS_USERNAME: username,
  SHARE_ACCESS_PASSWORD: password
});
let tunnel = null;
let stopping = false;
process.once("SIGINT", () => stopAndExit(0));
process.once("SIGTERM", () => stopAndExit(0));

try {
  await waitForOk(`http://127.0.0.1:${String(apiPort)}/health`, undefined, api);
  await waitForOk(
    `http://127.0.0.1:${String(webPort)}/`,
    {
      authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
    },
    web
  );
  await confirmMembership();

  console.log("\nControlled PennyWise beta share is ready to start.");
  console.log(`Share URL: ${appOrigin}`);
  console.log(`Access username: ${username}`);
  console.log("Access password: managed outside this process and never printed.");
  console.log(`Shared application identity: ${email}`);
  console.log("Keep this window open while sharing. Press Ctrl+C to end access.\n");

  const tunnelAddress = values.reserved
    ? ["--reserved-domain", `${subdomain}.loclx.io`]
    : ["--subdomain", subdomain];
  tunnel = spawn(
    loclxCommand,
    [
      "tunnel",
      "http",
      "--to",
      `127.0.0.1:${String(webPort)}`,
      ...tunnelAddress,
      "--rate-limit",
      "20",
      "--https-redirect"
    ],
    { cwd: rootPath, stdio: "inherit", windowsHide: true }
  );
  await new Promise((resolve, reject) => {
    tunnel.once("error", reject);
    tunnel.once("exit", (code) => resolve(code));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  stop(tunnel);
  stop(web);
  stop(api);
}

function required(name) {
  const value = values[name]?.trim();
  if (!value) fail(`--${name} is required.`);
  return value;
}

function port(name, fallback) {
  const value = Number.parseInt(values[name] ?? fallback, 10);
  if (!Number.isInteger(value) || value < 3100 || value > 3701)
    fail(`--${name} must remain inside the controlled-beta port range 3100 to 3701.`);
  return value;
}

function validateDevelopmentDatabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) !== 55432 ||
    url.pathname.replace(/^\//, "") !== "clearledger"
  )
    fail(
      "DATABASE_URL must target only 127.0.0.1:55432/clearledger for PennyWise controlled beta."
    );
}

function validateEmail(value) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail("--email must be a valid email address.");
}

function optionalHttpsOrigin(value) {
  if (!value?.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    fail("--webhook-base-url must be a valid HTTPS origin.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    fail("--webhook-base-url must be an HTTPS origin without credentials, path, query, or hash.");
  return parsed.origin;
}

function fail(message) {
  throw new Error(message);
}

function start(label, command, args, environment) {
  const child = spawn(command, args, {
    cwd: rootPath,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function waitForOk(url, headers = undefined, child = null) {
  const deadline = Date.now() + 30_000;
  let lastError = "unavailable";
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`The process serving ${url} exited with code ${String(child.exitCode)}.`);
    }
    try {
      const response = await fetch(url, headers ? { headers } : undefined);
      if (response.ok) return;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function confirmMembership() {
  const response = await fetch(`http://127.0.0.1:${String(apiPort)}/v1/organizations`, {
    headers: {
      "x-clearledger-user-email": email,
      "x-clearledger-user-name": email,
      "x-clearledger-email-verified": "true"
    }
  });
  if (!response.ok) throw new Error("Could not confirm the shared user's organization access.");
  const body = await response.json();
  if (!body.organizations.some((item) => item.organizationId === organizationId))
    throw new Error(
      "The shared email is not an active member of the chosen organization. Invite it locally, accept the invitation locally, then retry."
    );
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

function stopAndExit(code) {
  if (stopping) return;
  stopping = true;
  stop(tunnel);
  stop(web);
  stop(api);
  process.exit(code);
}
