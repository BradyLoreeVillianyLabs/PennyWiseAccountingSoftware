const TWO_DECIMAL_SCALE = 100n;
const CURRENCY_EXPONENTS = Object.freeze({ CAD: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 });

export function parseMoneyInput(value) {
  let text = String(value ?? "").trim();
  if (text.includes(",") && text.includes("."))
    throw new Error("Enter an amount like 123.45 without a thousands separator.");
  if (text.includes(",")) text = text.replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter an amount like 123.45.");
  const [whole, fraction = ""] = text.split(".");
  return (BigInt(whole) * TWO_DECIMAL_SCALE + BigInt(fraction.padEnd(2, "0"))).toString();
}

export function parseSignedMoneyInput(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith("-")) return `-${parseMoneyInput(text.slice(1))}`;
  return parseMoneyInput(text);
}

export function currencyExponent(currency = "CAD", locale = "en-CA") {
  const code = String(currency).trim().toUpperCase();
  if (CURRENCY_EXPONENTS[code] !== undefined) return CURRENCY_EXPONENTS[code];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    currencyDisplay: "code"
  }).resolvedOptions().maximumFractionDigits;
}

function decimalFromMinor(value, exponent) {
  const amount = BigInt(value ?? 0);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  if (exponent === 0) return `${negative ? "-" : ""}${absolute.toString()}`;
  const scale = 10n ** BigInt(exponent);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(exponent, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

export function formatMoney(value, currency = "CAD", { context = "app", locale = "en-CA" } = {}) {
  const code = String(currency).trim().toUpperCase();
  const exponent = currencyExponent(code, locale);
  const decimal = decimalFromMinor(value, exponent);
  if (context === "export") return decimal;
  const currencyDisplay = context === "document" ? "code" : "symbol";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent
    }).format(decimal);
  } catch {
    return decimal;
  }
}

export function formatMinor(value, currency = "CAD", locale = "en-CA") {
  return formatMoney(value, currency, { context: "app", locale });
}

export function minorToInput(value) {
  const amount = BigInt(value ?? 0);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / TWO_DECIMAL_SCALE;
  const cents = (absolute % TWO_DECIMAL_SCALE).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}
