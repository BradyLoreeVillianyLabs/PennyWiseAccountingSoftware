"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const PRODUCT = "PennyWise Accounting";
const TRIAL_DAYS = 30;
const PRICING_URL = "https://typewritingmonkeys.com/pennywise-accounting/";
const appRoot = path.dirname(process.execPath);
const resources = path.join(appRoot, "resources");
const dataRoot = path.join(process.env.LOCALAPPDATA || os.homedir(), "PennyWiseAccounting");
const logRoot = path.join(dataRoot, "logs");
const logPath = path.join(logRoot, "launcher.log");
const operationRoot = fs.existsSync(path.join(resources, "native-operations.cjs"))
  ? resources
  : __dirname;
const resourceRequire = createRequire(path.join(operationRoot, "launcher-resources.cjs"));
const nativeOperations = resourceRequire("./native-operations.cjs");
const offlineActivation = resourceRequire("./offline-activation.cjs");
const children = new Set();
let databaseStarted = false;
let databasePort = 0;
let postgresRuntimeRoot = null;
let stopping = false;
let dataRootError = null;

function backupTaskOptions() {
  // Windows blocks a scheduled task from directly launching a binary under the
  // immutable WindowsApps package path. An unpackaged Inno install has no such
  // boundary, so it can invoke the installed Backup entry point directly.
  if (/\\windowsapps\\/i.test(appRoot)) return {};
  return { backupExecutablePath: path.join(appRoot, "PennyWiseBackup.exe") };
}

try {
  for (const directory of [dataRoot, logRoot, path.join(dataRoot, "files")]) {
    fs.mkdirSync(directory, { recursive: true });
  }
} catch (error) {
  dataRootError = error;
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
  process.stdout.write(`${line}\n`);
}

function fail(message, detail) {
  const actionable = startupMessage(detail);
  try {
    log(`FATAL ${message}${detail ? `: ${detail}` : ""}`);
  } catch {
    process.stderr.write(`FATAL ${message}${detail ? `: ${detail}` : ""}\n`);
  }
  showMessage(`${message}\n\n${actionable}\n\nDiagnostics: ${logPath}`, PRODUCT);
  process.exitCode = 1;
}

function startupMessage(detail) {
  const text = String(detail || "");
  if (/ENOSPC|no space left|disk full/i.test(text))
    return "This computer is out of storage space. Free space, then start PennyWise again.";
  if (/address already in use|EADDRINUSE/i.test(text))
    return "PennyWise could not reserve a private loopback port. Close the conflicting local program and start PennyWise again.";
  if (/postgres|database|PG_VERSION|pg_ctl/i.test(text))
    return "PennyWise could not start its private database. Open PennyWise Support Diagnostics and restore a verified backup if the problem continues.";
  if (/migrate/i.test(text))
    return "A PennyWise update could not finish applying its database changes. Do not uninstall; open Support Diagnostics and contact support with the diagnostic archive.";
  return "Open PennyWise Support Diagnostics and send the resulting archive to support if this happens again.";
}

function showMessage(message, title) {
  const escaped = String(message).replace(/'/g, "''");
  const escapedTitle = String(title).replace(/'/g, "''");
  spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escaped}','${escapedTitle}') | Out-Null`
    ],
    { windowsHide: true }
  );
}

function registryRead(name) {
  const result = spawnSync(
    "reg.exe",
    ["query", "HKCU\\Software\\PennyWiseAccounting", "/v", name],
    {
      encoding: "utf8",
      windowsHide: true
    }
  );
  if (result.status !== 0) return null;
  const match = result.stdout.match(new RegExp(`${name}\\s+REG_SZ\\s+(.+)$`, "mi"));
  return match ? match[1].trim() : null;
}

function registryWrite(name, value) {
  const result = spawnSync(
    "reg.exe",
    ["add", "HKCU\\Software\\PennyWiseAccounting", "/v", name, "/t", "REG_SZ", "/d", value, "/f"],
    { windowsHide: true }
  );
  if (result.status !== 0)
    throw new Error(`Could not persist ${name} in the current-user registry.`);
}

function ensureInstallationIdentity() {
  const identityPath = path.join(dataRoot, nativeOperations.INSTALLATION_ID);
  const trial = safeJson(path.join(dataRoot, "trial.json"), {});
  const existing = safeJson(identityPath, null);
  const registryInstallId = registryRead("InstallId");
  const installId =
    existing?.installId || trial.installId || registryInstallId || crypto.randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(installId))
    throw new Error(
      "The local PennyWise installation identity is invalid. Restore from a verified backup."
    );
  if (registryInstallId && registryInstallId !== installId)
    throw new Error(
      "PennyWise installation identity does not match this Windows account. Restore stopped to protect this installation."
    );
  writeJson(identityPath, {
    schema: 1,
    installId,
    createdAt: existing?.createdAt || new Date().toISOString()
  });
  registryWrite("InstallId", installId);
  return installId;
}

function safeJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function licensePolicy() {
  const policy = safeJson(path.join(resources, "license-policy.json"), {});
  if (policy?.schemaVersion !== 1)
    throw new Error("PennyWise activation policy is missing or damaged. Run setup again.");
  return {
    requireActivation: policy.requireActivation === true,
    requiredEdition: typeof policy.requiredEdition === "string" ? policy.requiredEdition : null
  };
}

function verifyOfflineLicense(installId, requiredEdition) {
  const licensePath = path.join(dataRoot, "license.json");
  if (!fs.existsSync(licensePath)) return null;
  try {
    const envelope = JSON.parse(fs.readFileSync(licensePath, "utf8"));
    const publicKey = fs.readFileSync(path.join(resources, "license-public-key.pem"), "utf8");
    const result = offlineActivation.verifyLicenseEnvelope({
      envelope,
      publicKey,
      installId,
      requiredEdition
    });
    if (result.valid) return result.claims;
    log(`Ignoring invalid PennyWise activation: ${result.error}`);
    return null;
  } catch (error) {
    log(`Ignoring invalid PennyWise activation: ${error.message}`);
    return null;
  }
}

function enforceEntitlement(installId) {
  const policy = licensePolicy();
  const license = verifyOfflineLicense(installId, policy.requiredEdition);
  if (license) {
    log(`${license.edition} entitlement verified.`);
    return true;
  }
  if (policy.requireActivation) {
    showMessage(
      "This PennyWise Beta package needs a one-time device activation before it can start. Open PennyWise Activation from Start, copy the request code shown there, then import the activation file you receive.",
      PRODUCT
    );
    return false;
  }
  const now = new Date();
  const statePath = path.join(dataRoot, "trial.json");
  let fileState = {};
  try {
    if (fs.existsSync(statePath)) fileState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    fileState = {};
  }
  const starts = [parseDate(fileState.startedAt), parseDate(registryRead("TrialStartedAt"))].filter(
    Boolean
  );
  const seen = [parseDate(fileState.lastSeenAt), parseDate(registryRead("TrialLastSeenAt"))].filter(
    Boolean
  );
  const startedAt = starts.length
    ? new Date(Math.min(...starts.map((date) => date.getTime())))
    : now;
  const lastSeenAt = seen.length ? new Date(Math.max(...seen.map((date) => date.getTime()))) : now;
  if (now.getTime() + 5 * 60 * 1000 < lastSeenAt.getTime()) {
    throw new Error(
      "The Windows clock is earlier than the last verified trial time. Correct the clock or install a Founder license."
    );
  }
  const expiresAt = new Date(startedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  if (now >= expiresAt) {
    showMessage(
      "Your 30-day PennyWise Accounting trial has ended. Purchase or import a Founder license to continue.",
      PRODUCT
    );
    spawn("rundll32.exe", ["url.dll,FileProtocolHandler", PRICING_URL], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return false;
  }
  const state = {
    schema: 1,
    installId,
    startedAt: startedAt.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  registryWrite("TrialStartedAt", state.startedAt);
  registryWrite("TrialLastSeenAt", state.lastSeenAt);
  log(`Trial entitlement active through ${state.expiresAt}.`);
  return true;
}

function redactedCommandArgs(args) {
  return args.map((argument) =>
    String(argument).replace(
      /([a-z0-9_-]*(?:password|token|secret)[a-z0-9_-]*)=\S+/gi,
      "$1=[REDACTED]"
    )
  );
}

function run(command, args, options = {}) {
  log(`RUN ${path.basename(command)} ${redactedCommandArgs(args).join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || dataRoot,
    env: options.env || process.env,
    stdio: options.stdio,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 120000
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed (${result.status ?? "no exit code"}): ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  return result.stdout;
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function loadRuntimeSecrets() {
  const file = path.join(dataRoot, "runtime-secrets.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const value = {
    databaseOwnerPassword: randomSecret(),
    databaseRuntimePassword: randomSecret(),
    webhookEncryptionSecret: randomSecret(),
    connectorEncryptionSecret: randomSecret(),
    paymentWebhookSecret: randomSecret(),
    paymentEncryptionSecret: randomSecret()
  };
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return value;
}

async function freePort(preferred) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", preferred ? () => freePort(0).then(resolve, reject) : reject);
    server.listen({ host: "127.0.0.1", port: preferred }, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function executableMode() {
  const name = path.basename(process.execPath).toLowerCase();
  if (name.includes("activation")) return "activation";
  if (name.includes("backup")) return "backup";
  if (name.includes("restore")) return "restore";
  if (name.includes("diagnostics")) return "diagnostics";
  if (process.argv.includes("--backup")) return "backup";
  if (process.argv.includes("--restore")) return "restore";
  if (process.argv.includes("--diagnostics")) return "diagnostics";
  if (process.argv.includes("--activation")) return "activation";
  return "start";
}

function pickWithPowerShell(kind) {
  const command =
    kind === "folder"
      ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose another disk, a separate volume, or a synced folder for PennyWise nightly backups. A separate volume on the same disk is allowed but will not protect against disk failure.'; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}"
      : kind === "activation"
        ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='PennyWise beta activation (*.json)|*.json'; $d.Multiselect=$false; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.FileName)}"
        : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='PennyWise backup (*.zip)|*.zip'; $d.Multiselect=$false; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.FileName)}";
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true
    }
  );
  if (result.status !== 0)
    throw new Error("Windows could not open the PennyWise backup or restore picker.");
  return result.stdout.trim() || null;
}

function configureBackupInteractively() {
  return nativeOperations.configureBackupDestinationWithPicker({
    dataRoot,
    pickDestination: () => pickWithPowerShell("folder"),
    configure: ({ dataRoot: selectedDataRoot, destination }) =>
      nativeOperations.configureNightlyBackup({
        dataRoot: selectedDataRoot,
        destination,
        ...backupTaskOptions()
      }),
    onRejected: ({ message }) =>
      showMessage(
        `${message}\n\nChoose another folder, or Cancel to start PennyWise without nightly backups.`,
        PRODUCT
      ),
    onConfigured: ({ kind }) => {
      if (kind === "separate-volume-same-disk")
        showMessage(
          "Nightly backups are configured on a separate volume on the same physical disk as your books. This does not protect against that disk failing; keep another verified copy on a different disk or approved synced folder.",
          PRODUCT
        );
    }
  });
}

async function requestRunningLauncherExit() {
  const lock = path.join(dataRoot, "launcher.lock");
  if (!fs.existsSync(lock)) return;
  writeJson(path.join(dataRoot, "shutdown-request.json"), {
    schema: 1,
    requestedAt: new Date().toISOString(),
    reason: "restore"
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (!fs.existsSync(lock)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "PennyWise is still running. Close PennyWise, wait one minute, then choose Restore again."
  );
}

async function runMode(mode) {
  if (mode === "activation") {
    const installId = ensureInstallationIdentity();
    const activationPath = pickWithPowerShell("activation");
    if (!activationPath) {
      showMessage(
        `Your PennyWise Beta activation request code is:\n${installId}\n\nSend this code to the beta operator. When you receive your activation file, open PennyWise Activation again and select it.`,
        PRODUCT
      );
      return;
    }
    const envelope = safeJson(activationPath, null);
    const publicKey = fs.readFileSync(path.join(resources, "license-public-key.pem"), "utf8");
    const result = offlineActivation.verifyLicenseEnvelope({
      envelope,
      publicKey,
      installId,
      requiredEdition: offlineActivation.BETA20_EDITION
    });
    if (!result.valid) throw new Error(result.error);
    writeJson(path.join(dataRoot, "license.json"), envelope);
    showMessage(
      `PennyWise Beta slot ${result.claims.slot} is activated for this Windows installation. Open PennyWise Accounting from Start.`,
      PRODUCT
    );
    return;
  }
  if (mode === "diagnostics") {
    const archive = nativeOperations.collectDiagnostics({ dataRoot, resources, appRoot });
    showMessage(
      `Support diagnostics are ready:\n${archive}\n\nAttach this file to your support request.`,
      PRODUCT
    );
    return;
  }
  if (mode === "backup") {
    let config = safeJson(path.join(dataRoot, nativeOperations.BACKUP_CONFIG), null);
    if (!config?.destination && process.argv.includes("--scheduled"))
      throw new Error(
        "Nightly backup has not been configured. Start PennyWise and choose a second drive or synced folder."
      );
    if (!config?.destination) {
      const result = configureBackupInteractively();
      if (!result) return;
      config = safeJson(path.join(dataRoot, nativeOperations.BACKUP_CONFIG), null);
    }
    const archive = await nativeOperations.createBackup({
      dataRoot,
      resources,
      destination: config.destination,
      retain: config.retain,
      log
    });
    if (!process.argv.includes("--scheduled"))
      showMessage(`Your verified PennyWise backup is ready:\n${archive}`, PRODUCT);
    return;
  }
  if (mode === "restore") {
    const archive = pickWithPowerShell("archive");
    if (!archive) return;
    await requestRunningLauncherExit();
    const result = await nativeOperations.restoreBackup({ dataRoot, resources, archive, log });
    showMessage(
      `PennyWise restored ${result.migrationCount} database migration records. PennyWise will now start.`,
      PRODUCT
    );
    const mainExecutable = path.join(appRoot, "PennyWiseAccounting.exe");
    spawn(mainExecutable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
}

function pgUrl(user, password, port, database = "pennywise") {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}?schema=public`;
}

function initializeDatabase(secrets) {
  postgresRuntimeRoot = nativeOperations.ensureBundledPostgresRuntime({ dataRoot, resources });
  const pgBin = path.join(postgresRuntimeRoot, "bin");
  const databaseData = path.join(dataRoot, "postgresql");
  const initdb = path.join(pgBin, "initdb.exe");
  const pgCtl = path.join(pgBin, "pg_ctl.exe");
  const psql = path.join(pgBin, "psql.exe");
  const passwordFile = path.join(dataRoot, ".owner-password");
  if (!fs.existsSync(path.join(databaseData, "PG_VERSION"))) {
    if (fs.existsSync(databaseData))
      fs.renameSync(databaseData, `${databaseData}-incomplete-${crypto.randomUUID()}`);
    fs.writeFileSync(passwordFile, secrets.databaseOwnerPassword, {
      encoding: "utf8",
      mode: 0o600
    });
    try {
      run(initdb, [
        "-D",
        databaseData,
        "--username=pennywise_owner",
        `--pwfile=${passwordFile}`,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C"
      ]);
    } finally {
      fs.rmSync(passwordFile, { force: true });
    }
  }
  // A terminated launcher can leave its private server alive. Stop only the
  // server registered to this exact data directory before selecting a new port.
  const priorServer = spawnSync(pgCtl, ["status", "-D", databaseData], {
    windowsHide: true,
    stdio: "ignore",
    timeout: 15000
  });
  if (priorServer.status === 0)
    run(pgCtl, ["stop", "-D", databaseData, "-m", "fast", "-w"], {
      stdio: "ignore",
      timeout: 60000
    });
  // pg_ctl backgrounds postgres. Do not give that child Node's captured pipes or
  // spawnSync waits for the running server instead of the pg_ctl command.
  run(pgCtl, ["start", "-D", databaseData, "-w", "-o", `-p ${databasePort} -h 127.0.0.1`], {
    stdio: "ignore"
  });
  databaseStarted = true;
  const ownerEnv = { ...process.env, PGPASSWORD: secrets.databaseOwnerPassword };
  const exists = run(
    psql,
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(databasePort),
      "-U",
      "pennywise_owner",
      "-d",
      "postgres",
      "-tAc",
      "SELECT 1 FROM pg_database WHERE datname='pennywise'"
    ],
    { env: ownerEnv }
  ).trim();
  if (exists !== "1")
    run(
      psql,
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(databasePort),
        "-U",
        "pennywise_owner",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "CREATE DATABASE pennywise"
      ],
      { env: ownerEnv }
    );
  const node = path.join(resources, "node", "node.exe");
  const prisma = path.join(resources, "app", "node_modules", "prisma", "build", "index.js");
  const schema = path.join(
    resources,
    "app",
    "node_modules",
    "@clearledger",
    "db",
    "prisma",
    "schema.prisma"
  );
  run(node, [prisma, "migrate", "deploy", "--schema", schema], {
    env: {
      ...process.env,
      DATABASE_URL: pgUrl("pennywise_owner", secrets.databaseOwnerPassword, databasePort)
    },
    timeout: 300000
  });
  const roleSql = path.join(dataRoot, "configure-runtime-role.sql");
  fs.writeFileSync(
    roleSql,
    [
      "SELECT 'CREATE ROLE clearledger_beta_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS'",
      "WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clearledger_beta_runtime') \\gexec",
      "ALTER ROLE clearledger_beta_runtime WITH LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;",
      "GRANT clearledger_runtime TO clearledger_beta_runtime;",
      ""
    ].join("\n"),
    "utf8"
  );
  run(
    psql,
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(databasePort),
      "-U",
      "pennywise_owner",
      "-d",
      "pennywise",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `runtime_password=${secrets.databaseRuntimePassword}`,
      "-f",
      roleSql
    ],
    { env: ownerEnv }
  );
  fs.rmSync(roleSql, { force: true });
}

function spawnLogged(command, args, options) {
  const output = fs.openSync(logPath, "a");
  const child = spawn(command, args, {
    ...options,
    windowsHide: true,
    stdio: ["ignore", output, output]
  });
  children.add(child);
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping && code !== 0)
      fail(`${path.basename(command)} stopped unexpectedly`, `exit ${code}`);
  });
  return child;
}

async function waitForHealth(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  if (databaseStarted) {
    try {
      run(
        path.join(postgresRuntimeRoot, "bin", "pg_ctl.exe"),
        ["stop", "-D", path.join(dataRoot, "postgresql"), "-m", "fast", "-w"],
        { timeout: 60000 }
      );
    } catch (error) {
      log(`Database stop warning: ${error.message}`);
    }
  }
}

async function main() {
  if (dataRootError) {
    fail(
      "PennyWise Accounting could not prepare its local data folder",
      dataRootError.stack || dataRootError.message
    );
    return;
  }
  const lockPath = path.join(dataRoot, "launcher.lock");
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch {
    const priorPid = Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);
    let priorProcessAlive = Number.isInteger(priorPid) && priorPid > 0;
    if (priorProcessAlive) {
      try {
        process.kill(priorPid, 0);
      } catch {
        priorProcessAlive = false;
      }
    }
    if (priorProcessAlive) {
      showMessage(
        "PennyWise Accounting is already running. Check your browser or close the existing instance first.",
        PRODUCT
      );
      return;
    }
    fs.rmSync(lockPath, { force: true });
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  }
  const releaseLock = () => fs.rmSync(lockPath, { force: true });
  process.once("exit", releaseLock);
  process.once("SIGINT", () => stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => stop().finally(() => process.exit(0)));
  try {
    const installId = ensureInstallationIdentity();
    if (!enforceEntitlement(installId)) return;
    const startupState = path.join(dataRoot, "startup-state.json");
    const previousStartup = safeJson(startupState, null);
    if (previousStartup)
      log(`Recovering from an interrupted startup recorded at ${previousStartup.startedAt}.`);
    writeJson(startupState, { schema: 1, startedAt: new Date().toISOString(), phase: "starting" });
    if (!safeJson(path.join(dataRoot, nativeOperations.BACKUP_CONFIG), null)?.destination) {
      const configured = licensePolicy().requireActivation
        ? nativeOperations.configureNightlyBackup({
            dataRoot,
            destination: process.env.OneDrive
              ? path.join(process.env.OneDrive, "PennyWiseBackups")
              : path.resolve(dataRoot, "..", "PennyWiseRecovery"),
            ...backupTaskOptions()
          })
        : configureBackupInteractively();
      if (configured) log(`Nightly backups configured for a ${configured.kind} destination.`);
      else
        showMessage(
          "Nightly backup is not configured. Open PennyWise Backup from Start to choose a second drive or synced folder before relying on real books.",
          PRODUCT
        );
    }
    const secrets = loadRuntimeSecrets();
    databasePort = await freePort(54329);
    const apiPort = await freePort(32101);
    const webPort = await freePort(32100);
    initializeDatabase(secrets);
    writeJson(path.join(dataRoot, "runtime-state.json"), {
      schemaVersion: 1,
      launcherPid: process.pid,
      databasePort,
      apiPort,
      webPort,
      startedAt: new Date().toISOString()
    });
    const node = path.join(resources, "node", "node.exe");
    const apiEnv = {
      ...process.env,
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      CLEARLEDGER_BETA_RUNTIME: "true",
      DATABASE_URL: pgUrl(
        "clearledger_beta_runtime",
        secrets.databaseRuntimePassword,
        databasePort
      ),
      APP_BASE_URL: `http://127.0.0.1:${webPort}`,
      API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      PAYMENT_PUBLIC_BASE_URL: `http://127.0.0.1:${webPort}`,
      WEBHOOK_SECRET_ENCRYPTION_SECRET: secrets.webhookEncryptionSecret,
      CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET: secrets.connectorEncryptionSecret,
      PAYMENT_WEBHOOK_SECRET: secrets.paymentWebhookSecret,
      PAYMENT_ACCOUNT_ENCRYPTION_SECRET: secrets.paymentEncryptionSecret
    };
    spawnLogged(node, [path.join(resources, "app", "dist", "index.js")], {
      cwd: dataRoot,
      env: apiEnv
    });
    await waitForHealth(`http://127.0.0.1:${apiPort}/health`);
    spawnLogged(node, [path.join(resources, "web", "serve.mjs")], {
      cwd: path.join(resources, "web"),
      env: {
        ...process.env,
        WEB_HOST: "127.0.0.1",
        WEB_PORT: String(webPort),
        API_BASE_URL: `http://127.0.0.1:${apiPort}`,
        APP_ORIGIN: `http://127.0.0.1:${webPort}`
      }
    });
    await waitForHealth(`http://127.0.0.1:${webPort}/`);
    fs.rmSync(startupState, { force: true });
    log(`Ready at http://127.0.0.1:${webPort}/`);
    spawn("rundll32.exe", ["url.dll,FileProtocolHandler", `http://127.0.0.1:${webPort}/`], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (fs.existsSync(path.join(dataRoot, "shutdown-request.json"))) {
        log("A restore requested a controlled launcher shutdown.");
        fs.rmSync(path.join(dataRoot, "shutdown-request.json"), { force: true });
        break;
      }
    }
  } catch (error) {
    fail("PennyWise Accounting could not start", error.stack || error.message);
  } finally {
    await stop();
    fs.rmSync(path.join(dataRoot, "runtime-state.json"), { force: true });
    releaseLock();
  }
}

const mode = executableMode();
if (mode === "start") {
  main();
} else {
  runMode(mode).catch((error) =>
    fail(`PennyWise ${mode} could not finish`, error.stack || error.message)
  );
}
