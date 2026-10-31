import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  acquireIsolatedTestDatabaseLock,
  requireIsolatedTestDatabase
} from "./require-isolated-test-database.mjs";

const databaseUrl = requireIsolatedTestDatabase("Browser tests");
const releaseTestDatabaseLock = await acquireIsolatedTestDatabaseLock("Browser tests", databaseUrl);

// Development shares frequently occupy 3100/3101. Browser tests must never
// attach to or compete with a shared tunnel's service, so use an isolated port
// range by default and advance safely when another local test owns it.
const apiPort = await browserTestPort("PLAYWRIGHT_API_PORT", 3501);
const webPort = await browserTestPort("PLAYWRIGHT_WEB_PORT", 3500, new Set([apiPort]));
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const browserArguments = process.argv.slice(2);
if (browserArguments[0] === "--") browserArguments.shift();
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const childLifecycles = new WeakMap();
const sharedEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  NODE_ENV: "development"
};

try {
  await runPnpm(["--filter", "@clearledger/db", "run", "migrate:deploy"], sharedEnvironment);
  await assertTestDatabaseIsEmpty(databaseUrl);
  await runPnpm(["--filter", "@clearledger/web", "run", "build"], sharedEnvironment);
  const api = startService(
    process.execPath,
    ["--import", "tsx", "apps/api/src/index.ts"],
    { ...sharedEnvironment, HOST: "127.0.0.1", PORT: apiPort },
    "API"
  );
  const web = startService(
    process.execPath,
    ["apps/web/serve.mjs"],
    { ...sharedEnvironment, WEB_PORT: webPort, API_BASE_URL: apiUrl },
    "web"
  );

  try {
    await waitForOk(`${apiUrl}/health`);
    await waitForOk(webUrl);
    await runCommand(
      process.execPath,
      [playwrightCli, "test", ...browserArguments],
      {
        ...sharedEnvironment,
        PLAYWRIGHT_BASE_URL: webUrl,
        PLAYWRIGHT_SYSTEM_BROWSERS: process.platform === "win32" ? "true" : "false"
      },
      "Playwright"
    );
  } finally {
    await Promise.all([stopProcess(web), stopProcess(api)]);
  }

  // Run the contracts a browser matrix is evidence for. The `security` mode is
  // deliberately excluded: it rejects any `.env` on disk, which local
  // development requires, so running it here made this command impossible to
  // pass on a developer machine even when every test succeeded. The security
  // contract still runs where it belongs — `pnpm test:security` and the full
  // `pnpm test:release` — and is not weakened by this.
  for (const contract of ["accessibility", "performance"]) {
    await runCommand(
      process.execPath,
      ["scripts/verify-release-candidate.mjs", contract],
      sharedEnvironment,
      `release verification (${contract})`
    );
  }
  await flushStandardStreams();
} finally {
  await releaseTestDatabaseLock();
}
// On Windows, package-manager grandchildren can retain inherited handles after the verified
// service children and their pipes have closed. This script is a process boundary, so exit only
// after every test, release check, child exit, and output flush above has succeeded.
process.exit(0);

/**
 * The browser specs identify themselves with fixed per-project emails
 * (`phase14-<project>@example.test`), so a second run against the same database
 * finds the organizations the first run created. The app then opens a workspace
 * instead of the create-organization form and a dozen specs fail on
 * `#organization-form` being hidden — a failure that looks like a product
 * regression and is not one.
 *
 * `migrate:deploy` brings the schema up to date but never clears data, and the
 * isolation guard checks only the database *name*. Fail fast with an actionable
 * message rather than letting the suite produce a page of misleading failures.
 * This never deletes anything: how to dispose of a test database is the
 * operator's call.
 *
 * The check is best-effort. `@clearledger/db` is a workspace package that this
 * script cannot resolve by name, and its build output may legitimately be absent
 * on a fresh checkout, so a failure to load it warns and continues rather than
 * blocking the suite.
 */
async function assertTestDatabaseIsEmpty(databaseUrl) {
  const databaseModule = pathToFileURL(
    join(import.meta.dirname, "..", "packages", "db", "dist", "index.js")
  ).href;
  let PrismaClient;
  try {
    ({ PrismaClient } = await import(databaseModule));
  } catch {
    console.warn(
      "Browser tests could not load the database client to check that the test database is " +
        "empty; skipping that check. If many specs fail on a hidden #organization-form, the " +
        "database is probably left over from an earlier run."
    );
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const organizations = await prisma.organization.count();
    if (organizations > 0) {
      const name = decodeURIComponent(new URL(databaseUrl).pathname).slice(1);
      throw new Error(
        `Browser tests require an empty test database, but "${name}" already holds ` +
          `${String(organizations)} organization(s) from an earlier run. The specs use fixed ` +
          `identities, so reusing a populated database produces widespread false failures. ` +
          `Create a fresh database (the name must still match clearledger*_test) and point ` +
          `TEST_DATABASE_URL at it, or reset this one with ` +
          `"corepack pnpm --filter @clearledger/db run reset".`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function pnpmInvocation(args) {
  if (process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  if (process.platform === "win32") {
    // Node 20.12+ refuses to spawn .cmd/.bat without a shell (the CVE-2024-27980
    // hardening), so a bare spawn("pnpm.cmd", ...) fails with EINVAL and this
    // script could not run on Windows at all. Every argument below is an internal
    // literal — never user input — so the shell invocation carries no injection risk.
    return { command: "pnpm.cmd", args, shell: true };
  }
  return { command: "pnpm", args };
}

async function browserTestPort(environmentKey, defaultPort, reserved = new Set()) {
  const configured = process.env[environmentKey];
  if (configured !== undefined) {
    const port = Number.parseInt(configured, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error(`${environmentKey} must be a TCP port from 1024 through 65535.`);
    if (reserved.has(String(port)))
      throw new Error(`${environmentKey} duplicates another browser-test port.`);
    return String(port);
  }
  for (let port = defaultPort; port < defaultPort + 100; port += 1)
    if (!reserved.has(String(port)) && (await portIsAvailable(port))) return String(port);
  throw new Error(`No isolated browser-test port is available near ${String(defaultPort)}.`);
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close((error) => resolve(!error)));
  });
}

function startService(command, args, environment, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on("error", (error) => process.stderr.write(`[${label}] ${error.message}\n`));
  childLifecycles.set(child, {
    exit: settleOnChildEvent(child, "exit"),
    close: settleOnChildEvent(child, "close")
  });
  return child;
}

function runPnpm(args, environment) {
  const invocation = pnpmInvocation(args);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
      windowsHide: true,
      ...(invocation.shell === true ? { shell: true } : {})
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`pnpm command failed with exit code ${String(code)}: ${args.join(" ")}`));
    });
  });
}

function runCommand(command, args, environment, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${String(code)}.`));
    });
  });
}

async function waitForOk(url) {
  const deadline = Date.now() + 30_000;
  let lastError = "unavailable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function stopProcess(child) {
  if (!child) return;
  const lifecycle = childLifecycles.get(child);
  if (isRunning(child)) terminateProcessTree(child, false);

  let exited = lifecycle ? await settlesWithin(lifecycle.exit, 4_000) : !isRunning(child);
  if (!exited && isRunning(child)) {
    terminateProcessTree(child, true);
    exited = lifecycle ? await settlesWithin(lifecycle.exit, 2_000) : !isRunning(child);
  }

  const streamsClosed = await closeChildStreams(child);
  const closed = lifecycle ? await settlesWithin(lifecycle.close, 2_000) : exited;
  child.unref();

  if (!exited || !streamsClosed || !closed) {
    throw new Error(
      `Browser-test service process ${String(child.pid ?? "unknown")} did not shut down cleanly.`
    );
  }
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null && child.pid !== undefined;
}

function terminateProcessTree(child, force) {
  if (!isRunning(child)) return;
  if (process.platform === "win32") {
    const arguments_ = ["/pid", String(child.pid), "/t", "/f"];
    spawnSync("taskkill.exe", arguments_, {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5_000
    });
    if (force && isRunning(child)) child.kill("SIGKILL");
    return;
  }
  child.kill(force ? "SIGKILL" : "SIGTERM");
}

function settleOnChildEvent(child, eventName) {
  return new Promise((resolve) => {
    child.once(eventName, resolve);
    child.once("error", resolve);
  });
}

function settlesWithin(promise, milliseconds) {
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => resolve(false), milliseconds);
    promise.then(
      () => {
        globalThis.clearTimeout(timeout);
        resolve(true);
      },
      () => {
        globalThis.clearTimeout(timeout);
        resolve(false);
      }
    );
  });
}

async function closeChildStreams(child) {
  const streams = [child.stdout, child.stderr].filter(Boolean);
  const closures = streams.map(
    (stream) =>
      stream.closed ||
      new Promise((resolve) => {
        stream.once("close", resolve);
      })
  );
  for (const stream of streams) {
    if (!stream.destroyed) stream.destroy();
  }
  return await settlesWithin(Promise.all(closures), 2_000);
}

async function flushStandardStreams() {
  // Tooling and CI can wrap these streams in Windows pipes whose empty-write callback is
  // retained by a package-manager grandchild. Give the already-written output a brief chance
  // to drain, but never let this final hygiene step keep a successful release run alive.
  await settlesWithin(
    Promise.all([flushStream(process.stdout), flushStream(process.stderr)]),
    1_000
  );
}

function flushStream(stream) {
  return new Promise((resolve, reject) => {
    if (!stream.writable || stream.destroyed) return resolve();
    stream.write("", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
