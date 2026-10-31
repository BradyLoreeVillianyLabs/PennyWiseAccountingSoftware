import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { PrismaClient, verifyRuntimeDatabaseRole } from "../packages/db/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSecretsPath = join(
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? root, "AppData", "Local"),
  "PennyWiseAccounting",
  "beta",
  "pennywise-beta-secrets.json"
);
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: { secrets: { type: "string" } }
});
const secretsPath = resolve(values.secrets ?? defaultSecretsPath);
const roleName = "pennywise_beta_runtime";

if (supervisorTaskIsRunning()) {
  throw new Error(
    "Stop the PennyWise beta supervisor before changing its runtime database credential."
  );
}

const secrets = JSON.parse(await readFile(secretsPath, "utf8"));
assertLoopbackDatabase(secrets.databaseUrl);
const adminDatabaseUrl =
  process.env.PENNYWISE_BETA_ADMIN_DATABASE_URL?.trim() || secrets.databaseUrl;
assertLoopbackDatabase(adminDatabaseUrl);
const password = randomBytes(32).toString("base64url");
const admin = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl } } });

try {
  const roleRows = await admin.$queryRawUnsafe(
    "SELECT 1 FROM pg_roles WHERE rolname = 'pennywise_beta_runtime'"
  );
  if (roleRows.length === 0) {
    await admin.$executeRawUnsafe(
      `CREATE ROLE ${roleName} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
    );
  } else {
    await admin.$executeRawUnsafe(
      `ALTER ROLE ${roleName} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
    );
  }
  await admin.$executeRawUnsafe(`GRANT clearledger_runtime TO ${roleName}`);

  const runtimeUrl = new URL(secrets.databaseUrl);
  runtimeUrl.username = roleName;
  runtimeUrl.password = password;
  const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl.toString() } } });
  try {
    await verifyRuntimeDatabaseRole(runtime);
  } finally {
    await runtime.$disconnect();
  }
  secrets.runtimeDatabaseUrl = runtimeUrl.toString();
  await writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { encoding: "utf8" });
  if (process.platform === "win32") {
    try {
      execFileSync("cipher.exe", ["/e", "/a", secretsPath], { stdio: "ignore", windowsHide: true });
    } catch {
      // The beta-access bootstrap retains a user-only ACL when EFS is unavailable.
    }
  }
  console.log(
    "PennyWise beta now uses a constrained database runtime role. No credential was printed."
  );
} catch (error) {
  if (isMissingRoleProvisioningPrivilege(error)) {
    throw new Error(
      "A privileged loopback migration login is required to provision the PennyWise beta runtime role. " +
        "Set PENNYWISE_BETA_ADMIN_DATABASE_URL only in the current shell to an approved " +
        "127.0.0.1:55432/clearledger administrative connection, then rerun this command."
    );
  }
  throw error;
} finally {
  await admin.$disconnect();
}

function assertLoopbackDatabase(value) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) !== 55432 ||
    url.pathname.replace(/^\//, "") !== "clearledger"
  )
    throw new Error(
      "The PennyWise beta runtime role can be provisioned only for 127.0.0.1:55432/clearledger."
    );
}

function supervisorTaskIsRunning() {
  try {
    const output = execFileSync(
      "schtasks.exe",
      ["/Query", "/TN", "PennyWise Beta Tunnel Supervisor", "/FO", "LIST", "/V"],
      { encoding: "utf8", windowsHide: true }
    );
    return /^Status:\s+Running\s*$/im.test(output);
  } catch {
    return false;
  }
}

function isMissingRoleProvisioningPrivilege(error) {
  const message = String(error instanceof Error ? error.message : error);
  return /permission denied to create role|only roles with the createrole attribute/i.test(message);
}
