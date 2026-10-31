"use strict";

const crypto = require("node:crypto");

const BETA20_EDITION = "BETA_20";
const FOUNDER_EDITION = "FOUNDER";
const ISSUER = "PennyWise Accounting";
const BETA_SLOT_LIMIT = 20;
const INSTALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createBeta20License({ privateKey, installId, slot, now = new Date() }) {
  requireInstallId(installId);
  requireSlot(slot);
  if (!(now instanceof Date) || Number.isNaN(now.getTime()))
    throw new Error("Activation issue time is invalid.");
  const claims = {
    schemaVersion: 1,
    issuer: ISSUER,
    edition: BETA20_EDITION,
    status: "ACTIVE",
    licenseId: crypto.randomUUID(),
    installId: installId.toLowerCase(),
    slot,
    issuedAt: now.toISOString()
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8");
  return {
    alg: "Ed25519",
    payload: payload.toString("base64url"),
    signature: crypto.sign(null, payload, privateKey).toString("base64url")
  };
}

function verifyLicenseEnvelope({ envelope, publicKey, installId, requiredEdition = null }) {
  try {
    requireInstallId(installId);
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
      return invalid("The activation file is not a JSON object.");
    if (
      envelope.alg !== "Ed25519" ||
      typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string"
    )
      return invalid("The activation file has an unsupported signature format.");

    const payload = Buffer.from(envelope.payload, "base64url");
    const signature = Buffer.from(envelope.signature, "base64url");
    if (!payload.length || !signature.length || !crypto.verify(null, payload, publicKey, signature))
      return invalid("The activation signature is invalid.");

    const claims = JSON.parse(payload.toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims))
      return invalid("The activation claims are invalid.");
    if (claims.issuer !== ISSUER || claims.status !== "ACTIVE")
      return invalid("The activation is not issued for an active PennyWise installation.");
    if (requiredEdition && claims.edition !== requiredEdition)
      return invalid("The activation edition does not match this PennyWise package.");

    if (claims.edition === BETA20_EDITION) {
      if (claims.schemaVersion !== 1 || !INSTALL_ID_PATTERN.test(claims.licenseId || ""))
        return invalid("The beta activation identifier is invalid.");
      requireInstallId(claims.installId);
      requireSlot(claims.slot);
      if (claims.installId.toLowerCase() !== installId.toLowerCase())
        return invalid("This beta activation belongs to a different PennyWise installation.");
    } else if (claims.edition !== FOUNDER_EDITION) {
      return invalid("The activation edition is not supported.");
    }

    return { valid: true, claims };
  } catch (error) {
    return invalid(
      error instanceof Error ? error.message : "The activation file could not be verified."
    );
  }
}

function requireInstallId(installId) {
  if (typeof installId !== "string" || !INSTALL_ID_PATTERN.test(installId))
    throw new Error("The PennyWise installation request code is invalid.");
}

function requireSlot(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > BETA_SLOT_LIMIT)
    throw new Error(`Beta activation slot must be a whole number from 1 to ${BETA_SLOT_LIMIT}.`);
}

function invalid(error) {
  return { valid: false, error };
}

module.exports = {
  BETA20_EDITION,
  BETA_SLOT_LIMIT,
  FOUNDER_EDITION,
  ISSUER,
  createBeta20License,
  verifyLicenseEnvelope
};
