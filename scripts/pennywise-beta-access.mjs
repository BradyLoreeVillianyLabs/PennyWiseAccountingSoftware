import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile
} from "node:fs/promises";
import { closeSync, existsSync, openSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = resolve(
  root,
  "infrastructure",
  "beta",
  "pennywise-controlled-shares.json"
);
const betaDirectory = join(
  process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? root, "AppData", "Local"),
  "PennyWiseAccounting",
  "beta"
);
const defaultSecretsPath = join(betaDirectory, "pennywise-beta-secrets.json");
const taskName = "PennyWise Beta Tunnel Supervisor";
const minimumControlledPort = 3100;
const maximumControlledPort = 3701;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: true,
  options: {
    config: { type: "string" },
    secrets: { type: "string" },
    "rotate-access": { type: "boolean", default: false },
    "install-task": { type: "boolean", default: false },
    start: { type: "boolean", default: false },
    uninstall: { type: "boolean", default: false },
    reveal: { type: "boolean", default: false }
  }
});

const command = positionals[0] ?? "help";
const configPath = resolve(values.config ?? defaultConfigPath);
const secretsPath = resolve(values.secrets ?? defaultSecretsPath);

try {
  if (command === "help") {
    printUsage();
  } else if (command === "init") {
    await initialize({
      configPath,
      secretsPath,
      databaseUrl: process.env.DATABASE_URL,
      rotateAccess: values["rotate-access"],
      installTask: values["install-task"],
      start: values.start
    });
  } else if (command === "start") {
    await supervise({ configPath, secretsPath });
  } else if (command === "stop") {
    await stop({ configPath, uninstall: values.uninstall });
  } else if (command === "status") {
    await status({ configPath, secretsPath });
  } else if (command === "access") {
    await showAccess({ configPath, secretsPath, reveal: values.reveal });
  } else {
    throw new Error(`Unknown PennyWise beta command: ${command}`);
  }
} catch (error) {
  if (command === "start") {
    await ensurePrivateDirectory(betaDirectory);
    await appendFile(
      join(betaDirectory, "supervisor-failure.log"),
      `${new Date().toISOString()} ${sanitizeFailure(error)}\n`,
      "utf8"
    );
  }
  throw error;
}

async function initialize({
  configPath,
  secretsPath,
  databaseUrl,
  rotateAccess,
  installTask,
  start
}) {
  const config = await readConfig(configPath);
  await ensurePrivateDirectory(betaDirectory, { lockDown: true });
  const existing = await readOptionalSecrets(secretsPath);
  const effectiveDatabaseUrl = databaseUrl ?? existing?.databaseUrl;
  if (!effectiveDatabaseUrl)
    throw new Error("Set DATABASE_URL when initializing PennyWise beta access for the first time.");
  assertDevelopmentDatabaseUrl(effectiveDatabaseUrl, config);
  const restartAfterRotation = rotateAccess && supervisorTaskIsRunning();

  const secrets = {
    schemaVersion: 1,
    databaseUrl: effectiveDatabaseUrl,
    runtimeDatabaseUrl: existing?.runtimeDatabaseUrl ?? null,
    connectorCredentialEncryptionSecret:
      existing?.connectorCredentialEncryptionSecret ?? randomToken(),
    webhookSecretEncryptionSecret: existing?.webhookSecretEncryptionSecret ?? randomToken(),
    paymentWebhookSecret: existing?.paymentWebhookSecret ?? randomToken(),
    paymentAccountEncryptionSecret: existing?.paymentAccountEncryptionSecret ?? randomToken(),
    emailConnectionEncryptionSecret: existing?.emailConnectionEncryptionSecret ?? randomToken(),
    email: normalizeEmailConfiguration(existing?.email),
    shares: {}
  };
  for (const [name, value] of Object.entries({
    connectorCredentialEncryptionSecret: secrets.connectorCredentialEncryptionSecret,
    webhookSecretEncryptionSecret: secrets.webhookSecretEncryptionSecret,
    paymentWebhookSecret: secrets.paymentWebhookSecret,
    paymentAccountEncryptionSecret: secrets.paymentAccountEncryptionSecret,
    emailConnectionEncryptionSecret: secrets.emailConnectionEncryptionSecret
  })) {
    if (value.length < 32) throw new Error(`The existing ${name} is too short.`);
  }
  if (secrets.runtimeDatabaseUrl) assertDevelopmentDatabaseUrl(secrets.runtimeDatabaseUrl, config);
  for (const share of config.shares) {
    const existingPassword = existing?.shares?.[share.key]?.accessPassword;
    secrets.shares[share.key] = {
      accessPassword: rotateAccess || !existingPassword ? randomToken() : existingPassword
    };
    if (secrets.shares[share.key].accessPassword.length < 20)
      throw new Error(`The existing access password for ${share.key} is too short.`);
  }
  if (start && !secrets.runtimeDatabaseUrl) {
    throw new Error(
      "Provision the constrained PennyWise beta runtime database login before starting shares. " +
        "Run node scripts/provision-pennywise-beta-runtime.mjs with an approved local migration/admin connection."
    );
  }

  await mkdir(dirname(secretsPath), { recursive: true });
  await writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  const protection = protectSecrets(secretsPath);
  await reserveDomains(config);
  const entryPoint = await ensurePennyWiseEntryPoint();
  if (installTask) installSupervisorTask({ configPath, secretsPath, entryPoint });
  if (restartAfterRotation) {
    // Task Scheduler ignores a second invocation while the existing supervisor
    // is running. End it before launching the replacement so the generated
    // passwords take effect immediately rather than leaving an old password in
    // memory on a live tunnel.
    await stopSupervisorForRotation(config);
  }
  if (start) {
    if (!installTask)
      throw new Error("--start requires --install-task so the persistent task owns the shares.");
    runOrThrow("schtasks.exe", ["/Run", "/TN", taskName]);
  } else if (restartAfterRotation) {
    runOrThrow("schtasks.exe", ["/Run", "/TN", taskName]);
  }

  console.log(
    `PennyWise beta access initialized. Secrets use ${protection}; stable source entry point: ${entryPoint}`
  );
}

async function supervise({ configPath, secretsPath }) {
  const config = await readConfig(configPath);
  const secrets = await readSecrets(secretsPath, config);
  if (!secrets.runtimeDatabaseUrl) {
    throw new Error(
      "PennyWise beta shares require a constrained runtime database login. " +
        "Provision it before starting the supervisor."
    );
  }
  assertDevelopmentDatabaseUrl(secrets.runtimeDatabaseUrl, config);
  const logDirectory = join(dirname(secretsPath), "logs");
  await ensurePrivateDirectory(logDirectory);
  const loclxPath = resolveLoclxCommand();

  const children = new Map();
  let stopping = false;
  const shutdown = async (exitCode) => {
    if (stopping) return;
    stopping = true;
    for (const share of config.shares) await stopManagedShare(share.subdomain);
    process.exit(exitCode);
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));

  try {
    for (const share of config.shares) {
      try {
        const child = await startManagedShare({ share, secrets, logDirectory, loclxPath });
        children.set(share.key, child);
        await waitForShare(share, secrets.shares[share.key].accessPassword, child);
        console.log(`PennyWise beta share ready: https://${share.subdomain}.loclx.io/`);
      } catch (error) {
        children.delete(share.key);
        await stopManagedShare(share.subdomain);
        console.error(
          `PennyWise beta share ${share.key} did not become healthy: ${sanitizeFailure(error)}`
        );
      }
    }
    if (children.size === 0) {
      throw new Error("No PennyWise beta share became healthy.");
    }

    while (!stopping) {
      await delay(15_000);
      for (const share of config.shares) {
        const child = children.get(share.key);
        const healthy = await shareIsHealthy(share, secrets.shares[share.key].accessPassword);
        if (child?.exitCode === null && healthy) continue;
        try {
          await stopManagedShare(share.subdomain);
          const replacement = await startManagedShare({ share, secrets, logDirectory, loclxPath });
          children.set(share.key, replacement);
          await waitForShare(share, secrets.shares[share.key].accessPassword, replacement);
          console.log(`PennyWise beta share recovered: https://${share.subdomain}.loclx.io/`);
        } catch (error) {
          children.delete(share.key);
          await stopManagedShare(share.subdomain);
          console.error(
            `PennyWise beta share ${share.key} remains unavailable: ${sanitizeFailure(error)}`
          );
        }
      }
    }
  } catch (error) {
    for (const share of config.shares) await stopManagedShare(share.subdomain);
    throw error;
  }
}

async function stop({ configPath, uninstall }) {
  const config = await readConfig(configPath);
  await stopSupervisorForRotation(config);
  if (uninstall) runOrThrow("schtasks.exe", ["/Delete", "/TN", taskName, "/F"]);
  console.log(
    "PennyWise beta shares stopped. QBWooBridge and non-PennyWise tunnels were not touched."
  );
}

async function stopSupervisorForRotation(config) {
  if (supervisorTaskIsRunning()) run("schtasks.exe", ["/End", "/TN", taskName]);
  await delay(1_000);
  for (const share of config.shares) await stopManagedShare(share.subdomain);
}

function supervisorTaskIsRunning() {
  const result = run("schtasks.exe", ["/Query", "/TN", taskName, "/FO", "LIST", "/V"]);
  return result.status === 0 && /^Status:\s+Running\s*$/im.test(result.stdout);
}

async function status({ configPath, secretsPath }) {
  const config = await readConfig(configPath);
  const secrets = await readSecrets(secretsPath, config);
  const rows = [];
  for (const share of config.shares) {
    const healthy = await shareIsHealthy(share, secrets.shares[share.key].accessPassword);
    rows.push(
      `${share.displayName.padEnd(8)} ${healthy ? "READY" : "UNAVAILABLE"}  https://${share.subdomain}.loclx.io/`
    );
  }
  console.log(rows.join("\n"));
}

async function showAccess({ configPath, secretsPath, reveal }) {
  const config = await readConfig(configPath);
  const secrets = await readSecrets(secretsPath, config);
  for (const share of config.shares) {
    console.log(
      `${share.displayName}: https://${share.subdomain}.loclx.io/  username: ${share.username}`
    );
    if (reveal) console.log(`  password: ${secrets.shares[share.key].accessPassword}`);
  }
  if (!reveal)
    console.log(
      "Run this command with --reveal only when privately distributing a tester password."
    );
}

async function startManagedShare({ share, secrets, logDirectory, loclxPath }) {
  await stopManagedShare(share.subdomain);
  const stdout = openSync(join(logDirectory, `${share.key}.out.log`), "a");
  const stderr = openSync(join(logDirectory, `${share.key}.err.log`), "a");
  const child = spawn(
    process.execPath,
    [
      "scripts/start-loclx-share.mjs",
      "--email",
      share.email,
      "--name",
      share.displayName,
      "--organization",
      share.organizationId,
      "--subdomain",
      share.subdomain,
      ...(tunnelMode(share) === "reserved" ? ["--reserved"] : []),
      "--username",
      share.username,
      "--web-port",
      String(share.webPort),
      "--api-port",
      String(share.apiPort)
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: secrets.runtimeDatabaseUrl ?? secrets.databaseUrl,
        CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET: secrets.connectorCredentialEncryptionSecret,
        WEBHOOK_SECRET_ENCRYPTION_SECRET: secrets.webhookSecretEncryptionSecret,
        PAYMENT_WEBHOOK_SECRET: secrets.paymentWebhookSecret,
        PAYMENT_ACCOUNT_ENCRYPTION_SECRET: secrets.paymentAccountEncryptionSecret,
        EMAIL_CONNECTION_ENCRYPTION_SECRET: secrets.emailConnectionEncryptionSecret,
        CLEARLEDGER_BETA_RUNTIME: "true",
        EMAIL_DELIVERY_MODE: secrets.email.deliveryMode,
        PENNYWISE_BETA_EMAIL_DELIVERY_APPROVED: String(secrets.email.betaDeliveryApproved),
        ...emailProviderEnvironment(secrets.email.providers),
        SHARE_ACCESS_USERNAME: share.username,
        SHARE_ACCESS_PASSWORD: secrets.shares[share.key].accessPassword,
        STRIPE_MODE: "",
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SECRET: "",
        PENNYWISE_BETA_SUPERVISED: "1",
        PENNYWISE_LOCLX_PATH: loclxPath
      },
      stdio: ["ignore", stdout, stderr],
      windowsHide: true
    }
  );
  child.once("exit", () => {
    closeSync(stdout);
    closeSync(stderr);
  });
  return child;
}

async function waitForShare(share, password, launcher = null) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (launcher?.exitCode !== null && launcher?.exitCode !== undefined) {
      throw new Error(
        `The launcher for ${share.key} exited with code ${String(launcher.exitCode)} before the share became healthy.`
      );
    }
    if (await shareIsHealthy(share, password)) return;
    await delay(2_000);
  }
  throw new Error(`Timed out waiting for https://${share.subdomain}.loclx.io/.`);
}

async function shareIsHealthy(share, password) {
  const authorization = `Basic ${Buffer.from(`${share.username}:${password}`, "utf8").toString("base64")}`;
  try {
    const api = await fetch(`http://127.0.0.1:${share.apiPort}/health`, {
      signal: AbortSignal.timeout(10_000)
    });
    if (!api.ok) return false;
    const local = await fetch(`http://127.0.0.1:${share.webPort}/api/health`, {
      headers: { authorization },
      signal: AbortSignal.timeout(10_000)
    });
    if (!local.ok) return false;
    const remote = await fetch(`https://${share.subdomain}.loclx.io/api/health`, {
      headers: { authorization },
      signal: AbortSignal.timeout(15_000)
    });
    return remote.ok;
  } catch {
    return false;
  }
}

async function stopManagedShare(subdomain) {
  const processIds = findManagedLaunchers(subdomain);
  for (const processId of processIds) run("taskkill.exe", ["/pid", processId, "/t", "/f"]);
  if (processIds.length > 0) await delay(500);
}

function findManagedLaunchers(subdomain) {
  const escaped = subdomain.replace(/'/g, "''");
  const query = [
    `$subdomain = '${escaped}'`,
    '$pattern = \'--subdomain\\s+(?:\\"(?<value>[^\\"]+)\\"|(?<value>\\S+))\'',
    "Get-CimInstance Win32_Process |",
    "Where-Object {",
    "  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts/start-loclx-share\\.mjs' -and",
    "  ($match = [regex]::Match($_.CommandLine, $pattern)).Success -and $match.Groups['value'].Value -eq $subdomain",
    "} | ForEach-Object { $_.ProcessId }"
  ].join("; ");
  const result = run("powershell.exe", ["-NoProfile", "-Command", query]);
  if (result.status !== 0) return [];
  return result.stdout
    .trim()
    .split(/\s+/)
    .filter((value) => /^\d+$/.test(value));
}

async function reserveDomains(config) {
  const loclx = resolveLoclxCommand();
  const listed = runOrThrow(loclx, ["domain", "list"]).stdout;
  for (const share of config.shares) {
    if (tunnelMode(share) === "temporary") continue;
    const domain = `${share.subdomain}.loclx.io`;
    if (listed.includes(domain)) continue;
    runOrThrow(loclx, ["domain", "reserve", "--subdomain", share.subdomain, "--region", "us"]);
  }
}

function tunnelMode(share) {
  return share.tunnelMode ?? "reserved";
}

async function ensurePrivateDirectory(path, { lockDown = false } = {}) {
  await mkdir(path, { recursive: true });
  if (!lockDown) return;
  const target = powershellLiteral(resolve(path));
  const account = powershellLiteral(runOrThrow("whoami.exe", []).stdout.trim());
  const script = [
    `$target = ${target}`,
    `$account = ${account}`,
    "$acl = Get-Acl -LiteralPath $target",
    "$acl.SetAccessRuleProtection($true, $false)",
    "foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }",
    "$rights = [System.Security.AccessControl.FileSystemRights]::FullControl",
    "$inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit",
    "$propagation = [System.Security.AccessControl.PropagationFlags]::None",
    "$allow = [System.Security.AccessControl.AccessControlType]::Allow",
    "$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($account, $rights, $inheritance, $propagation, $allow)",
    "[void]$acl.AddAccessRule($rule)",
    "Set-Acl -LiteralPath $target -AclObject $acl"
  ].join("; ");
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (result.status === 0) return;

  // Some Windows installations expose an inherited security descriptor that
  // `Set-Acl` tries to preserve as a SACL. A standard user may own the
  // directory and have Full Control yet still lack SeSecurityPrivilege to
  // write that unchanged SACL. Rebuild only the DACL with icacls, then verify
  // it remains private rather than silently continuing with a broad ACL.
  const failure = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (!/SeSecurityPrivilege|PrivilegeNotHeld/i.test(failure)) {
    throw new Error(`Could not secure the PennyWise beta directory: ${failure.trim()}`);
  }
  const accountName = runOrThrow("whoami.exe", []).stdout.trim();
  runOrThrow("icacls.exe", [
    resolve(path),
    "/inheritance:r",
    "/grant:r",
    `${accountName}:(OI)(CI)(F)`
  ]);
  const verification = [
    `$target = ${target}`,
    `$account = ${account}`,
    "$accountSid = (New-Object System.Security.Principal.NTAccount($account)).Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "$rules = @(Get-Acl -LiteralPath $target | Select-Object -ExpandProperty Access)",
    "if ($rules.Count -ne 1) { exit 1 }",
    "$rule = $rules[0]",
    "$ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "if ($ruleSid -ne $accountSid -or $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { exit 1 }"
  ].join("; ");
  const verified = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    verification
  ]);
  if (verified.status !== 0) {
    throw new Error("Could not verify a user-only ACL for the PennyWise beta directory.");
  }
}

async function ensurePennyWiseEntryPoint() {
  const bundleDirectory = dirname(root);
  const workspaceDirectory = dirname(bundleDirectory);
  const entryPoint = join(workspaceDirectory, "PennyWise-Accounting-Beta");
  try {
    const existing = await lstat(entryPoint);
    if (!existing.isSymbolicLink())
      throw new Error(
        `${entryPoint} already exists and is not the PennyWise beta source junction.`
      );
    if ((await realpath(entryPoint)) !== (await realpath(root)))
      throw new Error(`${entryPoint} does not point to the active PennyWise beta source.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await symlink(root, entryPoint, "junction");
  }
  return entryPoint;
}

function installSupervisorTask({ configPath, secretsPath, entryPoint }) {
  const taskXmlPath = join(dirname(secretsPath), "PennyWise-Beta-Tunnel-Supervisor.xml");
  const user = runOrThrow("whoami.exe", []).stdout.trim();
  const stableRoot = entryPoint;
  const taskWrapper = join(stableRoot, "scripts", "run-pennywise-beta-supervisor.mjs");
  const stableConfigPath = join(
    stableRoot,
    "infrastructure",
    "beta",
    "pennywise-controlled-shares.json"
  );
  const arguments_ = `"${taskWrapper}" start --config "${stableConfigPath}" --secrets "${secretsPath}"`;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>PennyWise Accounting controlled-beta LocalXpose supervisor.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(user)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEscape(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure></Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(process.execPath)}</Command><Arguments>${xmlEscape(arguments_)}</Arguments><WorkingDirectory>${xmlEscape(stableRoot)}</WorkingDirectory></Exec></Actions>
</Task>`;
  writeFileSync(taskXmlPath, `\ufeff${xml}`, "utf16le");
  runOrThrow("schtasks.exe", ["/Create", "/TN", taskName, "/XML", taskXmlPath, "/F"]);
}

function protectSecrets(path) {
  const encrypted = run("cipher.exe", ["/e", "/a", path]);
  if (encrypted.status === 0) return "Windows EFS encryption";
  const account = runOrThrow("whoami.exe", []).stdout.trim();
  const acl = run("icacls.exe", [path, "/inheritance:r", "/grant:r", `${account}:(R,W)`]);
  if (acl.status !== 0)
    throw new Error("Windows could not protect the PennyWise beta secret store.");
  return "a Windows user-only NTFS ACL";
}

async function readConfig(path) {
  await access(path);
  const config = JSON.parse(await readFile(path, "utf8"));
  if (config.schemaVersion !== 1 || config.environment !== "controlled-beta")
    throw new Error(
      "The PennyWise share configuration is not a supported controlled-beta configuration."
    );
  if (config.database?.expectedHost !== "127.0.0.1")
    throw new Error("The PennyWise share configuration must target a loopback-only database.");
  const keys = new Set();
  const ports = new Set();
  for (const share of config.shares ?? []) {
    for (const field of [
      "key",
      "displayName",
      "email",
      "organizationId",
      "subdomain",
      "username",
      "webPort",
      "apiPort"
    ])
      if (!share[field]) throw new Error(`A PennyWise share is missing ${field}.`);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        share.organizationId
      )
    )
      throw new Error(`PennyWise share ${share.key} has an invalid organization UUID.`);
    if (!/^pennywise[a-z0-9-]+$/.test(share.subdomain))
      throw new Error("Only PennyWise-branded LocalXpose domains may be managed.");
    if (share.tunnelMode && !["reserved", "temporary"].includes(share.tunnelMode))
      throw new Error("PennyWise share tunnelMode must be reserved or temporary.");
    if (keys.has(share.key)) throw new Error("PennyWise share keys must be unique.");
    keys.add(share.key);
    for (const port of [share.webPort, share.apiPort]) {
      if (
        !Number.isInteger(port) ||
        port < minimumControlledPort ||
        port > maximumControlledPort ||
        ports.has(port)
      )
        throw new Error(
          `PennyWise share ports must be unique and remain inside the controlled range ${minimumControlledPort}-${maximumControlledPort}.`
        );
      ports.add(port);
    }
  }
  if (keys.size === 0) throw new Error("At least one PennyWise beta share is required.");
  return config;
}

async function readOptionalSecrets(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readSecrets(path, config) {
  const secrets = await readOptionalSecrets(path);
  if (!secrets || secrets.schemaVersion !== 1 || typeof secrets.databaseUrl !== "string")
    throw new Error("PennyWise beta secrets are missing. Run the init command locally first.");
  for (const name of [
    "connectorCredentialEncryptionSecret",
    "webhookSecretEncryptionSecret",
    "paymentWebhookSecret",
    "paymentAccountEncryptionSecret",
    "emailConnectionEncryptionSecret"
  ]) {
    if (typeof secrets[name] !== "string" || secrets[name].length < 32)
      throw new Error(`The PennyWise ${name} is missing or invalid. Run the init command locally.`);
  }
  if (secrets.runtimeDatabaseUrl !== undefined && secrets.runtimeDatabaseUrl !== null) {
    if (typeof secrets.runtimeDatabaseUrl !== "string")
      throw new Error("The PennyWise runtime database URL is invalid.");
    assertDevelopmentDatabaseUrl(secrets.runtimeDatabaseUrl, config);
  }
  secrets.email = normalizeEmailConfiguration(secrets.email);
  for (const share of config.shares) {
    const password = secrets.shares?.[share.key]?.accessPassword;
    if (typeof password !== "string" || password.length < 20)
      throw new Error(`The PennyWise access password for ${share.key} is missing or invalid.`);
  }
  return secrets;
}

function assertDevelopmentDatabaseUrl(value, config) {
  const url = new URL(value);
  const databaseName = url.pathname.replace(/^\//, "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== config.database.expectedHost ||
    Number(url.port) !== config.database.expectedPort ||
    databaseName !== config.database.expectedDatabase
  )
    throw new Error(
      "The PennyWise beta supervisor accepts only the configured loopback development database."
    );
}

function powershellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitizeFailure(error) {
  return String(error instanceof Error ? (error.stack ?? error.message) : error)
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[redacted database URL]")
    .replace(
      /(SHARE_ACCESS_PASSWORD|CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET|WEBHOOK_SECRET_ENCRYPTION_SECRET|PAYMENT_WEBHOOK_SECRET|PAYMENT_ACCOUNT_ENCRYPTION_SECRET|EMAIL_CONNECTION_ENCRYPTION_SECRET|EMAIL_GMAIL_CLIENT_SECRET|EMAIL_MICROSOFT_CLIENT_SECRET)=\S+/gi,
      "$1=[redacted]"
    );
}

function normalizeEmailConfiguration(value) {
  const email = value && typeof value === "object" ? value : {};
  const deliveryMode = email.deliveryMode ?? "disabled";
  if (!["disabled", "connected-mailbox"].includes(deliveryMode))
    throw new Error("PennyWise email delivery mode must be disabled or connected-mailbox.");
  const providers = {};
  for (const [key, environmentPrefix] of [
    ["gmail", "EMAIL_GMAIL"],
    ["microsoft", "EMAIL_MICROSOFT"]
  ]) {
    const candidate = email.providers?.[key];
    if (!candidate) continue;
    if (
      typeof candidate.clientId !== "string" ||
      !candidate.clientId.trim() ||
      typeof candidate.clientSecret !== "string" ||
      !candidate.clientSecret.trim()
    )
      throw new Error(`PennyWise ${environmentPrefix} credentials are incomplete.`);
    if (candidate.redirectUri !== undefined && candidate.redirectUri !== null) {
      let redirect;
      try {
        redirect = new URL(candidate.redirectUri);
      } catch {
        throw new Error(`PennyWise ${environmentPrefix} redirect URI is invalid.`);
      }
      if (redirect.protocol !== "https:")
        throw new Error(`PennyWise ${environmentPrefix} redirect URI must use HTTPS.`);
    }
    providers[key] = {
      clientId: candidate.clientId.trim(),
      clientSecret: candidate.clientSecret.trim(),
      ...(typeof candidate.redirectUri === "string" && candidate.redirectUri.trim()
        ? { redirectUri: candidate.redirectUri.trim() }
        : {})
    };
  }
  return {
    deliveryMode,
    betaDeliveryApproved: email.betaDeliveryApproved === true,
    providers
  };
}

function emailProviderEnvironment(providers) {
  const environment = {};
  if (providers.gmail) {
    environment.EMAIL_GMAIL_CLIENT_ID = providers.gmail.clientId;
    environment.EMAIL_GMAIL_CLIENT_SECRET = providers.gmail.clientSecret;
    if (providers.gmail.redirectUri)
      environment.EMAIL_GMAIL_REDIRECT_URI = providers.gmail.redirectUri;
  }
  if (providers.microsoft) {
    environment.EMAIL_MICROSOFT_CLIENT_ID = providers.microsoft.clientId;
    environment.EMAIL_MICROSOFT_CLIENT_SECRET = providers.microsoft.clientSecret;
    if (providers.microsoft.redirectUri)
      environment.EMAIL_MICROSOFT_REDIRECT_URI = providers.microsoft.redirectUri;
  }
  return environment;
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function ensureCommand(command) {
  const result = run("where.exe", [command]);
  if (result.status !== 0) throw new Error(`${command} is required on PATH.`);
  return result.stdout.trim().split(/\r?\n/)[0];
}

function resolveLoclxCommand() {
  const configured = process.env.PENNYWISE_LOCLX_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  if (process.platform === "win32") {
    const installed = join(process.env.ProgramFiles ?? "C:\\Program Files", "loclx.exe");
    if (existsSync(installed)) return installed;
  }
  return ensureCommand(process.platform === "win32" ? "loclx.exe" : "loclx");
}

function runOrThrow(command, args) {
  const result = run(command, args);
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`
    );
  return result;
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function printUsage() {
  console.log(`PennyWise controlled beta access

node scripts/pennywise-beta-access.mjs init --install-task --start
node scripts/pennywise-beta-access.mjs status
node scripts/pennywise-beta-access.mjs access [--reveal]
node scripts/pennywise-beta-access.mjs stop [--uninstall]

The init command reads DATABASE_URL only once, stores it locally,
and refuses any database that is not the configured loopback development target.`);
}
