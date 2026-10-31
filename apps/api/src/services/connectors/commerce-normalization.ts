import type {
  CommerceConnectorEvent,
  CommerceNormalizationIssue,
  ExactMoney,
  NormalizedCommerceComponent,
  NormalizedCommerceEvent,
  NormalizedCommerceLine,
  NormalizedCommercePayment,
  NormalizedCommerceRefund
} from "./commerce-connector-types.js";

const currencyExponents: Readonly<Record<string, number>> = {
  BHD: 3,
  CAD: 2,
  CHF: 2,
  EUR: 2,
  GBP: 2,
  JOD: 3,
  JPY: 0,
  KWD: 3,
  NZD: 2,
  OMR: 3,
  USD: 2
};

type JsonRecord = Record<string, unknown>;

/** Removes buyer contact/address data that accounting normalization does not need. */
export function privacySafeCommercePayload(value: JsonRecord): JsonRecord {
  return redactPrivateValue(value) as JsonRecord;
}

export function normalizeWooOrder(
  value: JsonRecord,
  shopExternalId: string,
  mapping: Readonly<Record<string, unknown>> = {}
): CommerceConnectorEvent {
  const issues: CommerceNormalizationIssue[] = [];
  const id = identifier(value.id, "order", issues);
  const currency = currencyCode(value.currency, issues, "currency");
  const explicitExponent = integerInRange(value.currency_minor_unit, 0, 4);
  const exponent = moneyExponent(currency, explicitExponent, issues, "currency_minor_unit");
  const lineValues = records(value.line_items, issues, "line_items");
  const lines: NormalizedCommerceLine[] = lineValues.map((line, index) => {
    const sku = optionalString(line.sku);
    const productExternalId = optionalIdentifier(line.product_id);
    // WooCommerce sends `variation_id: 0` for a simple product. Zero is not a
    // provider variation identity and must never become a cross-product
    // mapping key.
    const variationExternalId = wooVariationIdentifier(line.variation_id);
    const mappingState = connectorItemMappingState(mapping, {
      sku,
      productExternalId,
      variationExternalId
    });
    const mapped = mappingState === "MAPPED";
    if (!mapped)
      issues.push({
        code:
          mappingState === "CONFLICT"
            ? "ITEM_MAPPING_CONFLICT"
            : mappingState === "PARENT_ONLY"
              ? "ITEM_VARIANT_MAPPING_REQUIRED"
              : mappingState === "SKU_ONLY"
                ? "ITEM_PROVIDER_ID_MAPPING_REQUIRED"
                : sku
                  ? "ITEM_MAPPING_REQUIRED"
                  : "SKU_MISSING",
        message:
          mappingState === "CONFLICT"
            ? "Resolve the conflicting confirmed and manual item mappings for this order line."
            : mappingState === "PARENT_ONLY"
              ? "Map this WooCommerce variation by its exact variation ID; a parent-product mapping cannot safely identify a variation."
              : mappingState === "SKU_ONLY"
                ? "Map this WooCommerce item by its exact product or variation ID; an SKU-only mapping is not safe while provider identifiers are available."
                : sku
                  ? `Map SKU ${sku} before converting this order.`
                  : "A WooCommerce order line has no SKU and requires item review.",
        severity: "BLOCKING",
        path:
          mappingState === "PARENT_ONLY"
            ? `line_items.${String(index)}.variation_id`
            : mappingState === "SKU_ONLY"
              ? `line_items.${String(index)}.product_id`
              : mappingState === "CONFLICT" && !sku
                ? `line_items.${String(index)}`
                : `line_items.${String(index)}.sku`,
        externalRef:
          variationExternalId ?? productExternalId ?? sku ?? optionalString(line.id) ?? undefined
      });
    return {
      externalId: identifier(line.id, `line-${String(index + 1)}`, issues),
      productExternalId,
      variationExternalId,
      sku,
      name: optionalString(line.name) ?? "Unnamed item",
      quantity: exactQuantity(line.quantity, issues, `line_items.${String(index)}.quantity`),
      subtotal: decimalMoney(
        line.subtotal,
        currency,
        exponent,
        issues,
        `line_items.${String(index)}.subtotal`
      ),
      total: decimalMoney(
        line.total,
        currency,
        exponent,
        issues,
        `line_items.${String(index)}.total`
      ),
      tax: decimalMoney(
        line.total_tax,
        currency,
        exponent,
        issues,
        `line_items.${String(index)}.total_tax`
      ),
      mappingStatus: mapped ? "MAPPED" : "REVIEW_REQUIRED"
    };
  });
  const taxes = records(value.tax_lines, issues, "tax_lines").map((entry, index) =>
    componentFromDecimal(
      entry,
      index,
      currency,
      exponent,
      issues,
      "tax_lines",
      "tax_total",
      undefined
    )
  );
  const taxTreatment = commerceTaxMappingState(mapping, taxes, "WooCommerce", "tax_lines", issues);
  const shipping = records(value.shipping_lines, issues, "shipping_lines").map((entry, index) =>
    componentFromDecimal(
      entry,
      index,
      currency,
      exponent,
      issues,
      "shipping_lines",
      "total",
      "total_tax"
    )
  );
  const fees = records(value.fee_lines, issues, "fee_lines").map((entry, index) =>
    componentFromDecimal(
      entry,
      index,
      currency,
      exponent,
      issues,
      "fee_lines",
      "total",
      "total_tax"
    )
  );
  const discounts = records(value.coupon_lines, issues, "coupon_lines").map((entry, index) =>
    componentFromDecimal(
      entry,
      index,
      currency,
      exponent,
      issues,
      "coupon_lines",
      "discount",
      "discount_tax"
    )
  );
  const total = decimalMoney(value.total, currency, exponent, issues, "total");
  const componentTotal = sumMoney(
    [
      ...lines.flatMap((line) => [line.total, line.tax]),
      ...shipping.flatMap((entry) => [entry.amount, entry.tax]),
      ...fees.flatMap((entry) => [entry.amount, entry.tax])
    ],
    currency
  );
  const difference = subtractMoney(total, componentTotal);
  if (difference && difference.units !== "0")
    issues.push({
      code: "ORDER_TOTAL_MISMATCH",
      message: "WooCommerce order components do not reconcile to the provider total.",
      severity: "BLOCKING",
      path: "total"
    });
  const enrichedRefunds = records(value._clearledger_refunds, issues, "_clearledger_refunds");
  const providerRefunds = records(value.refunds, issues, "refunds");
  const refunds = normalizeWooRefunds(
    enrichedRefunds.length ? enrichedRefunds : providerRefunds,
    currency,
    exponent,
    issues
  );
  validateRefundBounds(refunds, total, issues, "refunds");
  const payments: NormalizedCommercePayment[] = [];
  const transactionId = optionalString(value.transaction_id);
  const paidAt = optionalDate(
    value.date_paid_gmt ?? value.date_paid,
    issues,
    value.date_paid_gmt !== undefined ? "date_paid_gmt" : "date_paid"
  );
  if (transactionId || paidAt || optionalString(value.payment_method))
    payments.push({
      externalId: transactionId ?? `order-${id}-payment`,
      status: paidAt ? "PAID" : "RECORDED",
      method: optionalString(value.payment_method) ?? optionalString(value.payment_method_title),
      amount: total,
      occurredAt: paidAt
    });
  const createdAt = optionalDate(
    value.date_created_gmt ?? value.date_created,
    issues,
    value.date_created_gmt !== undefined ? "date_created_gmt" : "date_created"
  );
  const modifiedAt =
    optionalDate(
      value.date_modified_gmt ?? value.date_modified,
      issues,
      value.date_modified_gmt !== undefined ? "date_modified_gmt" : "date_modified"
    ) ?? createdAt;
  const normalized: NormalizedCommerceEvent = {
    schemaVersion: 1,
    provider: "WOOCOMMERCE",
    transactionKind: "ORDER",
    externalId: id,
    sourceCreatedAt: createdAt,
    sourceModifiedAt: modifiedAt,
    status: optionalString(value.status) ?? "unknown",
    currencies: { source: currency, payment: currency, settlement: null },
    money: {
      total,
      discount: decimalMoney(value.discount_total, currency, exponent, issues, "discount_total"),
      shipping: decimalMoney(value.shipping_total, currency, exponent, issues, "shipping_total"),
      tax: decimalMoney(value.total_tax, currency, exponent, issues, "total_tax"),
      refunded: sumMoney(
        refunds.map((refund) => refund.amount),
        currency
      )
    },
    lines,
    taxes,
    shipping,
    discounts,
    fees,
    payments,
    refunds,
    settlement: null,
    mapping: {
      customerStrategy: customerStrategy(mapping),
      itemStatus: lines.every((line) => line.mappingStatus === "MAPPED")
        ? "MAPPED"
        : "REVIEW_REQUIRED",
      taxStatus: taxTreatment.taxStatus,
      taxRemittanceResponsibility: taxTreatment.responsibility,
      taxRemittanceByComponent: taxTreatment.byComponent
    },
    reconciliation: {
      providerTotal: total,
      componentTotal,
      difference,
      balanced: difference ? difference.units === "0" : null
    },
    issues,
    sourceMetadata: {
      createdVia: optionalString(value.created_via),
      pricesIncludeTax:
        typeof value.prices_include_tax === "boolean" ? value.prices_include_tax : null,
      paymentMethod: optionalString(value.payment_method),
      customerNotePresent: Boolean(optionalString(value.customer_note)),
      taxEvidence: {
        kind: "STORE_CALCULATION",
        jurisdictionBreakdownAvailable: taxes.length > 0,
        remittanceInferred: false
      },
      discountReconciliation: "WooCommerce line totals are already discount-adjusted"
    }
  };
  return {
    shopExternalId,
    externalEventId: `poll:order:${id}:${modifiedAt ?? "unknown"}`,
    resourceType: "ORDER",
    resourceId: id,
    eventType: `order.${normalized.status}`,
    eventVersion: modifiedAt ?? "",
    occurredAt: modifiedAt,
    sourceCurrency: currency,
    paymentCurrency: currency,
    settlementCurrency: null,
    rawPayload: value,
    normalizedPayload: normalized,
    normalizationIssues: issues
  };
}

export function normalizeEtsyReceipt(
  value: JsonRecord,
  shopExternalId: string,
  mapping: Readonly<Record<string, unknown>> = {}
): CommerceConnectorEvent {
  const issues: CommerceNormalizationIssue[] = [];
  const id = identifier(value.receipt_id, "receipt", issues);
  const total = etsyMoney(value.grandtotal, issues, "grandtotal");
  const currency = total?.currency ?? currencyFromEtsyRecord(value, issues);
  const transactions = records(value.transactions, issues, "transactions");
  const lines: NormalizedCommerceLine[] = transactions.map((entry, index) => {
    const skus = strings(entry.sku, issues, `transactions.${String(index)}.sku`);
    const sku = skus[0] ?? null;
    const listingExternalId = optionalIdentifier(entry.listing_id);
    const etsyProductExternalId = optionalIdentifier(entry.product_id);
    const productExternalId = listingExternalId ?? etsyProductExternalId;
    const variationExternalId =
      listingExternalId && etsyProductExternalId ? etsyProductExternalId : null;
    const mappingState = connectorItemMappingState(mapping, {
      sku,
      productExternalId,
      variationExternalId
    });
    const ambiguousSku = skus.length > 1;
    if (ambiguousSku)
      issues.push({
        code: "SKU_AMBIGUOUS",
        message: "The Etsy transaction contains multiple SKUs and requires offering review.",
        severity: "BLOCKING",
        path: `transactions.${String(index)}.sku`,
        externalRef: optionalIdentifier(entry.transaction_id) ?? undefined
      });
    const mapped = mappingState === "MAPPED" && !ambiguousSku;
    if (!mapped)
      issues.push({
        code:
          mappingState === "CONFLICT"
            ? "ITEM_MAPPING_CONFLICT"
            : sku
              ? "ITEM_MAPPING_REQUIRED"
              : "SKU_MISSING",
        message:
          mappingState === "CONFLICT"
            ? "Resolve the conflicting confirmed and manual item mappings for this Etsy line."
            : sku
              ? `Map SKU ${sku} before converting this receipt.`
              : "An Etsy transaction has no SKU and requires item review.",
        severity: "BLOCKING",
        path:
          mappingState === "CONFLICT" && !sku
            ? `transactions.${String(index)}`
            : `transactions.${String(index)}.sku`,
        externalRef:
          productExternalId ?? sku ?? optionalIdentifier(entry.transaction_id) ?? undefined
      });
    const price = etsyMoney(entry.price, issues, `transactions.${String(index)}.price`);
    const quantity = exactQuantity(
      entry.quantity,
      issues,
      `transactions.${String(index)}.quantity`
    );
    return {
      externalId: identifier(entry.transaction_id, `transaction-${String(index + 1)}`, issues),
      productExternalId,
      variationExternalId,
      sku,
      name: optionalString(entry.title) ?? "Unnamed item",
      quantity,
      subtotal: multiplyMoney(price, quantity, issues, `transactions.${String(index)}`),
      total: multiplyMoney(price, quantity, issues, `transactions.${String(index)}`),
      tax: null,
      mappingStatus: mapped ? "MAPPED" : "REVIEW_REQUIRED"
    };
  });
  const taxFields = [
    { key: "total_tax_cost", name: "Sales tax", value: value.total_tax_cost },
    { key: "total_vat_cost", name: "VAT", value: value.total_vat_cost }
  ] as const;
  const taxes = taxFields.flatMap(({ key, name, value: taxValue }) => {
    const amount = etsyMoney(taxValue, issues, key);
    return amount
      ? [
          {
            externalId: key,
            name,
            amount,
            tax: null,
            metadata: {
              providerField: key,
              jurisdictionGranularity: "AGGREGATE",
              remittanceInferred: false
            }
          }
        ]
      : [];
  });
  const taxMoney = taxes
    .map((entry) => entry.amount)
    .filter((entry): entry is ExactMoney => Boolean(entry));
  const taxTreatment = commerceTaxMappingState(mapping, taxes, "Etsy", "tax", issues);
  const shippingAmount = etsyMoney(value.total_shipping_cost, issues, "total_shipping_cost");
  const shipping: NormalizedCommerceComponent[] = shippingAmount
    ? [{ externalId: "shipping", name: "Shipping", amount: shippingAmount, tax: null }]
    : [];
  const discountAmount = etsyMoney(value.discount_amt, issues, "discount_amt");
  const discounts: NormalizedCommerceComponent[] = discountAmount
    ? [{ externalId: "discount", name: "Discount", amount: discountAmount, tax: null }]
    : [];
  const paymentValues = records(value._clearledger_payments, issues, "_clearledger_payments");
  const payments = normalizeEtsyPayments(paymentValues, issues);
  const paymentFees = normalizeEtsyPaymentFees(paymentValues, issues);
  const refunds = normalizeEtsyRefunds(paymentValues, issues);
  validateRefundBounds(refunds, total, issues, "_clearledger_payments.adjustments");
  const subtotal = etsyMoney(value.subtotal ?? value.total_price, issues, "subtotal");
  const giftWrap = etsyMoney(value.gift_wrap_price, issues, "gift_wrap_price");
  let componentTotal = sumMoney([subtotal, shippingAmount, ...taxMoney, giftWrap], currency);
  if (componentTotal && discountAmount)
    componentTotal = subtractMoney(componentTotal, discountAmount);
  const difference = subtractMoney(total, componentTotal);
  if (difference && difference.units !== "0")
    issues.push({
      code: "ORDER_TOTAL_MISMATCH",
      message: "Etsy receipt components do not reconcile to the provider total.",
      severity: "BLOCKING",
      path: "grandtotal"
    });
  const createdAt =
    unixDate(value.create_timestamp, issues, "create_timestamp") ??
    optionalDate(value.created_timestamp, issues, "created_timestamp");
  const modifiedAt =
    unixDate(value.update_timestamp, issues, "update_timestamp") ??
    optionalDate(value.updated_timestamp, issues, "updated_timestamp") ??
    createdAt;
  const status = value.is_canceled
    ? "canceled"
    : value.is_paid
      ? "paid"
      : (optionalString(value.status) ?? "open");
  const normalized: NormalizedCommerceEvent = {
    schemaVersion: 1,
    provider: "ETSY",
    transactionKind: "ORDER",
    externalId: id,
    sourceCreatedAt: createdAt,
    sourceModifiedAt: modifiedAt,
    status,
    currencies: { source: currency, payment: currency, settlement: null },
    money: {
      total,
      subtotal,
      shipping: shippingAmount,
      tax: sumMoney(taxMoney, currency),
      discount: discountAmount,
      giftWrap,
      refunded: sumMoney(
        refunds.map((refund) => refund.amount),
        currency
      )
    },
    lines,
    taxes,
    shipping,
    discounts,
    fees: paymentFees,
    payments,
    refunds,
    settlement: null,
    mapping: {
      customerStrategy: customerStrategy(mapping),
      itemStatus: lines.every((line) => line.mappingStatus === "MAPPED")
        ? "MAPPED"
        : "REVIEW_REQUIRED",
      taxStatus: taxTreatment.taxStatus,
      taxRemittanceResponsibility: taxTreatment.responsibility,
      taxRemittanceByComponent: taxTreatment.byComponent
    },
    reconciliation: {
      providerTotal: total,
      componentTotal,
      difference,
      balanced: difference ? difference.units === "0" : null
    },
    issues,
    sourceMetadata: {
      wasPaid: Boolean(value.is_paid),
      wasShipped: Boolean(value.was_shipped),
      wasDelivered: Boolean(value.was_delivered),
      giftMessagePresent: Boolean(optionalString(value.gift_message)),
      taxEvidence: {
        kind: "MARKETPLACE_RECEIPT_AGGREGATE",
        jurisdictionBreakdownAvailable: false,
        remittanceInferred: false,
        requiresSellerRegistrationContext: true
      }
    }
  };
  return {
    shopExternalId,
    externalEventId: `poll:receipt:${id}:${modifiedAt ?? "unknown"}`,
    resourceType: "ORDER",
    resourceId: id,
    eventType: `order.${status}`,
    eventVersion: modifiedAt ?? "",
    occurredAt: modifiedAt,
    sourceCurrency: currency,
    paymentCurrency: currency,
    settlementCurrency: null,
    rawPayload: value,
    normalizedPayload: normalized,
    normalizationIssues: issues
  };
}

export function normalizeEtsyLedgerEntry(
  value: JsonRecord,
  shopExternalId: string
): CommerceConnectorEvent {
  const issues: CommerceNormalizationIssue[] = [];
  const id = identifier(value.ledger_entry_id ?? value.entry_id, "ledger-entry", issues);
  const amount = etsyMoney(value.amount, issues, "amount");
  const currency = amount?.currency ?? currencyFromEtsyRecord(value, issues);
  const createdAt = unixDate(
    value.create_date ?? value.created_timestamp,
    issues,
    value.create_date !== undefined ? "create_date" : "created_timestamp"
  );
  const entryType =
    optionalString(value.ledger_type ?? value.entry_type ?? value.type) ?? "adjustment";
  const normalized: NormalizedCommerceEvent = {
    schemaVersion: 1,
    provider: "ETSY",
    transactionKind: "SETTLEMENT",
    externalId: id,
    externalOrderId: optionalIdentifier(value.refunded_transaction_id ?? value.transaction_id),
    sourceCreatedAt: createdAt,
    sourceModifiedAt: createdAt,
    status: entryType,
    currencies: { source: currency, payment: currency, settlement: currency },
    money: {
      amount,
      gross: etsyMoney(value.gross_amount, issues, "gross_amount"),
      fee: etsyMoney(value.fee_amount ?? value.fees, issues, "fee_amount"),
      tax: etsyMoney(value.tax_amount ?? value.taxes, issues, "tax_amount")
    },
    lines: [],
    taxes: [],
    shipping: [],
    discounts: [],
    fees: [],
    payments: [],
    refunds: [],
    settlement: {
      type: entryType,
      referenceId: optionalIdentifier(value.reference_id),
      paymentId: optionalIdentifier(value.payment_id),
      payoutId: optionalIdentifier(value.payout_id)
    },
    mapping: {
      customerStrategy: "UNCONFIGURED",
      itemStatus: "MAPPED",
      taxStatus: "REVIEW_REQUIRED",
      taxRemittanceResponsibility: "NOT_APPLICABLE"
    },
    reconciliation: {
      providerTotal: amount,
      componentTotal: null,
      difference: null,
      balanced: null
    },
    issues,
    sourceMetadata: { entryType }
  };
  return {
    shopExternalId,
    externalEventId: `poll:ledger:${id}:${createdAt ?? "unknown"}`,
    resourceType: "SETTLEMENT",
    resourceId: id,
    eventType: `settlement.${entryType}`,
    eventVersion: createdAt ?? "",
    occurredAt: createdAt,
    sourceCurrency: currency,
    paymentCurrency: currency,
    settlementCurrency: currency,
    rawPayload: value,
    normalizedPayload: normalized,
    normalizationIssues: issues
  };
}

export function decimalMoney(
  value: unknown,
  currency: string | null,
  exponent: number | null,
  issues: CommerceNormalizationIssue[],
  path: string
): ExactMoney | null {
  if (value === null || value === undefined || value === "") return null;
  if (!currency || exponent === null) return null;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    issues.push({
      code: "MONEY_INVALID",
      message: "Money value has an invalid shape.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  const decimal = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) {
    issues.push({
      code: "MONEY_INVALID",
      message: "Money value is not an exact decimal.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  const fraction = match[3] ?? "";
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) {
    issues.push({
      code: "MONEY_PRECISION_INVALID",
      message: "Money value exceeds the currency precision.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  const digits = `${match[2] ?? ""}${fraction.slice(0, exponent).padEnd(exponent, "0")}`.replace(
    /^0+(?=\d)/,
    ""
  );
  const units = `${match[1] === "-" ? "-" : ""}${digits || "0"}`;
  return exactMoney(currency, BigInt(units), 10n ** BigInt(exponent), value);
}

export function etsyMoney(
  value: unknown,
  issues: CommerceNormalizationIssue[],
  path: string
): ExactMoney | null {
  if (value === null || value === undefined) return null;
  const money = record(value);
  if (!money) {
    issues.push({
      code: "MONEY_INVALID",
      message: "Etsy Money has an invalid shape.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  const amount = integerString(money.amount);
  const divisor = positiveIntegerString(money.divisor);
  const currency = currencyCode(
    money.currency_code ?? money.currency,
    issues,
    `${path}.currency_code`
  );
  if (!amount || !divisor || !currency) {
    issues.push({
      code: "MONEY_INVALID",
      message: "Etsy Money requires exact amount, divisor, and currency.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  const divisorValue = BigInt(divisor);
  if (!isPowerOfTen(divisorValue)) {
    issues.push({
      code: "MONEY_DIVISOR_INVALID",
      message: "Etsy Money divisor is unsupported.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  return exactMoney(currency, BigInt(amount), divisorValue, value);
}

function exactMoney(
  currency: string,
  units: bigint,
  divisor: bigint,
  providerRepresentation: unknown
): ExactMoney {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const exponent = divisor.toString().length - 1;
  const padded = absolute.toString().padStart(exponent + 1, "0");
  const decimal =
    exponent === 0 ? padded : `${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
  return {
    currency,
    units: units.toString(),
    divisor: divisor.toString(),
    decimal: `${negative ? "-" : ""}${decimal}`,
    providerRepresentation
  };
}

function normalizeWooRefunds(
  values: JsonRecord[],
  currency: string | null,
  exponent: number | null,
  issues: CommerceNormalizationIssue[]
): NormalizedCommerceRefund[] {
  return values.map((entry, index) => ({
    externalId: identifier(entry.id, `refund-${String(index + 1)}`, issues),
    status: optionalString(entry.status) ?? "recorded",
    amount: decimalMoney(
      entry.amount ?? entry.total,
      currency,
      exponent,
      issues,
      `refunds.${String(index)}.amount`
    ),
    occurredAt: optionalDate(
      entry.date_created_gmt ?? entry.date_created,
      issues,
      `refunds.${String(index)}.${entry.date_created_gmt !== undefined ? "date_created_gmt" : "date_created"}`
    ),
    reason: optionalString(entry.reason)
  }));
}

function normalizeEtsyPayments(
  values: JsonRecord[],
  issues: CommerceNormalizationIssue[]
): NormalizedCommercePayment[] {
  return values.map((entry, index) => ({
    externalId: identifier(entry.payment_id, `payment-${String(index + 1)}`, issues),
    status: optionalString(entry.status) ?? "recorded",
    method: optionalString(entry.payment_method),
    amount: etsyMoney(
      entry.amount_gross ?? entry.amount,
      issues,
      `payments.${String(index)}.amount_gross`
    ),
    occurredAt: unixDate(
      entry.create_timestamp ?? entry.created_timestamp,
      issues,
      `payments.${String(index)}.${entry.create_timestamp !== undefined ? "create_timestamp" : "created_timestamp"}`
    )
  }));
}

function normalizeEtsyPaymentFees(
  values: JsonRecord[],
  issues: CommerceNormalizationIssue[]
): NormalizedCommerceComponent[] {
  return values.flatMap((entry, index) => {
    const amount = etsyMoney(entry.amount_fees, issues, `payments.${String(index)}.amount_fees`);
    if (!amount || amount.units === "0") return [];
    const paymentId = optionalIdentifier(entry.payment_id);
    return [
      {
        externalId: paymentId ? `payment-${paymentId}-fees` : `payment-${String(index + 1)}-fees`,
        name: "Etsy payment fees",
        amount,
        tax: null,
        metadata: {
          providerField: "amount_fees",
          paymentId,
          includedInCustomerOrderTotal: false
        }
      }
    ];
  });
}

function normalizeEtsyRefunds(
  payments: JsonRecord[],
  issues: CommerceNormalizationIssue[]
): NormalizedCommerceRefund[] {
  return payments.flatMap((payment, paymentIndex) =>
    records(payment.adjustments, issues, `payments.${String(paymentIndex)}.adjustments`).map(
      (entry, index) => ({
        externalId: identifier(
          entry.payment_adjustment_id ?? entry.adjustment_id,
          `adjustment-${String(paymentIndex + 1)}-${String(index + 1)}`,
          issues
        ),
        status: optionalString(entry.status) ?? "recorded",
        amount: etsyMoney(
          entry.total_adjustment_amount ?? entry.amount,
          issues,
          `payments.${String(paymentIndex)}.adjustments.${String(index)}.amount`
        ),
        occurredAt: unixDate(
          entry.create_timestamp ?? entry.created_timestamp,
          issues,
          `payments.${String(paymentIndex)}.adjustments.${String(index)}.${entry.create_timestamp !== undefined ? "create_timestamp" : "created_timestamp"}`
        ),
        reason: optionalString(entry.reason_code ?? entry.reason)
      })
    )
  );
}

function validateRefundBounds(
  refunds: readonly NormalizedCommerceRefund[],
  orderTotal: ExactMoney | null,
  issues: CommerceNormalizationIssue[],
  path: string
): void {
  if (!orderTotal) return;
  const comparable = refunds
    .map((refund) => refund.amount)
    .filter((amount): amount is ExactMoney => Boolean(amount))
    .filter(
      (amount) => amount.currency === orderTotal.currency && amount.divisor === orderTotal.divisor
    );
  if (comparable.length !== refunds.filter((refund) => Boolean(refund.amount)).length) {
    issues.push({
      code: "REFUND_RECONCILIATION_REQUIRED",
      message: "Refund currency or precision does not match the original order.",
      severity: "BLOCKING",
      path
    });
    return;
  }
  const refunded = comparable.reduce((sum, amount) => {
    const units = BigInt(amount.units);
    return sum + (units < 0n ? -units : units);
  }, 0n);
  const totalUnits = BigInt(orderTotal.units);
  const orderMagnitude = totalUnits < 0n ? -totalUnits : totalUnits;
  if (refunded > orderMagnitude)
    issues.push({
      code: "REFUND_RECONCILIATION_REQUIRED",
      message: "Refunds exceed the magnitude of the original order total.",
      severity: "BLOCKING",
      path
    });
}

function componentFromDecimal(
  value: JsonRecord,
  index: number,
  currency: string | null,
  exponent: number | null,
  issues: CommerceNormalizationIssue[],
  path: string,
  amountKey: string,
  taxKey: string | undefined
): NormalizedCommerceComponent {
  return {
    externalId: identifier(
      value.id ?? value.rate_id ?? value.code,
      `${path}-${String(index + 1)}`,
      issues
    ),
    name: optionalString(value.name ?? value.label ?? value.method_title ?? value.code) ?? path,
    amount: decimalMoney(
      value[amountKey],
      currency,
      exponent,
      issues,
      `${path}.${String(index)}.${amountKey}`
    ),
    tax: taxKey
      ? decimalMoney(
          value[taxKey],
          currency,
          exponent,
          issues,
          `${path}.${String(index)}.${taxKey}`
        )
      : null,
    metadata: { compound: typeof value.compound === "boolean" ? value.compound : null }
  };
}

function sumMoney(
  values: readonly (ExactMoney | null | undefined)[],
  currency: string | null
): ExactMoney | null {
  const present = values.filter((value): value is ExactMoney => Boolean(value));
  if (!currency || present.length === 0 || present.some((value) => value.currency !== currency))
    return null;
  const divisor = present[0]!.divisor;
  if (present.some((value) => value.divisor !== divisor)) return null;
  const units = present.reduce((sum, value) => sum + BigInt(value.units), 0n);
  return exactMoney(currency, units, BigInt(divisor), { derived: "sum" });
}

function subtractMoney(left: ExactMoney | null, right: ExactMoney | null): ExactMoney | null {
  if (!left || !right || left.currency !== right.currency || left.divisor !== right.divisor)
    return null;
  return exactMoney(left.currency, BigInt(left.units) - BigInt(right.units), BigInt(left.divisor), {
    derived: "difference"
  });
}

function multiplyMoney(
  value: ExactMoney | null,
  quantity: string,
  issues: CommerceNormalizationIssue[],
  path: string
): ExactMoney | null {
  if (!value) return null;
  if (!/^-?\d+$/.test(quantity)) {
    issues.push({
      code: "QUANTITY_PRECISION_UNSUPPORTED",
      message: "This provider quantity cannot be multiplied exactly.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  return exactMoney(value.currency, BigInt(value.units) * BigInt(quantity), BigInt(value.divisor), {
    derived: "quantity",
    quantity
  });
}

function moneyExponent(
  currency: string | null,
  explicit: number | null,
  issues: CommerceNormalizationIssue[],
  path: string
): number | null {
  if (explicit !== null) return explicit;
  if (currency && currency in currencyExponents) return currencyExponents[currency]!;
  issues.push({
    code: "CURRENCY_PRECISION_UNKNOWN",
    message: "Currency precision is unknown; no amount was guessed.",
    severity: "BLOCKING",
    path
  });
  return null;
}

function currencyFromEtsyRecord(
  value: JsonRecord,
  issues: CommerceNormalizationIssue[]
): string | null {
  return currencyCode(value.currency_code ?? value.currency, issues, "currency_code");
}

function currencyCode(
  value: unknown,
  issues: CommerceNormalizationIssue[],
  path: string
): string | null {
  const currency = optionalString(value)?.toUpperCase() ?? null;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    issues.push({
      code: "CURRENCY_INVALID",
      message: "Provider currency is missing or invalid.",
      severity: "BLOCKING",
      path
    });
    return null;
  }
  if (!["CAD", "USD"].includes(currency)) {
    issues.push({
      code: "CURRENCY_NOT_RELEASED",
      message: `${currency} is staged for review and cannot post in the current CAD/USD release.`,
      severity: "BLOCKING",
      path
    });
  }
  return currency;
}

function customerStrategy(
  mapping: Readonly<Record<string, unknown>>
): "POOLED" | "INDIVIDUAL" | "UNCONFIGURED" {
  return mapping.customerStrategy === "POOLED"
    ? "POOLED"
    : mapping.customerStrategy === "INDIVIDUAL"
      ? "INDIVIDUAL"
      : "UNCONFIGURED";
}

type CommerceTaxRemittanceResponsibility = "SELLER" | "MARKETPLACE" | "REVIEW_REQUIRED";

function commerceTaxMappingState(
  mapping: Readonly<Record<string, unknown>>,
  taxes: readonly NormalizedCommerceComponent[],
  providerLabel: string,
  path: string,
  issues: CommerceNormalizationIssue[]
): {
  readonly taxStatus: "MAPPED" | "REVIEW_REQUIRED";
  readonly responsibility: CommerceTaxRemittanceResponsibility | "MIXED" | "NOT_APPLICABLE";
  readonly byComponent: Readonly<Record<string, CommerceTaxRemittanceResponsibility>>;
} {
  if (taxes.length === 0)
    return { taxStatus: "MAPPED", responsibility: "NOT_APPLICABLE", byComponent: {} };
  const taxMappings = record(mapping.taxMappings);
  let complete = Boolean(taxMappings);
  if (!taxMappings) {
    issues.push({
      code: "TAX_MAPPING_REQUIRED",
      message: `Map each ${providerLabel} tax rate to a reviewed PennyWise Accounting tax code.`,
      severity: "BLOCKING",
      path
    });
  } else {
    const unmapped = taxes.filter((tax) => !hasTaxMapping(taxMappings, tax));
    if (unmapped.length) {
      complete = false;
      issues.push({
        code: "TAX_RATE_MAPPING_REQUIRED",
        message: `Map every ${providerLabel} tax rate before review can be completed.`,
        severity: "BLOCKING",
        path,
        externalRef: unmapped.map((tax) => tax.externalId).join(",")
      });
    }
  }
  const defaultResponsibility = taxRemittanceResponsibility(mapping);
  const remittanceMappings = record(mapping.taxRemittanceMappings);
  const byComponent = Object.fromEntries(
    taxes.map((tax) => [
      tax.externalId,
      taxRemittanceMapping(remittanceMappings, tax) ?? defaultResponsibility
    ])
  ) as Record<string, CommerceTaxRemittanceResponsibility>;
  const unresolved = Object.entries(byComponent)
    .filter(([, responsibility]) => responsibility === "REVIEW_REQUIRED")
    .map(([externalId]) => externalId);
  if (unresolved.length)
    issues.push({
      code: "TAX_REMITTANCE_CONFIRMATION_REQUIRED",
      message:
        "Confirm whether the seller or marketplace remits every applicable tax component. PennyWise Accounting never assumes Etsy, WooCommerce, or a payment provider remits it.",
      severity: "BLOCKING",
      path,
      externalRef: unresolved.join(",")
    });
  const confirmedResponsibilities = new Set(Object.values(byComponent));
  const responsibility = unresolved.length
    ? "REVIEW_REQUIRED"
    : confirmedResponsibilities.size === 1
      ? ([...confirmedResponsibilities][0] ?? "REVIEW_REQUIRED")
      : "MIXED";
  return {
    taxStatus: complete && unresolved.length === 0 ? "MAPPED" : "REVIEW_REQUIRED",
    responsibility,
    byComponent
  };
}

function taxRemittanceMapping(
  mappings: JsonRecord | null,
  tax: NormalizedCommerceComponent
): CommerceTaxRemittanceResponsibility | null {
  if (!mappings) return null;
  for (const key of [tax.externalId, tax.name]) {
    const value = mappings[key];
    if (value === "SELLER" || value === "MARKETPLACE" || value === "REVIEW_REQUIRED") return value;
  }
  return null;
}

function hasTaxMapping(taxMappings: JsonRecord, tax: NormalizedCommerceComponent): boolean {
  return [tax.externalId, tax.name].some((key) => {
    const target = taxMappings[key];
    return typeof target === "string" && target.trim().length > 0;
  });
}

function taxRemittanceResponsibility(
  mapping: Readonly<Record<string, unknown>>
): CommerceTaxRemittanceResponsibility {
  return mapping.taxRemittanceResponsibility === "SELLER" ||
    mapping.taxRemittanceResponsibility === "MARKETPLACE"
    ? mapping.taxRemittanceResponsibility
    : "REVIEW_REQUIRED";
}

function identifier(
  value: unknown,
  fallback: string,
  issues: CommerceNormalizationIssue[]
): string {
  const result = optionalIdentifier(value);
  if (result) return result;
  issues.push({
    code: "EXTERNAL_ID_MISSING",
    message: "Provider resource ID is missing.",
    severity: "BLOCKING"
  });
  return fallback;
}

function optionalIdentifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function wooVariationIdentifier(value: unknown): string | null {
  const identifier = optionalIdentifier(value);
  return identifier && !/^0+$/.test(identifier) ? identifier : null;
}

function exactQuantity(value: unknown, issues: CommerceNormalizationIssue[], path: string): string {
  const quantity =
    typeof value === "number" || typeof value === "bigint" || typeof value === "string"
      ? String(value).trim()
      : "";
  if (/^-?\d+(?:\.\d+)?$/.test(quantity)) return quantity;
  issues.push({
    code: "QUANTITY_INVALID",
    message: "Provider quantity is invalid.",
    severity: "BLOCKING",
    path
  });
  return "0";
}

type ConnectorItemMappingState = "MAPPED" | "UNMAPPED" | "CONFLICT" | "SKU_ONLY" | "PARENT_ONLY";

function connectorItemMappingState(
  mapping: Readonly<Record<string, unknown>>,
  references: {
    readonly sku: string | null;
    readonly productExternalId: string | null;
    readonly variationExternalId: string | null;
  }
): ConnectorItemMappingState {
  const lookups = [
    ...(references.variationExternalId
      ? [
          {
            kind: "variation" as const,
            reference: references.variationExternalId,
            manualKey: "variantMappings",
            confirmedKey: "catalogVariantMappings"
          }
        ]
      : []),
    ...(references.productExternalId
      ? [
          {
            // A single-variant product has its catalog variant keyed to the
            // product ID. For a real variation this remains parent evidence
            // only, never a substitute for a variation-ID confirmation.
            kind: "product" as const,
            reference: references.productExternalId,
            manualKey: "variantMappings",
            confirmedKey: "catalogVariantMappings"
          },
          {
            kind: "product" as const,
            reference: references.productExternalId,
            manualKey: "productMappings",
            confirmedKey: "catalogProductMappings"
          }
        ]
      : []),
    ...(references.sku
      ? [
          {
            kind: "sku" as const,
            reference: references.sku,
            manualKey: "skuMappings",
            confirmedKey: "catalogSkuMappings"
          }
        ]
      : [])
  ] as const;
  const targets = {
    variation: new Set<string>(),
    product: new Set<string>(),
    sku: new Set<string>()
  };
  for (const lookup of lookups) {
    const manualValue = mapping[lookup.manualKey];
    const confirmedValue = mapping[lookup.confirmedKey];
    const manual = manualValue === undefined ? {} : record(manualValue);
    const confirmed = confirmedValue === undefined ? {} : record(confirmedValue);
    if (!manual || !confirmed) return "CONFLICT";
    const manualTarget = manual[lookup.reference];
    const confirmedTarget = confirmed[lookup.reference];
    if (manualTarget !== undefined && (typeof manualTarget !== "string" || !manualTarget.trim()))
      return "CONFLICT";
    if (
      confirmedTarget !== undefined &&
      (typeof confirmedTarget !== "string" || !confirmedTarget.trim())
    )
      return "CONFLICT";
    if (
      typeof manualTarget === "string" &&
      typeof confirmedTarget === "string" &&
      manualTarget !== confirmedTarget
    )
      return "CONFLICT";
    const target = typeof manualTarget === "string" ? manualTarget : confirmedTarget;
    if (typeof target === "string") targets[lookup.kind].add(target);
  }
  if (targets.variation.size > 1 || targets.product.size > 1 || targets.sku.size > 1)
    return "CONFLICT";
  const variationTarget = firstMappingTarget(targets.variation);
  const productTarget = firstMappingTarget(targets.product);
  const skuTarget = firstMappingTarget(targets.sku);

  // Woo variable products must be mapped to the variation. A parent map can
  // describe the family, but it cannot prove that a particular size/colour
  // resolves to the right local item. A SKU-only map is equally insufficient
  // while Woo supplied a stable provider identity.
  if (references.variationExternalId) {
    if (!variationTarget)
      return productTarget ? "PARENT_ONLY" : skuTarget ? "SKU_ONLY" : "UNMAPPED";
    if (
      (productTarget && productTarget !== variationTarget) ||
      (skuTarget && skuTarget !== variationTarget)
    )
      return "CONFLICT";
    return "MAPPED";
  }

  const identityTargets = new Set(
    [variationTarget, productTarget].filter((target): target is string => Boolean(target))
  );
  if (identityTargets.size > 1) return "CONFLICT";
  const identityTarget = firstMappingTarget(identityTargets);
  if (identityTarget) return skuTarget && skuTarget !== identityTarget ? "CONFLICT" : "MAPPED";

  // Retain a bounded fallback for malformed/legacy provider payloads that
  // genuinely contain no product or variation identifier. It still requires
  // an explicit mapping; fuzzy candidate scores never participate here.
  return skuTarget ? "MAPPED" : "UNMAPPED";
}

function firstMappingTarget(targets: ReadonlySet<string>): string | null {
  return targets.size === 1 ? (targets.values().next().value ?? null) : null;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function records(
  value: unknown,
  issues?: CommerceNormalizationIssue[],
  path?: string
): JsonRecord[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    if (issues && path)
      issues.push({
        code: "FIELD_SHAPE_INVALID",
        message: "Provider field must be an array.",
        severity: "BLOCKING",
        path
      });
    return [];
  }
  const result: JsonRecord[] = [];
  value.forEach((entry, index) => {
    const item = record(entry);
    if (item) result.push(item);
    else if (issues && path)
      issues.push({
        code: "FIELD_SHAPE_INVALID",
        message: "Provider array item must be an object.",
        severity: "BLOCKING",
        path: `${path}.${String(index)}`
      });
  });
  return result;
}

function strings(value: unknown, issues?: CommerceNormalizationIssue[], path?: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    if (issues && path)
      issues.push({
        code: "FIELD_SHAPE_INVALID",
        message: "Provider field must be an array of strings.",
        severity: "BLOCKING",
        path
      });
    return [];
  }
  const result: string[] = [];
  value.forEach((entry, index) => {
    const item = optionalString(entry);
    if (item) result.push(item);
    else if (issues && path)
      issues.push({
        code: "FIELD_SHAPE_INVALID",
        message: "Provider array item must be a non-empty string.",
        severity: "BLOCKING",
        path: `${path}.${String(index)}`
      });
  });
  return result;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalDate(
  value: unknown,
  issues?: CommerceNormalizationIssue[],
  path?: string
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = optionalString(value);
  if (!raw) {
    if (issues && path)
      issues.push({
        code: "DATE_INVALID",
        message: "Provider date has an invalid shape.",
        severity: "BLOCKING",
        path
      });
    return null;
  }
  const parsed = new Date(raw.endsWith("Z") || /[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (Number.isNaN(parsed.getTime())) {
    if (issues && path)
      issues.push({
        code: "DATE_INVALID",
        message: "Provider date cannot be parsed safely.",
        severity: "BLOCKING",
        path
      });
    return null;
  }
  return parsed.toISOString();
}

function unixDate(
  value: unknown,
  issues?: CommerceNormalizationIssue[],
  path?: string
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    if (issues && path)
      issues.push({
        code: "DATE_INVALID",
        message: "Provider timestamp is invalid.",
        severity: "BLOCKING",
        path
      });
    return null;
  }
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(milliseconds);
  if (Number.isNaN(parsed.getTime())) {
    if (issues && path)
      issues.push({
        code: "DATE_INVALID",
        message: "Provider timestamp is outside the supported range.",
        severity: "BLOCKING",
        path
      });
    return null;
  }
  return parsed.toISOString();
}

function integerInRange(value: unknown, minimum: number, maximum: number): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(numeric) && numeric >= minimum && numeric <= maximum ? numeric : null;
}

function integerString(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return value.trim();
  return null;
}

function positiveIntegerString(value: unknown): string | null {
  const result = integerString(value);
  return result && BigInt(result) > 0n ? result : null;
}

function isPowerOfTen(value: bigint): boolean {
  if (value < 1n) return false;
  let current = value;
  while (current > 1n && current % 10n === 0n) current /= 10n;
  return current === 1n;
}

function redactPrivateValue(value: unknown, key = ""): unknown {
  const normalizedKey = key.trim().toLowerCase();
  if (isPrivateCommerceKey(normalizedKey)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactPrivateValue(entry));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([entryKey, entry]) => [
        entryKey,
        redactPrivateValue(entry, entryKey)
      ])
    );
  if (
    typeof value === "string" &&
    (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(value) || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.trim()))
  )
    return "[REDACTED]";
  return value;
}

function isPrivateCommerceKey(key: string): boolean {
  if (!key) return false;
  return (
    /^(billing|shipping|meta_data|metadata|customer_ip_address|ip_address|ip|customer_user_agent|user_agent|customer_note|order_note|gift_message|note_from_buyer|note_from_seller|message_from_buyer|message_from_seller|name|first_line|second_line)$/i.test(
      key
    ) ||
    /(?:^|_)(?:email|phone|fax|first_name|last_name|full_name|display_name|company|address|address_1|address_2|city|postcode|postal_code|zip)(?:_|$)/i.test(
      key
    ) ||
    /^(?:buyer|customer)_(?:id|user_id|name)$/i.test(key) ||
    /(?:^|_)(?:token|secret|password|authorization|api_key|consumer_key|consumer_secret|order_key|tracking_code|tracking_url)(?:_|$)/i.test(
      key
    )
  );
}
