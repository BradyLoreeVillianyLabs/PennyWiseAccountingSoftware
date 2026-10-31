/**
 * Boundary for future payment/device adapters. The first POS release is
 * intentionally online and server-authoritative; it accepts only cash and
 * manually recorded tender through PaymentService. No provider may bypass
 * invoice posting, the central tax engine, or the audit trail.
 */
export interface PosTenderAdapter {
  readonly kind: string;
  authorize(input: {
    readonly organizationId: string;
    readonly saleId: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly providerReference: string }>;
}

/**
 * Provider-neutral intake boundary. Adapters must normalize external orders
 * into this shape and then call the same PosService orchestration; no adapter
 * is allowed to post journals or mutate inventory directly.
 */
export interface PosOrderAdapter {
  readonly provider: string;
  normalize(input: unknown): Promise<PosExternalOrder>;
}

export interface PosExternalOrder {
  readonly providerOrderId: string;
  readonly providerLocationId: string;
  readonly providerVersion?: string | null;
  readonly occurredAt: string;
  readonly businessDate: string;
  readonly currency: string;
  readonly lines: readonly {
    readonly providerLineId: string;
    readonly providerProductId?: string | null;
    readonly sku?: string | null;
    readonly barcode?: string | null;
    readonly description: string;
    readonly quantity: string;
    readonly unitPriceMinor: string;
    readonly discountMinor: string;
    readonly taxTotalMinor: string;
  }[];
  readonly tenders: readonly {
    readonly providerPaymentId: string;
    readonly type: string;
    readonly amountMinor: string;
    readonly feeMinor?: string | null;
  }[];
  readonly sourcePayloadReference?: string | null;
}
