import { createHash } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generates a short, printable reference which is stable for the invoice's
 * provisional id and does not expose the invoice UUID. The check character
 * catches the most common transcription error without pretending to be a
 * security feature.
 */
export function derivePaymentReference(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  let body = "";
  for (let index = 0; index < 5; index += 1)
    body += ALPHABET[(digest[index] ?? 0) % ALPHABET.length]!;
  const checksum =
    body.split("").reduce((sum, character) => sum + ALPHABET.indexOf(character), 0) %
    ALPHABET.length;
  return `${body.slice(0, 3)}-${body.slice(3)}${ALPHABET[checksum]!}`;
}

export function normalizePaymentReference(value: string): string {
  return value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}
