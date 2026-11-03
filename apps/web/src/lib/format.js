// Date and fixed-precision quantity helpers.

import { showNotice } from "./notices.js";

export function toIsoDateTime(value) {
  return value ? new Date(value).toISOString() : null;
}

export function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function percentToRatioMicros(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  const match = /^(100(?:\.0{1,4})?|(?:\d{1,2})(?:\.\d{1,4})?)$/.exec(normalized);
  if (!match || Number(normalized) <= 0) {
    showNotice("Percentage must be greater than 0 and less than 100.", true);
    return null;
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  const micros = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  if (micros >= 1_000_000n) {
    showNotice("The first milestone must leave a positive final balance.", true);
    return null;
  }
  return micros.toString();
}

export function percentageToMicros(rawValue) {
  const value = String(rawValue ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(value))
    throw new Error("Residual percentage must be 0 to 100 with up to four decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  if (micros > 1_000_000n) throw new Error("Residual percentage must be between 0 and 100.");
  return micros.toString();
}

export function toDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function localDateTimeToIso(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function quantityToMicros(value) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value));
  if (!match) throw new Error("Quantity must have at most six decimal places.");
  return `${match[1]}${(match[2] ?? "").padEnd(6, "0")}`.replace(/^0+(?=\d)/, "");
}

export function formatQuantityMicros(value) {
  const negative = String(value).startsWith("-");
  const digits = String(value).replace("-", "").padStart(7, "0");
  const whole = digits.slice(0, -6);
  const fraction = digits.slice(-6).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function localCalendarDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
