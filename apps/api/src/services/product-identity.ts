/**
 * Canonical comparison form for catalog and product identifiers.  It is only
 * used for comparison and validation; callers retain the supplied identifier
 * as source evidence so leading zeroes and human-readable formatting are not
 * destroyed.
 */
export function normalizeProductIdentifier(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return normalized || null;
}

/**
 * A GTIN check digit only applies to the standard numeric GTIN widths.  Other
 * barcode-like identifiers remain valid source evidence and are not silently
 * rewritten or rejected by this helper.
 */
export function hasValidGtinCheckDigit(value: string | null | undefined): boolean {
  const normalized = normalizeProductIdentifier(value);
  if (!normalized || !/^\d+$/.test(normalized) || ![8, 12, 13, 14].includes(normalized.length))
    return true;
  let weightedSum = 0;
  for (let index = normalized.length - 2, position = 0; index >= 0; index -= 1, position += 1)
    weightedSum += Number(normalized[index]) * (position % 2 === 0 ? 3 : 1);
  return (10 - (weightedSum % 10)) % 10 === Number(normalized.at(-1));
}
