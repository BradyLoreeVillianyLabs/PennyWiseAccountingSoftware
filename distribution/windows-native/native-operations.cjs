"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKUP_FORMAT = "pennywise-native-backup-v1";
const TASK_NAME = `PennyWise Accounting Nightly Backup - ${os.userInfo().username}`;
const BACKUP_CONFIG = "backup-config.json";
const INSTALLATION_ID = "installation.json";
const RUNTIME_SECRETS = "runtime-secrets.json";
const POSTGRES_RUNTIME_MANIFEST = "postgresql-runtime.json";

function safeJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function safeRelative(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
    return relative.replaceAll("\\", "/");
  throw new Error("A native backup operation resolved outside its expected folder.");
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

function executableFor(postgresRoot, name) {
  const executable = path.join(postgresRoot, "bin", name);
  if (fs.existsSync(executable)) return executable;
  // The .cmd fallback is only useful to the disposable Windows contract harness; production
  // packages always contain the matching PostgreSQL .exe binaries.
  const fixture = executable.replace(/\.exe$/i, ".cmd");
  if (fs.existsSync(fixture)) return fixture;
  throw new Error(`PennyWise is missing its bundled PostgreSQL tool: ${name}`);
}

function postgresRuntimeManifest(resources) {
  const manifest = safeJson(path.join(resources, POSTGRES_RUNTIME_MANIFEST));
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  )
    throw new Error("PennyWise PostgreSQL runtime verification data is missing or invalid.");
  const files = new Map();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(entry.sha256)
    )
      throw new Error("PennyWise PostgreSQL runtime verification data is invalid.");
    const relative = entry.path.replaceAll("\\", "/");
    if (
      relative === "" ||
      relative.startsWith("/") ||
      relative.includes("//") ||
      relative.split("/").some((part) => part === "" || part === "." || part === "..")
    )
      throw new Error("PennyWise PostgreSQL runtime verification data contains an unsafe path.");
    if (files.has(relative))
      throw new Error("PennyWise PostgreSQL runtime verification data contains a duplicate path.");
    files.set(relative, entry.sha256.toLowerCase());
  }
  return files;
}

function verifyPostgresRuntime(root, files, label) {
  const expected = new Set(files.keys());
  const actual = new Set(listFiles(root).map((file) => safeRelative(root, file)));
  if (actual.size !== expected.size || [...actual].some((relative) => !expected.has(relative)))
    throw new Error(
      `PennyWise ${label} PostgreSQL runtime contents do not match the signed package.`
    );
  for (const [relative, expectedHash] of files) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || sha256(file) !== expectedHash)
      throw new Error(`PennyWise ${label} PostgreSQL runtime verification failed for ${relative}.`);
  }
}

function ensureBundledPostgresRuntime({ dataRoot, resources }) {
  const packagedRoot = path.join(resources, "postgresql");
  const files = postgresRuntimeManifest(resources);
  verifyPostgresRuntime(packagedRoot, files, "packaged");
  const runtimeParent = path.join(dataRoot, "runtime");
  const runtimeRoot = path.join(runtimeParent, "postgresql");
  try {
    verifyPostgresRuntime(runtimeRoot, files, "local");
    return runtimeRoot;
  } catch {
    // The package location is immutable under MSIX. PostgreSQL itself must create child
    // processes, so its verified runtime is executed from the app's private local data.
  }
  fs.mkdirSync(runtimeParent, { recursive: true });
  const staging = path.join(runtimeParent, `.postgresql-staging-${crypto.randomUUID()}`);
  const previous = path.join(runtimeParent, `.postgresql-previous-${crypto.randomUUID()}`);
  try {
    fs.cpSync(packagedRoot, staging, { recursive: true, errorOnExist: true });
    verifyPostgresRuntime(staging, files, "staged");
    if (fs.existsSync(runtimeRoot)) fs.renameSync(runtimeRoot, previous);
    try {
      fs.renameSync(staging, runtimeRoot);
    } catch (error) {
      if (fs.existsSync(previous) && !fs.existsSync(runtimeRoot))
        fs.renameSync(previous, runtimeRoot);
      throw error;
    }
    fs.rmSync(previous, { recursive: true, force: true });
    return runtimeRoot;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function invocation(command, args) {
  if (!/\.cmd$/i.test(command)) return { command, args };
  return {
    command: "cmd.exe",
    // This path is only for the .cmd test fixtures. Giving cmd.exe each argument
    // separately preserves SQL arguments without enabling a shell for production
    // PostgreSQL executables.
    args: ["/d", "/c", "call", command, ...args]
  };
}

function run(command, args, options = {}) {
  const commandLine = invocation(command, args);
  const result = spawnSync(commandLine.command, commandLine.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 300000
  });
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed: ${(result.stderr || result.stdout || "unknown failure").trim()}`
    );
  return result.stdout;
}

async function freeLoopbackPort(preferred = 0) {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", preferred ? () => freeLoopbackPort(0).then(resolve, reject) : reject);
    server.listen({ host: "127.0.0.1", port: preferred }, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function requireInstallation(dataRoot) {
  const identity = safeJson(path.join(dataRoot, INSTALLATION_ID));
  if (!identity || identity.schema !== 1 || typeof identity.installId !== "string")
    throw new Error(
      "PennyWise installation identity is missing. Start PennyWise once before using backup or restore."
    );
  const secrets = safeJson(path.join(dataRoot, RUNTIME_SECRETS));
  if (!secrets || typeof secrets.databaseOwnerPassword !== "string")
    throw new Error("PennyWise recovery secrets are missing. Restore cannot continue safely.");
  return { identity, secrets };
}

async function databaseSession({ dataRoot, resources, preferredPort = 0 }) {
  const postgresRoot = ensureBundledPostgresRuntime({ dataRoot, resources });
  const pgCtl = executableFor(postgresRoot, "pg_ctl.exe");
  const pgIsReady = executableFor(postgresRoot, "pg_isready.exe");
  const dataDirectory = path.join(dataRoot, "postgresql");
  if (!fs.existsSync(path.join(dataDirectory, "PG_VERSION")))
    throw new Error(
      "The local PostgreSQL data directory is missing or corrupt. Use PennyWise Restore with a verified backup."
    );
  const state = safeJson(path.join(dataRoot, "runtime-state.json"), {});
  const candidates = [state.databasePort, preferredPort].filter(
    (value, index, values) =>
      Number.isInteger(value) && value > 0 && values.indexOf(value) === index
  );
  for (const port of candidates) {
    const probeCommand = invocation(pgIsReady, [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-d",
      "pennywise"
    ]);
    const probe = spawnSync(probeCommand.command, probeCommand.args, { windowsHide: true });
    if (probe.status === 0) return { port, startedHere: false, postgresRoot };
  }
  const port = await freeLoopbackPort(preferredPort || 54329);
  try {
    run(pgCtl, ["start", "-D", dataDirectory, "-w", "-o", `-p ${port} -h 127.0.0.1`], {
      timeout: 120000,
      // pg_ctl backgrounds postgres. Ignoring stdio prevents the server from
      // retaining Node's capture pipes and blocking this synchronous lifecycle call.
      stdio: "ignore"
    });
  } catch (error) {
    throw new Error(
      `PennyWise could not start its private database. ${error.message} Run Support Diagnostics, then restore a verified backup if the problem continues.`,
      { cause: error }
    );
  }
  return { port, startedHere: true, postgresRoot };
}

function stopDatabase({ dataRoot, resources }) {
  try {
    run(
      executableFor(ensureBundledPostgresRuntime({ dataRoot, resources }), "pg_ctl.exe"),
      ["stop", "-D", path.join(dataRoot, "postgresql"), "-m", "fast", "-w"],
      { timeout: 60000 }
    );
  } catch {
    // A stopped or independently-owned database must not turn a successful backup into a failure.
  }
}

function destinationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function physicalDiskForVolume(volume) {
  const drive = /^([a-z]):\\$/i.exec(volume)?.[1];
  if (!drive) return null;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; Get-Partition -DriveLetter '${drive}' | Get-Disk | Select-Object -First 1 -ExpandProperty Number`
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 }
  );
  if (result.status !== 0) return null;
  const diskNumber = Number(result.stdout.trim());
  return Number.isInteger(diskNumber) && diskNumber >= 0 ? diskNumber : null;
}

function allowedBackupDestination(
  destination,
  dataRoot,
  { diskNumberForVolume = physicalDiskForVolume } = {}
) {
  const resolvedDestination = path.resolve(destination);
  if (resolvedDestination.startsWith("\\\\")) return { allowed: true, kind: "network-location" };
  const dataVolume = path.parse(path.resolve(dataRoot)).root.toLowerCase();
  const destinationVolume = path.parse(resolvedDestination).root.toLowerCase();
  const syncRoots = [process.env.OneDrive, process.env.OneDriveCommercial, process.env.Dropbox]
    .filter(Boolean)
    .map((value) => path.resolve(value).toLowerCase());
  const normalized = resolvedDestination.toLowerCase();
  if (syncRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`)))
    return { allowed: true, kind: "synced-folder" };
  if (normalized === path.resolve(dataRoot, "..", "PennyWiseRecovery").toLowerCase())
    return { allowed: true, kind: "local-recovery-same-disk" };
  if (dataVolume !== destinationVolume) {
    const dataDisk = diskNumberForVolume(dataVolume);
    const destinationDisk = diskNumberForVolume(destinationVolume);
    if (dataDisk !== null && destinationDisk !== null)
      return {
        allowed: true,
        kind: dataDisk === destinationDisk ? "separate-volume-same-disk" : "separate-physical-disk"
      };
    return { allowed: true, kind: "separate-volume-physical-disk-unknown" };
  }
  return { allowed: false, kind: "same-volume" };
}

function probeBackupDestination(destination) {
  const probe = path.join(destination, `.pennywise-write-probe-${crypto.randomUUID()}`);
  fs.writeFileSync(probe, "ok", { flag: "wx" });
  fs.rmSync(probe, { force: true });
}

function validateBackupDestination(
  destination,
  dataRoot,
  { diskNumberForVolume = physicalDiskForVolume, probe = probeBackupDestination } = {}
) {
  if (!destination || typeof destination !== "string")
    throw destinationError(
      "BACKUP_DESTINATION_REQUIRED",
      "Choose a backup destination before enabling nightly backups."
    );
  const resolved = path.resolve(destination);
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch {
    throw destinationError(
      "BACKUP_DESTINATION_UNWRITABLE",
      "PennyWise cannot create or write to that backup folder. Choose another location."
    );
  }
  const policy = allowedBackupDestination(resolved, dataRoot, { diskNumberForVolume });
  if (!policy.allowed)
    throw destinationError(
      "BACKUP_DESTINATION_SAME_VOLUME",
      "Choose a second drive or a recognized synced folder for backups. PennyWise will not keep the only backup on the same disk as its books."
    );
  try {
    probe(resolved);
  } catch {
    throw destinationError(
      "BACKUP_DESTINATION_UNWRITABLE",
      "PennyWise cannot write to that backup folder. Choose another location."
    );
  }
  return { destination: resolved, kind: policy.kind };
}

function backupDestinationRejectionMessage(error) {
  if (error?.code === "BACKUP_DESTINATION_SAME_VOLUME")
    return "That folder is on the same disk as your PennyWise books. A backup there could be lost with the books if the disk fails.";
  if (error?.code === "BACKUP_DESTINATION_UNWRITABLE")
    return "PennyWise cannot write to that folder. Choose a folder you can save files in.";
  return "PennyWise could not use that folder for backups. Choose another folder or cancel to continue without backups.";
}

function configureBackupDestinationWithPicker({
  dataRoot,
  pickDestination,
  configure = configureNightlyBackup,
  onRejected = () => {},
  onConfigured = () => {},
  maxAttempts = 3
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const selected = pickDestination();
    if (!selected) return null;
    try {
      const result = configure({ dataRoot, destination: selected });
      onConfigured(result);
      return result;
    } catch (error) {
      onRejected({ destination: selected, message: backupDestinationRejectionMessage(error) });
    }
  }
  return null;
}

function archiveChecksums(stage) {
  const rows = [];
  for (const file of listFiles(stage).sort()) {
    const relative = safeRelative(stage, file);
    if (relative === "files.sha256") continue;
    rows.push(`${sha256(file)}  ${relative}`);
  }
  fs.writeFileSync(path.join(stage, "files.sha256"), `${rows.join("\n")}\n`, "utf8");
}

function verifyArchiveStage(stage) {
  const manifest = safeJson(path.join(stage, "backup-manifest.json"));
  if (!manifest || manifest.format !== BACKUP_FORMAT || manifest.schemaVersion !== 1)
    throw new Error("This is not a supported PennyWise native backup archive.");
  const checksums = fs
    .readFileSync(path.join(stage, "files.sha256"), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const listed = new Set();
  for (const row of checksums) {
    const match = row.match(/^([a-f0-9]{64})\x20{2}([^\\/].*)$/i);
    if (!match || match[2].includes("..") || path.isAbsolute(match[2]))
      throw new Error("The backup checksum manifest is unsafe.");
    const file = path.join(stage, match[2]);
    const relative = safeRelative(stage, file);
    if (listed.has(relative))
      throw new Error("The backup checksum manifest contains a duplicate member.");
    listed.add(relative);
    if (!fs.existsSync(file) || sha256(file) !== match[1].toLowerCase())
      throw new Error(`Backup verification failed for ${match[2]}.`);
  }
  for (const file of listFiles(stage)) {
    const relative = safeRelative(stage, file);
    if (relative !== "files.sha256" && !listed.has(relative))
      throw new Error(`Backup member ${relative} is missing from the checksum manifest.`);
  }
  return manifest;
}

function systemTar() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot || !path.isAbsolute(systemRoot))
    throw new Error(
      "Windows system root is unavailable; PennyWise cannot create or restore a backup."
    );
  const tar = path.join(systemRoot, "System32", "tar.exe");
  if (!fs.existsSync(tar))
    throw new Error(
      "Windows archive support is unavailable; PennyWise cannot create or restore a backup."
    );
  return tar;
}

function packZip(stage, archive) {
  run(systemTar(), ["-a", "-c", "-f", archive, "-C", stage, "."], { timeout: 300000 });
}

function unpackZip(archive, stage) {
  run(systemTar(), ["-x", "-f", archive, "-C", stage], { timeout: 300000 });
}

function pruneBackups(destination, retain) {
  const backups = fs
    .readdirSync(destination, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^PennyWise-Backup-\d{8}-\d{6}-[a-f0-9-]+\.zip$/i.test(entry.name)
    )
    .map((entry) => path.join(destination, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const stale of backups.slice(retain)) {
    fs.rmSync(stale, { force: true });
    fs.rmSync(`${stale}.sha256`, { force: true });
  }
}

async function createBackup({ dataRoot, resources, destination, retain = 14, log = () => {} }) {
  const { identity, secrets } = requireInstallation(dataRoot);
  const target = validateBackupDestination(destination, dataRoot).destination;
  const id = crypto.randomUUID();
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-")
    .replace("Z", "");
  const stage = path.join(target, `.pennywise-backup-staging-${id}`);
  const archive = path.join(target, `PennyWise-Backup-${stamp}-${id}.zip`);
  const verification = path.join(target, `.pennywise-backup-verify-${id}`);
  fs.mkdirSync(stage, { recursive: true });
  let session;
  try {
    session = await databaseSession({ dataRoot, resources });
    const environment = { ...process.env, PGPASSWORD: secrets.databaseOwnerPassword };
    log("Creating a consistent PostgreSQL archive.");
    run(
      executableFor(session.postgresRoot, "pg_dump.exe"),
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(session.port),
        "-U",
        "pennywise_owner",
        "-d",
        "pennywise",
        "-Fc",
        "--no-owner",
        "-f",
        path.join(stage, "database.dump")
      ],
      { env: environment }
    );
    const documents = path.join(dataRoot, ".data");
    if (fs.existsSync(documents))
      fs.cpSync(documents, path.join(stage, "documents"), { recursive: true, errorOnExist: true });
    for (const name of [INSTALLATION_ID, RUNTIME_SECRETS, "trial.json", "license.json"]) {
      const source = path.join(dataRoot, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(stage, name));
    }
    const secretsHash = sha256(path.join(stage, RUNTIME_SECRETS));
    writeJson(path.join(stage, "backup-manifest.json"), {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      installId: identity.installId,
      recoverySecretsSha256: secretsHash,
      documentsSnapshot:
        "The database dump is captured before append-only document storage is copied; later files may be present but no dump-referenced file is omitted.",
      contents: [
        "database.dump",
        "documents/",
        INSTALLATION_ID,
        RUNTIME_SECRETS,
        "trial.json?",
        "license.json?",
        "files.sha256"
      ]
    });
    archiveChecksums(stage);
    packZip(stage, archive);
    fs.writeFileSync(
      `${archive}.sha256`,
      `${sha256(archive)}  ${path.basename(archive)}\n`,
      "ascii"
    );
    fs.mkdirSync(verification, { recursive: true });
    unpackZip(archive, verification);
    verifyArchiveStage(verification);
    if (sha256(archive) !== fs.readFileSync(`${archive}.sha256`, "ascii").trim().split(/\s+/)[0])
      throw new Error("The completed backup archive checksum did not verify.");
    pruneBackups(target, Math.max(1, Math.min(90, Number(retain) || 14)));
    log(`Backup verified: ${archive}`);
    return archive;
  } catch (error) {
    fs.rmSync(archive, { force: true });
    fs.rmSync(`${archive}.sha256`, { force: true });
    if (error && error.code === "ENOSPC")
      throw new Error(
        "The backup destination is full. Free space on the backup drive, then run PennyWise Backup again.",
        { cause: error }
      );
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(verification, { recursive: true, force: true });
    if (session?.startedHere) stopDatabase({ dataRoot, resources });
  }
}

function validateArchiveFile(archive) {
  const resolved = path.resolve(archive);
  const sibling = `${resolved}.sha256`;
  if (!fs.existsSync(resolved) || !fs.existsSync(sibling))
    throw new Error("Choose a backup ZIP with its matching .sha256 file beside it.");
  const line = fs.readFileSync(sibling, "ascii").trim();
  const match = line.match(/^([a-f0-9]{64})\x20{2}([^\\/]+)$/i);
  if (!match || match[2] !== path.basename(resolved) || sha256(resolved) !== match[1].toLowerCase())
    throw new Error(
      "The selected backup does not match its SHA-256 checksum. Restore stopped before changing any books."
    );
  return resolved;
}

async function restoreBackup({ dataRoot, resources, archive, log = () => {} }) {
  const { identity, secrets } = requireInstallation(dataRoot);
  const resolvedArchive = validateArchiveFile(archive);
  const restoreStage = path.join(dataRoot, `.pennywise-restore-${crypto.randomUUID()}`);
  fs.mkdirSync(restoreStage, { recursive: true });
  let session;
  try {
    unpackZip(resolvedArchive, restoreStage);
    const manifest = verifyArchiveStage(restoreStage);
    if (manifest.installId !== identity.installId)
      log(
        `Restoring a backup created by a different PennyWise installation (${manifest.installId}). Document encryption keys will be recovered; this installation keeps its database credentials and activation.`
      );
    if (manifest.recoverySecretsSha256 !== sha256(path.join(restoreStage, RUNTIME_SECRETS)))
      throw new Error(
        "The backup recovery-secrets checksum is invalid. Restore stopped before replacing any books."
      );
    session = await databaseSession({ dataRoot, resources });
    const environment = { ...process.env, PGPASSWORD: secrets.databaseOwnerPassword };
    log("Restoring the verified PostgreSQL archive.");
    run(
      executableFor(session.postgresRoot, "pg_restore.exe"),
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(session.port),
        "-U",
        "pennywise_owner",
        "-d",
        "pennywise",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--exit-on-error",
        "--single-transaction",
        path.join(restoreStage, "database.dump")
      ],
      { env: environment }
    );
    const psql = executableFor(session.postgresRoot, "psql.exe");
    const migrated = run(
      psql,
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(session.port),
        "-U",
        "pennywise_owner",
        "-d",
        "pennywise",
        "-tAc",
        "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
      ],
      { env: environment }
    ).trim();
    if (!/^\d+$/.test(migrated) || Number(migrated) < 1)
      throw new Error("The restored database has no completed Prisma migrations.");
    const restoredDocuments = path.join(restoreStage, "documents");
    const targetDocuments = path.join(dataRoot, ".data");
    const previousDocuments = path.join(dataRoot, `.data-before-restore-${crypto.randomUUID()}`);
    if (fs.existsSync(targetDocuments)) fs.renameSync(targetDocuments, previousDocuments);
    try {
      if (fs.existsSync(restoredDocuments))
        fs.cpSync(restoredDocuments, targetDocuments, { recursive: true, errorOnExist: true });
      else fs.mkdirSync(targetDocuments, { recursive: true });
    } catch (error) {
      fs.rmSync(targetDocuments, { recursive: true, force: true });
      if (fs.existsSync(previousDocuments)) fs.renameSync(previousDocuments, targetDocuments);
      throw error;
    }
    fs.rmSync(previousDocuments, { recursive: true, force: true });
    const recoveredSecrets = safeJson(path.join(restoreStage, RUNTIME_SECRETS));
    writeJson(path.join(dataRoot, RUNTIME_SECRETS), {
      ...recoveredSecrets,
      databaseOwnerPassword: secrets.databaseOwnerPassword,
      databaseRuntimePassword: secrets.databaseRuntimePassword
    });
    for (const name of manifest.installId === identity.installId
      ? ["trial.json", "license.json"]
      : []) {
      const source = path.join(restoreStage, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataRoot, name));
    }
    log("Restore verified. Start PennyWise to apply any newer forward migrations.");
    return { migrationCount: Number(migrated) };
  } catch (error) {
    if (error && error.code === "ENOSPC")
      throw new Error(
        "The computer is out of storage space. Restore stopped before completion; free space and use the verified backup again.",
        { cause: error }
      );
    throw error;
  } finally {
    fs.rmSync(restoreStage, { recursive: true, force: true });
    if (session?.startedHere) stopDatabase({ dataRoot, resources });
  }
}

function redact(text, dataRoot, secrets) {
  let value = String(text);
  for (const secret of Object.values(secrets ?? {})) {
    if (typeof secret === "string" && secret.length > 4)
      value = value.split(secret).join("[REDACTED]");
  }
  value = value.replace(/postgres(?:ql)?:\/\/[^\s@]+@[^\s]+/gi, "postgresql://[REDACTED]");
  value = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]");
  value = value.split(path.resolve(dataRoot)).join("%LOCALAPPDATA%\\PennyWiseAccounting");
  return value;
}

function collectDiagnostics({ dataRoot, resources, appRoot }) {
  const { identity, secrets } = requireInstallation(dataRoot);
  const desktop = path.join(process.env.USERPROFILE || os.homedir(), "Desktop");
  const output = path.join(
    desktop,
    `PennyWise-Diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
  );
  const stage = path.join(dataRoot, `.pennywise-diagnostics-${crypto.randomUUID()}`);
  fs.mkdirSync(stage, { recursive: true });
  try {
    const config = safeJson(path.join(dataRoot, BACKUP_CONFIG), {});
    const logFile = path.join(dataRoot, "logs", "launcher.log");
    const recentLog = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8").split(/\r?\n/).slice(-2000).join("\n")
      : "No launcher log exists.";
    fs.writeFileSync(
      path.join(stage, "launcher.redacted.log"),
      redact(recentLog, dataRoot, secrets),
      "utf8"
    );
    writeJson(path.join(stage, "diagnostics.json"), {
      schemaVersion: 1,
      product: "PennyWise Accounting",
      createdAt: new Date().toISOString(),
      installationIdPresent: Boolean(identity.installId),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      windowsRelease: os.release(),
      appRoot: path.basename(appRoot),
      bundledPostgreSql: fs.existsSync(path.join(resources, "postgresql", "bin", "postgres.exe")),
      backupConfigured: Boolean(config.destination),
      backupDestinationKind: config.kind ?? null,
      nightlyTaskName: TASK_NAME
    });
    packZip(stage, output);
    return output;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function taskWrapperContents(options = {}) {
  const { packageName = "TypeWritingMonkeys.PennyWiseAccounting", backupExecutablePath = null } =
    typeof options === "string" ? { packageName: options } : options;
  if (backupExecutablePath) {
    const executable = path.resolve(backupExecutablePath);
    if (path.extname(executable).toLowerCase() !== ".exe")
      throw new Error("PennyWise Backup executable path is invalid.");
    return [
      "@echo off",
      "setlocal enableextensions",
      `call "${executable.replace(/"/g, '""')}" --scheduled`,
      "exit /b %ERRORLEVEL%",
      ""
    ].join("\r\n");
  }
  return [
    "@echo off",
    "setlocal enableextensions",
    `for /f "usebackq delims=" %%P in (\`powershell.exe -NoLogo -NoProfile -NonInteractive -Command "(Get-AppxPackage -Name '${packageName}' | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty InstallLocation)"\`) do set "PW_PACKAGE=%%P"`,
    "if not defined PW_PACKAGE exit /b 20",
    "powershell.exe -NoLogo -NoProfile -NonInteractive -Command \"$p=Get-AppxPackage -Name 'TypeWritingMonkeys.PennyWiseAccounting'; Add-Type -Path (Join-Path $p.InstallLocation 'resources\\application-activation.cs'); $id=[PennyWiseApplication]::Start(($p.PackageFamilyName+'!PennyWiseBackup'),'--scheduled'); $process=Get-Process -Id $id -ErrorAction Stop; $handle=$process.Handle; $process.WaitForExit(); exit $process.ExitCode\"",
    "exit /b %ERRORLEVEL%",
    ""
  ].join("\r\n");
}

function nightlyTaskXml(wrapper) {
  const escapedWrapper = wrapper.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-16"?><Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><CalendarTrigger><StartBoundary>2026-01-01T02:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers><Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><StartWhenAvailable>true</StartWhenAvailable><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><ExecutionTimeLimit>PT2H</ExecutionTimeLimit></Settings><Actions Context="Author"><Exec><Command>${escapedWrapper}</Command></Exec></Actions></Task>`;
}

function writeUtf16LeXml(file, value) {
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, "utf16le")]),
    {
      mode: 0o600
    }
  );
}

function registerNightlyBackupTask(task) {
  return spawnSync("schtasks.exe", ["/Create", "/TN", TASK_NAME, "/XML", task, "/F"], {
    encoding: "utf8",
    windowsHide: true
  });
}

function configureNightlyBackup({
  dataRoot,
  destination,
  packageName = "TypeWritingMonkeys.PennyWiseAccounting",
  backupExecutablePath = null,
  retain = 14,
  registerTask = registerNightlyBackupTask
}) {
  const target = validateBackupDestination(destination, dataRoot);
  const operations = path.join(dataRoot, "operations");
  fs.mkdirSync(operations, { recursive: true });
  const wrapper = path.join(operations, "Run-NightlyBackup.cmd");
  fs.writeFileSync(wrapper, taskWrapperContents({ packageName, backupExecutablePath }), "ascii");
  const task = path.join(operations, "nightly-backup-task.xml");
  writeUtf16LeXml(task, nightlyTaskXml(wrapper));
  const result = registerTask(task);
  if (result.status !== 0)
    throw new Error(
      `PennyWise could not register its nightly backup task. ${(result.stderr || result.stdout || "Task Scheduler rejected the request.").trim()}`
    );
  writeJson(path.join(dataRoot, BACKUP_CONFIG), {
    schemaVersion: 1,
    destination: target.destination,
    kind: target.kind,
    retain: Math.max(1, Math.min(90, Number(retain) || 14)),
    configuredAt: new Date().toISOString()
  });
  return target;
}

module.exports = {
  BACKUP_CONFIG,
  BACKUP_FORMAT,
  INSTALLATION_ID,
  RUNTIME_SECRETS,
  TASK_NAME,
  allowedBackupDestination,
  backupDestinationRejectionMessage,
  collectDiagnostics,
  configureBackupDestinationWithPicker,
  configureNightlyBackup,
  createBackup,
  ensureBundledPostgresRuntime,
  physicalDiskForVolume,
  redact,
  restoreBackup,
  taskWrapperContents,
  validateArchiveFile,
  validateBackupDestination,
  verifyArchiveStage
};
