import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const migrationsDir = join(repoRoot, "packages", "db", "prisma", "migrations");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for rollback verification.");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "");

if (
  process.env.ALLOW_DESTRUCTIVE_ROLLBACK_VERIFY !== "true" &&
  !/^clearledger_rollback_verify_/.test(databaseName)
) {
  throw new Error(
    `Refusing destructive rollback verification on database "${databaseName}". ` +
      'Use a database named "clearledger_rollback_verify_*" or set ALLOW_DESTRUCTIVE_ROLLBACK_VERIFY=true.'
  );
}

const migrationDirectories = readdirSync(migrationsDir, { withFileTypes: true }).filter((entry) =>
  entry.isDirectory()
);
const missingDownFiles = migrationDirectories.filter(
  (entry) => !existsSync(join(migrationsDir, entry.name, "down.sql"))
);

if (missingDownFiles.length > 0) {
  throw new Error(
    `Every migration requires down.sql; missing: ${missingDownFiles
      .map((entry) => entry.name)
      .sort()
      .join(", ")}.`
  );
}

const downFiles = migrationDirectories
  .map((entry) => ({
    migrationName: entry.name,
    file: join(migrationsDir, entry.name, "down.sql")
  }))
  .sort((left, right) => right.migrationName.localeCompare(left.migrationName));

if (downFiles.length === 0) {
  throw new Error("No down.sql files found to verify.");
}

const psql = resolvePsql();
const psqlDatabaseUrl = toPsqlDatabaseUrl(databaseUrl);

deployMigrations();
applyDownMigrations();
deployMigrations();
applyDownMigrations();

console.log(`Verified ${downFiles.length} migration rollback file(s) on ${databaseName}.`);

function deployMigrations() {
  const pnpmExecutable = process.env.npm_execpath;

  if (pnpmExecutable) {
    run(
      process.execPath,
      [pnpmExecutable, "--filter", "@clearledger/db", "run", "migrate:deploy"],
      "Prisma migration deploy failed."
    );
    return;
  }

  run(
    process.platform === "win32" ? "corepack.cmd" : "corepack",
    ["pnpm", "--filter", "@clearledger/db", "run", "migrate:deploy"],
    "Prisma migration deploy failed."
  );
}

function applyDownMigrations() {
  for (const downFile of downFiles) {
    if (psql.kind === "docker") {
      run(
        "docker",
        [
          "exec",
          "-i",
          psql.container,
          "psql",
          "-U",
          decodeURIComponent(parsedDatabaseUrl.username),
          "-d",
          databaseName,
          "-v",
          "ON_ERROR_STOP=1"
        ],
        `Rollback failed for ${downFile.migrationName}.`,
        readFileSync(downFile.file, "utf8")
      );
      continue;
    }
    run(
      psql.executable,
      [psqlDatabaseUrl, "-v", "ON_ERROR_STOP=1", "-f", downFile.file],
      `Rollback failed for ${downFile.migrationName}.`
    );
  }
}

function run(command, args, failureMessage, input) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    ...(input === undefined ? {} : { input })
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(failureMessage);
  }
}

function resolvePsql() {
  const dockerContainer = process.env.PSQL_DOCKER_CONTAINER;
  if (dockerContainer) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(dockerContainer)) {
      throw new Error("PSQL_DOCKER_CONTAINER contains unsupported characters.");
    }
    return { kind: "docker", container: dockerContainer };
  }

  const executable = process.platform === "win32" ? "psql.exe" : "psql";
  const candidates = [
    process.env.PSQL,
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
    if (candidate === executable || existsSync(candidate)) {
      return { kind: "local", executable: candidate };
    }
  }

  return { kind: "local", executable };
}

function toPsqlDatabaseUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("schema");
  return parsed.toString();
}
