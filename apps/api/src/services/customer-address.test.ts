import { describe, expect, it } from "vitest";
import {
  assertCustomerAddress,
  customerAddressSchema,
  normalizeCustomerAddress
} from "./customer-address.js";

const base = {
  line1: "100 Main Street",
  city: "Calgary",
  postalCode: "T2P 1J9",
  countryCode: "CA",
  subdivisionCode: "CA-AB"
};

describe("structured customer addresses", () => {
  it("normalizes legacy province/country names to ISO codes", () => {
    expect(
      normalizeCustomerAddress({
        line1: base.line1,
        city: base.city,
        postalCode: base.postalCode,
        province: "AB",
        country: "CA"
      })
    ).toMatchObject({ countryCode: "CA", subdivisionCode: "CA-AB", postalCode: "T2P 1J9" });
  });

  it("accepts representative valid Canadian and US postal forms", () => {
    expect(customerAddressSchema.safeParse(base).success).toBe(true);
    expect(
      customerAddressSchema.safeParse({
        ...base,
        city: "Seattle",
        postalCode: "98101-1234",
        countryCode: "US",
        subdivisionCode: "US-WA"
      }).success
    ).toBe(true);
    expect(
      customerAddressSchema.safeParse({
        ...base,
        postalCode: "T2P1J9",
        subdivisionCode: "AB"
      }).success
    ).toBe(true);
  });

  it("rejects malformed CA and US addresses with field-level issues", () => {
    const canadian = customerAddressSchema.safeParse({ ...base, postalCode: "90210" });
    expect(canadian.success).toBe(false);
    expect(canadian.success ? [] : canadian.error.issues.map((issue) => issue.path)).toContainEqual(
      ["postalCode"]
    );

    const us = customerAddressSchema.safeParse({
      ...base,
      countryCode: "US",
      subdivisionCode: "US-WA",
      postalCode: "9810"
    });
    expect(us.success).toBe(false);
    expect(us.success ? [] : us.error.issues.map((issue) => issue.path)).toContainEqual([
      "postalCode"
    ]);

    expect(() => assertCustomerAddress({ ...base, subdivisionCode: "CA-XX" })).toThrow(
      /subdivisionCode/
    );
  });
});
