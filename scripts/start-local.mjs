import { spawn } from "node:child_process";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://clearledger:clearledger_dev_only@localhost:5432/clearledger?schema=public";
start("API", ["--import", "tsx", "apps/api/src/index.ts"], {
  DATABASE_URL: databaseUrl,
  PORT: process.env.PORT ?? "3001"
});
start("web", ["apps/web/serve.mjs"], {
  API_BASE_URL: process.env.API_BASE_URL ?? "http://localhost:3001",
  WEB_PORT: process.env.WEB_PORT ?? "3000"
});

console.log(
  "Started ClearLedger API on http://localhost:3001 and web app on http://localhost:3000."
);

function start(label, args, environment) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, ...environment },
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  child.once("error", (error) => {
    console.error(`Unable to start ${label}: ${error.message}`);
  });
}
