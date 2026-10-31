import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import net from "node:net";

// Real PostgreSQL drill against only newly created disposable clusters.
const resources = path.resolve(process.argv[2]);
const require = createRequire(import.meta.url);
const ops = require(path.join(resources, "native-operations.cjs"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pennywise-real-recovery-"));
const clusters = [];
function run(file, args, env = process.env) {
  const result = spawnSync(file, args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000
  });
  if (result.status !== 0)
    throw new Error(`${path.basename(file)}: ${result.stderr || result.error || result.stdout}`);
  return result.stdout.trim();
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function cluster(name, marker) {
  const dataRoot = path.join(root, name);
  fs.mkdirSync(dataRoot);
  const runtime = ops.ensureBundledPostgresRuntime({ dataRoot, resources });
  const bin = path.join(runtime, "bin");
  const owner = randomBytes(32).toString("hex");
  const pw = path.join(dataRoot, "pw.tmp");
  fs.writeFileSync(pw, owner);
  run(path.join(bin, "initdb.exe"), [
    "-D",
    path.join(dataRoot, "postgresql"),
    "--username=pennywise_owner",
    `--pwfile=${pw}`,
    "--auth=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C"
  ]);
  fs.unlinkSync(pw);
  const port = await freePort();
  const result = spawnSync(
    path.join(bin, "pg_ctl.exe"),
    ["start", "-D", path.join(dataRoot, "postgresql"), "-w", "-o", `-p ${port} -h 127.0.0.1`],
    { stdio: "ignore", windowsHide: true, timeout: 60000 }
  );
  assert.equal(result.status, 0);
  const env = { ...process.env, PGPASSWORD: owner };
  const item = { dataRoot, bin, port, env, owner };
  clusters.push(item);
  run(
    path.join(bin, "createdb.exe"),
    ["-h", "127.0.0.1", "-p", String(port), "-U", "pennywise_owner", "pennywise"],
    env
  );
  sql(
    item,
    `CREATE TABLE _prisma_migrations(finished_at timestamptz); INSERT INTO _prisma_migrations VALUES(now()); CREATE TABLE recovery_marker(value text); INSERT INTO recovery_marker VALUES('${marker}');`
  );
  fs.mkdirSync(path.join(dataRoot, ".data"));
  fs.writeFileSync(path.join(dataRoot, ".data", "sample.txt"), marker);
  fs.writeFileSync(
    path.join(dataRoot, "installation.json"),
    JSON.stringify({ schema: 1, installId: name })
  );
  fs.writeFileSync(
    path.join(dataRoot, "runtime-state.json"),
    JSON.stringify({ databasePort: port })
  );
  fs.writeFileSync(
    path.join(dataRoot, "runtime-secrets.json"),
    JSON.stringify({
      databaseOwnerPassword: owner,
      databaseRuntimePassword: owner,
      connectorEncryptionSecret: `${name}-encryption-key`
    })
  );
  fs.writeFileSync(path.join(dataRoot, "license.json"), `${name}-activation`);
  return item;
}
function sql(item, text) {
  return run(
    path.join(item.bin, "psql.exe"),
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(item.port),
      "-U",
      "pennywise_owner",
      "-d",
      "pennywise",
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      text
    ],
    item.env
  );
}
try {
  const source = await cluster("source", "earlier-books");
  const target = await cluster("replacement", "replacement-empty");
  const archive = await ops.createBackup({
    dataRoot: source.dataRoot,
    resources,
    destination: path.join(root, "PennyWiseRecovery")
  });
  await ops.restoreBackup({ dataRoot: target.dataRoot, resources, archive });
  assert.equal(sql(target, "SELECT value FROM recovery_marker"), "earlier-books");
  assert.equal(
    fs.readFileSync(path.join(target.dataRoot, ".data", "sample.txt"), "utf8"),
    "earlier-books"
  );
  const recovered = JSON.parse(
    fs.readFileSync(path.join(target.dataRoot, "runtime-secrets.json"), "utf8")
  );
  assert.equal(recovered.databaseOwnerPassword, target.owner);
  assert.equal(recovered.connectorEncryptionSecret, "source-encryption-key");
  assert.equal(
    fs.readFileSync(path.join(target.dataRoot, "license.json"), "utf8"),
    "replacement-activation"
  );
  fs.appendFileSync(archive, "corrupt");
  await assert.rejects(
    ops.restoreBackup({ dataRoot: target.dataRoot, resources, archive }),
    /checksum/
  );
  assert.equal(sql(target, "SELECT value FROM recovery_marker"), "earlier-books");
  console.log(
    "PASS: real PostgreSQL backup, replacement restore, documents, destination password/activation, source encryption keys, corrupt-backup refusal."
  );
} finally {
  for (const item of clusters)
    spawnSync(
      path.join(item.bin, "pg_ctl.exe"),
      ["stop", "-D", path.join(item.dataRoot, "postgresql"), "-m", "fast", "-w"],
      { stdio: "ignore", windowsHide: true, timeout: 60000 }
    );
  fs.rmSync(root, { recursive: true, force: true });
}
