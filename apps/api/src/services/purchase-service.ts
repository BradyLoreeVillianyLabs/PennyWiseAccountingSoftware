import { randomUUID } from "node:crypto";
import {
  allocateMinorUnits,
  convertBalancedComponents,
  convertMinorUnits,
  parseMinorUnit,
  sumMinorUnits
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import { JournalService, type PostJournalInput } from "./journal-service.js";
import { MonetaryPositionService } from "./monetary-position-service.js";
import { assertDocumentCurrency } from "./currency-workflow-policy.js";
import {
  calculatePurchaseLine,
  type CalculatedPurchaseLine,
  type PurchaseLineInput
} from "./purchase-calculation.js";
import { allocateTaxAdjustment } from "./tax-calculation-service.js";

type Tx = Prisma.TransactionClient;

export interface VendorInput {
  readonly vendorNumber: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly primaryContact?: Prisma.InputJsonValue | undefined;
  readonly additionalContacts?: Prisma.InputJsonValue | undefined;
  readonly remittanceAddress?: Prisma.InputJsonValue | undefined;
  readonly serviceAddress?: Prisma.InputJsonValue | undefined;
  readonly email?: string | null | undefined;
  readonly telephone?: string | null | undefined;
  readonly website?: string | null | undefined;
  readonly businessIdentifier?: string | null | undefined;
  readonly defaultPaymentTermsDays?: number | undefined;
  readonly defaultCurrency?: string | undefined;
  readonly defaultExpenseAccountId?: string | null | undefined;
  readonly defaultTaxCodeId?: string | null | undefined;
  readonly preferredPaymentMethod?:
    | "CASH"
    | "CHEQUE"
    | "ELECTRONIC_TRANSFER"
    | "CREDIT_CARD"
    | "OWNER_PAID"
    | "OTHER"
    | null
    | undefined;
  readonly internalNotes?: string | null | undefined;
}

export interface BillInput {
  readonly vendorId: string;
  readonly vendorInvoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate?: string | undefined;
  readonly paymentTermsDays?: number | undefined;
  readonly currency?: string | undefined;
  readonly fxRateSnapshotId?: string | undefined;
  readonly internalNotes?: string | null | undefined;
  readonly lines: readonly PurchaseLineInput[];
}

export interface ImmediateExpenseInput {
  readonly vendorId?: string | null | undefined;
  readonly reference?: string | null | undefined;
  readonly expenseDate: string;
  readonly method:
    | "CASH"
    | "CHEQUE"
    | "ELECTRONIC_TRANSFER"
    | "CREDIT_CARD"
    | "OWNER_PAID"
    | "OTHER";
  readonly payingAccountId: string;
  readonly internalNotes?: string | null | undefined;
  readonly lines: readonly PurchaseLineInput[];
}

export type CaptureReviewConversionInput =
  | {
      readonly target: "BILL";
      readonly version: number;
      readonly bill: BillInput;
    }
  | {
      readonly target: "IMMEDIATE_EXPENSE";
      readonly version: number;
      readonly expense: ImmediateExpenseInput;
    };

export class PurchaseService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;
  private readonly monetaryPositions: MonetaryPositionService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
    this.monetaryPositions = new MonetaryPositionService();
  }

  public async listVendors(context: OrganizationContext, active?: boolean) {
    await this.authorization.assert(context, "vendors:read", "Vendor");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.vendor.findMany({
        where: {
          organizationId: context.organizationId,
          ...(active === undefined ? {} : { isActive: active })
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: 200
      })
    );
    return rows.map(toJson);
  }

  public async createVendor(context: OrganizationContext, input: VendorInput) {
    await this.authorization.assert(context, "vendors:manage", "Vendor");
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await validateVendorDefaults(tx, context.organizationId, input);
        const row = await tx.vendor.create({
          data: vendorData(context, input)
        });
        await audit(tx, context, "VENDOR_CREATED", "Vendor", row.id, {
          vendorNumber: row.vendorNumber
        });
        return toJson(row);
      });
    } catch (error) {
      throwUnique(error, "DUPLICATE_VENDOR_NUMBER", "Vendor number already exists.");
    }
  }

  public async updateVendor(
    context: OrganizationContext,
    id: string,
    version: number,
    input: Partial<VendorInput>
  ) {
    await this.authorization.assert(context, "vendors:manage", "Vendor", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await validateVendorDefaults(tx, context.organizationId, input);
      const result = await tx.vendor.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: {
          ...cleanUndefined(input),
          primaryContact: jsonOrUndefined(input.primaryContact),
          additionalContacts: jsonOrUndefined(input.additionalContacts),
          remittanceAddress: jsonOrUndefined(input.remittanceAddress),
          serviceAddress: jsonOrUndefined(input.serviceAddress),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        } as Prisma.VendorUpdateManyMutationInput
      });
      if (result.count !== 1)
        throw new AppError("STALE_VENDOR", "Vendor was not found or was changed.", 409);
      const row = await tx.vendor.findUniqueOrThrow({ where: { id } });
      await audit(tx, context, "VENDOR_UPDATED", "Vendor", id, { version: row.version });
      return toJson(row);
    });
  }

  public async archiveVendor(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "vendors:manage", "Vendor", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.vendor.updateMany({
        where: { id, organizationId: context.organizationId, version, isActive: true },
        data: {
          isActive: false,
          archivedAt: new Date(),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError("STALE_VENDOR", "Vendor was not found or was changed.", 409);
      await audit(tx, context, "VENDOR_ARCHIVED", "Vendor", id, {});
      return toJson(await tx.vendor.findUniqueOrThrow({ where: { id } }));
    });
  }

  public async listBills(context: OrganizationContext, status?: string, vendorId?: string) {
    await this.authorization.assert(context, "bills:read", "Bill");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bill.findMany({
        where: {
          organizationId: context.organizationId,
          ...(status ? { status: status as never } : {}),
          ...(vendorId ? { vendorId } : {})
        },
        include: { vendor: true, lines: { orderBy: { lineNumber: "asc" } } },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: 200
      })
    );
    return rows.map((row) => billDto(row));
  }

  public async getBill(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "bills:read", "Bill", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bill.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          vendor: true,
          lines: { orderBy: { lineNumber: "asc" } },
          paymentAllocations: { include: { billPayment: true } },
          creditApplications: { include: { vendorCredit: true } },
          attachments: true,
          captureConversion: {
            include: {
              captureReview: {
                select: {
                  id: true,
                  projectId: true,
                  kind: true,
                  checksum: true,
                  mediaType: true,
                  byteSize: true
                }
              }
            }
          }
        }
      })
    );
    if (!row) throw new AppError("BILL_NOT_FOUND", "Bill was not found.", 404);
    return billDto(row);
  }

  public async createBill(context: OrganizationContext, input: BillInput, idempotencyKey?: string) {
    await this.authorization.assert(context, "bills:create", "Bill");
    const createDraft = async (tx: Tx) => {
      const row = await this.createBillDraftInTransaction(tx, context, input);
      await audit(tx, context, "BILL_DRAFT_CREATED", "Bill", row.id, {
        vendorId: row.vendorId,
        grandTotalMinor: row.grandTotalMinor.toString()
      });
      return billDto(row);
    };
    if (idempotencyKey?.trim()) {
      const result = await runIdempotent(
        this.prisma,
        context,
        "bills.create",
        idempotencyKey,
        input,
        async (tx) => {
          const bill = await createDraft(tx);
          return {
            statusCode: 201,
            body: { bill } as never,
            resourceId: typeof bill.id === "string" ? bill.id : undefined
          };
        }
      );
      return (result.body as unknown as { bill: JsonSafeObject }).bill;
    }
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), createDraft);
    } catch (error) {
      throwUnique(
        error,
        "DUPLICATE_VENDOR_INVOICE_NUMBER",
        "Vendor invoice number already exists for this vendor."
      );
    }
  }

  public async getImmediateExpenseDraft(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "expenses:record", "ImmediateExpenseDraft", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.immediateExpenseDraft.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          captureConversion: {
            include: {
              captureReview: {
                select: {
                  id: true,
                  projectId: true,
                  kind: true,
                  checksum: true,
                  mediaType: true,
                  byteSize: true
                }
              }
            }
          }
        }
      })
    );
    if (!row)
      throw new AppError(
        "IMMEDIATE_EXPENSE_DRAFT_NOT_FOUND",
        "Immediate expense draft was not found.",
        404
      );
    return immediateExpenseDraftDto(row);
  }

  public async convertApprovedCaptureReview(
    context: OrganizationContext,
    captureReviewId: string,
    input: CaptureReviewConversionInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "captures:manage", "CaptureReview", captureReviewId);
    await this.authorization.assert(
      context,
      input.target === "BILL" ? "bills:create" : "expenses:record",
      input.target === "BILL" ? "Bill" : "ImmediateExpenseDraft"
    );
    if (!Number.isSafeInteger(input.version) || input.version < 1)
      throw new AppError("CAPTURE_VERSION_INVALID", "Capture review version is invalid.", 422);
    try {
      return await runIdempotent(
        this.prisma,
        context,
        "capture-review.convert",
        idempotencyKey,
        { captureReviewId, ...input },
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "CaptureReview"
            WHERE "id" = ${captureReviewId}::uuid
              AND "organizationId" = ${context.organizationId}::uuid
            FOR UPDATE`;
          const capture = await tx.captureReview.findFirst({
            where: { id: captureReviewId, organizationId: context.organizationId }
          });
          if (!capture)
            throw new AppError("CAPTURE_NOT_FOUND", "Capture review was not found.", 404);
          const existing = await tx.captureReviewConversion.findUnique({
            where: {
              organizationId_captureReviewId: {
                organizationId: context.organizationId,
                captureReviewId
              }
            }
          });
          if (existing)
            throw new AppError(
              "CAPTURE_ALREADY_CONVERTED",
              "Capture review already has a purchase draft.",
              409
            );
          if (capture.status !== "APPROVED")
            throw new AppError(
              "CAPTURE_NOT_APPROVED",
              "Only an approved capture review can create a purchase draft.",
              409
            );
          if (capture.scanStatus !== "CLEAN")
            throw new AppError(
              "CAPTURE_EVIDENCE_NOT_CLEAN",
              "Only clean scanned evidence can create a purchase draft.",
              409
            );
          if (capture.version !== input.version)
            throw new AppError(
              "STALE_CAPTURE_REVIEW",
              "Capture review was changed by another request.",
              409
            );
          const expectedTarget = capture.kind === "BILL" ? "BILL" : "IMMEDIATE_EXPENSE";
          if (input.target !== expectedTarget)
            throw new AppError(
              "CAPTURE_TARGET_MISMATCH",
              "Bill evidence creates a bill draft and receipt evidence creates an immediate expense draft.",
              422
            );

          let targetId: string;
          let bill: JsonSafeObject | null = null;
          let immediateExpenseDraft: JsonSafeObject | null = null;
          let billId: string | null = null;
          let immediateExpenseDraftId: string | null = null;
          if (input.target === "BILL") {
            const row = await this.createBillDraftInTransaction(tx, context, input.bill);
            targetId = row.id;
            billId = row.id;
            bill = billDto(row);
            await audit(tx, context, "BILL_DRAFT_CREATED", "Bill", row.id, {
              vendorId: row.vendorId,
              grandTotalMinor: row.grandTotalMinor.toString(),
              captureReviewId
            });
          } else {
            const row = await this.createImmediateExpenseDraftInTransaction(
              tx,
              context,
              input.expense
            );
            targetId = row.id;
            immediateExpenseDraftId = row.id;
            immediateExpenseDraft = immediateExpenseDraftDto(row);
            await audit(
              tx,
              context,
              "IMMEDIATE_EXPENSE_DRAFT_CREATED",
              "ImmediateExpenseDraft",
              row.id,
              {
                grandTotalMinor: row.grandTotalMinor.toString(),
                captureReviewId
              }
            );
          }
          const changed = await tx.captureReview.updateMany({
            where: {
              id: captureReviewId,
              organizationId: context.organizationId,
              status: "APPROVED",
              version: input.version
            },
            data: { version: { increment: 1 } }
          });
          if (changed.count !== 1)
            throw new AppError(
              "STALE_CAPTURE_REVIEW",
              "Capture review was changed by another request.",
              409
            );
          const conversion = await tx.captureReviewConversion.create({
            data: {
              organizationId: context.organizationId,
              captureReviewId,
              captureReviewVersion: input.version,
              targetType: input.target,
              billId,
              immediateExpenseDraftId,
              convertedByUserId: context.user.id
            }
          });
          await audit(tx, context, "CAPTURE_REVIEW_CONVERTED", "CaptureReview", captureReviewId, {
            captureReviewVersion: input.version,
            captureKind: capture.kind,
            targetType: input.target,
            targetId,
            checksum: capture.checksum,
            projectId: capture.projectId,
            accountingEntriesCreated: 0
          });
          const body = {
            conversion: conversionDto(conversion),
            bill,
            immediateExpenseDraft,
            evidence: captureEvidenceDto(capture),
            accountingEntriesCreated: 0
          };
          return { statusCode: 201, body, resourceId: conversion.id };
        }
      );
    } catch (error) {
      if (isUniqueConstraint(error, "vendorInvoiceNumber"))
        throw new AppError(
          "DUPLICATE_VENDOR_INVOICE_NUMBER",
          "Vendor invoice number already exists for this vendor.",
          409
        );
      if (isUnique(error))
        throw new AppError(
          "CAPTURE_ALREADY_CONVERTED",
          "Capture review already has a purchase draft.",
          409
        );
      throw error;
    }
  }

  private async createBillDraftInTransaction(
    tx: Tx,
    context: OrganizationContext,
    input: BillInput
  ) {
    const vendor = await activeVendor(tx, context.organizationId, input.vendorId);
    const issueDate = parseDate(input.issueDate, "issueDate");
    const currencyPolicy = await assertDocumentCurrency(tx, {
      organizationId: context.organizationId,
      currency: input.currency ?? vendor.defaultCurrency,
      rateSnapshotId: input.fxRateSnapshotId,
      transactionDate: issueDate
    });
    const terms = input.paymentTermsDays ?? vendor.defaultPaymentTermsDays;
    const dueDate = input.dueDate ? parseDate(input.dueDate, "dueDate") : addDays(issueDate, terms);
    const lines = await calculateLines(tx, context.organizationId, issueDate, input.lines);
    const totals = purchaseTotals(lines);
    return tx.bill.create({
      data: {
        organizationId: context.organizationId,
        vendorId: vendor.id,
        vendorInvoiceNumber: input.vendorInvoiceNumber.trim(),
        issueDate,
        dueDate,
        paymentTermsDays: terms,
        currency: currencyPolicy.currency,
        fxRateSnapshotId: input.fxRateSnapshotId ?? null,
        ...totals,
        internalNotes: input.internalNotes ?? null,
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id,
        lines: {
          create: lines.map((line, index) => billLineData(context.organizationId, index + 1, line))
        }
      },
      include: { vendor: true, lines: { orderBy: { lineNumber: "asc" } } }
    });
  }

  private async createImmediateExpenseDraftInTransaction(
    tx: Tx,
    context: OrganizationContext,
    input: ImmediateExpenseInput
  ) {
    const date = parseDate(input.expenseDate, "expenseDate");
    if (input.vendorId) await activeVendor(tx, context.organizationId, input.vendorId);
    const paying = await paymentAccount(tx, context.organizationId, input.payingAccountId);
    const lines = await calculateLines(tx, context.organizationId, date, input.lines);
    const totals = purchaseTotals(lines);
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
      select: { currency: true }
    });
    return tx.immediateExpenseDraft.create({
      data: {
        organizationId: context.organizationId,
        vendorId: input.vendorId ?? null,
        reference: input.reference?.trim() ?? null,
        expenseDate: date,
        currency: organization.currency.trim(),
        method: input.method,
        payingAccountId: paying.id,
        subtotalMinor: totals.subtotalMinor,
        recoverableTaxMinor: totals.recoverableTaxMinor,
        nonRecoverableTaxMinor: totals.nonRecoverableTaxMinor,
        taxTotalMinor: totals.taxTotalMinor,
        grandTotalMinor: totals.grandTotalMinor,
        internalNotes: input.internalNotes ?? null,
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id,
        lines: {
          create: lines.map((line, index) => expenseDraftLineData(index + 1, line))
        }
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });
  }

  public async updateBill(
    context: OrganizationContext,
    id: string,
    version: number,
    input: BillInput
  ) {
    await this.authorization.assert(context, "bills:create", "Bill", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const bill = await lockBill(tx, context.organizationId, id);
      if (!["DRAFT", "APPROVED"].includes(bill.status) || bill.version !== version)
        throw new AppError("STALE_BILL", "Bill is posted or was changed.", 409);
      const vendor = await activeVendor(tx, context.organizationId, input.vendorId);
      const issueDate = parseDate(input.issueDate, "issueDate");
      const currencyPolicy = await assertDocumentCurrency(tx, {
        organizationId: context.organizationId,
        currency: input.currency ?? bill.currency,
        rateSnapshotId: input.fxRateSnapshotId,
        transactionDate: issueDate
      });
      const terms = input.paymentTermsDays ?? vendor.defaultPaymentTermsDays;
      const dueDate = input.dueDate
        ? parseDate(input.dueDate, "dueDate")
        : addDays(issueDate, terms);
      const lines = await calculateLines(tx, context.organizationId, issueDate, input.lines);
      const totals = purchaseTotals(lines);
      await tx.billLine.deleteMany({
        where: { billId: id, organizationId: context.organizationId }
      });
      await tx.billLine.createMany({
        data: lines.map((line, index) => ({
          billId: id,
          ...billLineData(context.organizationId, index + 1, line)
        }))
      });
      const row = await tx.bill.update({
        where: { id },
        data: {
          vendorId: vendor.id,
          vendorInvoiceNumber: input.vendorInvoiceNumber.trim(),
          issueDate,
          dueDate,
          paymentTermsDays: terms,
          currency: currencyPolicy.currency,
          fxRateSnapshotId: input.fxRateSnapshotId ?? null,
          ...totals,
          internalNotes: input.internalNotes ?? null,
          status: "DRAFT",
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        },
        include: { vendor: true, lines: { orderBy: { lineNumber: "asc" } } }
      });
      await audit(tx, context, "BILL_DRAFT_UPDATED", "Bill", id, { version: row.version });
      return billDto(row);
    });
  }

  public async approveBill(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "bills:post", "Bill", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.bill.updateMany({
        where: { id, organizationId: context.organizationId, status: "DRAFT", version },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedByUserId: context.user.id,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw new AppError("STALE_BILL", "Bill cannot be approved.", 409);
      await audit(tx, context, "BILL_APPROVED", "Bill", id, {});
      return billDto(
        await tx.bill.findUniqueOrThrow({
          where: { id },
          include: { vendor: true, lines: { orderBy: { lineNumber: "asc" } } }
        })
      );
    });
  }

  public async postBill(
    context: OrganizationContext,
    id: string,
    version: number,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "bills:post", "Bill", id);
    return runIdempotent(
      this.prisma,
      context,
      "bill.post",
      idempotencyKey,
      { billId: id, version },
      async (tx) => {
        const bill = await lockBill(tx, context.organizationId, id);
        if (!["DRAFT", "APPROVED"].includes(bill.status) || bill.version !== version)
          throw new AppError("STALE_BILL", "Bill is posted or was changed.", 409);
        const vendor = await activeVendor(tx, context.organizationId, bill.vendorId);
        await assertDocumentCurrency(tx, {
          organizationId: context.organizationId,
          currency: bill.currency,
          rateSnapshotId: bill.fxRateSnapshotId,
          transactionDate: bill.issueDate
        });
        const ap = await controlAccount(
          tx,
          context.organizationId,
          "accounts-payable",
          "LIABILITY"
        );
        const baseCurrency = (
          await tx.organization.findUniqueOrThrow({
            where: { id: context.organizationId },
            select: { currency: true }
          })
        ).currency.trim();
        const fxRate = bill.fxRateSnapshotId
          ? await tx.fxRateSnapshot.findFirst({
              where: { id: bill.fxRateSnapshotId, organizationId: context.organizationId },
              select: {
                id: true,
                transactionCurrency: true,
                baseCurrency: true,
                transactionExponent: true,
                baseExponent: true,
                numerator: true,
                denominator: true
              }
            })
          : null;
        if (bill.currency.trim() !== baseCurrency && !fxRate)
          throw new AppError(
            "FX_RATE_REQUIRED",
            "A locked FX rate snapshot is required before posting a foreign-currency bill.",
            422
          );
        const journal = await this.journals.postJournalInTransaction(
          tx,
          context,
          purchaseJournal(
            "bill",
            bill.id,
            bill.issueDate,
            `Bill ${bill.vendorInvoiceNumber}`,
            bill.lines,
            bill.grandTotalMinor,
            ap.id,
            bill.currency,
            fxRate
          ),
          true
        );
        const baseAmounts = billBaseAmounts(
          bill.lines,
          {
            subtotalMinor: bill.subtotalMinor,
            discountTotalMinor: bill.discountTotalMinor,
            recoverableTaxMinor: bill.recoverableTaxMinor,
            nonRecoverableTaxMinor: bill.nonRecoverableTaxMinor,
            taxTotalMinor: bill.taxTotalMinor,
            grandTotalMinor: bill.grandTotalMinor
          },
          bill.currency,
          fxRate
        );
        for (const [index, baseLine] of baseAmounts.lines.entries()) {
          await tx.billLine.updateMany({
            where: {
              organizationId: context.organizationId,
              billId: bill.id,
              lineNumber: index + 1
            },
            data: baseLine
          });
        }
        if (fxRate && bill.currency.trim() !== baseCurrency) {
          await this.monetaryPositions.recognize(tx, {
            organizationId: context.organizationId,
            accountId: ap.id,
            kind: "ACCOUNTS_PAYABLE",
            currency: bill.currency.trim(),
            sourceType: "bill",
            sourceId: bill.id,
            transactionMinor: bill.grandTotalMinor,
            baseMinor: baseAmounts.baseGrandTotalMinor,
            eventDate: bill.issueDate,
            rateSnapshotId: fxRate.id,
            journalId: journal.id
          });
        }
        const row = await tx.bill.update({
          where: { id },
          data: {
            status: "POSTED",
            vendorNameSnapshot: vendor.displayName,
            remittanceSnapshot: vendor.remittanceAddress ?? Prisma.JsonNull,
            journalId: journal.id,
            baseSubtotalMinor: baseAmounts.baseSubtotalMinor,
            baseDiscountTotalMinor: baseAmounts.baseDiscountTotalMinor,
            baseRecoverableTaxMinor: baseAmounts.baseRecoverableTaxMinor,
            baseNonRecoverableTaxMinor: baseAmounts.baseNonRecoverableTaxMinor,
            baseTaxTotalMinor: baseAmounts.baseTaxTotalMinor,
            baseGrandTotalMinor: baseAmounts.baseGrandTotalMinor,
            postedAt: new Date(),
            postedByUserId: context.user.id,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          },
          include: { vendor: true, lines: { orderBy: { lineNumber: "asc" } } }
        });
        await audit(tx, context, "BILL_POSTED", "Bill", id, {
          journalId: journal.id,
          grandTotalMinor: bill.grandTotalMinor.toString()
        });
        await outbox(tx, context.organizationId, "purchases.bill.posted", "Bill", id, {
          billId: id,
          journalId: journal.id
        });
        return { statusCode: 201, body: { bill: billDto(row) }, resourceId: id };
      }
    );
  }

  public async recordImmediateExpense(
    context: OrganizationContext,
    input: ImmediateExpenseInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "expenses:record", "ImmediateExpense");
    return runIdempotent(
      this.prisma,
      context,
      "immediate-expense.record",
      idempotencyKey,
      input,
      async (tx) => {
        const date = parseDate(input.expenseDate, "expenseDate");
        if (input.vendorId) await activeVendor(tx, context.organizationId, input.vendorId);
        const paying = await paymentAccount(tx, context.organizationId, input.payingAccountId);
        const lines = await calculateLines(tx, context.organizationId, date, input.lines);
        const totals = purchaseTotals(lines);
        const id = randomUUID();
        const duplicateReferenceWarning =
          !!input.reference &&
          (await tx.immediateExpense.count({
            where: {
              organizationId: context.organizationId,
              reference: input.reference.trim()
            }
          })) > 0;
        const journal = await this.journals.postJournalInTransaction(
          tx,
          context,
          purchaseJournal(
            "immediate_expense",
            id,
            date,
            `Expense ${input.reference?.trim() || id}`,
            lines,
            totals.grandTotalMinor,
            paying.id
          ),
          true
        );
        const row = await tx.immediateExpense.create({
          data: {
            id,
            organizationId: context.organizationId,
            vendorId: input.vendorId ?? null,
            reference: input.reference?.trim() ?? null,
            expenseDate: date,
            method: input.method,
            payingAccountId: paying.id,
            subtotalMinor: totals.subtotalMinor,
            recoverableTaxMinor: totals.recoverableTaxMinor,
            nonRecoverableTaxMinor: totals.nonRecoverableTaxMinor,
            taxTotalMinor: totals.taxTotalMinor,
            grandTotalMinor: totals.grandTotalMinor,
            journalId: journal.id,
            internalNotes: input.internalNotes ?? null,
            createdByUserId: context.user.id,
            lines: {
              create: lines.map((line, index) =>
                expenseLineData(context.organizationId, index + 1, line)
              )
            }
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        await audit(tx, context, "IMMEDIATE_EXPENSE_RECORDED", "ImmediateExpense", id, {
          journalId: journal.id,
          duplicateReferenceWarning
        });
        return {
          statusCode: 201,
          body: { expense: toJson(row), duplicateReferenceWarning },
          resourceId: id
        };
      }
    );
  }

  public async reverseImmediateExpense(
    context: OrganizationContext,
    id: string,
    effectiveDate: string,
    reason: string,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "expenses:record", "ImmediateExpense", id);
    return runIdempotent(
      this.prisma,
      context,
      "immediate-expense.reverse",
      idempotencyKey,
      { id, effectiveDate, reason },
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ImmediateExpense" WHERE "id" = ${id}::uuid
          AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
        const expense = await tx.immediateExpense.findFirst({
          where: { id, organizationId: context.organizationId }
        });
        if (!expense)
          throw new AppError(
            "IMMEDIATE_EXPENSE_NOT_FOUND",
            "Immediate expense was not found.",
            404
          );
        if (expense.reversedJournalId)
          throw new AppError(
            "IMMEDIATE_EXPENSE_ALREADY_REVERSED",
            "Expense is already reversed.",
            409
          );
        const reversal = await this.journals.reverseJournalInTransaction(
          tx,
          context,
          expense.journalId,
          { effectiveDate, reason },
          "immediate_expense_reversal",
          id,
          `immediate-expense:reverse:${id}`
        );
        const updated = await tx.immediateExpense.update({
          where: { id },
          data: { reversedJournalId: reversal.id }
        });
        await audit(tx, context, "IMMEDIATE_EXPENSE_REVERSED", "ImmediateExpense", id, {
          reversalJournalId: reversal.id,
          reason
        });
        return { statusCode: 200, body: { expense: toJson(updated) }, resourceId: id };
      }
    );
  }

  public async recordBillPayment(
    context: OrganizationContext,
    input: {
      vendorId: string;
      paymentDate: string;
      amountMinor: string;
      currency?: string | undefined;
      fxRateSnapshotId?: string | undefined;
      method: ImmediateExpenseInput["method"];
      payingAccountId: string;
      reference?: string | null | undefined;
      allocations: readonly { billId: string; amountMinor: string }[];
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "bills:pay", "BillPayment");
    return runIdempotent(
      this.prisma,
      context,
      "bill-payment.record",
      idempotencyKey,
      input,
      async (tx) => {
        const amount = parseMinorUnit(input.amountMinor, "amountMinor");
        if (amount <= 0n)
          throw new AppError("PAYMENT_AMOUNT_INVALID", "Payment must be positive.", 422);
        await activeVendor(tx, context.organizationId, input.vendorId);
        const paying = await paymentAccount(tx, context.organizationId, input.payingAccountId);
        const ap = await controlAccount(
          tx,
          context.organizationId,
          "accounts-payable",
          "LIABILITY"
        );
        const allocations = input.allocations.map((allocation) => ({
          ...allocation,
          amount: parseMinorUnit(allocation.amountMinor, "allocation.amountMinor")
        }));
        if (
          allocations.length === 0 ||
          sumMinorUnits(allocations.map((row) => row.amount)) !== amount
        )
          throw new AppError(
            "PAYMENT_ALLOCATION_MISMATCH",
            "Payment allocations must be positive and equal the payment amount.",
            422
          );
        if (new Set(allocations.map((row) => row.billId)).size !== allocations.length)
          throw new AppError("DUPLICATE_BILL_ALLOCATION", "Each bill may be allocated once.", 422);
        const bills = [];
        for (const allocation of allocations) {
          if (allocation.amount <= 0n)
            throw new AppError("ALLOCATION_AMOUNT_INVALID", "Allocations must be positive.", 422);
          const bill = await lockBill(tx, context.organizationId, allocation.billId);
          if (bill.vendorId !== input.vendorId)
            throw new AppError(
              "PAYMENT_VENDOR_MISMATCH",
              "All bills must belong to the payment vendor.",
              422
            );
          const outstanding = bill.grandTotalMinor - bill.amountPaidMinor - bill.creditedMinor;
          if (allocation.amount > outstanding)
            throw new AppError("PAYMENT_EXCEEDS_BALANCE", "Payment exceeds a bill balance.", 409);
          bills.push({ bill, amount: allocation.amount });
        }
        const id = randomUUID();
        const date = parseDate(input.paymentDate, "paymentDate");
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: context.organizationId },
          select: { currency: true }
        });
        const baseCurrency = organization.currency.trim();
        const paymentCurrency = bills[0]!.bill.currency.trim();
        if (bills.some(({ bill }) => bill.currency.trim() !== paymentCurrency))
          throw new AppError(
            "PAYMENT_CURRENCY_MISMATCH",
            "All bill allocations in one payment must use the same currency.",
            422
          );
        if (input.currency && input.currency.trim().toUpperCase() !== paymentCurrency)
          throw new AppError(
            "PAYMENT_CURRENCY_MISMATCH",
            "Payment currency must match the selected bills.",
            422
          );
        let settlementRate: BillRate | null = null;
        let paymentBaseMinor = amount;
        let foreignCashDisposals: {
          sourceId: string;
          transactionMinor: bigint;
          carryingBaseRelievedMinor: bigint;
          settlementBaseMinor: bigint;
          realizedFxBaseMinor: bigint;
        }[] = [];
        let settlementAmounts = bills.map(({ bill, amount: allocationAmount }) => ({
          bill,
          transactionMinor: allocationAmount,
          carryingBaseRelievedMinor: allocationAmount,
          settlementBaseMinor: allocationAmount,
          realizedFxBaseMinor: 0n
        }));
        let realizedGainAccountId: string | null = null;
        let realizedLossAccountId: string | null = null;
        if (paymentCurrency !== baseCurrency) {
          if (!input.fxRateSnapshotId)
            throw new AppError(
              "FX_RATE_REQUIRED",
              "A documented settlement-rate snapshot is required for a foreign bill payment.",
              422
            );
          const snapshot = await tx.fxRateSnapshot.findFirst({
            where: { id: input.fxRateSnapshotId, organizationId: context.organizationId },
            select: {
              id: true,
              transactionCurrency: true,
              baseCurrency: true,
              transactionExponent: true,
              baseExponent: true,
              numerator: true,
              denominator: true,
              purpose: true,
              effectiveAt: true
            }
          });
          if (
            !snapshot ||
            snapshot.transactionCurrency.trim() !== paymentCurrency ||
            snapshot.baseCurrency.trim() !== baseCurrency ||
            !["TRANSACTION", "ACTUAL_SETTLEMENT"].includes(snapshot.purpose) ||
            snapshot.effectiveAt.toISOString().slice(0, 10) !== input.paymentDate
          )
            throw new AppError(
              "FX_RATE_CURRENCY_MISMATCH",
              "Settlement rate does not match the bill and base currencies.",
              422
            );
          settlementRate = {
            ...snapshot,
            transactionCurrency: snapshot.transactionCurrency.trim(),
            baseCurrency: snapshot.baseCurrency.trim()
          };
          const linkedBank = await tx.bankAccount.findFirst({
            where: {
              organizationId: context.organizationId,
              linkedLedgerAccountId: paying.id
            },
            select: { id: true, currency: true }
          });
          if (linkedBank && ![baseCurrency, paymentCurrency].includes(linkedBank.currency.trim()))
            throw new AppError(
              "BANK_PAYMENT_CURRENCY_MISMATCH",
              "The paying bank account currency must match either the bill currency or the base currency.",
              422
            );
          const settlementSpotBaseMinor = convertMinorUnits(
            amount,
            {
              code: paymentCurrency,
              exponent: settlementRate.transactionExponent,
              name: paymentCurrency
            },
            {
              code: baseCurrency,
              exponent: settlementRate.baseExponent,
              name: baseCurrency
            },
            { numerator: settlementRate.numerator, denominator: settlementRate.denominator }
          );
          const allocatedSettlementBase = allocateMinorUnits(
            settlementSpotBaseMinor,
            bills.map(({ amount: allocationAmount }) => ({ weight: allocationAmount }))
          );
          settlementAmounts = [];
          for (const [index, { bill, amount: allocationAmount }] of bills.entries()) {
            const quote = await this.monetaryPositions.quoteSettlement(tx, {
              organizationId: context.organizationId,
              positionSourceType: "bill",
              positionSourceId: bill.id,
              transactionMinor: allocationAmount,
              settlementBaseMinor: allocatedSettlementBase[index]!,
              eventDate: date
            });
            settlementAmounts.push({
              bill,
              transactionMinor: allocationAmount,
              carryingBaseRelievedMinor: quote.carryingBaseRelievedMinor,
              settlementBaseMinor: quote.settlementBaseMinor,
              realizedFxBaseMinor: quote.realizedFxBaseMinor
            });
          }
          paymentBaseMinor = settlementSpotBaseMinor;
          if (linkedBank?.currency.trim() === paymentCurrency) {
            await tx.$queryRaw`
              SELECT "id"
              FROM "MonetaryPosition"
              WHERE "organizationId" = ${context.organizationId}::uuid
                AND "accountId" = ${paying.id}::uuid
                AND "kind" = 'BANK'::"MonetaryPositionKind"
                AND trim("currency") = ${paymentCurrency}
                AND "active" = true
              ORDER BY "asOfDate" ASC, "id" ASC
              FOR UPDATE
            `;
            const cashPositions = await tx.monetaryPosition.findMany({
              where: {
                organizationId: context.organizationId,
                accountId: paying.id,
                kind: "BANK",
                currency: paymentCurrency,
                active: true
              },
              orderBy: [{ asOfDate: "asc" }, { id: "asc" }]
            });
            const consumptions: { sourceId: string; transactionMinor: bigint }[] = [];
            let remaining = amount;
            for (const position of cashPositions) {
              if (remaining === 0n) break;
              const transactionMinor =
                position.outstandingTransactionMinor < remaining
                  ? position.outstandingTransactionMinor
                  : remaining;
              consumptions.push({ sourceId: position.sourceId, transactionMinor });
              remaining -= transactionMinor;
            }
            if (remaining !== 0n)
              throw new AppError(
                "FOREIGN_CASH_POSITION_INSUFFICIENT",
                `The ${paymentCurrency} bank account does not have enough tracked foreign-cash lots for this payment.`,
                409,
                { shortageMinor: remaining.toString() }
              );
            const allocatedCashSpotBase = allocateMinorUnits(
              settlementSpotBaseMinor,
              consumptions.map((consumption) => ({ weight: consumption.transactionMinor }))
            );
            foreignCashDisposals = [];
            for (const [index, consumption] of consumptions.entries()) {
              const quote = await this.monetaryPositions.quoteSettlement(tx, {
                organizationId: context.organizationId,
                positionSourceType: "foreign_receipt",
                positionSourceId: consumption.sourceId,
                transactionMinor: consumption.transactionMinor,
                settlementBaseMinor: allocatedCashSpotBase[index]!,
                eventDate: date
              });
              foreignCashDisposals.push({
                sourceId: consumption.sourceId,
                transactionMinor: consumption.transactionMinor,
                carryingBaseRelievedMinor: quote.carryingBaseRelievedMinor,
                settlementBaseMinor: quote.settlementBaseMinor,
                realizedFxBaseMinor: quote.realizedFxBaseMinor
              });
            }
            paymentBaseMinor = foreignCashDisposals.reduce(
              (sum, disposal) => sum + disposal.carryingBaseRelievedMinor,
              0n
            );
          }
          realizedGainAccountId =
            (
              await tx.account.findFirst({
                where: {
                  organizationId: context.organizationId,
                  systemPurpose: "realized-fx-gain",
                  isArchived: false
                },
                select: { id: true }
              })
            )?.id ?? null;
          realizedLossAccountId =
            (
              await tx.account.findFirst({
                where: {
                  organizationId: context.organizationId,
                  systemPurpose: "realized-fx-loss",
                  isArchived: false
                },
                select: { id: true }
              })
            )?.id ?? null;
          if (!realizedGainAccountId || !realizedLossAccountId)
            throw new AppError(
              "FX_SETTLEMENT_ACCOUNTS_REQUIRED",
              "Realized FX gain and loss accounts must be configured before settlement.",
              422
            );
        }
        const journalLines: PostJournalInput["lines"][number][] = settlementAmounts.map(
          (settlement) => ({
            accountId: ap.id,
            description: `Accounts payable settlement ${settlement.bill.vendorInvoiceNumber}`,
            debitMinor: settlement.carryingBaseRelievedMinor.toString(),
            creditMinor: "0",
            transactionMinor: settlementRate ? settlement.transactionMinor.toString() : undefined,
            fxRateSnapshotId: settlement.bill.fxRateSnapshotId ?? undefined,
            conversionPolicy: settlementRate ? "CARRYING_VALUE" : undefined
          })
        );
        journalLines.push({
          accountId: paying.id,
          description: "Vendor payment",
          debitMinor: "0",
          creditMinor: paymentBaseMinor.toString(),
          transactionMinor: settlementRate ? (-amount).toString() : undefined,
          conversionPolicy: foreignCashDisposals.length > 0 ? "CARRYING_VALUE" : undefined
        });
        for (const settlement of settlementAmounts) {
          if (settlement.realizedFxBaseMinor > 0n)
            journalLines.push({
              accountId: realizedGainAccountId!,
              description: "Realized FX gain on payable settlement",
              debitMinor: "0",
              creditMinor: settlement.realizedFxBaseMinor.toString()
            });
          if (settlement.realizedFxBaseMinor < 0n)
            journalLines.push({
              accountId: realizedLossAccountId!,
              description: "Realized FX loss on payable settlement",
              debitMinor: (-settlement.realizedFxBaseMinor).toString(),
              creditMinor: "0"
            });
        }
        for (const disposal of foreignCashDisposals) {
          if (disposal.realizedFxBaseMinor > 0n)
            journalLines.push({
              accountId: realizedGainAccountId!,
              description: "Realized FX gain on foreign cash disposal",
              debitMinor: "0",
              creditMinor: disposal.realizedFxBaseMinor.toString()
            });
          if (disposal.realizedFxBaseMinor < 0n)
            journalLines.push({
              accountId: realizedLossAccountId!,
              description: "Realized FX loss on foreign cash disposal",
              debitMinor: (-disposal.realizedFxBaseMinor).toString(),
              creditMinor: "0"
            });
        }
        const journal = await this.journals.postJournalInTransaction(
          tx,
          context,
          {
            description: `Vendor payment ${input.reference?.trim() || id}`,
            effectiveDate: input.paymentDate,
            sourceType: "bill_payment",
            sourceId: id,
            postingKey: `bill-payment:${id}`,
            transactionCurrency: settlementRate ? paymentCurrency : undefined,
            fxRateSnapshotId: settlementRate?.id,
            allowControlAccountPosting: true,
            lines: journalLines
          },
          true
        );
        if (settlementRate) {
          for (const settlement of settlementAmounts) {
            await this.monetaryPositions.settle(tx, {
              organizationId: context.organizationId,
              positionSourceType: "bill",
              positionSourceId: settlement.bill.id,
              transactionMinor: settlement.transactionMinor,
              settlementBaseMinor: settlement.settlementBaseMinor,
              eventDate: date,
              rateSnapshotId: settlementRate.id,
              journalId: journal.id,
              sourceType: "bill_payment",
              sourceId: `${id}:${settlement.bill.id}`
            });
          }
          for (const disposal of foreignCashDisposals) {
            await this.monetaryPositions.settle(tx, {
              organizationId: context.organizationId,
              positionSourceType: "foreign_receipt",
              positionSourceId: disposal.sourceId,
              transactionMinor: disposal.transactionMinor,
              settlementBaseMinor: disposal.settlementBaseMinor,
              eventDate: date,
              rateSnapshotId: settlementRate.id,
              journalId: journal.id,
              sourceType: "bill_payment_cash_disposal",
              sourceId: `${id}:${disposal.sourceId}`
            });
          }
        }
        const payment = await tx.billPayment.create({
          data: {
            id,
            organizationId: context.organizationId,
            vendorId: input.vendorId,
            paymentDate: date,
            amountMinor: amount,
            unappliedMinor: 0n,
            currency: paymentCurrency,
            fxRateSnapshotId: settlementRate?.id ?? null,
            method: input.method,
            payingAccountId: paying.id,
            reference: input.reference?.trim() ?? null,
            journalId: journal.id,
            createdByUserId: context.user.id,
            allocations: {
              create: settlementAmounts.map((settlement) => ({
                organizationId: context.organizationId,
                billId: settlement.bill.id,
                amountMinor: settlement.transactionMinor,
                carryingBaseRelievedMinor: settlement.carryingBaseRelievedMinor,
                settlementBaseMinor: settlement.settlementBaseMinor,
                realizedFxBaseMinor: settlement.realizedFxBaseMinor
              }))
            }
          },
          include: { allocations: true }
        });
        for (const { bill, amount: allocationAmount } of bills) {
          const paid = bill.amountPaidMinor + allocationAmount;
          const settled = paid + bill.creditedMinor === bill.grandTotalMinor;
          await tx.bill.update({
            where: { id: bill.id },
            data: {
              amountPaidMinor: paid,
              status: settled ? "PAID" : "PARTIALLY_PAID",
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            }
          });
        }
        await audit(tx, context, "BILL_PAYMENT_RECORDED", "BillPayment", id, {
          journalId: journal.id,
          amountMinor: amount.toString()
        });
        return { statusCode: 201, body: { payment: toJson(payment) }, resourceId: id };
      }
    );
  }

  public async reverseBillPayment(
    context: OrganizationContext,
    id: string,
    effectiveDate: string,
    reason: string,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "bills:pay", "BillPayment", id);
    return runIdempotent(
      this.prisma,
      context,
      "bill-payment.reverse",
      idempotencyKey,
      { paymentId: id, effectiveDate, reason },
      async (tx) => {
        const rows = await tx.$queryRaw<readonly { id: string }[]>`
          SELECT "id" FROM "BillPayment"
          WHERE "id" = ${id}::uuid AND "organizationId" = ${context.organizationId}::uuid
          FOR UPDATE`;
        if (!rows[0])
          throw new AppError("BILL_PAYMENT_NOT_FOUND", "Bill payment was not found.", 404);
        const payment = await tx.billPayment.findUniqueOrThrow({
          where: { id },
          include: { allocations: true }
        });
        if (payment.reversedJournalId)
          throw new AppError("BILL_PAYMENT_ALREADY_REVERSED", "Payment is already reversed.", 409);
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: context.organizationId },
          select: { currency: true }
        });
        if (payment.currency.trim() !== organization.currency.trim())
          throw new AppError(
            "FOREIGN_SETTLEMENT_REVERSAL_REQUIRES_CORRECTION",
            "Foreign settlement reversal requires a linked monetary-position correction and is not available in this release.",
            409
          );
        for (const allocation of payment.allocations)
          await lockBill(tx, context.organizationId, allocation.billId);
        const reversal = await this.journals.reverseJournalInTransaction(
          tx,
          context,
          payment.journalId,
          { effectiveDate, reason },
          "bill_payment_reversal",
          id,
          `bill-payment:reverse:${id}`
        );
        const updated = await tx.billPayment.update({
          where: { id },
          data: { reversedJournalId: reversal.id, version: { increment: 1 } }
        });
        for (const allocation of payment.allocations) {
          const bill = await tx.bill.findUniqueOrThrow({ where: { id: allocation.billId } });
          const paid = bill.amountPaidMinor - allocation.amountMinor;
          await tx.bill.update({
            where: { id: bill.id },
            data: {
              amountPaidMinor: paid,
              status: paid === 0n && bill.creditedMinor === 0n ? "POSTED" : "PARTIALLY_PAID",
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            }
          });
        }
        await audit(tx, context, "BILL_PAYMENT_REVERSED", "BillPayment", id, {
          reversalJournalId: reversal.id,
          reason
        });
        return { statusCode: 200, body: { payment: toJson(updated) }, resourceId: id };
      }
    );
  }

  public async createVendorCredit(
    context: OrganizationContext,
    input: {
      vendorId: string;
      vendorCreditNumber: string;
      issueDate: string;
      reason: string;
      lines: readonly {
        billLineId?: string | null | undefined;
        description?: string | undefined;
        amountMinor?: string | undefined;
        accountId?: string | undefined;
      }[];
    }
  ) {
    await this.authorization.assert(context, "vendor-credits:create", "VendorCredit");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await activeVendor(tx, context.organizationId, input.vendorId);
      const lines = [];
      for (const request of input.lines) {
        if (!request.billLineId)
          throw new AppError(
            "VENDOR_CREDIT_SOURCE_REQUIRED",
            "Phase 7 vendor credits must reference an original bill line.",
            422
          );
        const source = await tx.billLine.findFirst({
          where: {
            id: request.billLineId,
            organizationId: context.organizationId,
            bill: { vendorId: input.vendorId, status: { notIn: ["DRAFT", "APPROVED", "VOIDED"] } }
          }
        });
        if (!source)
          throw new AppError("BILL_LINE_NOT_CREDITABLE", "Bill line is not creditable.", 422);
        const previous = await tx.vendorCreditLine.aggregate({
          where: { billLineId: source.id, vendorCredit: { status: { in: ["POSTED", "APPLIED"] } } },
          _sum: { totalMinor: true }
        });
        const remaining = source.totalMinor - (previous._sum.totalMinor ?? 0n);
        const total = request.amountMinor
          ? parseMinorUnit(request.amountMinor, "amountMinor")
          : remaining;
        if (total <= 0n || total > remaining)
          throw new AppError(
            "CREDIT_EXCEEDS_ELIGIBLE_VALUE",
            "Credit exceeds the original line.",
            409
          );
        const taxAllocation = allocateTaxAdjustment({
          sourceNetMinor: source.netAmountMinor,
          sourceTaxTotalMinor: source.taxTotalMinor,
          sourceRecoverableTaxMinor: source.recoverableTaxMinor,
          sourceTotalMinor: source.totalMinor,
          allocationTotalMinor: total,
          purpose: "CREDIT",
          sourceSnapshot: source.taxSnapshot
        });
        lines.push({
          billLineId: source.id,
          lineNumber: lines.length + 1,
          description: request.description?.trim() || source.description,
          netAmountMinor: taxAllocation.netMinor,
          recoverableTaxMinor: taxAllocation.recoverableTaxMinor,
          nonRecoverableTaxMinor: taxAllocation.nonRecoverableTaxMinor,
          taxTotalMinor: taxAllocation.taxTotalMinor,
          totalMinor: total,
          accountId: source.accountId,
          taxSnapshot: taxAllocation.snapshot
        });
      }
      const totals = creditTotals(lines);
      const row = await tx.vendorCredit.create({
        data: {
          organizationId: context.organizationId,
          vendorId: input.vendorId,
          vendorCreditNumber: input.vendorCreditNumber.trim(),
          issueDate: parseDate(input.issueDate, "issueDate"),
          reason: input.reason.trim(),
          ...totals,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id,
          lines: {
            create: lines.map((line) => ({
              ...line,
              organizationId: context.organizationId,
              taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull
            }))
          }
        },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      await audit(tx, context, "VENDOR_CREDIT_DRAFT_CREATED", "VendorCredit", row.id, {
        grandTotalMinor: totals.grandTotalMinor.toString()
      });
      return toJson(row);
    });
  }

  public async postVendorCredit(
    context: OrganizationContext,
    id: string,
    version: number,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "vendor-credits:create", "VendorCredit", id);
    return runIdempotent(
      this.prisma,
      context,
      "vendor-credit.post",
      idempotencyKey,
      { id, version },
      async (tx) => {
        const rows = await tx.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "VendorCredit"
        WHERE "id" = ${id}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
        if (!rows[0])
          throw new AppError("VENDOR_CREDIT_NOT_FOUND", "Vendor credit was not found.", 404);
        const credit = await tx.vendorCredit.findUniqueOrThrow({
          where: { id },
          include: { lines: true }
        });
        if (credit.status !== "DRAFT" || credit.version !== version)
          throw new AppError("STALE_VENDOR_CREDIT", "Vendor credit is posted or was changed.", 409);
        const ap = await controlAccount(
          tx,
          context.organizationId,
          "accounts-payable",
          "LIABILITY"
        );
        const journalLines: PostJournalInput["lines"][number][] = [
          { accountId: ap.id, debitMinor: credit.grandTotalMinor.toString(), creditMinor: "0" }
        ];
        const credits = new Map<string, bigint>();
        for (const line of credit.lines) {
          credits.set(
            line.accountId,
            (credits.get(line.accountId) ?? 0n) + line.netAmountMinor + line.nonRecoverableTaxMinor
          );
          for (const component of snapshotComponents(line.taxSnapshot)) {
            if (component.recoverableMinor > 0n && component.recoverableAccountId)
              credits.set(
                component.recoverableAccountId,
                (credits.get(component.recoverableAccountId) ?? 0n) + component.recoverableMinor
              );
          }
        }
        for (const [accountId, amount] of credits)
          journalLines.push({ accountId, debitMinor: "0", creditMinor: amount.toString() });
        const journal = await this.journals.postJournalInTransaction(
          tx,
          context,
          {
            description: `Vendor credit ${credit.vendorCreditNumber}`,
            effectiveDate: credit.issueDate.toISOString().slice(0, 10),
            sourceType: "vendor_credit",
            sourceId: id,
            postingKey: `vendor-credit:${id}`,
            allowControlAccountPosting: true,
            lines: journalLines
          },
          true
        );
        const posted = await tx.vendorCredit.update({
          where: { id },
          data: {
            status: "POSTED",
            journalId: journal.id,
            postedAt: new Date(),
            postedByUserId: context.user.id,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          },
          include: { lines: true }
        });
        await audit(tx, context, "VENDOR_CREDIT_POSTED", "VendorCredit", id, {
          journalId: journal.id
        });
        return { statusCode: 201, body: { vendorCredit: toJson(posted) }, resourceId: id };
      }
    );
  }

  public async applyVendorCredit(
    context: OrganizationContext,
    id: string,
    allocations: readonly { billId: string; amountMinor: string }[],
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "vendor-credits:apply", "VendorCredit", id);
    return runIdempotent(
      this.prisma,
      context,
      "vendor-credit.apply",
      idempotencyKey,
      { id, allocations },
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "VendorCredit" WHERE "id" = ${id}::uuid
        AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
        const credit = await tx.vendorCredit.findFirst({
          where: {
            id,
            organizationId: context.organizationId,
            status: { in: ["POSTED", "APPLIED"] }
          }
        });
        if (!credit)
          throw new AppError("VENDOR_CREDIT_NOT_POSTED", "Vendor credit is not posted.", 409);
        const parsed = allocations.map((row) => ({
          billId: row.billId,
          amount: parseMinorUnit(row.amountMinor, "amountMinor")
        }));
        const total = sumMinorUnits(parsed.map((row) => row.amount));
        if (total <= 0n || total > credit.grandTotalMinor - credit.appliedMinor)
          throw new AppError(
            "CREDIT_APPLICATION_EXCESSIVE",
            "Application exceeds available credit.",
            409
          );
        for (const allocation of parsed) {
          const bill = await lockBill(tx, context.organizationId, allocation.billId);
          if (bill.vendorId !== credit.vendorId || allocation.amount <= 0n)
            throw new AppError(
              "CREDIT_APPLICATION_INVALID",
              "Credit and bill must share a vendor.",
              422
            );
          const outstanding = bill.grandTotalMinor - bill.amountPaidMinor - bill.creditedMinor;
          if (allocation.amount > outstanding)
            throw new AppError("CREDIT_EXCEEDS_BILL", "Credit exceeds bill balance.", 409);
          await tx.vendorCreditApplication.create({
            data: {
              organizationId: context.organizationId,
              vendorCreditId: id,
              billId: bill.id,
              amountMinor: allocation.amount,
              appliedByUserId: context.user.id
            }
          });
          const credited = bill.creditedMinor + allocation.amount;
          const settled = credited + bill.amountPaidMinor === bill.grandTotalMinor;
          await tx.bill.update({
            where: { id: bill.id },
            data: {
              creditedMinor: credited,
              status: settled ? "CREDITED" : "PARTIALLY_CREDITED",
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            }
          });
        }
        const updated = await tx.vendorCredit.update({
          where: { id },
          data: {
            appliedMinor: { increment: total },
            status: credit.appliedMinor + total === credit.grandTotalMinor ? "APPLIED" : "POSTED",
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          },
          include: { applications: true }
        });
        await audit(tx, context, "VENDOR_CREDIT_APPLIED", "VendorCredit", id, {
          amountMinor: total.toString()
        });
        return { statusCode: 200, body: { vendorCredit: toJson(updated) }, resourceId: id };
      }
    );
  }

  public async payables(context: OrganizationContext, asOf = new Date()) {
    await this.authorization.assert(context, "payables:read", "Payables");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { currency: true }
      });
      const baseCurrency = organization.currency.trim();
      const bills = await tx.bill.findMany({
        where: {
          organizationId: context.organizationId,
          issueDate: { lte: asOf },
          status: { notIn: ["DRAFT", "APPROVED", "VOIDED"] }
        },
        include: { vendor: true },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }]
      });
      const foreignPositions = await tx.monetaryPosition.findMany({
        where: {
          organizationId: context.organizationId,
          kind: "ACCOUNTS_PAYABLE"
        },
        select: {
          sourceId: true,
          events: {
            where: { eventDate: { lte: asOf } },
            select: { carryingBaseDeltaMinor: true }
          }
        }
      });
      const foreignCarryingByBill = new Map(
        foreignPositions.map((position) => [
          position.sourceId,
          position.events.reduce((sum, event) => sum + event.carryingBaseDeltaMinor, 0n)
        ])
      );
      const open = bills
        .map((bill) => {
          const outstanding = bill.grandTotalMinor - bill.amountPaidMinor - bill.creditedMinor;
          const baseOutstanding =
            bill.currency.trim() === baseCurrency
              ? outstanding
              : (foreignCarryingByBill.get(bill.id) ?? 0n);
          return { bill, outstanding, baseOutstanding };
        })
        .filter((row) => row.outstanding > 0n);
      const buckets = { current: 0n, days1To30: 0n, days31To60: 0n, days61To90: 0n, over90: 0n };
      for (const row of open) {
        const days = Math.floor((asOf.getTime() - row.bill.dueDate.getTime()) / 86_400_000);
        if (days <= 0) buckets.current += row.baseOutstanding;
        else if (days <= 30) buckets.days1To30 += row.baseOutstanding;
        else if (days <= 60) buckets.days31To60 += row.baseOutstanding;
        else if (days <= 90) buckets.days61To90 += row.baseOutstanding;
        else buckets.over90 += row.baseOutstanding;
      }
      const subledger = open.reduce((sum, row) => sum + row.baseOutstanding, 0n);
      const ap = await controlAccount(tx, context.organizationId, "accounts-payable", "LIABILITY");
      const glRows = await tx.journalLine.aggregate({
        where: {
          organizationId: context.organizationId,
          accountId: ap.id,
          journal: { status: "POSTED", effectiveDate: { lte: asOf } }
        },
        _sum: { debitMinor: true, creditMinor: true }
      });
      const generalLedger = (glRows._sum.creditMinor ?? 0n) - (glRows._sum.debitMinor ?? 0n);
      return {
        asOf: asOf.toISOString().slice(0, 10),
        openBills: open.map(({ bill, outstanding, baseOutstanding }) => ({
          ...billDto(bill),
          outstandingMinor: outstanding.toString(),
          baseOutstandingMinor: baseOutstanding.toString()
        })),
        aging: toJson(buckets),
        subledgerBalanceMinor: subledger.toString(),
        generalLedgerBalanceMinor: generalLedger.toString(),
        discrepancyMinor: (generalLedger - subledger).toString(),
        reconciled: generalLedger === subledger
      };
    });
  }
}

function vendorData(context: OrganizationContext, input: VendorInput) {
  return {
    organizationId: context.organizationId,
    vendorNumber: input.vendorNumber.trim(),
    legalName: input.legalName.trim(),
    displayName: input.displayName.trim(),
    primaryContact: input.primaryContact ?? Prisma.JsonNull,
    additionalContacts: input.additionalContacts ?? Prisma.JsonNull,
    remittanceAddress: input.remittanceAddress ?? Prisma.JsonNull,
    serviceAddress: input.serviceAddress ?? Prisma.JsonNull,
    email: input.email ?? null,
    telephone: input.telephone ?? null,
    website: input.website ?? null,
    businessIdentifier: input.businessIdentifier ?? null,
    defaultPaymentTermsDays: input.defaultPaymentTermsDays ?? 30,
    defaultCurrency: input.defaultCurrency?.trim().toUpperCase() ?? "CAD",
    defaultExpenseAccountId: input.defaultExpenseAccountId ?? null,
    defaultTaxCodeId: input.defaultTaxCodeId ?? null,
    preferredPaymentMethod: input.preferredPaymentMethod ?? null,
    internalNotes: input.internalNotes ?? null,
    createdByUserId: context.user.id,
    updatedByUserId: context.user.id
  };
}

async function validateVendorDefaults(tx: Tx, organizationId: string, input: Partial<VendorInput>) {
  if (input.defaultCurrency !== undefined) {
    const currency = input.defaultCurrency.trim().toUpperCase();
    const enabled = await tx.$queryRaw<{ enabled: boolean }[]>`
      SELECT "enabled" FROM "OrganizationCurrency"
      WHERE "organizationId" = ${organizationId}::uuid AND "currencyCode" = ${currency}
    `;
    if (!enabled[0]?.enabled)
      throw new AppError(
        "VENDOR_CURRENCY_NOT_ENABLED",
        `Currency ${currency} is not enabled for this organization.`,
        400
      );
  }
  if (
    input.defaultExpenseAccountId &&
    !(await tx.account.findFirst({
      where: {
        id: input.defaultExpenseAccountId,
        organizationId,
        type: { in: ["EXPENSE", "ASSET"] },
        isArchived: false
      }
    }))
  )
    throw new AppError("VENDOR_ACCOUNT_INVALID", "Vendor default account is invalid.", 422);
  if (
    input.defaultTaxCodeId &&
    !(await tx.taxCode.findFirst({
      where: { id: input.defaultTaxCodeId, organizationId, active: true }
    }))
  )
    throw new AppError("VENDOR_TAX_CODE_INVALID", "Vendor default tax code is invalid.", 422);
}

async function activeVendor(tx: Tx, organizationId: string, id: string) {
  const vendor = await tx.vendor.findFirst({ where: { id, organizationId, isActive: true } });
  if (!vendor) throw new AppError("VENDOR_NOT_FOUND", "Active vendor was not found.", 422);
  return vendor;
}

async function controlAccount(tx: Tx, organizationId: string, purpose: string, type: "LIABILITY") {
  const account = await tx.account.findFirst({
    where: { organizationId, systemPurpose: purpose, type, isArchived: false, isControl: true }
  });
  if (!account)
    throw new AppError(
      "CONTROL_ACCOUNT_REQUIRED",
      `Configured ${purpose} control account is required.`,
      422
    );
  return account;
}

async function paymentAccount(tx: Tx, organizationId: string, id: string) {
  const account = await tx.account.findFirst({
    where: {
      id,
      organizationId,
      isArchived: false,
      type: { in: ["ASSET", "LIABILITY", "EQUITY"] }
    }
  });
  if (!account || account.systemPurpose === "accounts-receivable")
    throw new AppError("PAYING_ACCOUNT_INVALID", "Paying account is invalid.", 422);
  return account;
}

async function calculateLines(
  tx: Tx,
  organizationId: string,
  date: Date,
  inputs: readonly PurchaseLineInput[]
) {
  if (inputs.length === 0)
    throw new AppError("PURCHASE_LINES_REQUIRED", "At least one line is required.", 422);
  return Promise.all(inputs.map((input) => calculatePurchaseLine(tx, organizationId, date, input)));
}

function purchaseTotals(lines: readonly CalculatedPurchaseLine[]) {
  return {
    subtotalMinor: sumMinorUnits(lines.map((line) => line.grossAmountMinor)),
    discountTotalMinor: sumMinorUnits(lines.map((line) => line.discountMinor)),
    recoverableTaxMinor: sumMinorUnits(lines.map((line) => line.recoverableTaxMinor)),
    nonRecoverableTaxMinor: sumMinorUnits(lines.map((line) => line.nonRecoverableTaxMinor)),
    taxTotalMinor: sumMinorUnits(lines.map((line) => line.taxTotalMinor)),
    grandTotalMinor: sumMinorUnits(lines.map((line) => line.totalMinor))
  };
}

function creditTotals(
  lines: readonly {
    netAmountMinor: bigint;
    recoverableTaxMinor: bigint;
    nonRecoverableTaxMinor: bigint;
    taxTotalMinor: bigint;
    totalMinor: bigint;
  }[]
) {
  return {
    subtotalMinor: sumMinorUnits(lines.map((line) => line.netAmountMinor)),
    recoverableTaxMinor: sumMinorUnits(lines.map((line) => line.recoverableTaxMinor)),
    nonRecoverableTaxMinor: sumMinorUnits(lines.map((line) => line.nonRecoverableTaxMinor)),
    taxTotalMinor: sumMinorUnits(lines.map((line) => line.taxTotalMinor)),
    grandTotalMinor: sumMinorUnits(lines.map((line) => line.totalMinor))
  };
}

function billLineData(organizationId: string, lineNumber: number, line: CalculatedPurchaseLine) {
  return {
    organizationId,
    lineNumber,
    description: line.description,
    quantityMicros: line.quantityMicros,
    unitCostMinor: line.unitCostMinor,
    grossAmountMinor: line.grossAmountMinor,
    discountMinor: line.discountMinor,
    netAmountMinor: line.netAmountMinor,
    recoverableTaxMinor: line.recoverableTaxMinor,
    nonRecoverableTaxMinor: line.nonRecoverableTaxMinor,
    taxTotalMinor: line.taxTotalMinor,
    totalMinor: line.totalMinor,
    accountId: line.accountId,
    accountCode: line.accountCode,
    accountName: line.accountName,
    taxCodeId: line.taxCodeId,
    taxCodeVersionId: line.taxCodeVersionId,
    taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull,
    inventoryPlaceholder: line.inventoryPlaceholder,
    productItemId: line.productItemId
  };
}

function expenseLineData(organizationId: string, lineNumber: number, line: CalculatedPurchaseLine) {
  return {
    organizationId,
    ...expenseLineValues(lineNumber, line)
  };
}

function expenseLineValues(lineNumber: number, line: CalculatedPurchaseLine) {
  return {
    lineNumber,
    description: line.description,
    quantityMicros: line.quantityMicros,
    unitCostMinor: line.unitCostMinor,
    discountMinor: line.discountMinor,
    netAmountMinor: line.netAmountMinor,
    recoverableTaxMinor: line.recoverableTaxMinor,
    nonRecoverableTaxMinor: line.nonRecoverableTaxMinor,
    taxTotalMinor: line.taxTotalMinor,
    totalMinor: line.totalMinor,
    accountId: line.accountId,
    taxCodeId: line.taxCodeId,
    taxCodeVersionId: line.taxCodeVersionId,
    taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull
  };
}

function expenseDraftLineData(lineNumber: number, line: CalculatedPurchaseLine) {
  return expenseLineValues(lineNumber, line);
}

function purchaseJournal(
  sourceType: string,
  sourceId: string,
  date: Date,
  description: string,
  lines: readonly {
    accountId: string;
    description: string;
    netAmountMinor: bigint;
    nonRecoverableTaxMinor: bigint;
    taxSnapshot: Prisma.JsonValue | Prisma.InputJsonValue | null;
  }[],
  total: bigint,
  creditAccountId: string,
  currency = "CAD",
  fxRate: BillRate | null = null
): PostJournalInput {
  const debits = new Map<string, { amount: bigint; description: string }>();
  for (const line of lines) {
    const amount = line.netAmountMinor + line.nonRecoverableTaxMinor;
    const existing = debits.get(line.accountId);
    debits.set(line.accountId, {
      amount: (existing?.amount ?? 0n) + amount,
      description: existing?.description ?? line.description
    });
    for (const component of snapshotComponents(line.taxSnapshot)) {
      if (component.recoverableMinor > 0n && component.recoverableAccountId) {
        const recoverable = debits.get(component.recoverableAccountId);
        debits.set(component.recoverableAccountId, {
          amount: (recoverable?.amount ?? 0n) + component.recoverableMinor,
          description: `${component.name} recoverable`
        });
      }
    }
  }
  const transactionCurrency = currency.trim().toUpperCase();
  const baseCurrency = fxRate?.baseCurrency.trim().toUpperCase() ?? "CAD";
  const rawLines: PostJournalInput["lines"] = [
    ...[...debits].map(([accountId, value]) => ({
      accountId,
      description: value.description,
      debitMinor: value.amount.toString(),
      creditMinor: "0"
    })),
    { accountId: creditAccountId, description, debitMinor: "0", creditMinor: total.toString() }
  ];
  const convertedLines =
    fxRate && transactionCurrency !== baseCurrency
      ? (() => {
          const transactionComponents = rawLines.map(
            (line) => BigInt(line.debitMinor) - BigInt(line.creditMinor)
          );
          const baseComponents = convertBalancedComponents(
            transactionComponents,
            {
              code: transactionCurrency,
              exponent: fxRate.transactionExponent,
              name: transactionCurrency
            },
            { code: baseCurrency, exponent: fxRate.baseExponent, name: baseCurrency },
            { numerator: fxRate.numerator, denominator: fxRate.denominator }
          );
          return rawLines.map((line, index) => {
            const transactionMinor = transactionComponents[index]!;
            const baseMinor = baseComponents[index]!;
            return {
              ...line,
              debitMinor: baseMinor > 0n ? baseMinor.toString() : "0",
              creditMinor: baseMinor < 0n ? (-baseMinor).toString() : "0",
              transactionMinor: transactionMinor.toString()
            };
          });
        })()
      : rawLines;
  return {
    description,
    effectiveDate: date.toISOString().slice(0, 10),
    sourceType,
    sourceId,
    postingKey: `${sourceType}:${sourceId}`,
    transactionCurrency:
      fxRate && transactionCurrency !== baseCurrency ? transactionCurrency : undefined,
    fxRateSnapshotId: fxRate && transactionCurrency !== baseCurrency ? fxRate.id : undefined,
    allowControlAccountPosting: true,
    lines: convertedLines
  };
}

interface BillRate {
  readonly id: string;
  readonly transactionCurrency: string;
  readonly baseCurrency: string;
  readonly transactionExponent: number;
  readonly baseExponent: number;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function billBaseAmounts(
  lines: readonly {
    grossAmountMinor: bigint;
    discountMinor: bigint;
    netAmountMinor: bigint;
    recoverableTaxMinor: bigint;
    nonRecoverableTaxMinor: bigint;
    taxTotalMinor: bigint;
    totalMinor: bigint;
  }[],
  totals: {
    subtotalMinor: bigint;
    discountTotalMinor: bigint;
    recoverableTaxMinor: bigint;
    nonRecoverableTaxMinor: bigint;
    taxTotalMinor: bigint;
    grandTotalMinor: bigint;
  },
  currency: string,
  fxRate: BillRate | null
) {
  if (!fxRate || currency.trim().toUpperCase() === fxRate.baseCurrency.trim().toUpperCase()) {
    return {
      baseSubtotalMinor: totals.subtotalMinor,
      baseDiscountTotalMinor: totals.discountTotalMinor,
      baseRecoverableTaxMinor: totals.recoverableTaxMinor,
      baseNonRecoverableTaxMinor: totals.nonRecoverableTaxMinor,
      baseTaxTotalMinor: totals.taxTotalMinor,
      baseGrandTotalMinor: totals.grandTotalMinor,
      lines: lines.map((line) => ({
        baseGrossAmountMinor: line.grossAmountMinor,
        baseDiscountMinor: line.discountMinor,
        baseNetAmountMinor: line.netAmountMinor,
        baseRecoverableTaxMinor: line.recoverableTaxMinor,
        baseNonRecoverableTaxMinor: line.nonRecoverableTaxMinor,
        baseTaxTotalMinor: line.taxTotalMinor,
        baseTotalMinor: line.totalMinor
      }))
    };
  }
  const transactionCurrency = {
    code: currency.trim().toUpperCase(),
    exponent: fxRate.transactionExponent,
    name: currency.trim().toUpperCase()
  };
  const baseCurrency = {
    code: fxRate.baseCurrency.trim().toUpperCase(),
    exponent: fxRate.baseExponent,
    name: fxRate.baseCurrency.trim().toUpperCase()
  };
  const rate = { numerator: fxRate.numerator, denominator: fxRate.denominator };
  const baseGrandTotalMinor = convertMinorUnits(
    totals.grandTotalMinor,
    transactionCurrency,
    baseCurrency,
    rate
  );
  const baseLineTotals = allocateMinorUnits(
    baseGrandTotalMinor,
    lines.map((line) => ({ weight: line.totalMinor }))
  );
  const convertedLines = lines.map((line, index) => {
    const components = allocateMinorUnits(baseLineTotals[index]!, [
      { weight: line.netAmountMinor },
      { weight: line.recoverableTaxMinor },
      { weight: line.nonRecoverableTaxMinor }
    ]);
    const baseDiscountMinor = convertMinorUnits(
      line.discountMinor,
      transactionCurrency,
      baseCurrency,
      rate
    );
    const baseNetAmountMinor = components[0]!;
    const baseRecoverableTaxMinor = components[1]!;
    const baseNonRecoverableTaxMinor = components[2]!;
    return {
      baseGrossAmountMinor: baseNetAmountMinor + baseDiscountMinor,
      baseDiscountMinor,
      baseNetAmountMinor,
      baseRecoverableTaxMinor,
      baseNonRecoverableTaxMinor,
      baseTaxTotalMinor: baseRecoverableTaxMinor + baseNonRecoverableTaxMinor,
      baseTotalMinor: baseLineTotals[index]!
    };
  });
  return {
    baseSubtotalMinor: sumMinorUnits(convertedLines.map((line) => line.baseGrossAmountMinor)),
    baseDiscountTotalMinor: sumMinorUnits(convertedLines.map((line) => line.baseDiscountMinor)),
    baseRecoverableTaxMinor: sumMinorUnits(
      convertedLines.map((line) => line.baseRecoverableTaxMinor)
    ),
    baseNonRecoverableTaxMinor: sumMinorUnits(
      convertedLines.map((line) => line.baseNonRecoverableTaxMinor)
    ),
    baseTaxTotalMinor: sumMinorUnits(convertedLines.map((line) => line.baseTaxTotalMinor)),
    baseGrandTotalMinor,
    lines: convertedLines
  };
}

function snapshotComponents(snapshot: Prisma.JsonValue | Prisma.InputJsonValue | null) {
  const value = snapshot as {
    components?: readonly {
      name: string;
      recoverableAccountId: string | null;
      recoverableMinor: string;
    }[];
  } | null;
  return (value?.components ?? []).map((component) => ({
    ...component,
    recoverableMinor: BigInt(component.recoverableMinor)
  }));
}

async function lockBill(tx: Tx, organizationId: string, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Bill" WHERE "id" = ${id}::uuid
    AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
  const row = await tx.bill.findFirst({
    where: { id, organizationId },
    include: { lines: { orderBy: { lineNumber: "asc" } } }
  });
  if (!row) throw new AppError("BILL_NOT_FOUND", "Bill was not found.", 404);
  return row;
}

type JsonSafe = string | number | boolean | null | JsonSafeObject | JsonSafe[];
interface JsonSafeObject {
  [key: string]: JsonSafe;
}

function billDto(
  row: object & {
    grandTotalMinor: bigint;
    amountPaidMinor: bigint;
    creditedMinor: bigint;
  }
): JsonSafeObject {
  const json = toJson(row);
  if (!json || Array.isArray(json) || typeof json !== "object")
    throw new AppError("SERIALIZATION_ERROR", "Bill could not be serialized.", 500);
  return {
    ...json,
    outstandingMinor: (row.grandTotalMinor - row.amountPaidMinor - row.creditedMinor).toString()
  };
}

function immediateExpenseDraftDto(row: object): JsonSafeObject {
  const json = toJson(row);
  if (!json || Array.isArray(json) || typeof json !== "object")
    throw new AppError(
      "SERIALIZATION_ERROR",
      "Immediate expense draft could not be serialized.",
      500
    );
  return { ...json, status: "DRAFT" };
}

function conversionDto(row: {
  id: string;
  captureReviewId: string;
  captureReviewVersion: number;
  targetType: string;
  billId: string | null;
  immediateExpenseDraftId: string | null;
  convertedByUserId: string;
  createdAt: Date;
}): JsonSafeObject {
  return {
    id: row.id,
    captureReviewId: row.captureReviewId,
    captureReviewVersion: row.captureReviewVersion,
    targetType: row.targetType,
    targetId: row.billId ?? row.immediateExpenseDraftId,
    billId: row.billId,
    immediateExpenseDraftId: row.immediateExpenseDraftId,
    convertedByUserId: row.convertedByUserId,
    createdAt: row.createdAt.toISOString()
  };
}

function captureEvidenceDto(row: {
  id: string;
  projectId: string | null;
  kind: string;
  checksum: string;
  mediaType: string;
  byteSize: number;
  extractedData: Prisma.JsonValue | null;
}): JsonSafeObject {
  const extraction =
    row.extractedData && typeof row.extractedData === "object" && !Array.isArray(row.extractedData)
      ? (row.extractedData as Record<string, unknown>).localExtraction
      : null;
  const provenance =
    extraction && typeof extraction === "object" && !Array.isArray(extraction)
      ? {
          engine: toJson((extraction as Record<string, unknown>).engine ?? null),
          schemaVersion: toJson((extraction as Record<string, unknown>).schemaVersion ?? null),
          processingState: toJson((extraction as Record<string, unknown>).processingState ?? null)
        }
      : null;
  return {
    captureReviewId: row.id,
    projectId: row.projectId,
    kind: row.kind,
    checksum: row.checksum,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    extractionProvenance: provenance,
    contentPath: `/v1/capture-reviews/${row.id}/content`
  };
}

function toJson(value: unknown): JsonSafe {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  if (value === null || ["string", "number", "boolean"].includes(typeof value))
    return value as string | number | boolean | null;
  return null;
}

function cleanUndefined(value: object) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function jsonOrUndefined(value: Prisma.InputJsonValue | undefined) {
  return value;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
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

async function outbox(
  tx: Tx,
  organizationId: string,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Prisma.InputJsonObject
) {
  await tx.outboxEvent.create({
    data: { organizationId, eventType, aggregateType, aggregateId, payload }
  });
}

function throwUnique(error: unknown, code: string, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new AppError(code, message, 409);
  throw error;
}

function isUnique(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isUniqueConstraint(error: unknown, field: string): boolean {
  if (!isUnique(error)) return false;
  const target = (error.meta as { readonly target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.some((item) => String(item).includes(field));
  return typeof target === "string" && target.includes(field);
}
