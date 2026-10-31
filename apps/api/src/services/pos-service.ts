import { createHash } from "node:crypto";
import {
  parseMinorUnit,
  serializeMinorUnit,
  serializeQuantityMicros
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { hashJson } from "../utils/json.js";
import { normalizeCatalogIdentifier } from "./catalog-mapping-service.js";
import { runIdempotent } from "./idempotency-service.js";
import { InvoiceService } from "./invoice-service.js";
import {
  calculateLine,
  type CalculatedLine,
  type LineCalculationInput
} from "./invoice-calculation.js";
import { PaymentService } from "./payment-service.js";
import { InventoryService } from "./inventory-service.js";
import { assertSafePaymentReference } from "./payment-reference.js";

type Tx = Prisma.TransactionClient;

export type PosLineInput = LineCalculationInput;

export interface PosTenderInput {
  readonly type: "CASH" | "MANUAL";
  readonly amountReceivedMinor: string;
  readonly reference?: string | undefined;
}

export interface PosRegisterInput {
  readonly companyId: string;
  readonly inventoryLocationId: string;
  readonly cashAccountId: string;
  readonly code: string;
  readonly name: string;
  readonly receiptPrefix?: string | undefined;
}

export interface PosDeviceInput {
  readonly registerId: string;
  readonly deviceCode: string;
  readonly deviceKey?: string | undefined;
}

export interface PosCompleteSaleInput {
  readonly registerId: string;
  readonly shiftId: string;
  readonly deviceId?: string | null | undefined;
  readonly customerId?: string | null | undefined;
  readonly businessDate: string;
  readonly currency?: string | undefined;
  readonly lines: readonly PosLineInput[];
  readonly tenders: readonly PosTenderInput[];
}

export interface PosReturnInput {
  readonly saleId: string;
  readonly returnDate: string;
  readonly reason: string;
  readonly lines: readonly {
    readonly saleLineId: string;
    readonly quantity?: string | undefined;
    readonly disposition?: "RESTOCK" | "WRITE_OFF" | undefined;
  }[];
  readonly refund: boolean;
  /**
   * Cash refunds from a closed original shift must be recorded in a current,
   * open shift that uses the same cash account. The original open shift remains
   * the safe default for immediate returns.
   */
  readonly refundShiftId?: string | null | undefined;
}

export class PosService {
  private readonly authorization: AuthorizationService;
  private readonly invoices: InvoiceService;
  private readonly payments: PaymentService;
  private readonly inventory: InventoryService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.invoices = new InvoiceService(prisma);
    this.payments = new PaymentService(prisma);
    this.inventory = new InventoryService(prisma);
  }

  public async listRegisters(context: OrganizationContext) {
    await this.authorization.assert(context, "pos:read", "PosRegister");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.posRegister.findMany({
        where: { organizationId: context.organizationId, companyId: requireCompany(context) },
        include: { inventoryLocation: true },
        orderBy: [{ status: "asc" }, { code: "asc" }]
      });
      return rows.map(registerDto);
    });
  }

  public async capabilities(context: OrganizationContext) {
    await this.authorization.assert(context, "pos:read", "PosCapabilities");
    return {
      onlineAuthoritative: true,
      offlineSupported: false,
      tenderTypes: ["CASH", "MANUAL"],
      liveCardProcessing: false,
      returns: "existing_invoice_credit_note_workflow",
      externalOrderAdapters: "contract_only",
      /**
       * The service has always accepted a bounded basket and multiple tenders;
       * expose those facts as a versioned interaction contract so clients do
       * not have to infer support from request validation or hard-code limits.
       */
      cart: {
        multiLine: true,
        maxLines: 100,
        quantityDecimals: 6
      },
      tenders: {
        split: true,
        maxTenders: 10,
        change: true,
        changeTenderTypes: ["CASH"]
      },
      receipts: {
        receiptNumber: true,
        invoiceDocument: true,
        browserPrint: true,
        devicePrinting: false,
        externalDelivery: false
      }
    } as const;
  }

  /**
   * Scanner lookup is deliberately exact and server-scoped. It never falls
   * back to a title/fuzzy suggestion and it refuses a shared identifier rather
   * than letting a browser-side first-match pick a product.
   */
  public async resolveProductIdentifier(context: OrganizationContext, identifier: string) {
    await this.authorization.assert(context, "pos:sell", "ProductItem");
    const normalized = normalizeCatalogIdentifier(identifier);
    if (!normalized)
      throw new AppError(
        "POS_PRODUCT_IDENTIFIER_INVALID",
        "Enter an exact SKU, GTIN, or manufacturer part number.",
        422
      );
    const companyId = requireCompany(context);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const candidates = await tx.productItem.findMany({
        where: {
          organizationId: context.organizationId,
          companyId,
          active: true,
          OR: [
            { normalizedSku: normalized },
            { normalizedGtin: normalized },
            { normalizedManufacturerPartNumber: normalized }
          ]
        },
        select: {
          id: true,
          name: true,
          sku: true,
          gtin: true,
          manufacturerPartNumber: true,
          salesPriceMinor: true
        },
        take: 2
      });
      if (candidates.length === 0)
        throw new AppError(
          "POS_PRODUCT_IDENTIFIER_NOT_FOUND",
          "No active product matches that exact identifier.",
          404
        );
      if (candidates.length > 1)
        throw new AppError(
          "POS_PRODUCT_IDENTIFIER_AMBIGUOUS",
          "That identifier matches more than one active product. Resolve the duplicate before checkout.",
          409
        );
      const product = candidates[0]!;
      return {
        identifier: normalized,
        product: {
          ...product,
          salesPriceMinor: serializeMinorUnit(product.salesPriceMinor)
        }
      };
    });
  }

  public async createRegister(context: OrganizationContext, input: PosRegisterInput) {
    await this.authorization.assert(context, "pos:configure", "PosRegister");
    const companyId = requireCompany(context);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertCompany(tx, context.organizationId, input.companyId, companyId);
      const location = await tx.inventoryLocation.findFirst({
        where: {
          id: input.inventoryLocationId,
          organizationId: context.organizationId,
          companyId,
          isActive: true
        }
      });
      if (!location)
        throw new AppError(
          "POS_LOCATION_INVALID",
          "The register location is not active for this company.",
          422
        );
      const account = await tx.account.findFirst({
        where: {
          id: input.cashAccountId,
          organizationId: context.organizationId,
          companyId,
          type: "ASSET",
          isArchived: false
        }
      });
      if (!account)
        throw new AppError(
          "POS_CASH_ACCOUNT_INVALID",
          "Choose an active asset account for the cash drawer.",
          422
        );
      try {
        const row = await tx.posRegister.create({
          data: {
            organizationId: context.organizationId,
            companyId,
            inventoryLocationId: location.id,
            cashAccountId: account.id,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            status: "ACTIVE",
            receiptPrefix: input.receiptPrefix?.trim().toUpperCase() || "POS",
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          },
          include: { inventoryLocation: true }
        });
        await audit(tx, context, "POS_REGISTER_CREATED", "PosRegister", row.id, {
          companyId,
          code: row.code,
          locationId: row.inventoryLocationId
        });
        return registerDto(row);
      } catch (error) {
        if (isUnique(error))
          throw new AppError("POS_REGISTER_EXISTS", "Register code is already in use.", 409);
        throw error;
      }
    });
  }

  public async enrollDevice(context: OrganizationContext, input: PosDeviceInput) {
    await this.authorization.assert(context, "pos:configure", "PosDevice");
    const companyId = requireCompany(context);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const register = await tx.posRegister.findFirst({
        where: {
          id: input.registerId,
          organizationId: context.organizationId,
          companyId,
          status: "ACTIVE"
        }
      });
      if (!register)
        throw new AppError("POS_REGISTER_NOT_FOUND", "Register was not found or is inactive.", 404);
      try {
        const row = await tx.posDevice.create({
          data: {
            organizationId: context.organizationId,
            companyId,
            registerId: register.id,
            deviceCode: input.deviceCode.trim(),
            deviceKeyHash: input.deviceKey ? sha256(input.deviceKey) : null,
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "POS_DEVICE_ENROLLED", "PosDevice", row.id, {
          registerId: register.id,
          deviceCode: row.deviceCode
        });
        return deviceDto(row);
      } catch (error) {
        if (isUnique(error))
          throw new AppError("POS_DEVICE_EXISTS", "Device code is already in use.", 409);
        throw error;
      }
    });
  }

  public async listDevices(context: OrganizationContext, registerId?: string) {
    await this.authorization.assert(context, "pos:read", "PosDevice");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.posDevice.findMany({
        where: {
          organizationId: context.organizationId,
          companyId: requireCompany(context),
          ...(registerId ? { registerId } : {})
        },
        orderBy: { deviceCode: "asc" }
      });
      return rows.map(deviceDto);
    });
  }

  public async openShift(
    context: OrganizationContext,
    input: {
      readonly registerId: string;
      readonly deviceId?: string | null | undefined;
      readonly businessDate: string;
      readonly openingFloatMinor: string;
    }
  ) {
    await this.authorization.assert(context, "pos:shift", "PosShift");
    const companyId = requireCompany(context);
    const openingFloatMinor = parseMinorUnit(input.openingFloatMinor, "openingFloatMinor");
    if (openingFloatMinor < 0n)
      throw new AppError("POS_OPENING_FLOAT_INVALID", "Opening float cannot be negative.", 422);
    const businessDate = parseDate(input.businessDate, "businessDate");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const register = await tx.posRegister.findFirst({
        where: {
          id: input.registerId,
          organizationId: context.organizationId,
          companyId,
          status: "ACTIVE"
        }
      });
      if (!register)
        throw new AppError("POS_REGISTER_NOT_FOUND", "Register was not found or is inactive.", 404);
      const device = await this.findDevice(tx, context, companyId, register.id, input.deviceId);
      const current = await tx.posShift.findFirst({
        where: {
          organizationId: context.organizationId,
          registerId: register.id,
          status: { in: ["OPENING_COUNT", "OPEN", "CLOSING_COUNT", "PENDING_REVIEW"] }
        }
      });
      if (current)
        throw new AppError(
          "POS_SHIFT_ALREADY_OPEN",
          "This register already has an open shift.",
          409
        );
      const shift = await tx.posShift.create({
        data: {
          organizationId: context.organizationId,
          companyId,
          registerId: register.id,
          deviceId: device?.id ?? null,
          status: "OPEN",
          businessDate,
          openingFloatMinor,
          openedByUserId: context.user.id
        }
      });
      await tx.posCashEvent.create({
        data: {
          organizationId: context.organizationId,
          companyId,
          shiftId: shift.id,
          eventType: "OPENING_FLOAT",
          amountMinor: openingFloatMinor,
          createdByUserId: context.user.id
        }
      });
      await audit(tx, context, "POS_SHIFT_OPENED", "PosShift", shift.id, {
        registerId: register.id,
        openingFloatMinor: openingFloatMinor.toString(),
        businessDate: serializeDate(businessDate)
      });
      return shiftDto(shift);
    });
  }

  public async closeShift(context: OrganizationContext, shiftId: string, countedCashMinor: string) {
    await this.authorization.assert(context, "pos:shift", "PosShift", shiftId);
    const companyId = requireCompany(context);
    const counted = parseMinorUnit(countedCashMinor, "countedCashMinor");
    if (counted < 0n)
      throw new AppError("POS_COUNT_INVALID", "Counted cash cannot be negative.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const shift = await lockShift(tx, context, shiftId, companyId);
      if (shift.status !== "OPEN")
        throw new AppError("POS_SHIFT_NOT_OPEN", "Only an open shift can be closed.", 409);
      const pendingSale = await tx.posSale.findFirst({
        where: {
          organizationId: context.organizationId,
          companyId,
          shiftId: shift.id,
          status: "PAYMENT_PENDING"
        },
        select: { id: true }
      });
      if (pendingSale)
        throw new AppError(
          "POS_SHIFT_SETTLEMENT_PENDING",
          "Finish or recover the pending sale before closing this shift.",
          409
        );
      const expected = await expectedCash(tx, shift.id);
      const variance = counted - expected;
      const status = variance === 0n ? "CLOSED" : "PENDING_REVIEW";
      const updated = await tx.posShift.update({
        where: { id: shift.id },
        data: {
          status,
          expectedCashMinor: expected,
          countedCashMinor: counted,
          varianceMinor: variance,
          closedAt: status === "CLOSED" ? new Date() : null,
          closedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      await audit(tx, context, "POS_SHIFT_CLOSED", "PosShift", shift.id, {
        expectedCashMinor: expected.toString(),
        countedCashMinor: counted.toString(),
        varianceMinor: variance.toString(),
        status
      });
      return shiftDto(updated);
    });
  }

  public async approveShiftVariance(context: OrganizationContext, shiftId: string, reason: string) {
    await this.authorization.assert(context, "pos:cash-events", "PosShift", shiftId);
    const companyId = requireCompany(context);
    if (!reason.trim())
      throw new AppError(
        "POS_VARIANCE_REASON_REQUIRED",
        "A reason is required to approve a variance.",
        422
      );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const shift = await lockShift(tx, context, shiftId, companyId);
      if (shift.status !== "PENDING_REVIEW")
        throw new AppError("POS_VARIANCE_NOT_PENDING", "This shift has no pending variance.", 409);
      const updated = await tx.posShift.update({
        where: { id: shift.id },
        data: { status: "CLOSED", closedAt: new Date(), version: { increment: 1 } }
      });
      await audit(tx, context, "POS_SHIFT_VARIANCE_APPROVED", "PosShift", shift.id, {
        varianceMinor: (shift.varianceMinor ?? 0n).toString(),
        reason: reason.trim(),
        accountingResolution: "REQUIRES_SEPARATE_CONTROLLED_WORKFLOW"
      });
      return shiftDto(updated);
    });
  }

  public async addCashEvent(
    context: OrganizationContext,
    shiftId: string,
    input: {
      readonly eventType: "PAID_IN" | "PAID_OUT" | "DROP" | "SAFE_TRANSFER";
      readonly amountMinor: string;
      readonly reason: string;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "pos:cash-events", "PosCashEvent", shiftId);
    const amount = parseMinorUnit(input.amountMinor, "amountMinor");
    if (amount <= 0n)
      throw new AppError("POS_CASH_EVENT_INVALID", "Cash event amount must be positive.", 422);
    if (!input.reason.trim())
      throw new AppError(
        "POS_CASH_EVENT_REASON_REQUIRED",
        "A reason is required for cash events.",
        422
      );
    if (input.eventType === "PAID_IN" || input.eventType === "PAID_OUT")
      throw new AppError(
        "POS_CASH_EVENT_ACCOUNTING_WORKFLOW_REQUIRED",
        "Paid-ins and paid-outs require a linked bank, expense, or reimbursement accounting workflow. Record only drawer custody drops or safe transfers here.",
        409
      );
    assertSafePaymentReference(input.reason);
    return runIdempotent(
      this.prisma,
      context,
      "pos.cash-event",
      idempotencyKey,
      { shiftId, input },
      async (tx) => {
        const shift = await lockShift(tx, context, shiftId, requireCompany(context));
        if (shift.status !== "OPEN")
          throw new AppError("POS_SHIFT_NOT_OPEN", "Cash events require an open shift.", 409);
        const signed = input.eventType === "PAID_IN" ? amount : -amount;
        const row = await tx.posCashEvent.create({
          data: {
            organizationId: context.organizationId,
            companyId: shift.companyId,
            shiftId,
            eventType: input.eventType,
            amountMinor: signed,
            reason: input.reason.trim(),
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "POS_CASH_EVENT_RECORDED", "PosCashEvent", row.id, {
          eventType: row.eventType,
          amountMinor: signed.toString(),
          reason: row.reason
        });
        return { statusCode: 201, body: { event: cashEventDto(row) }, resourceId: row.id };
      }
    );
  }

  public async preview(
    context: OrganizationContext,
    input: Pick<PosCompleteSaleInput, "registerId" | "shiftId" | "businessDate" | "lines">
  ) {
    await this.authorization.assert(context, "pos:sell", "PosSale");
    const companyId = requireCompany(context);
    await this.assertPricingPermissions(context, input.lines);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertOpenContext(tx, context, companyId, input.registerId, input.shiftId, null);
      const calculated = await calculateLines(
        tx,
        context.organizationId,
        companyId,
        input.businessDate,
        input.lines
      );
      return previewDto(calculated);
    });
  }

  public async completeSale(
    context: OrganizationContext,
    input: PosCompleteSaleInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "pos:sell", "PosSale");
    await this.assertPricingPermissions(context, input.lines);
    for (const tender of input.tenders) assertSafePaymentReference(tender.reference);
    if (!idempotencyKey || idempotencyKey.length < 16)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required for a POS sale.",
        400
      );
    const companyId = requireCompany(context);
    const requestHash = hashJson(input);
    const draft = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.posSale.findFirst({
        where: { organizationId: context.organizationId, idempotencyKey },
        include: { lines: true, tenders: true }
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new AppError(
            "POS_IDEMPOTENCY_MISMATCH",
            "The idempotency key was used with different sale data.",
            409
          );
        return existing;
      }
      const businessDate = parseDate(input.businessDate, "businessDate");
      const contextRow = await this.assertOpenContext(
        tx,
        context,
        companyId,
        input.registerId,
        input.shiftId,
        input.deviceId ?? null
      );
      const calculated = await calculateLines(
        tx,
        context.organizationId,
        companyId,
        input.businessDate,
        input.lines
      );
      const totals = totalsOf(calculated);
      if (totals.grandTotalMinor <= 0n)
        throw new AppError("POS_TOTAL_INVALID", "A sale total must be positive.", 422);
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { baseCurrency: true }
      });
      const currency = (input.currency ?? company.baseCurrency).toUpperCase();
      const customer = await ensureGuest(tx, context, input.customerId ?? null, currency);
      const tenders = normalizeTenders(input.tenders, totals.grandTotalMinor);
      const sale = await tx.posSale.create({
        data: {
          organizationId: context.organizationId,
          companyId,
          registerId: contextRow.register.id,
          deviceId: contextRow.device?.id ?? null,
          shiftId: contextRow.shift.id,
          customerId: customer.id,
          idempotencyKey,
          requestHash,
          status: "PAYMENT_PENDING",
          currency,
          businessDate,
          subtotalMinor: totals.subtotalMinor,
          discountTotalMinor: totals.discountTotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          grandTotalMinor: totals.grandTotalMinor,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id,
          lines: {
            create: calculated.map((line, index) =>
              posLineData(context.organizationId, companyId, line, index + 1)
            )
          },
          tenders: {
            create: tenders.map((tender) => ({
              organizationId: context.organizationId,
              companyId,
              type: tender.type,
              status: "PENDING",
              amountReceivedMinor: tender.received,
              appliedAmountMinor: tender.applied,
              changeMinor: tender.change,
              currency,
              reference: tender.reference
            }))
          }
        },
        include: { lines: true, tenders: true }
      });
      await audit(tx, context, "POS_SALE_STARTED", "PosSale", sale.id, {
        registerId: sale.registerId,
        shiftId: sale.shiftId,
        grandTotalMinor: sale.grandTotalMinor.toString()
      });
      return sale;
    });

    if (draft.status === "COMPLETED") return posSaleDto(draft);
    const sale = await this.continueSale(context, draft.id, idempotencyKey);
    return sale;
  }

  public async getSale(context: OrganizationContext, saleId: string) {
    await this.authorization.assert(context, "pos:read", "PosSale", saleId);
    const companyId = requireCompany(context);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.posSale.findFirst({
        where: { id: saleId, organizationId: context.organizationId, companyId },
        include: { lines: { orderBy: { lineNumber: "asc" } }, tenders: true }
      });
      if (!row) throw new AppError("POS_SALE_NOT_FOUND", "POS sale was not found.", 404);
      return posSaleDto(row);
    });
  }

  public async returnSale(
    context: OrganizationContext,
    input: PosReturnInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "pos:return", "PosSale", input.saleId);
    const companyId = requireCompany(context);
    if (!idempotencyKey || idempotencyKey.length < 16)
      throw new AppError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "An idempotency key is required for a POS return.",
        400
      );
    if (!input.reason.trim() || input.lines.length === 0)
      throw new AppError(
        "POS_RETURN_INVALID",
        "A return reason and at least one line are required.",
        422
      );
    assertSafePaymentReference(input.reason);
    const requestHash = hashJson(input);
    const prepared = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.posReturn.findFirst({
        where: { organizationId: context.organizationId, idempotencyKey }
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new AppError(
            "POS_IDEMPOTENCY_MISMATCH",
            "The idempotency key was used with different return data.",
            409
          );
        const sale = await tx.posSale.findFirst({
          where: { id: existing.saleId, organizationId: context.organizationId, companyId },
          include: {
            lines: { include: { productItem: true }, orderBy: { lineNumber: "asc" } },
            tenders: true,
            register: true
          }
        });
        if (!sale)
          throw new AppError("POS_SALE_NOT_FOUND", "The original POS sale was not found.", 404);
        return { returnRow: existing, sale };
      }
      const sale = await tx.posSale.findFirst({
        where: {
          id: input.saleId,
          organizationId: context.organizationId,
          companyId,
          status: "COMPLETED"
        },
        include: {
          lines: { include: { productItem: true }, orderBy: { lineNumber: "asc" } },
          tenders: true,
          register: true
        }
      });
      if (!sale || !sale.invoiceId)
        throw new AppError(
          "POS_SALE_NOT_RETURNABLE",
          "Only completed POS sales can be returned.",
          409
        );
      const invoiceLines = await tx.invoiceLine.findMany({
        where: { invoiceId: sale.invoiceId, organizationId: context.organizationId },
        orderBy: { lineNumber: "asc" }
      });
      const saleLineIds = new Set(sale.lines.map((line) => line.id));
      const seen = new Set<string>();
      for (const line of input.lines) {
        if (!saleLineIds.has(line.saleLineId) || seen.has(line.saleLineId))
          throw new AppError(
            "POS_RETURN_LINE_INVALID",
            "Return lines must reference this sale once each.",
            422
          );
        seen.add(line.saleLineId);
      }
      const refundShiftId = input.refund
        ? await resolveCashRefundShift(tx, context, sale, input.refundShiftId)
        : null;
      const returnRow = await tx.posReturn.create({
        data: {
          organizationId: context.organizationId,
          companyId: sale.companyId,
          saleId: sale.id,
          idempotencyKey,
          requestHash,
          status: "PENDING",
          refundShiftId,
          reason: input.reason.trim(),
          createdByUserId: context.user.id
        }
      });
      return { returnRow, sale, invoiceLines };
    });
    if (prepared.returnRow.status === "COMPLETED") return posReturnDto(prepared.returnRow);
    const saleLines = prepared.sale.lines;
    const cashRefundShiftId =
      input.refund && prepared.sale.tenders.some((tender) => tender.type === "CASH")
        ? (prepared.returnRow.refundShiftId ??
          (await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
            const refundShiftId = await resolveCashRefundShift(
              tx,
              context,
              prepared.sale,
              input.refundShiftId
            );
            if (!refundShiftId)
              throw new AppError(
                "POS_REFUND_SHIFT_REQUIRED",
                "An open cash shift is required before refunding a cash sale.",
                409
              );
            await tx.posReturn.update({
              where: { id: prepared.returnRow.id },
              data: { refundShiftId }
            });
            return refundShiftId;
          })))
        : null;
    const invoiceLines =
      prepared.invoiceLines ??
      (await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.invoiceLine.findMany({
          where: { invoiceId: prepared.sale.invoiceId!, organizationId: context.organizationId },
          orderBy: { lineNumber: "asc" }
        })
      ));
    const requestedBySaleLine = new Map(input.lines.map((line) => [line.saleLineId, line]));
    const orderedReturnInputs = saleLines.flatMap((saleLine) => {
      const requested = requestedBySaleLine.get(saleLine.id);
      return requested ? [requested] : [];
    });
    let creditNoteId = prepared.returnRow.creditNoteId;
    let creditNote: {
      id: string;
      version: number;
      grandTotalMinor: string;
      lines: readonly { id: string; quantityMicros: string }[];
    };
    if (creditNoteId) {
      const note = await withTenantTransaction(
        this.prisma,
        dbContext(context),
        (tx) =>
          tx.creditNote.findFirst({
            where: { id: creditNoteId!, organizationId: context.organizationId },
            include: { lines: true }
          }) as Promise<Prisma.CreditNoteGetPayload<{ include: { lines: true } }> | null>
      );
      if (!note)
        throw new AppError(
          "POS_RETURN_CREDIT_NOTE_MISSING",
          "The return credit note is missing.",
          409
        );
      creditNote = {
        id: note.id,
        version: note.version,
        grandTotalMinor: note.grandTotalMinor.toString(),
        lines: note.lines.map((line) => ({
          id: line.id,
          quantityMicros: line.quantityMicros.toString()
        }))
      };
    } else {
      const creditLines = saleLines.flatMap((saleLine) => {
        const requested = requestedBySaleLine.get(saleLine.id);
        const invoiceLine = invoiceLines.find((line) => line.lineNumber === saleLine.lineNumber);
        return requested && invoiceLine
          ? [
              {
                invoiceLineId: invoiceLine.id,
                ...(requested.quantity ? { quantity: requested.quantity } : {})
              }
            ]
          : [];
      });
      if (creditLines.length !== input.lines.length)
        throw new AppError(
          "POS_RETURN_LINE_INVALID",
          "The original invoice lines could not be resolved.",
          409
        );
      const draft = await this.invoices.createCreditNote(context, {
        invoiceId: prepared.sale.invoiceId!,
        issueDate: input.returnDate,
        reason: input.reason.trim(),
        fullCredit: false,
        lines: creditLines
      });
      const posted = await this.invoices.postCreditNote(
        context,
        draft.id,
        draft.version,
        `pos-return-credit:${prepared.returnRow.id}`
      );
      creditNote = posted.body.creditNote;
      creditNoteId = creditNote.id;
      await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.posReturn.update({
          where: { id: prepared.returnRow.id },
          data: { creditNoteId, totalMinor: BigInt(creditNote.grandTotalMinor) }
        })
      );
    }
    for (const [index, creditLine] of creditNote.lines.entries()) {
      const requested = orderedReturnInputs[index];
      const saleLine = requested
        ? saleLines.find((line) => line.id === requested.saleLineId)
        : null;
      if (!saleLine?.productItemId || saleLine.productItem?.itemType !== "INVENTORY_PRODUCT")
        continue;
      await this.inventory.customerReturn(
        context,
        {
          creditNoteLineId: creditLine.id,
          quantity: creditLine.quantityMicros
            ? deserializeQuantity(BigInt(creditLine.quantityMicros))
            : (requested?.quantity ?? "1"),
          disposition: requested?.disposition ?? "RESTOCK",
          returnDate: input.returnDate,
          reason: input.reason.trim()
        },
        `pos-return-inventory:${prepared.returnRow.id}:${creditLine.id}`
      );
    }
    if (input.refund) {
      let remaining = BigInt(creditNote.grandTotalMinor);
      for (const tender of prepared.sale.tenders) {
        if (!tender.paymentId || tender.status !== "PAID" || remaining <= 0n) continue;
        const amount =
          tender.appliedAmountMinor < remaining ? tender.appliedAmountMinor : remaining;
        const refund = await this.payments.refund(
          context,
          tender.paymentId,
          {
            amountMinor: amount.toString(),
            reason: input.reason.trim(),
            treatment: "CREDIT_NOTE_AND_REFUND",
            creditNoteId
          },
          `pos-return-refund:${prepared.returnRow.id}:${tender.id}`
        );
        if (tender.type === "CASH" && refund.body.refund.status === "SUCCEEDED") {
          if (!cashRefundShiftId)
            throw new AppError(
              "POS_REFUND_SHIFT_REQUIRED",
              "An open cash shift is required before refunding a cash sale.",
              409
            );
          await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
            const refundShift = await lockShift(
              tx,
              context,
              cashRefundShiftId,
              prepared.sale.companyId
            );
            if (refundShift.status !== "OPEN")
              throw new AppError(
                "POS_REFUND_SHIFT_NOT_OPEN",
                "Cash refunds must be recorded in an open shift.",
                409
              );
            const existingCashRefund = await tx.posCashEvent.findFirst({
              where: {
                organizationId: context.organizationId,
                companyId: prepared.sale.companyId,
                shiftId: cashRefundShiftId,
                saleId: prepared.sale.id,
                eventType: "REFUND",
                amountMinor: -amount,
                reason: input.reason.trim()
              }
            });
            if (existingCashRefund) return;
            await tx.posCashEvent.create({
              data: {
                organizationId: context.organizationId,
                companyId: prepared.sale.companyId,
                shiftId: cashRefundShiftId,
                saleId: prepared.sale.id,
                eventType: "REFUND",
                amountMinor: -amount,
                reason: input.reason.trim(),
                createdByUserId: context.user.id
              }
            });
          });
        }
        remaining -= amount;
      }
      if (remaining > 0n)
        throw new AppError(
          "POS_REFUND_TENDER_UNAVAILABLE",
          "The original tenders could not cover this refund.",
          409
        );
    }
    const completed = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.posReturn.update({
        where: { id: prepared.returnRow.id },
        data: { status: "COMPLETED", creditNoteId, totalMinor: BigInt(creditNote.grandTotalMinor) }
      });
      await audit(tx, context, "POS_RETURN_COMPLETED", "PosReturn", row.id, {
        saleId: row.saleId,
        creditNoteId,
        totalMinor: row.totalMinor.toString(),
        refund: input.refund,
        refundShiftId: cashRefundShiftId
      });
      return row;
    });
    return posReturnDto(completed);
  }

  public async listSales(context: OrganizationContext, shiftId?: string) {
    await this.authorization.assert(context, "pos:read", "PosSale");
    const companyId = requireCompany(context);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.posSale.findMany({
        where: {
          organizationId: context.organizationId,
          companyId,
          ...(shiftId ? { shiftId } : {})
        },
        include: { lines: true, tenders: true },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return rows.map(posSaleDto);
    });
  }

  public async reconcileShift(context: OrganizationContext, shiftId: string) {
    await this.authorization.assert(context, "pos:read", "PosShift", shiftId);
    const companyId = requireCompany(context);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const shift = await tx.posShift.findFirst({
        where: {
          id: shiftId,
          organizationId: context.organizationId,
          companyId
        }
      });
      if (!shift) throw new AppError("POS_SHIFT_NOT_FOUND", "POS shift was not found.", 404);
      const sales = await tx.posSale.findMany({
        where: {
          organizationId: context.organizationId,
          companyId,
          shiftId,
          status: "COMPLETED"
        },
        select: { grandTotalMinor: true, taxTotalMinor: true, subtotalMinor: true }
      });
      const tenders = await tx.posTender.findMany({
        where: {
          organizationId: context.organizationId,
          companyId,
          sale: { shiftId, companyId },
          status: "PAID"
        },
        select: { type: true, appliedAmountMinor: true, changeMinor: true }
      });
      return {
        shift: shiftDto(shift),
        completedSales: sales.length,
        salesTotalMinor: serializeMinorUnit(
          sales.reduce((sum, row) => sum + row.grandTotalMinor, 0n)
        ),
        taxTotalMinor: serializeMinorUnit(sales.reduce((sum, row) => sum + row.taxTotalMinor, 0n)),
        tenderTotals: Object.fromEntries(
          ["CASH", "MANUAL"].map((type) => [
            type,
            serializeMinorUnit(
              tenders
                .filter((tender) => tender.type === type)
                .reduce((sum, tender) => sum + tender.appliedAmountMinor, 0n)
            )
          ])
        )
      };
    });
  }

  private async continueSale(context: OrganizationContext, saleId: string, idempotencyKey: string) {
    const companyId = requireCompany(context);
    const snapshot = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.posSale.findFirst({
        where: { id: saleId, organizationId: context.organizationId, companyId },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          tenders: true,
          register: true,
          shift: true
        }
      })
    );
    if (!snapshot) throw new AppError("POS_SALE_NOT_FOUND", "POS sale was not found.", 404);
    if (snapshot.status === "COMPLETED") return posSaleDto(snapshot);
    const lineInputs = snapshot.lines.map((line) => ({
      productItemId: line.productItemId,
      description: line.description,
      quantity: deserializeQuantity(line.quantityMicros),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      taxCodeId: line.taxCodeId
    }));
    let invoiceId = snapshot.invoiceId;
    if (!invoiceId) {
      const createdInvoice = await this.invoices.create(context, {
        customerId: snapshot.customerId,
        issueDate: serializeDate(snapshot.businessDate),
        currency: snapshot.currency,
        lines: lineInputs
      });
      // The POS row is the durable operation owner. A duplicate continuation
      // may construct another draft, but only one draft can become its linked
      // source document and therefore only one can ever be posted.
      const boundInvoiceId = await withTenantTransaction(
        this.prisma,
        dbContext(context),
        async (tx) => {
          await tx.posSale.updateMany({
            where: {
              id: saleId,
              organizationId: context.organizationId,
              companyId,
              invoiceId: null
            },
            data: { invoiceId: createdInvoice.id, updatedByUserId: context.user.id }
          });
          const bound = await tx.posSale.findFirst({
            where: { id: saleId, organizationId: context.organizationId, companyId },
            select: { invoiceId: true }
          });
          return bound?.invoiceId ?? null;
        }
      );
      if (!boundInvoiceId)
        throw new AppError(
          "POS_INVOICE_BINDING_FAILED",
          "The POS sale could not be linked to its invoice safely.",
          409
        );
      invoiceId = boundInvoiceId;
    }
    let invoice = await this.invoices.get(context, invoiceId);
    if (invoice.status === "DRAFT")
      invoice = await this.invoices.approve(context, invoice.id, invoice.version);
    if (invoice.status === "APPROVED") {
      const posted = await this.invoices.post(
        context,
        invoice.id,
        invoice.version,
        serializeDate(snapshot.businessDate),
        `pos-invoice-post:${saleId}`,
        snapshot.register.inventoryLocationId
      );
      invoice = posted.body.invoice;
    }
    if (invoice.grandTotalMinor !== snapshot.grandTotalMinor.toString())
      throw new AppError(
        "POS_TOTAL_CHANGED",
        "The authoritative invoice total changed; the sale was not completed.",
        409
      );
    for (const [index, tender] of snapshot.tenders.entries()) {
      if (tender.status === "PAID") continue;
      const paymentResult = await this.payments.recordManual(
        context,
        {
          customerId: snapshot.customerId,
          receivingAccountId: snapshot.register.cashAccountId,
          paymentDate: serializeDate(snapshot.businessDate),
          amountMinor: tender.appliedAmountMinor.toString(),
          currency: snapshot.currency,
          methodCategory: tender.type === "CASH" ? "CASH" : "OTHER",
          reference: tender.reference ?? `POS:${saleId}:${String(index + 1)}`,
          allocations: [
            { invoiceId: invoice.id, amountMinor: tender.appliedAmountMinor.toString() }
          ]
        },
        `pos-payment:${saleId}:${tender.id}`
      );
      const payment = paymentResult.body.payment as { id: string };
      await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const applied = await tx.posTender.updateMany({
          where: {
            id: tender.id,
            organizationId: context.organizationId,
            companyId: snapshot.companyId,
            status: "PENDING",
            paymentId: null
          },
          data: { paymentId: payment.id, status: "PAID" }
        });
        // A concurrent retry can reach this point after the canonical payment
        // was recorded. Only the request that transitioned the tender may add
        // the drawer event.
        if (applied.count !== 1) return;
        if (tender.type === "CASH")
          await tx.posCashEvent.create({
            data: {
              organizationId: context.organizationId,
              companyId: snapshot.companyId,
              shiftId: snapshot.shiftId,
              saleId,
              eventType: "SALE",
              amountMinor: tender.appliedAmountMinor,
              createdByUserId: context.user.id
            }
          });
      });
    }
    const completed = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.posSale.update({
        where: { id: saleId },
        data: {
          status: "COMPLETED",
          receiptNumber: `${snapshot.register.receiptPrefix}-${invoice.invoiceNumber ?? saleId.slice(0, 8).toUpperCase()}`,
          completedAt: new Date(),
          updatedByUserId: context.user.id
        },
        include: { lines: true, tenders: true }
      });
      await audit(tx, context, "POS_SALE_COMPLETED", "PosSale", saleId, {
        invoiceId: invoice.id,
        receiptNumber: row.receiptNumber,
        idempotencyKey
      });
      return row;
    });
    return posSaleDto(completed);
  }

  private async assertOpenContext(
    tx: Tx,
    context: OrganizationContext,
    companyId: string,
    registerId: string,
    shiftId: string,
    deviceId: string | null
  ) {
    const register = await tx.posRegister.findFirst({
      where: { id: registerId, organizationId: context.organizationId, companyId, status: "ACTIVE" }
    });
    if (!register)
      throw new AppError("POS_REGISTER_NOT_FOUND", "Register was not found or is inactive.", 404);
    const shift = await tx.posShift.findFirst({
      where: {
        id: shiftId,
        organizationId: context.organizationId,
        companyId,
        registerId,
        status: "OPEN"
      }
    });
    if (!shift)
      throw new AppError("POS_SHIFT_NOT_OPEN", "An open shift for this register is required.", 409);
    const device = await this.findDevice(tx, context, companyId, registerId, deviceId);
    return { register, shift, device };
  }

  private async findDevice(
    tx: Tx,
    context: OrganizationContext,
    companyId: string,
    registerId: string,
    deviceId: string | null | undefined
  ) {
    if (!deviceId) return null;
    const device = await tx.posDevice.findFirst({
      where: {
        id: deviceId,
        organizationId: context.organizationId,
        companyId,
        registerId,
        active: true
      }
    });
    if (!device)
      throw new AppError(
        "POS_DEVICE_INVALID",
        "The POS device is not enrolled for this register.",
        422
      );
    return device;
  }

  private async assertPricingPermissions(
    context: OrganizationContext,
    lines: readonly PosLineInput[]
  ) {
    const productIds = lines.flatMap((line) => (line.productItemId ? [line.productItemId] : []));
    const products = productIds.length
      ? await this.prisma.productItem.findMany({
          where: { organizationId: context.organizationId, id: { in: productIds } },
          select: { id: true, salesPriceMinor: true, defaultTaxCodeId: true }
        })
      : [];
    const byId = new Map(products.map((product) => [product.id, product]));
    for (const line of lines) {
      const product = line.productItemId ? byId.get(line.productItemId) : null;
      const requestedPrice =
        line.unitPriceMinor === undefined
          ? null
          : parseMinorUnit(line.unitPriceMinor, "unitPriceMinor");
      if (!product || (requestedPrice !== null && requestedPrice !== product.salesPriceMinor))
        await this.authorization.assert(context, "pos:price-override", "PosSale");
      if (
        line.discountMinor !== undefined &&
        parseMinorUnit(line.discountMinor, "discountMinor") > 0n
      )
        await this.authorization.assert(context, "pos:discount", "PosSale");
      if (line.taxCodeId !== undefined && line.taxCodeId !== (product?.defaultTaxCodeId ?? null))
        await this.authorization.assert(context, "pos:tax-override", "PosSale");
    }
  }
}

function requireCompany(context: OrganizationContext): string {
  if (!context.companyId)
    throw new AppError("COMPANY_CONTEXT_REQUIRED", "Select a company before using POS.", 409);
  return context.companyId;
}

async function assertCompany(
  tx: Tx,
  organizationId: string,
  requestedId: string,
  contextCompanyId: string
) {
  if (requestedId !== contextCompanyId)
    throw new AppError(
      "POS_COMPANY_MISMATCH",
      "The register company must match the active company.",
      422
    );
  const company = await tx.company.findFirst({
    where: { id: requestedId, organizationId, status: "ACTIVE" }
  });
  if (!company) throw new AppError("COMPANY_NOT_FOUND", "Company was not found.", 404);
}

async function ensureGuest(
  tx: Tx,
  context: OrganizationContext,
  customerId: string | null,
  currency: string
) {
  if (customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, organizationId: context.organizationId, active: true }
    });
    if (!customer)
      throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found or is inactive.", 404);
    return customer;
  }
  const existing = await tx.customer.findFirst({
    where: { organizationId: context.organizationId, customerNumber: "POS-GUEST" }
  });
  if (existing?.active) return existing;
  if (existing)
    throw new AppError("POS_GUEST_CUSTOMER_INACTIVE", "The POS walk-in customer is inactive.", 409);
  return tx.customer.create({
    data: {
      organizationId: context.organizationId,
      customerNumber: "POS-GUEST",
      displayName: "Walk-in customer",
      defaultPaymentTermsDays: 0,
      defaultCurrency: currency.toUpperCase(),
      createdByUserId: context.user.id,
      updatedByUserId: context.user.id
    }
  });
}

async function calculateLines(
  tx: Tx,
  organizationId: string,
  companyId: string,
  businessDate: string,
  inputs: readonly PosLineInput[]
) {
  if (inputs.length === 0 || inputs.length > 100)
    throw new AppError(
      "POS_LINES_INVALID",
      "A sale must contain between one and one hundred lines.",
      422
    );
  const date = parseDate(businessDate, "businessDate");
  const result: CalculatedLine[] = [];
  for (const input of inputs) {
    if (input.productItemId) {
      const product = await tx.productItem.findFirst({
        where: { id: input.productItemId, organizationId },
        select: { companyId: true }
      });
      if (!product || product.companyId !== companyId)
        throw new AppError(
          "POS_PRODUCT_COMPANY_MISMATCH",
          "Every product must belong to the active company.",
          422
        );
    }
    result.push(await calculateLine(tx, organizationId, date, input));
  }
  return result;
}

function normalizeTenders(inputs: readonly PosTenderInput[], total: bigint) {
  if (inputs.length === 0 || inputs.length > 10)
    throw new AppError(
      "POS_TENDERS_INVALID",
      "Provide at least one and no more than ten tenders.",
      422
    );
  let remaining = total;
  return inputs
    .map((input) => {
      if (remaining === 0n)
        throw new AppError("POS_TENDER_EXCESS", "Tendered amounts exceed the sale total.", 422);
      const received = parseMinorUnit(input.amountReceivedMinor, "amountReceivedMinor");
      if (received <= 0n)
        throw new AppError("POS_TENDER_INVALID", "Tender amounts must be positive.", 422);
      const applied = received < remaining ? received : remaining;
      const change = received - applied;
      remaining -= applied;
      if (change > 0n && input.type !== "CASH")
        throw new AppError(
          "POS_CHANGE_CASH_ONLY",
          "Change can only be issued against a cash tender.",
          422
        );
      return {
        type: input.type,
        received,
        applied,
        change,
        reference: input.reference?.trim() || null
      };
    })
    .map((tender, index, all) => {
      if (index === all.length - 1 && remaining > 0n)
        throw new AppError(
          "POS_TENDER_SHORT",
          "Tendered amounts do not cover the sale total.",
          422
        );
      return tender;
    });
}

function totalsOf(lines: readonly CalculatedLine[]) {
  return lines.reduce(
    (totals, line) => ({
      subtotalMinor: totals.subtotalMinor + line.netAmountMinor,
      discountTotalMinor: totals.discountTotalMinor + line.discountMinor,
      taxTotalMinor: totals.taxTotalMinor + line.taxTotalMinor,
      grandTotalMinor: totals.grandTotalMinor + line.totalMinor
    }),
    { subtotalMinor: 0n, discountTotalMinor: 0n, taxTotalMinor: 0n, grandTotalMinor: 0n }
  );
}

function posLineData(
  organizationId: string,
  companyId: string,
  line: CalculatedLine,
  lineNumber: number
) {
  return {
    organizationId,
    companyId,
    lineNumber,
    productItemId: line.productItemId,
    description: line.description,
    skuSnapshot: line.sku,
    quantityMicros: line.quantityMicros,
    unitPriceMinor: line.unitPriceMinor,
    grossAmountMinor: line.grossAmountMinor,
    discountMinor: line.discountMinor,
    netAmountMinor: line.netAmountMinor,
    taxTotalMinor: line.taxTotalMinor,
    totalMinor: line.totalMinor,
    taxCodeId: line.taxCodeId,
    taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull,
    incomeAccountId: line.incomeAccountId
  };
}

function previewDto(lines: readonly CalculatedLine[]) {
  const totals = totalsOf(lines);
  return {
    totals: Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [key, serializeMinorUnit(value)])
    ),
    lines: lines.map((line) => ({
      productItemId: line.productItemId,
      sku: line.sku,
      description: line.description,
      quantity: serializeQuantityMicros(line.quantityMicros),
      quantityMicros: line.quantityMicros.toString(),
      unitPriceMinor: serializeMinorUnit(line.unitPriceMinor),
      grossAmountMinor: serializeMinorUnit(line.grossAmountMinor),
      discountMinor: serializeMinorUnit(line.discountMinor),
      netAmountMinor: serializeMinorUnit(line.netAmountMinor),
      taxTotalMinor: serializeMinorUnit(line.taxTotalMinor),
      totalMinor: serializeMinorUnit(line.totalMinor),
      taxCodeId: line.taxCodeId,
      taxSnapshot: line.taxSnapshot
    }))
  };
}

function registerDto(row: {
  id: string;
  companyId: string;
  inventoryLocationId: string;
  cashAccountId: string;
  code: string;
  name: string;
  status: string;
  receiptPrefix: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  inventoryLocation?: { code: string; name: string } | null;
}) {
  return {
    id: row.id,
    companyId: row.companyId,
    inventoryLocationId: row.inventoryLocationId,
    cashAccountId: row.cashAccountId,
    code: row.code,
    name: row.name,
    status: row.status,
    receiptPrefix: row.receiptPrefix,
    version: row.version,
    location: row.inventoryLocation
      ? { code: row.inventoryLocation.code, name: row.inventoryLocation.name }
      : null,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}
function deviceDto(row: {
  id: string;
  registerId: string;
  deviceCode: string;
  active: boolean;
  enrolledAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}) {
  return {
    id: row.id,
    registerId: row.registerId,
    deviceCode: row.deviceCode,
    active: row.active,
    enrolledAt: row.enrolledAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null
  };
}
function shiftDto(row: {
  id: string;
  registerId: string;
  deviceId: string | null;
  status: string;
  businessDate: Date;
  openingFloatMinor: bigint;
  expectedCashMinor: bigint | null;
  countedCashMinor: bigint | null;
  varianceMinor: bigint | null;
  openedAt: Date;
  closedAt: Date | null;
  version: number;
}) {
  return {
    id: row.id,
    registerId: row.registerId,
    deviceId: row.deviceId,
    status: row.status,
    businessDate: serializeDate(row.businessDate),
    openingFloatMinor: serializeMinorUnit(row.openingFloatMinor),
    expectedCashMinor:
      row.expectedCashMinor === null ? null : serializeMinorUnit(row.expectedCashMinor),
    countedCashMinor:
      row.countedCashMinor === null ? null : serializeMinorUnit(row.countedCashMinor),
    varianceMinor: row.varianceMinor === null ? null : serializeMinorUnit(row.varianceMinor),
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    version: row.version
  };
}
function cashEventDto(row: {
  id: string;
  shiftId: string;
  saleId: string | null;
  eventType: string;
  amountMinor: bigint;
  reason: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    shiftId: row.shiftId,
    saleId: row.saleId,
    eventType: row.eventType,
    amountMinor: serializeMinorUnit(row.amountMinor),
    reason: row.reason,
    createdAt: row.createdAt.toISOString()
  };
}
function posSaleDto(row: {
  id: string;
  registerId: string;
  deviceId: string | null;
  shiftId: string;
  customerId: string;
  invoiceId: string | null;
  receiptNumber?: string | null;
  status: string;
  currency: string;
  businessDate: Date;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxTotalMinor: bigint;
  grandTotalMinor: bigint;
  completedAt: Date | null;
  createdAt?: Date;
  lines: readonly {
    id: string;
    lineNumber: number;
    productItemId: string | null;
    description: string;
    quantityMicros: bigint;
    unitPriceMinor: bigint;
    grossAmountMinor: bigint;
    discountMinor: bigint;
    netAmountMinor: bigint;
    taxTotalMinor: bigint;
    totalMinor: bigint;
    taxCodeId: string | null;
    taxSnapshot: Prisma.JsonValue | null;
  }[];
  tenders: readonly {
    id: string;
    type: string;
    status: string;
    amountReceivedMinor: bigint;
    appliedAmountMinor: bigint;
    changeMinor: bigint;
    currency: string;
    paymentId: string | null;
    reference: string | null;
  }[];
}) {
  return {
    id: row.id,
    registerId: row.registerId,
    deviceId: row.deviceId,
    shiftId: row.shiftId,
    customerId: row.customerId,
    invoiceId: row.invoiceId,
    receiptNumber: row.receiptNumber ?? null,
    status: row.status,
    currency: row.currency,
    businessDate: serializeDate(row.businessDate),
    subtotalMinor: serializeMinorUnit(row.subtotalMinor),
    discountTotalMinor: serializeMinorUnit(row.discountTotalMinor),
    taxTotalMinor: serializeMinorUnit(row.taxTotalMinor),
    grandTotalMinor: serializeMinorUnit(row.grandTotalMinor),
    completedAt: row.completedAt?.toISOString() ?? null,
    lines: row.lines.map((line) => ({
      ...line,
      quantity: deserializeQuantity(line.quantityMicros),
      quantityMicros: line.quantityMicros.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      grossAmountMinor: line.grossAmountMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      netAmountMinor: line.netAmountMinor.toString(),
      taxTotalMinor: line.taxTotalMinor.toString(),
      totalMinor: line.totalMinor.toString()
    })),
    tenders: row.tenders.map((tender) => ({
      ...tender,
      amountReceivedMinor: tender.amountReceivedMinor.toString(),
      appliedAmountMinor: tender.appliedAmountMinor.toString(),
      changeMinor: tender.changeMinor.toString()
    }))
  };
}

function posReturnDto(row: {
  id: string;
  saleId: string;
  creditNoteId: string | null;
  refundShiftId: string | null;
  status: string;
  totalMinor: bigint;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    saleId: row.saleId,
    creditNoteId: row.creditNoteId,
    refundShiftId: row.refundShiftId,
    status: row.status,
    totalMinor: serializeMinorUnit(row.totalMinor),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
function deserializeQuantity(value: bigint) {
  return `${(value / 1_000_000n).toString()}.${(value % 1_000_000n).toString().padStart(6, "0")}`
    .replace(/\.0+$/, "")
    .replace(/(\.[0-9]*?)0+$/, "$1");
}
async function expectedCash(tx: Tx, shiftId: string) {
  const rows = await tx.posCashEvent.findMany({
    where: { shiftId },
    select: { amountMinor: true }
  });
  return rows.reduce((sum, row) => sum + row.amountMinor, 0n);
}

async function resolveCashRefundShift(
  tx: Tx,
  context: OrganizationContext,
  sale: {
    companyId: string;
    shiftId: string;
    register: { cashAccountId: string };
    tenders: readonly { type: string; status: string }[];
  },
  requestedShiftId: string | null | undefined
) {
  const cashRefundRequired = sale.tenders.some(
    (tender) => tender.type === "CASH" && tender.status === "PAID"
  );
  if (!cashRefundRequired) return null;
  const shiftId = requestedShiftId ?? sale.shiftId;
  const shift = await lockShift(tx, context, shiftId, sale.companyId);
  if (shift.status !== "OPEN")
    throw new AppError(
      requestedShiftId ? "POS_REFUND_SHIFT_NOT_OPEN" : "POS_REFUND_SHIFT_REQUIRED",
      requestedShiftId
        ? "Cash refunds must be recorded in the selected open shift."
        : "The original cash-sale shift is closed. Open a compatible cash shift and select it before refunding.",
      409
    );
  const refundRegister = await tx.posRegister.findFirst({
    where: {
      id: shift.registerId,
      organizationId: context.organizationId,
      companyId: sale.companyId
    },
    select: { cashAccountId: true }
  });
  if (!refundRegister || refundRegister.cashAccountId !== sale.register.cashAccountId)
    throw new AppError(
      "POS_REFUND_CASH_ACCOUNT_MISMATCH",
      "The refund shift must use the same cash account as the original sale.",
      422
    );
  return shift.id;
}

async function lockShift(tx: Tx, context: OrganizationContext, shiftId: string, companyId: string) {
  const rows = await tx.$queryRaw<
    readonly { id: string }[]
  >`SELECT "id" FROM "PosShift" WHERE "id" = ${shiftId}::uuid AND "organizationId" = ${context.organizationId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
  if (!rows[0]) throw new AppError("POS_SHIFT_NOT_FOUND", "POS shift was not found.", 404);
  const row = await tx.posShift.findFirst({
    where: { id: shiftId, organizationId: context.organizationId, companyId }
  });
  if (!row) throw new AppError("POS_SHIFT_NOT_FOUND", "POS shift was not found.", 404);
  return row;
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType,
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
