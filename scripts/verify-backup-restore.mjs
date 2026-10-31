import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceUrl = process.env.BACKUP_RESTORE_SOURCE_DATABASE_URL;
const targetUrl = process.env.BACKUP_RESTORE_TARGET_DATABASE_URL;
const dockerContainer = process.env.BACKUP_RESTORE_DOCKER_CONTAINER;

if (!sourceUrl || !targetUrl) {
  throw new Error(
    "BACKUP_RESTORE_SOURCE_DATABASE_URL and BACKUP_RESTORE_TARGET_DATABASE_URL are required."
  );
}
if (dockerContainer && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(dockerContainer)) {
  throw new Error("BACKUP_RESTORE_DOCKER_CONTAINER contains unsupported characters.");
}

const targetName = new URL(targetUrl).pathname.replace(/^\//, "");
if (
  process.env.ALLOW_DESTRUCTIVE_BACKUP_RESTORE !== "true" &&
  !/^clearledger_restore_verify_/.test(targetName)
) {
  throw new Error(
    `Refusing to restore into \"${targetName}\". Use a database named clearledger_restore_verify_* or set ALLOW_DESTRUCTIVE_BACKUP_RESTORE=true.`
  );
}

const pgDump = resolvePostgresTool("pg_dump");
const pgRestore = resolvePostgresTool("pg_restore");
const psql = resolvePostgresTool("psql");
const source = postgresConnection(sourceUrl);
const target = postgresConnection(targetUrl);
const workDir = mkdtempSync(join(tmpdir(), "clearledger-backup-restore-"));
const archivePath = join(workDir, "restore-drill.dump");

try {
  if (dockerContainer) {
    const sourceDatabase = dockerDatabase(sourceUrl);
    writeFileSync(
      archivePath,
      runBinary("docker", [
        "exec",
        dockerContainer,
        "pg_dump",
        "-U",
        sourceDatabase.user,
        "-d",
        sourceDatabase.name,
        "--format=custom",
        "--no-owner"
      ])
    );
  } else {
    run(
      pgDump,
      [source.url, "--format=custom", "--no-owner", "--file", archivePath],
      source.environment
    );
  }
  const archive = readFileSync(archivePath);
  if (archive.length === 0) throw new Error("Backup archive is empty.");
  const checksum = createHash("sha256").update(archive).digest("hex");
  let migrationCount;
  if (dockerContainer) {
    const targetDatabase = dockerDatabase(targetUrl);
    runBinary(
      "docker",
      [
        "exec",
        "-i",
        dockerContainer,
        "pg_restore",
        "-U",
        targetDatabase.user,
        "-d",
        targetDatabase.name,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--exit-on-error"
      ],
      archive
    );
    migrationCount = run(
      "docker",
      [
        "exec",
        dockerContainer,
        "psql",
        "-U",
        targetDatabase.user,
        "-d",
        targetDatabase.name,
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        'SELECT COUNT(*) FROM "_prisma_migrations";'
      ],
      {}
    ).trim();
  } else {
    run(
      pgRestore,
      [
        "--dbname",
        target.url,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--exit-on-error",
        archivePath
      ],
      target.environment
    );
    migrationCount = run(
      psql,
      [
        target.url,
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        'SELECT COUNT(*) FROM "_prisma_migrations";'
      ],
      target.environment
    ).trim();
  }
  if (!/^\d+$/.test(migrationCount) || Number(migrationCount) === 0)
    throw new Error("Restored database does not contain Prisma migration history.");
  console.log(
    `Backup restore drill passed: ${basename(archivePath)} (${archive.length} bytes, sha256 ${checksum}, ${migrationCount} migrations) restored into ${targetName}.`
  );
} finally {
  if (process.env.KEEP_BACKUP_RESTORE_ARTIFACTS !== "true") {
    rmSync(workDir, { recursive: true, force: true });
  } else {
    console.log(`Backup restore artifact retained at ${archivePath}.`);
  }
}

function resolvePostgresTool(name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [
    process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, executable) : undefined,
    join(
      repoRoot,
      ".tmp",
      "tools",
      "postgresql-17.10-2-windows-x64-binaries",
      "pgsql",
      "bin",
      executable
    ),
    executable
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === executable || existsSync(candidate)) return candidate;
  }
  return executable;
}

function postgresConnection(url) {
  const parsed = new URL(url);
  const password = parsed.password;
  parsed.search = "";
  parsed.password = "";
  return {
    url: parsed.toString(),
    environment: password ? { PGPASSWORD: decodeURIComponent(password) } : {}
  };
}

function dockerDatabase(url) {
  const parsed = new URL(url);
  return {
    name: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    user: decodeURIComponent(parsed.username)
  };
}

function run(command, args, environment = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout || "unknown error"}`);
  }
  return result.stdout;
}

function runBinary(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: null,
    maxBuffer: 512 * 1024 * 1024,
    ...(input === undefined ? {} : { input })
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.stderr?.toString("utf8") || result.stdout?.toString("utf8") || "unknown error"}`
    );
  }
  return result.stdout;
}
