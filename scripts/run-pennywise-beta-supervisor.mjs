import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptsDirectory, "..");
const betaDirectory = join(
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? root, "AppData", "Local"),
  "PennyWiseAccounting",
  "beta"
);
const taskLogPath = join(betaDirectory, "task-supervisor.log");

await mkdir(betaDirectory, { recursive: true });
await writeLog("Task wrapper started.");

let child;
try {
  child = spawn(
    process.execPath,
    [join(scriptsDirectory, "pennywise-beta-access.mjs"), ...process.argv.slice(2)],
    {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  child.stdout.on("data", (chunk) => void writeLog(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => void writeLog(chunk.toString("utf8")));
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  await writeLog("Task wrapper exited with code " + String(exitCode) + ".");
  process.exitCode = exitCode;
} catch (error) {
  await writeLog("Task wrapper failed: " + sanitize(error));
  process.exitCode = 1;
}

async function writeLog(message) {
  const normalized = sanitize(message).replaceAll("\r", "");
  await appendFile(taskLogPath, new Date().toISOString() + " " + normalized, "utf8");
}

function sanitize(value) {
  return String(value instanceof Error ? (value.stack ?? value.message) : value)
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[redacted database URL]")
    .replace(
      /(SHARE_ACCESS_PASSWORD|CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET)=\S+/gi,
      "$1=[redacted]"
    );
}
