import { describe, expect, it } from "vitest";
import {
  decimalMoney,
  etsyMoney,
  normalizeEtsyReceipt,
  normalizeWooOrder,
  privacySafeCommercePayload
} from "./commerce-normalization.js";
import type { CommerceNormalizationIssue } from "./commerce-connector-types.js";

describe("commerce money normalization", () => {
  it("keeps CAD and USD amounts exact beyond JavaScript's safe integer range", () => {
    const issues: CommerceNormalizationIssue[] = [];

    const cad = decimalMoney("9007199254740993.27", "CAD", 2, issues, "cad_total");
    const usd = etsyMoney(
      {
        amount: "-900719925474099327",
        divisor: 100,
        currency_code: "USD"
      },
      issues,
      "usd_total"
    );

    expect(cad).toMatchObject({
      currency: "CAD",
      units: "900719925474099327",
      divisor: "100",
      decimal: "9007199254740993.27"
    });
    expect(usd).toMatchObject({
      currency: "USD",
      units: "-900719925474099327",
      divisor: "100",
      decimal: "-9007199254740993.27"
    });
    expect(issues).toEqual([]);
  });

  it("blocks Etsy Money with a non-power-of-ten divisor instead of guessing", () => {
    const issues: CommerceNormalizationIssue[] = [];

    const money = etsyMoney(
      { amount: 1234, divisor: 20, currency_code: "CAD" },
      issues,
      "grandtotal"
    );

    expect(money).toBeNull();
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "MONEY_DIVISOR_INVALID",
        severity: "BLOCKING",
        path: "grandtotal"
      })
    );
  });

  it("marks currencies outside the current CAD/USD release as blocking", () => {
    const event = normalizeWooOrder(
      {
        id: 7301,
        status: "processing",
        currency: "EUR",
        currency_minor_unit: 2,
        total: "10.00",
        line_items: []
      },
      "https://store.example.test"
    );

    expect(event.normalizedPayload.money.total).toMatchObject({
      currency: "EUR",
      units: "1000",
      decimal: "10.00"
    });
    expect(event.normalizationIssues).toContainEqual(
      expect.objectContaining({
        code: "CURRENCY_NOT_RELEASED",
        severity: "BLOCKING",
        path: "currency"
      })
    );
  });

  it("accepts human-confirmed catalog mappings for WooCommerce and Etsy order lines", () => {
    const mapping = { catalogSkuMappings: { "SKU-REVIEWED": "local-product-id" } };
    const woo = normalizeWooOrder(
      {
        id: 7302,
        status: "processing",
        currency: "CAD",
        total: "10.00",
        line_items: [
          {
            id: 1,
            product_id: 10,
            sku: "SKU-REVIEWED",
            name: "Reviewed item",
            quantity: 1,
            subtotal: "10.00",
            total: "10.00",
            total_tax: "0.00"
          }
        ]
      },
      "woo-shop",
      mapping
    );
    const etsy = normalizeEtsyReceipt(
      {
        receipt_id: 7303,
        grandtotal: { amount: 1000, divisor: 100, currency_code: "CAD" },
        subtotal: { amount: 1000, divisor: 100, currency_code: "CAD" },
        transactions: [
          {
            transaction_id: 2,
            listing_id: 20,
            sku: ["SKU-REVIEWED"],
            title: "Reviewed item",
            quantity: 1,
            price: { amount: 1000, divisor: 100, currency_code: "CAD" }
          }
        ]
      },
      "etsy-shop",
      mapping
    );

    for (const event of [woo, etsy]) {
      expect(event.normalizedPayload.lines[0]?.mappingStatus).toBe("MAPPED");
      expect(event.normalizedPayload.mapping.itemStatus).toBe("MAPPED");
      expect(event.normalizationIssues).not.toContainEqual(
        expect.objectContaining({ code: "ITEM_MAPPING_REQUIRED" })
      );
    }
  });

  it("maps no-SKU WooCommerce and Etsy lines only through prior confirmed provider identities", () => {
    const woo = normalizeWooOrder(
      {
        id: 7305,
        status: "processing",
        currency: "CAD",
        total: "10.00",
        line_items: [
          {
            id: 1,
            product_id: 90,
            variation_id: 901,
            name: "No-SKU variation",
            quantity: 1,
            subtotal: "10.00",
            total: "10.00",
            total_tax: "0.00"
          }
        ]
      },
      "woo-shop",
      { catalogVariantMappings: { "901": "woo-local-product" } }
    );
    const etsy = normalizeEtsyReceipt(
      {
        receipt_id: 7306,
        grandtotal: { amount: 1000, divisor: 100, currency_code: "CAD" },
        subtotal: { amount: 1000, divisor: 100, currency_code: "CAD" },
        transactions: [
          {
            transaction_id: 3,
            product_id: "etsy-product-7",
            listing_id: 70,
            title: "No-SKU Etsy offering",
            quantity: 1,
            price: { amount: 1000, divisor: 100, currency_code: "CAD" }
          }
        ]
      },
      "etsy-shop",
      { catalogVariantMappings: { "etsy-product-7": "etsy-local-product" } }
    );

    for (const event of [woo, etsy]) {
      expect(event.normalizedPayload.lines[0]?.sku).toBeNull();
      expect(event.normalizedPayload.lines[0]?.mappingStatus).toBe("MAPPED");
      expect(event.normalizationIssues).not.toContainEqual(
        expect.objectContaining({ code: "SKU_MISSING" })
      );
    }
  });

  it("blocks conflicting manual and confirmed catalog mappings instead of choosing one", () => {
    const event = normalizeWooOrder(
      {
        id: 7304,
        status: "processing",
        currency: "CAD",
        total: "10.00",
        line_items: [
          {
            id: 1,
            product_id: 10,
            sku: "SKU-CONFLICT",
            name: "Conflicted item",
            quantity: 1,
            subtotal: "10.00",
            total: "10.00",
            total_tax: "0.00"
          }
        ]
      },
      "woo-shop",
      {
        skuMappings: { "SKU-CONFLICT": "manual-product" },
        catalogSkuMappings: { "SKU-CONFLICT": "confirmed-product" }
      }
    );

    expect(event.normalizedPayload.lines[0]?.mappingStatus).toBe("REVIEW_REQUIRED");
    expect(event.normalizedPayload.mapping.itemStatus).toBe("REVIEW_REQUIRED");
    expect(event.normalizationIssues).toContainEqual(
      expect.objectContaining({
        code: "ITEM_MAPPING_CONFLICT",
        severity: "BLOCKING",
        path: "line_items.0.sku"
      })
    );
  });

  it("requires an explicit tax remitter and every observed provider tax rate", () => {
    const order = {
      id: 7307,
      status: "processing",
      currency: "USD",
      total: "12.00",
      line_items: [],
      tax_lines: [
        { id: 10, label: "State tax", tax_total: "1.00" },
        { id: 11, label: "Local tax", tax_total: "1.00" }
      ]
    };
    const unconfirmed = normalizeWooOrder(order, "woo-shop", {
      taxMappings: { "10": "state-tax" }
    });
    expect(unconfirmed.normalizedPayload.mapping).toMatchObject({
      taxStatus: "REVIEW_REQUIRED",
      taxRemittanceResponsibility: "REVIEW_REQUIRED"
    });
    expect(unconfirmed.normalizationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TAX_RATE_MAPPING_REQUIRED", severity: "BLOCKING" }),
        expect.objectContaining({
          code: "TAX_REMITTANCE_CONFIRMATION_REQUIRED",
          severity: "BLOCKING"
        })
      ])
    );

    const marketplace = normalizeWooOrder(order, "woo-shop", {
      taxMappings: { "10": "state-tax", "11": "local-tax" },
      taxRemittanceResponsibility: "MARKETPLACE"
    });
    expect(marketplace.normalizedPayload.mapping).toMatchObject({
      taxStatus: "MAPPED",
      taxRemittanceResponsibility: "MARKETPLACE"
    });
    expect(marketplace.normalizationIssues).not.toContainEqual(
      expect.objectContaining({ code: "TAX_REMITTANCE_CONFIRMATION_REQUIRED" })
    );
  });

  it("routes mixed seller and marketplace taxes per provider tax component", () => {
    const event = normalizeWooOrder(
      {
        id: 7313,
        status: "processing",
        currency: "CAD",
        total: "12.00",
        line_items: [],
        tax_lines: [
          { id: 10, label: "GST", tax_total: "1.00" },
          { id: 11, label: "BC PST", tax_total: "1.00" }
        ]
      },
      "woo-shop",
      {
        taxMappings: { "10": "gst-tax", "11": "bc-pst-tax" },
        taxRemittanceResponsibility: "REVIEW_REQUIRED",
        taxRemittanceMappings: { "10": "SELLER", "11": "MARKETPLACE" }
      }
    );

    expect(event.normalizedPayload.mapping).toMatchObject({
      taxStatus: "MAPPED",
      taxRemittanceResponsibility: "MIXED",
      taxRemittanceByComponent: { "10": "SELLER", "11": "MARKETPLACE" }
    });
    expect(event.normalizationIssues).not.toContainEqual(
      expect.objectContaining({ code: "TAX_REMITTANCE_CONFIRMATION_REQUIRED" })
    );
  });

  it("routes malformed provider arrays and supplied dates to blocking review", () => {
    const woo = normalizeWooOrder(
      {
        id: 7308,
        status: "processing",
        currency: "CAD",
        total: "0.00",
        line_items: { id: 1 },
        tax_lines: ["not-an-object"],
        date_modified_gmt: "not-a-date"
      },
      "woo-shop"
    );
    const etsy = normalizeEtsyReceipt(
      {
        receipt_id: 7309,
        grandtotal: { amount: 0, divisor: 100, currency_code: "CAD" },
        transactions: "not-an-array",
        update_timestamp: -1
      },
      "etsy-shop"
    );

    expect(woo.normalizationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "FIELD_SHAPE_INVALID",
          path: "line_items",
          severity: "BLOCKING"
        }),
        expect.objectContaining({ code: "FIELD_SHAPE_INVALID", path: "tax_lines.0" }),
        expect.objectContaining({ code: "DATE_INVALID", path: "date_modified_gmt" })
      ])
    );
    expect(etsy.normalizationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "FIELD_SHAPE_INVALID", path: "transactions" }),
        expect.objectContaining({ code: "DATE_INVALID", path: "update_timestamp" })
      ])
    );
  });

  it("preserves Etsy offering identity, payment fees, and aggregate tax evidence", () => {
    const event = normalizeEtsyReceipt(
      {
        receipt_id: 7310,
        is_paid: true,
        grandtotal: { amount: 1050, divisor: 100, currency_code: "CAD" },
        subtotal: { amount: 1000, divisor: 100, currency_code: "CAD" },
        total_tax_cost: { amount: 50, divisor: 100, currency_code: "CAD" },
        transactions: [
          {
            transaction_id: 91,
            listing_id: 80,
            product_id: 801,
            sku: ["SKU-OFFERING"],
            title: "Mapped offering",
            quantity: 1,
            price: { amount: 1000, divisor: 100, currency_code: "CAD" }
          }
        ],
        _clearledger_payments: [
          {
            payment_id: 71,
            status: "settled",
            amount_gross: { amount: 1050, divisor: 100, currency_code: "CAD" },
            amount_fees: { amount: 75, divisor: 100, currency_code: "CAD" }
          }
        ]
      },
      "etsy-shop",
      {
        catalogVariantMappings: { "801": "local-offering" },
        taxMappings: { total_tax_cost: "marketplace-tax" },
        taxRemittanceResponsibility: "MARKETPLACE"
      }
    );

    expect(event.normalizedPayload.lines[0]).toMatchObject({
      productExternalId: "80",
      variationExternalId: "801",
      mappingStatus: "MAPPED"
    });
    expect(event.normalizedPayload.taxes[0]).toMatchObject({
      externalId: "total_tax_cost",
      metadata: { jurisdictionGranularity: "AGGREGATE", remittanceInferred: false }
    });
    const paymentFee = event.normalizedPayload.fees.find(
      (fee) => fee.externalId === "payment-71-fees"
    );
    expect(paymentFee?.amount).toMatchObject({ units: "75", decimal: "0.75" });
  });

  it("blocks ambiguous Etsy SKUs and refunds exceeding the original order", () => {
    const event = normalizeEtsyReceipt(
      {
        receipt_id: 7311,
        grandtotal: { amount: 1000, divisor: 100, currency_code: "CAD" },
        subtotal: { amount: 1000, divisor: 100, currency_code: "CAD" },
        transactions: [
          {
            transaction_id: 92,
            listing_id: 81,
            product_id: 811,
            sku: ["SKU-ONE", "SKU-TWO"],
            title: "Ambiguous offering",
            quantity: 1,
            price: { amount: 1000, divisor: 100, currency_code: "CAD" }
          }
        ],
        _clearledger_payments: [
          {
            payment_id: 72,
            adjustments: [
              {
                payment_adjustment_id: 73,
                total_adjustment_amount: {
                  amount: 1200,
                  divisor: 100,
                  currency_code: "CAD"
                }
              }
            ]
          }
        ]
      },
      "etsy-shop",
      { catalogVariantMappings: { "811": "local-offering" } }
    );

    expect(event.normalizedPayload.mapping.itemStatus).toBe("REVIEW_REQUIRED");
    expect(event.normalizationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SKU_AMBIGUOUS", severity: "BLOCKING" }),
        expect.objectContaining({
          code: "REFUND_RECONCILIATION_REQUIRED",
          severity: "BLOCKING"
        })
      ])
    );
  });

  it("reconciles Woo discounts from already-discounted line totals without subtracting twice", () => {
    const event = normalizeWooOrder(
      {
        id: 7312,
        status: "processing",
        currency: "CAD",
        total: "9.00",
        discount_total: "1.00",
        line_items: [
          {
            id: 1,
            product_id: 101,
            sku: "SKU-DISCOUNTED",
            quantity: 1,
            subtotal: "10.00",
            total: "9.00",
            total_tax: "0.00"
          }
        ],
        coupon_lines: [{ id: 2, code: "SAVE1", discount: "1.00" }]
      },
      "woo-shop",
      { catalogProductMappings: { "101": "local-item" } }
    );

    expect(event.normalizedPayload.reconciliation).toMatchObject({
      balanced: true,
      difference: { units: "0" }
    });
    expect(event.normalizationIssues).not.toContainEqual(
      expect.objectContaining({ code: "ORDER_TOTAL_MISMATCH" })
    );
  });

  it("removes nested buyer metadata, contact values, IP addresses, and names from evidence", () => {
    const safe = privacySafeCommercePayload({
      id: 42,
      billing: { company: "Private Co", email: "buyer@example.invalid" },
      customer_ip_address: "192.0.2.10",
      meta_data: [{ key: "_billing_email", value: "alternate@example.invalid" }],
      arbitrary_contact: "hidden@example.invalid",
      order_key: "wc_order_private_key",
      name: "Private buyer",
      line_items: [{ id: 1, name: "Public product", total: "10.00" }]
    });

    expect(safe).toMatchObject({
      id: 42,
      billing: "[REDACTED]",
      customer_ip_address: "[REDACTED]",
      meta_data: "[REDACTED]",
      arbitrary_contact: "[REDACTED]",
      order_key: "[REDACTED]",
      name: "[REDACTED]",
      line_items: [{ id: 1, name: "[REDACTED]", total: "10.00" }]
    });
    expect(JSON.stringify(safe)).not.toMatch(
      /Private Co|buyer@example|alternate@example|192\.0\.2\.10|Private buyer|Public product|wc_order_private_key/
    );
  });
});
