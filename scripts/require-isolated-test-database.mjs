import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const betaHostnames = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Returns the explicitly configured disposable test database URL.
 * Browser, integration, and performance suites create and reset tenants.
 * They must never inherit the PennyWise beta deployment's live database URL.
 */
export function requireIsolatedTestDatabase(purpose, environment = process.env) {
  const databaseUrl = environment.TEST_DATABASE_URL?.trim();
  if (!databaseUrl)
    throw new Error(
      purpose +
        " requires TEST_DATABASE_URL. Refusing to fall back to DATABASE_URL because beta data must not be reset by a test suite."
    );

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(purpose + " TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  const databaseName = decodeURIComponent(parsed.pathname).slice(1);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !databaseName)
    throw new Error(purpose + " TEST_DATABASE_URL must name a PostgreSQL database.");
  if (
    betaHostnames.has(parsed.hostname) &&
    Number(parsed.port) === 55432 &&
    databaseName === "clearledger"
  )
    throw new Error(
      purpose +
        " refuses the PennyWise beta database at 127.0.0.1:55432/clearledger. Use a disposable TEST_DATABASE_URL instead."
    );

  const normalizedDatabaseName = databaseName.toLowerCase();
  const looksDisposable =
    normalizedDatabaseName.startsWith("clearledger") && normalizedDatabaseName.includes("_test");
  if (!looksDisposable && environment.CLEARLEDGER_ALLOW_NONSTANDARD_TEST_DATABASE !== "1")
    throw new Error(
      purpose +
        " TEST_DATABASE_URL must use a disposable clearledger*_test database name. Set CLEARLEDGER_ALLOW_NONSTANDARD_TEST_DATABASE=1 only in an isolated CI environment."
    );

  return databaseUrl;
}

/**
 * Locks a test database for this host so destructive suite resets cannot
 * overlap in two local terminals.
 */
export async function acquireIsolatedTestDatabaseLock(purpose, databaseUrl) {
  const parsed = new URL(databaseUrl);
  const identity = parsed.hostname + ":" + (parsed.port || "5432") + parsed.pathname;
  const lockId = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  const lockDirectory = join(
    process.env.LOCALAPPDATA ?? tmpdir(),
    "PennyWiseAccounting",
    "test-locks"
  );
  const lockPath = join(lockDirectory, "clearledger-" + lockId + ".lock");
  const metadata = JSON.stringify({
    pid: process.pid,
    purpose,
    createdAt: new Date().toISOString()
  });
  await mkdir(lockDirectory, { recursive: true });

  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readLockMetadata(lockPath);
    if (existing?.pid && !processExists(existing.pid)) {
      await rm(lockPath, { force: true });
      handle = await open(lockPath, "wx");
    } else {
      throw new Error(
        purpose +
          " cannot start because another local destructive suite holds this TEST_DATABASE_URL lock. Wait for it to finish, or remove only a stale lock after confirming that process is gone."
      );
    }
  }

  await writeFile(handle, metadata, "utf8");
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close();
    await rm(lockPath, { force: true });
  };
}

async function readLockMetadata(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
