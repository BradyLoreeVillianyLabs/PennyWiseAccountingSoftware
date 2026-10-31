import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  BETA20_EDITION,
  BETA_SLOT_LIMIT,
  createBeta20License
} = require("../distribution/windows-native/offline-activation.cjs");

const [command, ...argumentList] = process.argv.slice(2);
const args = parseArgs(argumentList);

if (command === "generate-key") await generateKey(args);
else if (command === "issue") await issueActivation(args);
else usage();

async function generateKey(values) {
  const privateKeyPath = requiredPath(values, "private-key");
  const publicKeyPath = requiredPath(values, "public-key");
  await refuseExisting(privateKeyPath);
  await refuseExisting(publicKeyPath);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await writePrivate(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  await writeAtomic(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), 0o644);
  console.log(
    `Created PennyWise beta issuer key pair. Keep private key offline: ${privateKeyPath}`
  );
  console.log(`Public key for Build-PennyWiseMsix.ps1: ${publicKeyPath}`);
}

async function issueActivation(values) {
  const privateKeyPath = requiredPath(values, "private-key");
  const ledgerPath = requiredPath(values, "ledger");
  const outputPath = requiredPath(values, "out");
  const installId = requiredText(values, "install-id");
  const slot = Number(requiredText(values, "slot"));
  if (!Number.isInteger(slot) || slot < 1 || slot > BETA_SLOT_LIMIT)
    throw new Error(`--slot must be a whole number from 1 to ${BETA_SLOT_LIMIT}.`);
  await refuseExisting(outputPath);

  const privateKey = await readFile(privateKeyPath, "utf8");
  const ledger = await readLedger(ledgerPath);
  if (ledger.slots[String(slot)])
    throw new Error(
      `Beta slot ${slot} is already issued. Do not reuse a slot; use the documented recovery reissue procedure.`
    );

  const envelope = createBeta20License({ privateKey, installId, slot });
  const claims = JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"));
  ledger.slots[String(slot)] = {
    licenseId: claims.licenseId,
    installId: claims.installId,
    issuedAt: claims.issuedAt
  };

  await writeAtomic(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 0o600);
  await writeAtomic(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 0o600);
  console.log(`Issued beta slot ${slot} for installation ${claims.installId}.`);
  console.log(`Send this activation file without renaming its contents: ${outputPath}`);
}

async function readLedger(ledgerPath) {
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8"));
    if (
      !parsed ||
      parsed.schemaVersion !== 1 ||
      parsed.program !== BETA20_EDITION ||
      !parsed.slots ||
      typeof parsed.slots !== "object" ||
      Array.isArray(parsed.slots)
    )
      throw new Error("The activation ledger is not a supported PennyWise BETA_20 ledger.");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT")
      return { schemaVersion: 1, program: BETA20_EDITION, maxSlots: BETA_SLOT_LIMIT, slots: {} };
    throw error;
  }
}

async function writePrivate(filePath, content) {
  await writeAtomic(filePath, content, 0o600);
}

async function writeAtomic(filePath, content, mode) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, filePath);
}

async function refuseExisting(filePath) {
  try {
    await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing file: ${filePath}`);
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined || parsed.has(name.slice(2))) usage();
    parsed.set(name.slice(2), value);
  }
  return parsed;
}

function requiredText(values, name) {
  const value = values.get(name);
  if (!value?.trim()) throw new Error(`--${name} is required.`);
  return value.trim();
}

function requiredPath(values, name) {
  return resolve(requiredText(values, name));
}

function usage() {
  throw new Error(
    "Usage:\n" +
      "  node scripts/pennywise-beta-activation.mjs generate-key --private-key <protected.pem> --public-key <public.pem>\n" +
      "  node scripts/pennywise-beta-activation.mjs issue --private-key <protected.pem> --ledger <issued.json> --install-id <request-code> --slot <1-20> --out <activation.json>"
  );
}
