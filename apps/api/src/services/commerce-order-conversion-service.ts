import { randomUUID } from "node:crypto";
import {
  multiplyMinorByQuantity,
  parseMinorUnit,
  parseQuantityMicros,
  roundRatioHalfUp,
  sumMinorUnits
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import {
  assertCustomerAddress,
  normalizeCustomerAddress,
  type CustomerAddressInput
} from "./customer-address.js";
import { assertDocumentCurrency } from "./currency-workflow-policy.js";
import type {
  NormalizedCommerceEvent,
  NormalizedCommerceLine
} from "./connectors/commerce-connector-types.js";
import {
  calculateLine,
  type CalculatedLine,
  type LineCalculationInput
} from "./invoice-calculation.js";
import { InvoiceService } from "./invoice-service.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate } from "../utils/dates.js";
import { derivePaymentReference } from "./payment-reference-code.js";

type Tx = Prisma.TransactionClient;
export interface CommerceOrderConversionSelection {
  readonly customerId?: string | undefined;
  readonly customer?: CommerceOrderCustomerInput | undefined;
  readonly fxRateSnapshotId?: string | undefined;
}

export interface CommerceOrderCustomerInput {
  readonly customerNumber: string;
  readonly displayName: string;
  readonly legalName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly telephone?: string | null | undefined;
  readonly defaultPaymentTermsDays?: number | undefined;
  readonly defaultCurrency?: string | undefined;
  readonly addresses: readonly CustomerAddressInput[];
}

export type CommerceOrderConversionInput =
  | {
      readonly decision: "CONFIRM";
      readonly version: number;
      readonly customerId?: string | undefined;
      readonly customer?: CommerceOrderCustomerInput | undefined;
      readonly fxRateSnapshotId?: string | undefined;
    }
  | {
      readonly decision: "REJECT";
      readonly version: number;
      readonly reason: string;
    };

export interface CommerceOrderBatchConversionInput {
  readonly items: readonly ({ eventId: string } & CommerceOrderConversionInput)[];
}

interface Gap {
  readonly code: string;
  readonly message: string;
  readonly path?: string | undefined;
}

interface ResolvedCustomer {
  readonly existingId: string | null;
  readonly input: CommerceOrderCustomerInput | null;
  readonly displayName: string | null;
  readonly paymentTermsDays: number;
}

interface PreparedDraft {
  readonly issueDate: Date;
  readonly currency: string;
  readonly fxRateSnapshotId: string | null;
  readonly dueDate: Date;
  readonly customer: ResolvedCustomer;
  readonly lineInputs: readonly LineCalculationInput[];
  readonly lines: readonly CalculatedLine[];
  readonly totals: {
    readonly subtotalMinor: bigint;
    readonly discountTotalMinor: bigint;
    readonly taxTotalMinor: bigint;
    readonly grandTotalMinor: bigint;
  };
  readonly providerTotals: Prisma.InputJsonObject;
}

interface PreflightResult {
  readonly eventId: string;
  readonly status: string;
  readonly conversionStatus: string;
  readonly ready: boolean;
  readonly gaps: readonly Gap[];
  readonly customerStrategy: string;
  readonly providerTotals: Prisma.InputJsonObject | null;
  readonly draft: ReturnType<typeof draftDto> | null;
  readonly prepared: PreparedDraft | null;
}

export class CommerceOrderConversionService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly invoices: InvoiceService
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async preflight(
    context: OrganizationContext,
    eventId: string,
    input: CommerceOrderConversionSelection = {}
  ) {
    await this.authorization.assert(context, "commerce:review", "CommerceInboxEvent", eventId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const event = await tx.commerceInboxEvent.findFirst({
        where: { id: eventId, organizationId: context.organizationId },
        include: { installation: { select: { mapping: true } } }
      });
      if (!event) throw new AppError("COMMERCE_EVENT_NOT_FOUND", "Inbox event was not found.", 404);
      return publicPreflight(await this.buildPreflight(tx, context, event, input));
    });
  }

  public async convert(
    context: OrganizationContext,
    eventId: string,
    input: CommerceOrderConversionInput
  ) {
    await this.authorization.assert(context, "commerce:review", "CommerceInboxEvent", eventId);
    const result = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.convertInTransaction(tx, context, eventId, input)
    );
    if (!result.invoiceId) return result.response;
    return {
      statusCode: result.response.statusCode,
      body: {
        ...result.response.body,
        conversion: {
          ...result.response.body.conversion,
          invoice: await this.invoices.get(context, result.invoiceId)
        }
      }
    };
  }

  public async convertBatch(
    context: OrganizationContext,
    input: CommerceOrderBatchConversionInput
  ) {
    await this.authorization.assert(context, "commerce:review", "CommerceInboxEvent");
    const results = [];
    for (const item of input.items) {
      const { eventId, ...decision } = item;
      try {
        results.push({ eventId, ...(await this.convert(context, eventId, decision)).body });
      } catch (error) {
        if (error instanceof AppError)
          results.push({
            eventId,
            conversion: {
              eventId,
              ready: false,
              conversionStatus: "ACTION_REQUIRED",
              gaps: [{ code: error.code, message: error.message }]
            }
          });
        else throw error;
      }
    }
    return { results };
  }

  private async convertInTransaction(
    tx: Tx,
    context: OrganizationContext,
    eventId: string,
    input: CommerceOrderConversionInput
  ) {
    await tx.$queryRaw`
      SELECT "id" FROM "CommerceInboxEvent"
       WHERE "id" = ${eventId}::uuid
         AND "organizationId" = ${context.organizationId}::uuid
       FOR UPDATE
    `;
    const event = await tx.commerceInboxEvent.findFirst({
      where: { id: eventId, organizationId: context.organizationId },
      include: { installation: { select: { mapping: true } } }
    });
    if (!event) throw new AppError("COMMERCE_EVENT_NOT_FOUND", "Inbox event was not found.", 404);

    // The event lock makes this branch the retry result for a concurrent double click.
    if (event.resultingInvoiceId) {
      return {
        invoiceId: event.resultingInvoiceId,
        response: {
          statusCode: 200,
          body: {
            conversion: {
              eventId,
              ready: true,
              conversionStatus: event.conversionStatus,
              resultingInvoiceId: event.resultingInvoiceId,
              replayed: true
            }
          }
        }
      };
    }

    if (input.decision === "REJECT") {
      const reason = input.reason.trim();
      if (!reason)
        throw new AppError(
          "COMMERCE_REJECTION_REASON_REQUIRED",
          "A rejection reason is required.",
          422
        );
      if (event.version !== input.version)
        throw new AppError(
          "STALE_COMMERCE_EVENT",
          "The inbox event changed or has an invalid version.",
          409
        );
      const updated = await tx.commerceInboxEvent.updateMany({
        where: { id: eventId, organizationId: context.organizationId, version: input.version },
        data: {
          conversionStatus: "REJECTED",
          conversionReviewNote: reason,
          conversionMissing: Prisma.JsonNull,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1)
        throw new AppError(
          "STALE_COMMERCE_EVENT",
          "The inbox event changed or has an invalid version.",
          409
        );
      await audit(tx, context, "COMMERCE_ORDER_CONVERSION_REJECTED", eventId, { reason });
      return {
        invoiceId: null,
        response: {
          statusCode: 200,
          body: {
            conversion: {
              eventId,
              ready: false,
              conversionStatus: "REJECTED",
              reason
            }
          }
        }
      };
    }

    if (event.version !== input.version)
      throw new AppError(
        "STALE_COMMERCE_EVENT",
        "The inbox event changed or has an invalid version.",
        409
      );
    const preflight = await this.buildPreflight(tx, context, event, input);
    if (!preflight.ready || !preflight.prepared) {
      await tx.commerceInboxEvent.update({
        where: { id: eventId },
        data: {
          conversionStatus: "ACTION_REQUIRED",
          conversionMissing: preflight.gaps as unknown as Prisma.InputJsonArray,
          conversionReviewNote:
            "Conversion was refused until every reviewed prerequisite is resolved.",
          version: { increment: 1 }
        }
      });
      await audit(tx, context, "COMMERCE_ORDER_CONVERSION_REFUSED", eventId, {
        gaps: preflight.gaps as unknown as Prisma.InputJsonArray
      });
      return {
        invoiceId: null,
        response: {
          statusCode: 422,
          body: { conversion: publicPreflight(preflight) }
        }
      };
    }

    const customer = await this.persistCustomer(tx, context, preflight.prepared.customer);
    const organizationSnapshot = await organizationSnapshotFor(tx, context.organizationId);
    const provisionalIdentifier = `DRAFT-${cryptoRandomId()}`;
    const invoice = await tx.invoice.create({
      data: {
        organizationId: context.organizationId,
        customerId: customer.id,
        provisionalIdentifier,
        paymentReference: derivePaymentReference(
          `${context.organizationId}:${provisionalIdentifier}`
        ),
        issueDate: preflight.prepared.issueDate,
        dueDate: preflight.prepared.dueDate,
        paymentTermsDays: customer.defaultPaymentTermsDays,
        currency: preflight.prepared.currency,
        fxRateSnapshotId: preflight.prepared.fxRateSnapshotId,
        subtotalMinor: preflight.prepared.totals.subtotalMinor,
        discountTotalMinor: preflight.prepared.totals.discountTotalMinor,
        taxTotalMinor: preflight.prepared.totals.taxTotalMinor,
        grandTotalMinor: preflight.prepared.totals.grandTotalMinor,
        customerNameSnapshot: customer.displayName,
        customerEmailSnapshot: customer.email,
        billingAddressSnapshot: addressSnapshotFor(customer.addresses, "BILLING"),
        serviceAddressSnapshot: addressSnapshotFor(customer.addresses, "SERVICE"),
        organizationSnapshot,
        internalNotes: `Commerce ${event.providerKey} order ${event.resourceId}; source event ${event.id}.`,
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id
      }
    });
    await tx.invoiceLine.createMany({
      data: preflight.prepared.lines.map((line, index) =>
        invoiceLineData(context.organizationId, invoice.id, index + 1, line)
      )
    });
    await tx.commerceInboxEvent.update({
      where: { id: eventId },
      data: {
        conversionStatus: "CONVERTED",
        conversionReviewNote:
          "Reviewed by an operator and assembled as a draft invoice. Posting remains a separate action.",
        conversionMissing: Prisma.JsonNull,
        providerTotalsSnapshot: preflight.prepared.providerTotals,
        resultingInvoiceId: invoice.id,
        version: { increment: 1 }
      }
    });
    await audit(tx, context, "COMMERCE_ORDER_CONVERTED_TO_INVOICE_DRAFT", eventId, {
      invoiceId: invoice.id,
      providerKey: event.providerKey,
      resourceId: event.resourceId,
      providerTotals: preflight.prepared.providerTotals
    });
    await audit(tx, context, "INVOICE_DRAFT_CREATED_FROM_COMMERCE_ORDER", invoice.id, {
      commerceInboxEventId: event.id,
      providerKey: event.providerKey,
      resourceId: event.resourceId,
      providerTotals: preflight.prepared.providerTotals
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: context.organizationId,
        eventType: "commerce.order.invoice_draft_created",
        aggregateType: "Invoice",
        aggregateId: invoice.id,
        payload: {
          commerceInboxEventId: event.id,
          invoiceId: invoice.id,
          providerKey: event.providerKey,
          resourceId: event.resourceId
        }
      }
    });
    return {
      invoiceId: invoice.id,
      response: {
        statusCode: 201,
        body: {
          conversion: {
            eventId,
            ready: true,
            conversionStatus: "CONVERTED",
            resultingInvoiceId: invoice.id,
            replayed: false
          }
        }
      }
    };
  }

  private async buildPreflight(
    tx: Tx,
    context: OrganizationContext,
    event: Prisma.CommerceInboxEventGetPayload<{
      include: { installation: { select: { mapping: true } } };
    }>,
    input: CommerceOrderConversionSelection
  ): Promise<PreflightResult> {
    const gaps: Gap[] = [];
    const normalized = asNormalized(event.normalizedPayload);
    const mapping = asRecord(event.installation.mapping);
    if (event.status !== "NORMALIZED")
      addGap(
        gaps,
        "ORDER_NOT_APPROVED",
        "Mark the inbox event NORMALIZED after reviewing its evidence."
      );
    if (
      event.resourceType.trim().toUpperCase() !== "ORDER" ||
      normalized?.transactionKind !== "ORDER"
    )
      addGap(gaps, "EVENT_NOT_AN_ORDER", "Only a normalized ORDER event can become an invoice.");
    if (!normalized)
      addGap(gaps, "NORMALIZED_PAYLOAD_REQUIRED", "A valid normalized order payload is required.");
    if (blockingIssues(event.normalizationIssues))
      addGap(
        gaps,
        "NORMALIZATION_BLOCKING",
        "Resolve every blocking normalization finding before conversion."
      );
    if (!mapping)
      addGap(
        gaps,
        "CONNECTOR_MAPPING_INVALID",
        "Repair the connector's reviewed mapping before conversion."
      );
    if (!normalized || !mapping) return failedPreflight(event, gaps, "UNCONFIGURED", null);

    const currency = normalized.currencies.source?.trim().toUpperCase() ?? null;
    if (!currency || !["CAD", "USD"].includes(currency))
      addGap(
        gaps,
        "CURRENCY_NOT_RELEASED",
        "The order must use a supported CAD or USD currency.",
        "currencies.source"
      );
    const providerTotal = moneyMinor(normalized.money.total, currency, gaps, "money.total");
    if (providerTotal === null)
      addGap(
        gaps,
        "PROVIDER_TOTAL_REQUIRED",
        "The provider order total is required.",
        "money.total"
      );

    const issueDate = event.occurredAt
      ? parseDate(event.occurredAt.toISOString().slice(0, 10), "issueDate")
      : parseDate(event.createdAt.toISOString().slice(0, 10), "issueDate");
    const period = await tx.fiscalPeriod.findFirst({
      where: {
        organizationId: context.organizationId,
        ...(context.companyId ? { companyId: context.companyId } : {}),
        startDate: { lte: issueDate },
        endDate: { gte: issueDate }
      },
      orderBy: { startDate: "desc" },
      select: { status: true }
    });
    if (!period)
      addGap(
        gaps,
        "FISCAL_PERIOD_NOT_FOUND",
        "Open a fiscal period containing the order date.",
        "issueDate"
      );
    else if (period.status !== "OPEN")
      addGap(gaps, "PERIOD_LOCKED", "The order date is in a closed fiscal period.", "issueDate");

    const customer = await this.resolveCustomer(tx, context, mapping, input, gaps);
    const taxCodeId = resolveTaxCodeId(normalized, mapping, gaps);
    const lineInputs: LineCalculationInput[] = [];
    const expectedLines: {
      input: LineCalculationInput;
      expectedNet: bigint;
      expectedTax: bigint;
      path: string;
    }[] = [];
    const normalizedLines: readonly NormalizedCommerceLine[] = normalized.lines;
    if (!normalizedLines.length)
      addGap(gaps, "ORDER_LINES_REQUIRED", "The order must contain at least one line.", "lines");
    for (const [index, line] of normalizedLines.entries()) {
      const path = `lines.${String(index)}`;
      const productItemId = resolveProductId(mapping, line, gaps, path);
      const quantity = safeQuantity(line.quantity, gaps, `${path}.quantity`);
      const gross = moneyMinor(line.subtotal ?? line.total, currency, gaps, `${path}.subtotal`);
      const net = moneyMinor(line.total, currency, gaps, `${path}.total`);
      const tax = moneyMinor(line.tax, currency, gaps, `${path}.tax`, true) ?? 0n;
      if (gross !== null && net !== null) {
        if (gross < net)
          addGap(
            gaps,
            "LINE_DISCOUNT_INVALID",
            "A line total cannot exceed its provider subtotal.",
            path
          );
        const discount = gross >= net ? gross - net : 0n;
        if (quantity) {
          const unitPrice = roundRatioHalfUp(gross * 1_000_000n, quantity);
          if (multiplyMinorByQuantity(unitPrice, quantity) !== gross)
            addGap(
              gaps,
              "LINE_PRICE_NOT_EXACT",
              "The provider line price cannot be represented exactly at this quantity.",
              path
            );
          const input: LineCalculationInput = {
            productItemId,
            description: line.name,
            quantity: line.quantity,
            unitPriceMinor: unitPrice.toString(),
            discountMinor: discount.toString(),
            taxCodeId: tax > 0n ? taxCodeId : null
          };
          lineInputs.push(input);
          expectedLines.push({ input, expectedNet: net, expectedTax: tax, path });
        }
      }
    }

    const discounts =
      moneyMinor(normalized.money.discount, currency, gaps, "money.discount", true) ?? 0n;
    const lineDiscounts = expectedLines.reduce(
      (sum, line) => sum + BigInt(line.input.discountMinor ?? "0"),
      0n
    );
    if (discounts !== lineDiscounts)
      addGap(
        gaps,
        "DISCOUNT_ALLOCATION_REQUIRED",
        "Provider discounts must reconcile to explicit invoice line discounts; no order-level discount was guessed.",
        "money.discount"
      );

    const shipping = normalized.shipping;
    const shippingRevenueAccount = shipping.length
      ? await tx.account.findFirst({
          where: {
            organizationId: context.organizationId,
            systemPurpose: "shipping-revenue",
            isArchived: false
          },
          select: { id: true }
        })
      : null;
    const shippingRevenueAccountId = shippingRevenueAccount?.id ?? null;
    for (const [index, component] of shipping.entries()) {
      const path = `shipping.${String(index)}`;
      const amount = moneyMinor(component.amount, currency, gaps, `${path}.amount`);
      const tax = moneyMinor(component.tax, currency, gaps, `${path}.tax`, true) ?? 0n;
      if (amount === null) continue;
      const input: LineCalculationInput = {
        productItemId: null,
        description: `Shipping: ${component.name}`,
        quantity: "1",
        unitPriceMinor: amount.toString(),
        discountMinor: "0",
        taxCodeId: tax > 0n ? taxCodeId : null,
        // Falls back to the sales account when no shipping revenue account is
        // configured, so an organization without one is unaffected.
        ...(shippingRevenueAccountId ? { incomeAccountId: shippingRevenueAccountId } : {})
      };
      lineInputs.push(input);
      expectedLines.push({ input, expectedNet: amount, expectedTax: tax, path });
    }

    const fees = [...normalized.fees];
    if (
      fees.some(
        (fee) =>
          (moneyMinor(fee.amount, currency, [], "fee", true) ?? 0n) !== 0n ||
          (moneyMinor(fee.tax, currency, [], "fee", true) ?? 0n) !== 0n
      )
    )
      addGap(
        gaps,
        "FEES_OUT_OF_SCOPE",
        "Provider fees require the separate payout and fee workflow; they were not folded into sales revenue.",
        "fees"
      );
    const giftWrap =
      moneyMinor(normalized.money.giftWrap, currency, gaps, "money.giftWrap", true) ?? 0n;
    if (giftWrap !== 0n)
      addGap(
        gaps,
        "GIFT_WRAP_ALLOCATION_REQUIRED",
        "Gift-wrap charges need an explicit mapped sales line before conversion.",
        "money.giftWrap"
      );

    for (const [index, productId] of lineInputs.map((line) => line.productItemId).entries()) {
      if (!productId) continue;
      const product = await tx.productItem.findFirst({
        where: { id: productId, organizationId: context.organizationId },
        include: { incomeAccount: true }
      });
      if (!product) {
        addGap(
          gaps,
          "PRODUCT_NOT_FOUND",
          "The reviewed catalog mapping points to no product in this organization.",
          `lines.${String(index)}.productItemId`
        );
        continue;
      }
      if (
        product.incomeAccount.isArchived ||
        !["REVENUE", "CONTRA_REVENUE"].includes(product.incomeAccount.type)
      )
        addGap(
          gaps,
          "INCOME_ACCOUNT_REQUIRED",
          `Product ${product.name} needs an active revenue account before conversion.`,
          `lines.${String(index)}`
        );
      if (
        product.itemType === "INVENTORY_PRODUCT" &&
        (!product.inventoryAssetAccountId ||
          !product.costOfGoodsSoldAccountId ||
          !product.purchaseClearingAccountId ||
          !product.adjustmentGainAccountId ||
          !product.inventoryLossAccountId ||
          !product.defaultLocationId)
      )
        addGap(
          gaps,
          "INVENTORY_CONFIGURATION_INCOMPLETE",
          `Inventory product ${product.name} is missing a required inventory account or default location.`,
          `lines.${String(index)}`
        );
    }

    const lines: CalculatedLine[] = [];
    if (!gaps.length) {
      for (const expected of expectedLines) {
        try {
          const calculated = await calculateLine(
            tx,
            context.organizationId,
            issueDate,
            expected.input
          );
          if (calculated.netAmountMinor !== expected.expectedNet)
            addGap(
              gaps,
              "LINE_TOTAL_MISMATCH",
              "The assembled invoice net amount does not equal the provider line total.",
              expected.path
            );
          if (calculated.taxTotalMinor !== expected.expectedTax)
            addGap(
              gaps,
              "LINE_TAX_MISMATCH",
              "The selected tax mapping does not reproduce the provider line tax exactly.",
              expected.path
            );
          lines.push(calculated);
        } catch (error) {
          addGap(
            gaps,
            error instanceof AppError ? error.code : "LINE_ASSEMBLY_FAILED",
            error instanceof Error ? error.message : "The invoice line could not be assembled.",
            expected.path
          );
        }
      }
    }
    const totals = lineTotals(lines);
    if (providerTotal !== null && totals.grandTotalMinor !== providerTotal)
      addGap(
        gaps,
        "ORDER_TOTAL_MISMATCH",
        "The assembled invoice total does not equal the provider total exactly.",
        "money.total"
      );
    if (providerTotal !== null && providerTotal <= 0n)
      addGap(
        gaps,
        "ORDER_TOTAL_INVALID",
        "Only positive provider orders can be posted as invoices.",
        "money.total"
      );
    if (normalized.reconciliation.balanced === false)
      addGap(
        gaps,
        "PROVIDER_RECONCILIATION_UNBALANCED",
        "Provider order components do not reconcile; review the source evidence before conversion.",
        "reconciliation"
      );

    const prepared =
      gaps.length || !currency || providerTotal === null || !customer
        ? null
        : {
            issueDate,
            currency,
            fxRateSnapshotId: input.fxRateSnapshotId ?? null,
            dueDate: addDays(issueDate, customer.paymentTermsDays),
            customer,
            lineInputs,
            lines,
            totals,
            providerTotals: providerTotalsSnapshot(normalized)
          };
    if (currency && (input.fxRateSnapshotId || currency !== "CAD")) {
      try {
        await assertDocumentCurrency(tx, {
          organizationId: context.organizationId,
          currency,
          rateSnapshotId: input.fxRateSnapshotId,
          transactionDate: issueDate
        });
      } catch (error) {
        addGap(
          gaps,
          error instanceof AppError ? error.code : "CURRENCY_INVALID",
          error instanceof Error ? error.message : "Currency configuration is invalid.",
          "currency"
        );
      }
    }
    const prior = await tx.commerceInboxEvent.findFirst({
      where: {
        organizationId: context.organizationId,
        installationId: event.installationId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        resultingInvoiceId: { not: null },
        id: { not: event.id }
      },
      select: { id: true, resultingInvoiceId: true }
    });
    if (prior)
      addGap(
        gaps,
        "ORDER_REVISION_REVIEW_REQUIRED",
        "A later or earlier revision of this provider order is already linked to an invoice; use the credit-note or reversal workflow instead of creating another invoice.",
        "resourceId"
      );

    return {
      eventId: event.id,
      status: event.status,
      conversionStatus: gaps.length ? "ACTION_REQUIRED" : "REVIEW_READY",
      ready: gaps.length === 0,
      gaps,
      customerStrategy: customerStrategy(mapping),
      providerTotals: providerTotalsSnapshot(normalized),
      draft: gaps.length
        ? null
        : draftDto({
            issueDate,
            dueDate: prepared?.dueDate ?? issueDate,
            currency: currency ?? "CAD",
            customer: customer!,
            lines,
            totals
          }),
      prepared: gaps.length ? null : prepared
    };
  }

  private async resolveCustomer(
    tx: Tx,
    context: OrganizationContext,
    mapping: Record<string, unknown>,
    input: CommerceOrderConversionSelection,
    gaps: Gap[]
  ): Promise<ResolvedCustomer | null> {
    const strategy = customerStrategy(mapping);
    const requestedId =
      input.customerId ??
      stringValue(mapping.marketplaceCustomerId ?? mapping.customerId ?? mapping.pooledCustomerId);
    if (requestedId) {
      const customer = await tx.customer.findFirst({
        where: { id: requestedId, organizationId: context.organizationId },
        include: { addresses: { orderBy: { createdAt: "asc" } } }
      });
      if (!customer)
        addGap(
          gaps,
          "CUSTOMER_NOT_FOUND",
          "Select an active customer in this organization for the order.",
          "customerId"
        );
      else if (!customer.active)
        addGap(
          gaps,
          "CUSTOMER_INACTIVE",
          "The selected customer is archived and cannot receive a new invoice.",
          "customerId"
        );
      else
        return {
          existingId: customer.id,
          input: null,
          displayName: customer.displayName,
          paymentTermsDays: customer.defaultPaymentTermsDays
        };
    }
    if (strategy === "POOLED") {
      addGap(
        gaps,
        "MARKETPLACE_CUSTOMER_REQUIRED",
        "Choose the configured pooled marketplace customer or provide customerId during review.",
        "customerId"
      );
      return null;
    }
    if (strategy === "UNCONFIGURED" || strategy === "ASK") {
      if (input.customer) return validateCustomerInput(tx, context, input.customer, gaps);
      addGap(
        gaps,
        "CUSTOMER_REVIEW_REQUIRED",
        "Choose a customer during review or configure the connector's customer import rule.",
        "customer"
      );
      return null;
    }
    if (!input.customer) {
      addGap(
        gaps,
        "INDIVIDUAL_CUSTOMER_EVIDENCE_REQUIRED",
        "Provide the reviewed customer and at least one structured address; provider PII is not inferred from redacted evidence.",
        "customer"
      );
      return null;
    }
    return validateCustomerInput(tx, context, input.customer, gaps);
  }

  private async persistCustomer(tx: Tx, context: OrganizationContext, resolved: ResolvedCustomer) {
    if (resolved.existingId) {
      const customer = await tx.customer.findFirst({
        where: { id: resolved.existingId, organizationId: context.organizationId },
        include: { addresses: { orderBy: { createdAt: "asc" } } }
      });
      if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 422);
      return customer;
    }
    if (!resolved.input)
      throw new AppError("CUSTOMER_REVIEW_REQUIRED", "A reviewed customer is required.", 422);
    const customer = await tx.customer.create({
      data: {
        organizationId: context.organizationId,
        customerNumber: resolved.input.customerNumber,
        legalName: resolved.input.legalName ?? null,
        displayName: resolved.input.displayName,
        primaryContact: null,
        additionalContacts: Prisma.JsonNull,
        email: resolved.input.email ?? null,
        telephone: resolved.input.telephone ?? null,
        website: null,
        taxRegistrationIdentifiers: Prisma.JsonNull,
        defaultPaymentTermsDays: resolved.input.defaultPaymentTermsDays ?? 30,
        defaultTaxCodeId: null,
        defaultCurrency: resolved.input.defaultCurrency ?? "CAD",
        internalNotes: "Created from a human-reviewed commerce order conversion.",
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id
      }
    });
    for (const [index, value] of resolved.input.addresses.entries()) {
      const address = normalizeCustomerAddress(value, index === 0 ? "SHIPPING" : undefined);
      await tx.customerAddress.create({
        data: {
          organizationId: context.organizationId,
          customerId: customer.id,
          role: address.role,
          recipientName: address.recipientName,
          organization: address.organization,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          subdivisionCode: address.subdivisionCode,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
          phone: address.phone,
          email: address.email,
          isDefault: address.isDefault || index === 0,
          needsReview: false,
          legacyValue: Prisma.JsonNull
        }
      });
    }
    return tx.customer.findUniqueOrThrow({
      where: { id: customer.id },
      include: { addresses: { orderBy: { createdAt: "asc" } } }
    });
  }
}

async function validateCustomerInput(
  tx: Tx,
  context: OrganizationContext,
  input: CommerceOrderCustomerInput,
  gaps: Gap[]
): Promise<ResolvedCustomer | null> {
  if (!input.customerNumber.trim() || !input.displayName.trim()) {
    addGap(
      gaps,
      "CUSTOMER_FIELDS_REQUIRED",
      "A customer number and display name are required.",
      "customer"
    );
    return null;
  }
  if (!input.addresses.length) {
    addGap(
      gaps,
      "CUSTOMER_ADDRESS_REQUIRED",
      "An individual commerce customer needs at least one structured address.",
      "customer.addresses"
    );
    return null;
  }
  for (const [index, address] of input.addresses.entries()) {
    try {
      assertCustomerAddress(address, `customer.addresses.${String(index)}`);
    } catch (error) {
      addGap(
        gaps,
        "CUSTOMER_ADDRESS_INVALID",
        error instanceof Error ? error.message : "Customer address is invalid.",
        `customer.addresses.${String(index)}`
      );
    }
  }
  const existing = await tx.customer.findFirst({
    where: { organizationId: context.organizationId, customerNumber: input.customerNumber }
  });
  if (existing)
    addGap(
      gaps,
      "CUSTOMER_NUMBER_EXISTS",
      "Choose a unique customer number for the individual customer.",
      "customer.customerNumber"
    );
  return {
    existingId: null,
    input,
    displayName: input.displayName,
    paymentTermsDays: input.defaultPaymentTermsDays ?? 30
  };
}

function resolveProductId(
  mapping: Record<string, unknown>,
  line: NormalizedCommerceLine,
  gaps: Gap[],
  path: string
): string | null {
  const refs: [string, string][] = [];
  if (line.variationExternalId) refs.push([line.variationExternalId, "variation"]);
  if (line.productExternalId) refs.push([line.productExternalId, "product"]);
  if (line.sku) refs.push([line.sku, "sku"]);
  const targets = new Set<string>();
  for (const [reference, kind] of refs) {
    const keys =
      kind === "variation"
        ? ["catalogVariantMappings", "variantMappings"]
        : kind === "product"
          ? [
              "catalogProductMappings",
              "productMappings",
              "catalogVariantMappings",
              "variantMappings"
            ]
          : ["catalogSkuMappings", "skuMappings"];
    for (const key of keys) {
      const value = asRecord(mapping[key])?.[reference];
      if (value !== undefined) {
        if (typeof value !== "string" || !value.trim())
          addGap(
            gaps,
            "CATALOG_MAPPING_INVALID",
            "A reviewed catalog mapping is invalid.",
            `${path}.${kind}`
          );
        else targets.add(value.trim());
      }
    }
  }
  if (targets.size !== 1) {
    addGap(
      gaps,
      targets.size > 1 ? "CATALOG_MAPPING_CONFLICT" : "CATALOG_MATCH_REQUIRED",
      targets.size > 1
        ? "Resolve conflicting catalog mappings before conversion."
        : "Confirm an exact provider catalog match before conversion.",
      path
    );
    return null;
  }
  return [...targets][0]!;
}

function resolveTaxCodeId(
  normalized: NormalizedCommerceEvent,
  mapping: Record<string, unknown>,
  gaps: Gap[]
): string | null {
  if (!normalized.taxes.length) return null;
  const taxMappings = asRecord(mapping.taxMappings);
  const ids = new Set<string>();
  for (const tax of normalized.taxes) {
    const destination = taxMappings?.[tax.externalId] ?? taxMappings?.[tax.name];
    if (typeof destination !== "string" || !destination.trim())
      addGap(
        gaps,
        "TAX_RATE_MAPPING_REQUIRED",
        `Map provider tax rate ${tax.name} to a reviewed accounting tax code.`,
        `taxes.${tax.externalId}`
      );
    else ids.add(destination.trim());
  }
  const responsibilities = normalized.mapping.taxRemittanceByComponent
    ? Object.values(normalized.mapping.taxRemittanceByComponent)
    : [normalized.mapping.taxRemittanceResponsibility];
  if (responsibilities.some((value) => value === "REVIEW_REQUIRED" || value === "NOT_APPLICABLE"))
    addGap(
      gaps,
      "TAX_REMITTANCE_CONFIRMATION_REQUIRED",
      "Confirm the reviewed seller or marketplace tax remittance treatment.",
      "mapping.taxRemittanceResponsibility"
    );
  if (ids.size > 1)
    addGap(
      gaps,
      "TAX_ALLOCATION_UNSUPPORTED",
      "This order has multiple mapped tax codes but no provider line-level tax allocation; conversion would guess.",
      "taxes"
    );
  return ids.size === 1 ? [...ids][0]! : null;
}

function moneyMinor(
  value: unknown,
  currency: string | null,
  gaps: Gap[],
  path: string,
  optional = false
): bigint | null {
  if (value === null || value === undefined) return optional ? 0n : null;
  const record = asRecord(value);
  if (
    !record ||
    typeof record.units !== "string" ||
    !/^-?\d+$/.test(record.units) ||
    typeof record.currency !== "string" ||
    !currency ||
    record.currency.trim().toUpperCase() !== currency ||
    record.divisor !== "100"
  ) {
    if (!optional)
      addGap(gaps, "MONEY_INVALID", "Money must be an exact CAD/USD minor-unit value.", path);
    return null;
  }
  try {
    return parseMinorUnit(record.units, path);
  } catch (error) {
    addGap(
      gaps,
      error instanceof AppError ? error.code : "MONEY_INVALID",
      error instanceof Error ? error.message : "Money is outside the supported range.",
      path
    );
    return null;
  }
}

function safeQuantity(value: string, gaps: Gap[], path: string): bigint | null {
  try {
    return parseQuantityMicros(value, path);
  } catch (error) {
    addGap(
      gaps,
      error instanceof AppError ? error.code : "QUANTITY_INVALID",
      error instanceof Error ? error.message : "Quantity is invalid.",
      path
    );
    return null;
  }
}

function asNormalized(value: Prisma.JsonValue | null): NormalizedCommerceEvent | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as unknown as NormalizedCommerceEvent)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function customerStrategy(
  mapping: Record<string, unknown>
): "POOLED" | "INDIVIDUAL" | "ASK" | "UNCONFIGURED" {
  return mapping.customerStrategy === "POOLED" ||
    mapping.customerStrategy === "INDIVIDUAL" ||
    mapping.customerStrategy === "ASK"
    ? mapping.customerStrategy
    : "UNCONFIGURED";
}

function blockingIssues(value: Prisma.JsonValue): boolean {
  return Array.isArray(value) && value.some((issue) => asRecord(issue)?.severity === "BLOCKING");
}

function failedPreflight(
  event: { id: string; status: string },
  gaps: Gap[],
  strategy: string,
  totals: Prisma.InputJsonObject | null
): PreflightResult {
  return {
    eventId: event.id,
    status: event.status,
    conversionStatus: "ACTION_REQUIRED",
    ready: false,
    gaps,
    customerStrategy: strategy,
    providerTotals: totals,
    draft: null,
    prepared: null
  };
}

function providerTotalsSnapshot(normalized: NormalizedCommerceEvent): Prisma.InputJsonObject {
  return {
    currency: normalized.currencies.source,
    money: normalized.money as unknown as Prisma.InputJsonObject,
    reconciliation: normalized.reconciliation as unknown as Prisma.InputJsonObject
  };
}

function lineTotals(lines: readonly CalculatedLine[]) {
  return {
    subtotalMinor: sumMinorUnits(lines.map((line) => line.grossAmountMinor)),
    discountTotalMinor: sumMinorUnits(lines.map((line) => line.discountMinor)),
    taxTotalMinor: sumMinorUnits(lines.map((line) => line.taxTotalMinor)),
    grandTotalMinor: sumMinorUnits(lines.map((line) => line.totalMinor))
  };
}

function draftDto(input: {
  issueDate: Date;
  dueDate: Date;
  currency: string;
  customer: ResolvedCustomer;
  lines: readonly CalculatedLine[];
  totals: ReturnType<typeof lineTotals>;
}) {
  return {
    issueDate: input.issueDate.toISOString(),
    dueDate: input.dueDate.toISOString(),
    currency: input.currency,
    customerId: input.customer.existingId,
    customerName: input.customer.displayName ?? input.customer.input?.displayName ?? null,
    lines: input.lines.map((line) => ({
      productItemId: line.productItemId,
      description: line.description,
      quantityMicros: line.quantityMicros.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      netAmountMinor: line.netAmountMinor.toString(),
      taxTotalMinor: line.taxTotalMinor.toString(),
      totalMinor: line.totalMinor.toString(),
      taxCodeId: line.taxCodeId,
      incomeAccountId: line.incomeAccountId,
      incomeAccountCode: line.incomeAccountCode
    })),
    subtotalMinor: input.totals.subtotalMinor.toString(),
    discountTotalMinor: input.totals.discountTotalMinor.toString(),
    taxTotalMinor: input.totals.taxTotalMinor.toString(),
    grandTotalMinor: input.totals.grandTotalMinor.toString()
  };
}

function publicPreflight(result: PreflightResult) {
  return {
    eventId: result.eventId,
    status: result.status,
    conversionStatus: result.conversionStatus,
    ready: result.ready,
    gaps: result.gaps,
    customerStrategy: result.customerStrategy,
    providerTotals: result.providerTotals,
    draft: result.draft
  };
}

function invoiceLineData(
  organizationId: string,
  invoiceId: string,
  lineNumber: number,
  line: CalculatedLine
) {
  return {
    organizationId,
    invoiceId,
    lineNumber,
    productItemId: line.productItemId,
    description: line.description,
    quantityMicros: line.quantityMicros,
    unitPriceMinor: line.unitPriceMinor,
    grossAmountMinor: line.grossAmountMinor,
    discountMinor: line.discountMinor,
    netAmountMinor: line.netAmountMinor,
    taxableAmountMinor: line.taxableAmountMinor,
    taxTotalMinor: line.taxTotalMinor,
    totalMinor: line.totalMinor,
    taxCodeId: line.taxCodeId,
    taxCodeVersionId: line.taxCodeVersionId,
    taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull,
    incomeAccountId: line.incomeAccountId,
    incomeAccountCode: line.incomeAccountCode,
    incomeAccountName: line.incomeAccountName
  };
}

function addressSnapshotFor(
  addresses: readonly {
    role: string;
    line1: string | null;
    city: string | null;
    postalCode: string | null;
    countryCode: string | null;
    recipientName: string | null;
    organization: string | null;
    line2: string | null;
    subdivisionCode: string | null;
    phone: string | null;
    email: string | null;
    needsReview: boolean;
  }[],
  role: string
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const address = addresses.find((value) => value.role === role && !value.needsReview);
  if (!address || !address.line1 || !address.city || !address.postalCode || !address.countryCode)
    return Prisma.JsonNull;
  return {
    recipientName: address.recipientName,
    organization: address.organization,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    province: address.subdivisionCode,
    subdivisionCode: address.subdivisionCode,
    postalCode: address.postalCode,
    country: address.countryCode,
    countryCode: address.countryCode,
    phone: address.phone,
    email: address.email
  };
}

async function organizationSnapshotFor(
  tx: Tx,
  organizationId: string
): Promise<Prisma.InputJsonObject> {
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { settings: true }
  });
  return {
    legalName: organization.legalName,
    displayName: organization.displayName,
    currency: organization.currency,
    timezone: organization.timezone,
    businessNumber: organization.settings?.businessNumber ?? null,
    address: organization.settings?.businessAddress ?? null
  };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addGap(gaps: Gap[], code: string, message: string, path?: string): void {
  if (gaps.some((gap) => gap.code === code && gap.path === path)) return;
  gaps.push({ code, message, ...(path ? { path } : {}) });
}

function cryptoRandomId(): string {
  return randomUUID();
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function audit(
  tx: Tx,
  context: OrganizationContext,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType:
        targetId === context.organizationId
          ? "Organization"
          : action.startsWith("INVOICE")
            ? "Invoice"
            : "CommerceInboxEvent",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
