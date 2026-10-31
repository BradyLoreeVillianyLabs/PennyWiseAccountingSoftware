import assert from "node:assert/strict";
import test from "node:test";
import {
  currencyExponent,
  formatMinor,
  formatMoney,
  minorToInput,
  parseMoneyInput,
  parseSignedMoneyInput
} from "./money.js";

test("parses CAD input exactly without floating point", () => {
  assert.equal(parseMoneyInput("123.45"), "12345");
  assert.equal(parseMoneyInput("123,45"), "12345");
  assert.equal(parseMoneyInput("0"), "0");
  assert.equal(parseMoneyInput("1000000000000.99"), "100000000000099");
});

test("rejects ambiguous, negative, and over-precise owner input", () => {
  assert.throws(() => parseMoneyInput("1,234.56"), /thousands separator/);
  assert.throws(() => parseMoneyInput("1.234"), /123.45/);
  assert.throws(() => parseMoneyInput("-1.00"), /123.45/);
  assert.equal(parseSignedMoneyInput("-12.30"), "-1230");
});

test("formats exact app, document, and export money contexts", () => {
  assert.equal(formatMoney("12345", "CAD", { context: "app", locale: "en-CA" }), "$123.45");
  assert.equal(formatMoney("-123456", "CAD", { context: "app", locale: "en-CA" }), "-$1,234.56");
  assert.equal(
    formatMoney("123456", "CAD", { context: "document", locale: "fr-CA" }),
    "1\u00a0234,56\u00a0CAD"
  );
  assert.equal(formatMoney("12345", "USD", { context: "document", locale: "en-CA" }), "USD 123.45");
  assert.equal(formatMoney("12345", "CAD", { context: "export" }), "123.45");
  assert.equal(formatMoney("1234", "JPY", { context: "document", locale: "en-CA" }), "JPY 1,234");
  assert.equal(
    formatMoney("1234567", "KWD", { context: "document", locale: "en-CA" }),
    "KWD 1,234.567"
  );
  assert.equal(
    formatMoney("900719925474099300", "CAD", { context: "export" }),
    "9007199254740993.00"
  );
  assert.equal(formatMinor("12345"), "$123.45");
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(minorToInput("12345"), "123.45");
});
