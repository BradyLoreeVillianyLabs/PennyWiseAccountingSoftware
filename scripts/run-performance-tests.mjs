import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireIsolatedTestDatabaseLock,
  requireIsolatedTestDatabase
} from "./require-isolated-test-database.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = requireIsolatedTestDatabase("Performance tests");
const packageManagerEntrypoint = process.env.npm_execpath;

const command = packageManagerEntrypoint
  ? { executable: process.execPath, argsPrefix: [packageManagerEntrypoint] }
  : { executable: process.platform === "win32" ? "pnpm.cmd" : "pnpm", argsPrefix: [] };
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl
};

const releaseLock = await acquireIsolatedTestDatabaseLock("Performance tests", databaseUrl);
try {
  run(["--filter", "@clearledger/db", "run", "migrate:deploy"]);
  run(["--filter", "@clearledger/api", "run", "test:performance"]);
} finally {
  await releaseLock();
}

function run(args) {
  const result = spawnSync(command.executable, [...command.argsPrefix, ...args], {
    cwd: repoRoot,
    env: environment,
    shell: false,
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
