import { test } from "node:test";
import assert from "node:assert/strict";
import { getCurrencyDecimals, formatMoney } from "../dist/currency.js";

test("UGX, TZS, RWF are 0-decimal (East African shilling/franc convention)", () => {
  assert.equal(getCurrencyDecimals("UGX"), 0);
  assert.equal(getCurrencyDecimals("TZS"), 0);
  assert.equal(getCurrencyDecimals("RWF"), 0);
});

test("KES, USD are 2-decimal (real ISO 4217 minor units)", () => {
  assert.equal(getCurrencyDecimals("KES"), 2);
  assert.equal(getCurrencyDecimals("USD"), 2);
});

test("an unrecognized code falls back to 2 decimals, never throws", () => {
  assert.equal(getCurrencyDecimals("XXX"), 2);
  assert.equal(getCurrencyDecimals("not-a-code"), 2);
});

test("formatMoney: code prefix + grouped digits, decimals per currency", () => {
  assert.equal(formatMoney(1234567, "UGX"), "UGX 1,234,567");
  assert.equal(formatMoney(1234567, "TZS"), "TZS 1,234,567");
  assert.equal(formatMoney(1234567.891, "KES"), "KES 1,234,567.89");
  assert.equal(formatMoney(0, "USD"), "USD 0.00");
});
