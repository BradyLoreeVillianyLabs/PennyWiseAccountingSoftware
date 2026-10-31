"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { verifyLicenseEnvelope, BETA20_EDITION } = require("./offline-activation.cjs");

function provisionBeta({ dataRoot, envelope, publicKey }) {
  const claims = JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"));
  const identityFile = path.join(dataRoot, "installation.json");
  const existing = fs.existsSync(identityFile)
    ? JSON.parse(fs.readFileSync(identityFile, "utf8"))
    : null;
  const installId = existing?.installId || claims.installId;
  const verification = verifyLicenseEnvelope({
    envelope,
    publicKey,
    installId,
    requiredEdition: BETA20_EDITION
  });
  if (!verification.valid) throw new Error(verification.error);
  if (!existing && fs.existsSync(path.join(dataRoot, "postgresql")))
    throw new Error("Existing books have no installation identity. Setup will not replace them.");
  fs.mkdirSync(dataRoot, { recursive: true });
  if (!existing)
    fs.writeFileSync(
      identityFile,
      JSON.stringify({ schema: 1, installId, createdAt: new Date().toISOString() }),
      { flag: "wx", mode: 0o600 }
    );
  const temporary = path.join(dataRoot, `license-${process.pid}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(envelope), { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, path.join(dataRoot, "license.json"));
  return verification.claims;
}

if (require.main === module) {
  const [activationPath, publicKeyPath] = process.argv.slice(2);
  const result = provisionBeta({
    dataRoot: path.join(process.env.LOCALAPPDATA, "PennyWiseAccounting"),
    envelope: JSON.parse(fs.readFileSync(activationPath, "utf8")),
    publicKey: fs.readFileSync(publicKeyPath, "utf8")
  });
  process.stdout.write(`Beta slot ${result.slot} provisioned.\n`);
}

module.exports = { provisionBeta };
