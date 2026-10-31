import { AppError } from "@clearledger/shared";

/**
 * Manual payment references are retained as accounting evidence. They must
 * never become a side channel for PAN, CVV, or other raw card credentials.
 * Provider tokens and processor transaction references remain valid because
 * they do not look like a card number.
 */
export function assertSafePaymentReference(reference: string | null | undefined): void {
  const value = reference?.trim();
  if (!value) return;

  if (/\b(?:cvv|cvc|security\s*code|card\s*(?:number|details?))\b/i.test(value))
    throw sensitiveReferenceError();

  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  if (
    candidates.some((candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
    })
  )
    throw sensitiveReferenceError();
}

function sensitiveReferenceError(): AppError {
  return new AppError(
    "PAYMENT_REFERENCE_SENSITIVE",
    "Raw card credentials cannot be stored. Use a processor token, terminal receipt, or masked reference instead.",
    422
  );
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (doubleDigit) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}
