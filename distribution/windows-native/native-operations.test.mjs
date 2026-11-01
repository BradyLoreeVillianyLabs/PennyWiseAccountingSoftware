import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import operations from "./native-operations.cjs";
import offlineActivation from "./offline-activation.cjs";
import provisioning from "./provision-beta.cjs";

const windowsOnly = process.platform === "win32" ? false : "Windows path and cmd.exe fixture";

test("preissued setup activates a fresh installation, preserves updates, and refuses another slot", () => {
  const root = mkdtempSync(join(tmpdir(), "pennywise-provision-test-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const envelope = offlineActivation.createBeta20License({
    privateKey,
    installId: "2f44f5d5-82f3-45a7-b401-f0aa13e11111",
    slot: 1
  });
  try {
    const dataRoot = join(root, "PennyWiseAccounting");
    provisioning.provisionBeta({ dataRoot, envelope, publicKey });
    const original = readFileSync(join(dataRoot, "installation.json"), "utf8");
    provisioning.provisionBeta({ dataRoot, envelope, publicKey });
    assert.equal(readFileSync(join(dataRoot, "installation.json"), "utf8"), original);
    const other = offlineActivation.createBeta20License({
      privateKey,
      installId: "3f44f5d5-82f3-45a7-b401-f0aa13e11111",
      slot: 2
    });
    assert.throws(
      () => provisioning.provisionBeta({ dataRoot, envelope: other, publicKey }),
      /different/
    );
    assert.equal(readFileSync(join(dataRoot, "installation.json"), "utf8"), original);
    assert.equal(
      operations.allowedBackupDestination(join(root, "PennyWiseRecovery"), dataRoot).kind,
      "local-recovery-same-disk"
    );
    assert.equal(
      operations.allowedBackupDestination(join(root, "some-other-folder"), dataRoot).allowed,
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function writePostgresRuntimeManifest(resources) {
  const bin = join(resources, "postgresql", "bin");
  const files = readdirSync(bin)
    .sort()
    .map((name) => ({ path: `bin/${name}`, sha256: hash(join(bin, name)) }));
  writeFileSync(
    join(resources, "postgresql-runtime.json"),
    `\uFEFF${JSON.stringify({ schemaVersion: 1, files })}`
  );
}

test("offline BETA_20 activation is signed, device-bound, and limited to twenty slots", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const installId = "2f44f5d5-82f3-45a7-b401-f0aa13e11111";
  const envelope = offlineActivation.createBeta20License({ privateKey, installId, slot: 1 });
  const verified = offlineActivation.verifyLicenseEnvelope({
    envelope,
    publicKey,
    installId,
    requiredEdition: offlineActivation.BETA20_EDITION
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.claims.slot, 1);
  assert.equal(verified.claims.installId, installId);

  const otherInstall = offlineActivation.verifyLicenseEnvelope({
    envelope,
    publicKey,
    installId: "3f44f5d5-82f3-45a7-b401-f0aa13e11111",
    requiredEdition: offlineActivation.BETA20_EDITION
  });
  assert.equal(otherInstall.valid, false);
  assert.match(otherInstall.error, /different PennyWise installation/i);

  const tampered = { ...envelope, payload: `${envelope.payload.slice(0, -1)}A` };
  assert.equal(
    offlineActivation.verifyLicenseEnvelope({
      envelope: tampered,
      publicKey,
      installId,
      requiredEdition: offlineActivation.BETA20_EDITION
    }).valid,
    false
  );
  assert.throws(
    () => offlineActivation.createBeta20License({ privateKey, installId, slot: 21 }),
    /1 to 20/
  );
});

test("native backup manifest verifies every archive member", () => {
  const root = mkdtempSync(join(tmpdir(), "pennywise-native-archive-"));
  try {
    mkdirSync(join(root, "documents"));
    writeFileSync(join(root, "database.dump"), "database");
    writeFileSync(join(root, "documents", "invoice.pdf"), "document");
    writeFileSync(join(root, "runtime-secrets.json"), '{"databaseOwnerPassword":"fixture"}');
    writeFileSync(
      join(root, "backup-manifest.json"),
      JSON.stringify({ format: operations.BACKUP_FORMAT, schemaVersion: 1, installId: "fixture" })
    );
    const rows = [
      "database.dump",
      "documents/invoice.pdf",
      "runtime-secrets.json",
      "backup-manifest.json"
    ].map((name) => `${hash(join(root, name))}  ${name}`);
    writeFileSync(join(root, "files.sha256"), `${rows.join("\n")}\n`);
    assert.equal(operations.verifyArchiveStage(root).installId, "fixture");
    writeFileSync(join(root, "documents", "invoice.pdf"), "tampered");
    assert.throws(() => operations.verifyArchiveStage(root), /verification failed/i);
    writeFileSync(join(root, "documents", "unlisted.txt"), "unlisted");
    writeFileSync(join(root, "documents", "invoice.pdf"), "document");
    assert.throws(() => operations.verifyArchiveStage(root), /missing from the checksum manifest/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "nightly task wrapper supports both installed MSIX and unpackaged beta entries",
  { skip: windowsOnly },
  () => {
    const wrapper = operations.taskWrapperContents("TypeWritingMonkeys.PennyWiseAccounting");
    assert.match(wrapper, /Get-AppxPackage -Name 'TypeWritingMonkeys\.PennyWiseAccounting'/);
    assert.match(wrapper, /!PennyWiseBackup/);
    assert.match(wrapper, /PennyWiseApplication/);
    assert.match(wrapper, /--scheduled/);
    assert.doesNotMatch(wrapper, /ExecutionPolicy/);

    const direct = operations.taskWrapperContents({
      backupExecutablePath: "C:\\Program Files\\PennyWise Accounting\\PennyWiseBackup.exe"
    });
    assert.match(
      direct,
      /call "C:\\Program Files\\PennyWise Accounting\\PennyWiseBackup\.exe" --scheduled/
    );
    assert.doesNotMatch(direct, /Get-AppxPackage|ExecutionPolicy/);
    assert.throws(
      () => operations.taskWrapperContents({ backupExecutablePath: "C:\\PennyWiseBackup.cmd" }),
      /executable path is invalid/i
    );
  }
);

test("nightly backup task XML has a UTF-16LE BOM and does not persist config when registration fails", () => {
  const root = mkdtempSync(join(tmpdir(), "pennywise-native-task-"));
  const previousOneDrive = process.env.OneDrive;
  process.env.OneDrive = join(root, "synced");
  try {
    const dataRoot = join(root, "data");
    let registeredTask = null;
    operations.configureNightlyBackup({
      dataRoot,
      destination: join(root, "synced", "PennyWise"),
      registerTask: (task) => {
        registeredTask = task;
        return { status: 0, stdout: "SUCCESS" };
      }
    });
    const xml = readFileSync(registeredTask);
    assert.deepEqual([...xml.subarray(0, 2)], [0xff, 0xfe]);
    assert.match(xml.subarray(2).toString("utf16le"), /<Task version="1\.4"/);
    assert.ok(existsSync(join(dataRoot, "backup-config.json")));

    const failedDataRoot = join(root, "failed-data");
    assert.throws(
      () =>
        operations.configureNightlyBackup({
          dataRoot: failedDataRoot,
          destination: join(root, "synced", "PennyWise-failed"),
          registerTask: () => ({ status: 1, stderr: "Task Scheduler rejected the XML" })
        }),
      /could not register its nightly backup task/i
    );
    assert.equal(existsSync(join(failedDataRoot, "backup-config.json")), false);
  } finally {
    if (previousOneDrive === undefined) delete process.env.OneDrive;
    else process.env.OneDrive = previousOneDrive;
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "backup destinations distinguish physical disks, same-disk volumes, sync folders, and network locations",
  { skip: windowsOnly },
  () => {
    const diskNumberForVolume = (volume) => ({ "c:\\": 0, "d:\\": 0, "e:\\": 1 })[volume];
    assert.deepEqual(
      operations.allowedBackupDestination(
        "C:\\Users\\owner\\Documents",
        "C:\\Users\\owner\\PennyWise"
      ),
      { allowed: false, kind: "same-volume" }
    );
    assert.deepEqual(
      operations.allowedBackupDestination("D:\\PennyWiseBackups", "C:\\Users\\owner\\PennyWise", {
        diskNumberForVolume
      }),
      { allowed: true, kind: "separate-volume-same-disk" }
    );
    assert.deepEqual(
      operations.allowedBackupDestination("E:\\PennyWiseBackups", "C:\\Users\\owner\\PennyWise", {
        diskNumberForVolume
      }),
      { allowed: true, kind: "separate-physical-disk" }
    );
    assert.deepEqual(
      operations.allowedBackupDestination(
        "\\\\server\\PennyWiseBackups",
        "C:\\Users\\owner\\PennyWise"
      ),
      { allowed: true, kind: "network-location" }
    );
    const previousOneDrive = process.env.OneDrive;
    process.env.OneDrive = "C:\\Users\\owner\\OneDrive";
    try {
      assert.deepEqual(
        operations.allowedBackupDestination(
          "C:\\Users\\owner\\OneDrive\\PennyWiseBackups",
          "C:\\Users\\owner\\PennyWise"
        ),
        { allowed: true, kind: "synced-folder" }
      );
    } finally {
      if (previousOneDrive === undefined) delete process.env.OneDrive;
      else process.env.OneDrive = previousOneDrive;
    }
  }
);

test("backup destination validation refuses a write probe failure with an actionable error", () => {
  const root = mkdtempSync(join(tmpdir(), "pennywise-native-write-probe-"));
  const previousOneDrive = process.env.OneDrive;
  process.env.OneDrive = join(root, "synced");
  let probeCalls = 0;
  try {
    assert.throws(
      () =>
        operations.validateBackupDestination(
          join(root, "synced", "PennyWise"),
          join(root, "data"),
          {
            probe: () => {
              probeCalls += 1;
              const error = new Error("access denied");
              error.code = "EACCES";
              throw error;
            }
          }
        ),
      (error) => error.code === "BACKUP_DESTINATION_UNWRITABLE"
    );
    assert.equal(probeCalls, 1);
  } finally {
    if (previousOneDrive === undefined) delete process.env.OneDrive;
    else process.env.OneDrive = previousOneDrive;
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup picker recovers from a refused folder and lets cancellation defer configuration", () => {
  const selections = ["C:\\Users\\owner\\Documents", null];
  const messages = [];
  const result = operations.configureBackupDestinationWithPicker({
    dataRoot: "C:\\Users\\owner\\PennyWise",
    pickDestination: () => selections.shift(),
    configure: () => {
      const error = new Error("same volume");
      error.code = "BACKUP_DESTINATION_SAME_VOLUME";
      throw error;
    },
    onRejected: ({ message }) => messages.push(message)
  });
  assert.equal(result, null);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /same disk.*lost with the books/i);
});

test("backup picker accepts a disclosed same-disk volume and bounds repeated refusals", () => {
  const configured = [];
  const sameDisk = operations.configureBackupDestinationWithPicker({
    dataRoot: "C:\\Users\\owner\\PennyWise",
    pickDestination: () => "D:\\PennyWiseBackups",
    configure: () => ({ destination: "D:\\PennyWiseBackups", kind: "separate-volume-same-disk" }),
    onConfigured: (result) => configured.push(result)
  });
  assert.equal(sameDisk.kind, "separate-volume-same-disk");
  assert.equal(configured.length, 1);

  let attempts = 0;
  const rejected = [];
  const deferred = operations.configureBackupDestinationWithPicker({
    dataRoot: "C:\\Users\\owner\\PennyWise",
    pickDestination: () => "C:\\Users\\owner\\Documents",
    configure: () => {
      attempts += 1;
      const error = new Error("same volume");
      error.code = "BACKUP_DESTINATION_SAME_VOLUME";
      throw error;
    },
    onRejected: ({ message }) => rejected.push(message)
  });
  assert.equal(deferred, null);
  assert.equal(attempts, 3);
  assert.equal(rejected.length, 3);
});

test("diagnostics redact stored secrets, database URLs, email, and local data paths", () => {
  const root = join(tmpdir(), "PennyWiseAccounting-fixture");
  const result = operations.redact(
    `secret-value postgresql://owner:password@127.0.0.1:5432/pennywise jane@example.ca ${root}`,
    root,
    { databaseOwnerPassword: "secret-value" }
  );
  assert.doesNotMatch(result, /secret-value|password|jane@example\.ca|PennyWiseAccounting-fixture/);
  assert.match(result, /\[REDACTED\]|postgresql:\/\/\[REDACTED\]/);
});

test(
  "verified local PostgreSQL runtime supports initdb child processes and repairs tampering",
  { skip: windowsOnly },
  () => {
    const root = mkdtempSync(join(tmpdir(), "pennywise-native-runtime-"));
    try {
      const resources = join(root, "resources");
      const bin = join(resources, "postgresql", "bin");
      const dataRoot = join(root, "data");
      mkdirSync(bin, { recursive: true });
      writeFileSync(
        join(bin, "postgres.cmd"),
        '@echo off\r\nif /I "%~1"=="-V" exit /b 0\r\nexit /b 1\r\n'
      );
      writeFileSync(
        join(bin, "initdb.cmd"),
        '@echo off\r\ncall "%~dp0postgres.cmd" -V\r\nexit /b %ERRORLEVEL%\r\n'
      );
      writePostgresRuntimeManifest(resources);

      const runtime = operations.ensureBundledPostgresRuntime({ dataRoot, resources });
      const initdb = join(runtime, "bin", "initdb.cmd");
      assert.equal(
        spawnSync("cmd.exe", ["/d", "/c", "call", initdb], { windowsHide: true }).status,
        0
      );

      writeFileSync(join(runtime, "bin", "postgres.cmd"), "tampered");
      assert.equal(operations.ensureBundledPostgresRuntime({ dataRoot, resources }), runtime);
      assert.match(readFileSync(join(runtime, "bin", "postgres.cmd"), "utf8"), /-V/);
      writeFileSync(join(bin, "postgres.cmd"), "tampered package source");
      assert.throws(
        () => operations.ensureBundledPostgresRuntime({ dataRoot, resources }),
        /packaged PostgreSQL runtime verification failed/i
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "native backup and restore round-trip a database dump, documents, and installation-bound secrets",
  { skip: windowsOnly },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "pennywise-native-roundtrip-"));
    const previousOneDrive = process.env.OneDrive;
    process.env.OneDrive = join(root, "synced");
    try {
      const dataRoot = join(root, "data");
      const bin = join(root, "resources", "postgresql", "bin");
      mkdirSync(join(dataRoot, "postgresql"), { recursive: true });
      mkdirSync(join(dataRoot, ".data"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(dataRoot, "postgresql", "PG_VERSION"), "17");
      writeFileSync(join(dataRoot, ".data", "invoice.pdf"), "before-restore");
      writeFileSync(
        join(dataRoot, "installation.json"),
        JSON.stringify({ schema: 1, installId: "5a82bed2-d832-5cd4-9d02-e531614d38a7" })
      );
      writeFileSync(
        join(dataRoot, "runtime-secrets.json"),
        JSON.stringify({ databaseOwnerPassword: "owner-password" })
      );
      writeFileSync(join(dataRoot, "runtime-state.json"), JSON.stringify({ databasePort: 54329 }));
      const commands = {
        "pg_isready.cmd": "@echo off\r\nexit /b 0\r\n",
        "pg_dump.cmd":
          '@echo off\r\n:next\r\nif "%~1"=="" exit /b 1\r\nif /I "%~1"=="-f" (echo fixture-database>"%~2"& exit /b 0)\r\nshift\r\ngoto next\r\n',
        "pg_restore.cmd": "@echo off\r\nexit /b 0\r\n",
        "psql.cmd": "@echo off\r\necho 107\r\nexit /b 0\r\n",
        "pg_ctl.cmd": "@echo off\r\nexit /b 0\r\n"
      };
      for (const [name, source] of Object.entries(commands)) writeFileSync(join(bin, name), source);
      writePostgresRuntimeManifest(join(root, "resources"));
      const backup = await operations.createBackup({
        dataRoot,
        resources: join(root, "resources"),
        destination: join(root, "synced", "PennyWise"),
        retain: 2
      });
      writeFileSync(join(dataRoot, ".data", "invoice.pdf"), "after-backup-mutation");
      const result = await operations.restoreBackup({
        dataRoot,
        resources: join(root, "resources"),
        archive: backup
      });
      assert.equal(result.migrationCount, 107);
      assert.equal(readFileSync(join(dataRoot, ".data", "invoice.pdf"), "utf8"), "before-restore");
    } finally {
      if (previousOneDrive === undefined) delete process.env.OneDrive;
      else process.env.OneDrive = previousOneDrive;
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "restore succeeds onto a replacement installation and discloses the source installation",
  { skip: windowsOnly },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "pennywise-native-cross-install-"));
    const previousOneDrive = process.env.OneDrive;
    process.env.OneDrive = join(root, "synced");
    try {
      const dataRoot = join(root, "data");
      const bin = join(root, "resources", "postgresql", "bin");
      mkdirSync(join(dataRoot, "postgresql"), { recursive: true });
      mkdirSync(join(dataRoot, ".data"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(dataRoot, "postgresql", "PG_VERSION"), "17");
      writeFileSync(
        join(dataRoot, "installation.json"),
        JSON.stringify({ schema: 1, installId: "5a82bed2-d832-5cd4-9d02-e531614d38a7" })
      );
      writeFileSync(
        join(dataRoot, "runtime-secrets.json"),
        JSON.stringify({ databaseOwnerPassword: "owner-password" })
      );
      writeFileSync(join(dataRoot, "runtime-state.json"), JSON.stringify({ databasePort: 54329 }));
      const commands = {
        "pg_isready.cmd": "@echo off\r\nexit /b 0\r\n",
        "pg_dump.cmd":
          '@echo off\r\n:next\r\nif "%~1"=="" exit /b 1\r\nif /I "%~1"=="-f" (echo fixture-database>"%~2"& exit /b 0)\r\nshift\r\ngoto next\r\n',
        "pg_restore.cmd": "@echo off\r\nexit /b 0\r\n",
        "psql.cmd": "@echo off\r\necho 107\r\nexit /b 0\r\n",
        "pg_ctl.cmd": "@echo off\r\nexit /b 0\r\n"
      };
      for (const [name, source] of Object.entries(commands)) writeFileSync(join(bin, name), source);
      writePostgresRuntimeManifest(join(root, "resources"));
      const backup = await operations.createBackup({
        dataRoot,
        resources: join(root, "resources"),
        destination: join(root, "synced", "PennyWise"),
        retain: 2
      });

      // A replacement machine has its own fresh installation identity, created the
      // first time PennyWise ever ran on it. Restoring a backup from a different,
      // failed machine is the disaster-recovery case this exists for, so it must
      // succeed rather than be refused for that mismatch.
      writeFileSync(
        join(dataRoot, "installation.json"),
        JSON.stringify({ schema: 1, installId: "9b6a0e1a-1111-4b33-9c9d-000000000000" })
      );
      const messages = [];
      writeFileSync(
        join(dataRoot, "runtime-secrets.json"),
        JSON.stringify({
          databaseOwnerPassword: "replacement-password",
          databaseRuntimePassword: "replacement-runtime",
          connectorEncryptionSecret: "new-key"
        })
      );
      writeFileSync(join(dataRoot, "license.json"), "replacement-license");
      const result = await operations.restoreBackup({
        dataRoot,
        resources: join(root, "resources"),
        archive: backup,
        log: (message) => messages.push(message)
      });
      assert.equal(result.migrationCount, 107);
      assert.equal(
        JSON.parse(readFileSync(join(dataRoot, "runtime-secrets.json"), "utf8"))
          .databaseOwnerPassword,
        "replacement-password"
      );
      assert.equal(readFileSync(join(dataRoot, "license.json"), "utf8"), "replacement-license");
      assert.ok(
        messages.some((message) => message.includes("different PennyWise installation")),
        "expected a diagnostic note recording the cross-installation restore"
      );
    } finally {
      if (previousOneDrive === undefined) delete process.env.OneDrive;
      else process.env.OneDrive = previousOneDrive;
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test("native package contract retains loopback-only, cross-installation-restore transparency, and Store-signing boundaries", async () => {
  const { readFile } = await import("node:fs/promises");
  const [launcher, operationSource, activationSource, build, manifest, lifecycle, issuer] =
    await Promise.all([
      readFile(new URL("./launcher.cjs", import.meta.url), "utf8"),
      readFile(new URL("./native-operations.cjs", import.meta.url), "utf8"),
      readFile(new URL("./offline-activation.cjs", import.meta.url), "utf8"),
      readFile(new URL("./Build-PennyWiseMsix.ps1", import.meta.url), "utf8"),
      readFile(new URL("./AppxManifest.template.xml", import.meta.url), "utf8"),
      readFile(
        new URL("../public-beta/qa/Test-PennyWiseMsixLifecycle.ps1", import.meta.url),
        "utf8"
      ),
      readFile(new URL("../../scripts/pennywise-beta-activation.mjs", import.meta.url), "utf8")
    ]);
  assert.match(launcher, /host: "127\.0\.0\.1"/);
  assert.doesNotMatch(operationSource, /This backup belongs to a different PennyWise installation/);
  assert.match(operationSource, /Restoring a backup created by a different PennyWise installation/);
  assert.match(operationSource, /path\.join\(systemRoot, "System32", "tar\.exe"\)/);
  assert.doesNotMatch(operationSource, /run\("tar\.exe"/);
  assert.match(launcher, /PennyWise Support Diagnostics/);
  assert.match(launcher, /configureBackupDestinationWithPicker/);
  assert.match(launcher, /ensureBundledPostgresRuntime/);
  assert.match(launcher, /pg_ctl backgrounds postgres/);
  assert.match(launcher, /stdio: "ignore"/);
  assert.match(launcher, /redactedCommandArgs/);
  assert.doesNotMatch(launcher, /log\(`RUN \$\{path\.basename\(command\)\} \$\{args\.join/);
  assert.match(launcher, /same physical disk as your books/);
  assert.match(build, /\[switch\]\$SelfSign/);
  assert.doesNotMatch(build, /TrustQaCertificate|Import-Certificate/);
  assert.match(build, /LicensePublicKeyPath/);
  assert.match(build, /RequireBeta20Activation/);
  assert.match(build, /offline-activation\.cjs/);
  assert.match(build, /PennyWiseBackup\.exe/);
  assert.match(build, /PennyWiseActivation\.exe/);
  assert.match(build, /postgresql-runtime\.json/);
  assert.match(build, /UTF8Encoding\(\$false\)/);
  assert.match(operationSource, /verifyPostgresRuntime/);
  assert.match(operationSource, /pg_ctl backgrounds postgres/);
  assert.match(manifest, /PackageIntegrity/);
  assert.match(manifest, /Name="TypeWritingMonkeys\.PennyWiseAccounting"/);
  assert.match(lifecycle, /Get-AppxPackage -Name 'TypeWritingMonkeys\.PennyWiseAccounting'/);
  assert.match(lifecycle, /function Read-MsixPackageIdentity/);
  assert.match(lifecycle, /\[System\.IO\.Compression\.ZipFile\]::OpenRead/);
  assert.doesNotMatch(lifecycle, /Get-AppxPackageManifest -Package \$resolvedPackage/);
  assert.match(lifecycle, /Identity\.Name -eq 'TypeWritingMonkeys\.PennyWiseAccounting'/);
  assert.match(lifecycle, /ResumeAfterReboot/);
  assert.match(lifecycle, /Reboot continuity passed/);
  assert.match(manifest, /PennyWiseRestore/);
  assert.match(manifest, /PennyWiseActivation/);
  assert.match(launcher, /one-time device activation/);
  assert.match(launcher, /offlineActivation\.BETA20_EDITION/);
  assert.match(activationSource, /BETA_SLOT_LIMIT = 20/);
  assert.match(issuer, /Beta slot \$\{slot\} is already issued/);
});
