import { randomUUID } from "node:crypto";
import {
  allocateMinorUnits,
  convertBalancedComponents,
  convertMinorUnits,
  parseMinorUnit,
  parseQuantityMicros,
  serializeMinorUnit,
  sumMinorUnits
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import {
  buildInvoiceRenderData,
  renderDataHash,
  type InvoiceRenderAssetReference
} from "./invoice-render-service.js";
import {
  defaultInvoiceTemplate,
  getInvoiceTemplate,
  validateTemplateConfiguration,
  type InvoiceTemplateConfiguration
} from "./invoice-template-service.js";
import { assertDocumentCurrency } from "./currency-workflow-policy.js";
import { addressSnapshot } from "./customer-address.js";
import { JournalService, type PostJournalInput } from "./journal-service.js";
import { MonetaryPositionService } from "./monetary-position-service.js";
import {
  depleteInvoiceInventoryInTransaction,
  reverseInvoiceInventoryInTransaction
} from "./inventory-service.js";
import { PaymentInstructionService } from "./payment-instruction-service.js";
import {
  calculatedLineInput,
  calculateLine,
  prorateAmount,
  type CalculatedLine,
  type LineCalculationInput
} from "./invoice-calculation.js";
import { allocateTaxAdjustment } from "./tax-calculation-service.js";
import { derivePaymentReference } from "./payment-reference-code.js";

type TransactionClient = Prisma.TransactionClient;
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;
type CreditNoteRow = Prisma.CreditNoteGetPayload<{ include: { lines: true } }>;
type InvoiceLineRow = Prisma.InvoiceLineGetPayload<Prisma.InvoiceLineDefaultArgs>;
type CreditNoteLineRow = Prisma.CreditNoteLineGetPayload<Prisma.CreditNoteLineDefaultArgs>;

export interface InvoiceCreateInput {
  readonly customerId: string;
  readonly issueDate: string;
  readonly dueDate?: string | undefined;
  readonly paymentTermsDays?: number | undefined;
  readonly currency: string;
  readonly fxRateSnapshotId?: string | undefined;
  readonly lines: readonly LineCalculationInput[];
  readonly customerFacingNotes?: string | null | undefined;
  readonly internalNotes?: string | null | undefined;
  readonly terms?: string | null | undefined;
  readonly paymentMethodSelection?: readonly string[] | undefined;
  readonly recurrenceIdempotencyKey?: string | undefined;
  readonly allowMissingFxRate?: boolean | undefined;
  readonly automationBlockingReason?: string | undefined;
}

export interface InvoiceUpdateInput extends InvoiceCreateInput {
  readonly version: number;
}

export class InvoiceService {
  private readonly authorization: AuthorizationService;
  private readonly journalService: JournalService;
  private readonly monetaryPositions: MonetaryPositionService;
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly paymentInstructionService = new PaymentInstructionService(prisma)
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.journalService = new JournalService(prisma);
    this.monetaryPositions = new MonetaryPositionService();
  }

  public async list(context: OrganizationContext, status?: string) {
    await this.authorization.assert(context, "invoices:read", "Invoice");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          ...(status ? { status: status as never } : {})
        },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          creditNotes: { where: { status: "POSTED" }, include: { lines: true } }
        },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        take: 100
      });
      return rows.map((row) => invoiceDto(row, row.creditNotes));
    });
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "invoices:read", "Invoice", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoice.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          creditNotes: { where: { status: "POSTED" }, include: { lines: true } }
        }
      })
    );
    if (!row) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
    return invoiceDto(row, row.creditNotes);
  }

  /**
   * Finalize is the customer-facing one-step action. The existing post
   * transaction is deliberately reused so validation, authoritative tax
   * calculation, journal creation, inventory depletion, and render-data
   * snapshotting stay atomic and idempotent.
   */
  public async finalize(
    context: OrganizationContext,
    id: string,
    version: number,
    effectiveDate: string | undefined,
    idempotencyKey: string | undefined
  ) {
    return this.post(context, id, version, effectiveDate, idempotencyKey);
  }

  public async booksImpact(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "invoices:read", "Invoice", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id, organizationId: context.organizationId },
        select: { id: true, status: true, journalId: true, currency: true }
      });
      if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
      if (!invoice.journalId || invoice.status === "DRAFT" || invoice.status === "APPROVED")
        throw new AppError(
          "INVOICE_NOT_POSTED",
          "Books impact is available after the invoice is finalized.",
          409
        );
      const journal = await tx.journal.findFirst({
        where: { id: invoice.journalId, organizationId: context.organizationId, status: "POSTED" },
        include: {
          lines: {
            orderBy: { lineNumber: "asc" },
            include: {
              account: {
                select: { code: true, name: true, type: true, systemPurpose: true }
              }
            }
          }
        }
      });
      if (!journal)
        throw new AppError(
          "INVOICE_JOURNAL_NOT_FOUND",
          "The posted invoice journal was not found.",
          500
        );

      const entries = journal.lines.map((line) => ({
        lineNumber: line.lineNumber,
        accountId: line.accountId,
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.type,
        systemPurpose: line.account.systemPurpose,
        description: line.description,
        debitMinor: serializeMinorUnit(line.debitMinor),
        creditMinor: serializeMinorUnit(line.creditMinor),
        baseCurrency: line.baseCurrency.trim()
      }));
      const signed = (line: (typeof journal.lines)[number]) => line.debitMinor - line.creditMinor;
      const sum = (lines: readonly (typeof journal.lines)[number][]) =>
        lines.reduce((total, line) => total + signed(line), 0n);
      const receivableLines = journal.lines.filter(
        (line) => line.account.systemPurpose === "accounts-receivable"
      );
      const revenueLines = journal.lines.filter((line) => line.account.type === "REVENUE");
      const taxLines = journal.lines.filter(
        (line) =>
          line.account.type === "LIABILITY" &&
          (line.account.systemPurpose?.toLowerCase().includes("tax") ||
            line.description?.toLowerCase().includes("payable") === true)
      );
      return {
        invoiceId: invoice.id,
        journalId: journal.id,
        currency: invoice.currency.trim(),
        effectiveDate: serializeDate(journal.effectiveDate),
        entries,
        totals: {
          receivablesDebitMinor: serializeMinorUnit(
            sum(receivableLines.filter((line) => line.debitMinor > 0n))
          ),
          revenueCreditMinor: serializeMinorUnit(
            revenueLines.reduce((total, line) => total + line.creditMinor - line.debitMinor, 0n)
          ),
          taxPayableCreditMinor: serializeMinorUnit(
            taxLines.reduce((total, line) => total + line.creditMinor - line.debitMinor, 0n)
          ),
          debitsMinor: serializeMinorUnit(
            journal.lines.reduce((total, line) => total + line.debitMinor, 0n)
          ),
          creditsMinor: serializeMinorUnit(
            journal.lines.reduce((total, line) => total + line.creditMinor, 0n)
          )
        }
      };
    });
  }

  public async create(context: OrganizationContext, input: InvoiceCreateInput) {
    await this.authorization.assert(context, "invoices:create", "Invoice");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const customer = await this.findActiveCustomer(tx, context.organizationId, input.customerId);
      const issueDate = parseDate(input.issueDate, "issueDate");
      let automationBlockingReason = input.automationBlockingReason ?? null;
      let currencyPolicy;
      try {
        currencyPolicy = await assertDocumentCurrency(tx, {
          organizationId: context.organizationId,
          currency: input.currency,
          rateSnapshotId: input.fxRateSnapshotId,
          transactionDate: issueDate,
          allowMissingRate: input.allowMissingFxRate
        });
      } catch (error) {
        if (
          input.allowMissingFxRate &&
          error instanceof AppError &&
          error.code === "FX_RATE_REQUIRED"
        ) {
          automationBlockingReason = error.code;
          currencyPolicy = await assertDocumentCurrency(tx, {
            organizationId: context.organizationId,
            currency: input.currency,
            rateSnapshotId: input.fxRateSnapshotId,
            transactionDate: issueDate,
            allowMissingRate: true
          });
        } else {
          throw error;
        }
      }
      const paymentTermsDays = input.paymentTermsDays ?? customer.defaultPaymentTermsDays;
      const dueDate = input.dueDate
        ? parseDate(input.dueDate, "dueDate")
        : addDays(issueDate, paymentTermsDays);
      if (dueDate < issueDate)
        throw new AppError("INVALID_DUE_DATE", "Due date cannot precede issue date.", 422);
      const lines = await this.calculateLines(tx, context.organizationId, issueDate, input.lines);
      const organizationSnapshot = await this.organizationSnapshot(tx, context.organizationId);
      const totals = lineTotals(lines);
      const invoice = await tx.invoice.create({
        data: {
          organizationId: context.organizationId,
          customerId: customer.id,
          provisionalIdentifier: `DRAFT-${cryptoRandomId()}`,
          paymentReference: derivePaymentReference(`${context.organizationId}:${cryptoRandomId()}`),
          issueDate,
          dueDate,
          paymentTermsDays,
          currency: currencyPolicy.currency,
          fxRateSnapshotId: input.fxRateSnapshotId ?? null,
          subtotalMinor: totals.subtotalMinor,
          discountTotalMinor: totals.discountTotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          grandTotalMinor: totals.grandTotalMinor,
          customerNameSnapshot: customer.displayName,
          customerEmailSnapshot: customer.email,
          customerDocumentLanguageSnapshot: customer.documentLanguage,
          billingAddressSnapshot: addressSnapshot(customer.addresses, "BILLING") ?? Prisma.JsonNull,
          serviceAddressSnapshot: addressSnapshot(customer.addresses, "SERVICE") ?? Prisma.JsonNull,
          organizationSnapshot,
          customerFacingNotes: input.customerFacingNotes ?? null,
          internalNotes: input.internalNotes ?? null,
          terms: input.terms ?? null,
          paymentMethodSelection: input.paymentMethodSelection
            ? (input.paymentMethodSelection as unknown as Prisma.InputJsonArray)
            : Prisma.JsonNull,
          recurrenceIdempotencyKey: input.recurrenceIdempotencyKey ?? null,
          automationBlockingReason,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await tx.invoiceLine.createMany({
        data: lines.map((line, index) =>
          invoiceLineData(context.organizationId, invoice.id, index + 1, line)
        )
      });
      await audit(tx, context, "INVOICE_DRAFT_CREATED", "Invoice", invoice.id, {
        lineCount: lines.length
      });
      const created = await tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: { lines: true }
      });
      return invoiceDto(created, []);
    });
  }

  public async update(context: OrganizationContext, id: string, input: InvoiceUpdateInput) {
    await this.authorization.assert(context, "invoices:create", "Invoice", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.invoice.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      if (!current) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
      if (!["DRAFT", "APPROVED"].includes(current.status))
        throw new AppError("INVOICE_IMMUTABLE", "Posted invoices cannot be edited.", 409);
      const customer = await this.findActiveCustomer(tx, context.organizationId, input.customerId);
      const issueDate = parseDate(input.issueDate, "issueDate");
      const currencyPolicy = await assertDocumentCurrency(tx, {
        organizationId: context.organizationId,
        currency: input.currency,
        rateSnapshotId: input.fxRateSnapshotId,
        transactionDate: issueDate
      });
      const dueDate = input.dueDate
        ? parseDate(input.dueDate, "dueDate")
        : addDays(issueDate, input.paymentTermsDays ?? customer.defaultPaymentTermsDays);
      if (dueDate < issueDate)
        throw new AppError("INVALID_DUE_DATE", "Due date cannot precede issue date.", 422);
      const lines = await this.calculateLines(tx, context.organizationId, issueDate, input.lines);
      const totals = lineTotals(lines);
      const changed = await tx.invoice.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version: input.version,
          status: { in: ["DRAFT", "APPROVED"] }
        },
        data: {
          customerId: customer.id,
          issueDate,
          dueDate,
          paymentTermsDays: input.paymentTermsDays ?? customer.defaultPaymentTermsDays,
          currency: currencyPolicy.currency,
          fxRateSnapshotId: input.fxRateSnapshotId ?? null,
          subtotalMinor: totals.subtotalMinor,
          discountTotalMinor: totals.discountTotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          grandTotalMinor: totals.grandTotalMinor,
          customerNameSnapshot: customer.displayName,
          customerEmailSnapshot: customer.email,
          customerDocumentLanguageSnapshot: customer.documentLanguage,
          billingAddressSnapshot: addressSnapshot(customer.addresses, "BILLING") ?? Prisma.JsonNull,
          serviceAddressSnapshot: addressSnapshot(customer.addresses, "SERVICE") ?? Prisma.JsonNull,
          customerFacingNotes: input.customerFacingNotes ?? null,
          internalNotes: input.internalNotes ?? null,
          terms: input.terms ?? null,
          paymentMethodSelection: input.paymentMethodSelection
            ? (input.paymentMethodSelection as unknown as Prisma.InputJsonArray)
            : Prisma.JsonNull,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError("STALE_INVOICE", "Invoice was changed by another request.", 409);
      await tx.invoiceLine.deleteMany({
        where: { invoiceId: id, organizationId: context.organizationId }
      });
      await tx.invoiceLine.createMany({
        data: lines.map((line, index) =>
          invoiceLineData(context.organizationId, id, index + 1, line)
        )
      });
      const updated = await tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      await audit(tx, context, "INVOICE_DRAFT_UPDATED", "Invoice", id, { lineCount: lines.length });
      return invoiceDto(updated, []);
    });
  }

  public async validate(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "invoices:read", "Invoice", id);
    const invoice = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoice.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      })
    );
    if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
    const lines = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.calculateLines(
        tx,
        context.organizationId,
        invoice.issueDate,
        invoice.lines.map(calculatedLineInput)
      )
    );
    const totals = lineTotals(lines);
    return {
      invoiceId: id,
      valid: totals.grandTotalMinor > 0n,
      ...serializeTotals(totals),
      lines: lines.map(calculatedLineDto)
    };
  }

  public async approve(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "invoices:post", "Invoice", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.invoice.updateMany({
        where: { id, organizationId: context.organizationId, version, status: "DRAFT" },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedByUserId: context.user.id,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError("STALE_INVOICE", "Invoice was changed or is not a draft.", 409);
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      await audit(tx, context, "INVOICE_APPROVED", "Invoice", id, {});
      return invoiceDto(row, []);
    });
  }

  public async post(
    context: OrganizationContext,
    id: string,
    version: number,
    effectiveDate: string | undefined,
    idempotencyKey: string | undefined,
    inventoryLocationId?: string
  ) {
    await this.authorization.assert(context, "invoices:post", "Invoice", id);
    const payload = {
      invoiceId: id,
      version,
      effectiveDate: effectiveDate ?? null,
      inventoryLocationId: inventoryLocationId ?? null
    };
    return runIdempotent(
      this.prisma,
      context,
      "invoice.post",
      idempotencyKey,
      payload,
      async (tx) => {
        const invoice = await this.lockInvoice(tx, context.organizationId, id);
        if (!["DRAFT", "APPROVED"].includes(invoice.status))
          throw new AppError("INVOICE_ALREADY_POSTED", "Invoice is no longer postable.", 409);
        if (invoice.version !== version)
          throw new AppError("STALE_INVOICE", "Invoice was changed by another request.", 409);
        const customer = await this.findActiveCustomer(
          tx,
          context.organizationId,
          invoice.customerId
        );
        const organizationSnapshot = await this.organizationSnapshot(tx, context.organizationId);
        const postingDate = effectiveDate
          ? parseDate(effectiveDate, "effectiveDate")
          : invoice.issueDate;
        await assertDocumentCurrency(tx, {
          organizationId: context.organizationId,
          currency: invoice.currency,
          rateSnapshotId: invoice.fxRateSnapshotId,
          transactionDate: invoice.issueDate
        });
        const lines = await this.calculateLines(
          tx,
          context.organizationId,
          invoice.issueDate,
          invoice.lines.map(calculatedLineInput)
        );
        const totals = lineTotals(lines);
        if (totals.grandTotalMinor <= 0n)
          throw new AppError(
            "INVOICE_TOTAL_INVALID",
            "Posted invoices must have a positive total.",
            422
          );
        await tx.invoiceLine.deleteMany({
          where: { invoiceId: id, organizationId: context.organizationId }
        });
        await tx.invoiceLine.createMany({
          data: lines.map((line, index) =>
            invoiceLineData(context.organizationId, id, index + 1, line)
          )
        });
        const number = await allocateNumber(tx, context.organizationId, "invoice");
        const ar = await this.findReceivableAccount(tx, context.organizationId);
        const fxRate = invoice.fxRateSnapshotId
          ? await tx.fxRateSnapshot.findFirst({
              where: { id: invoice.fxRateSnapshotId, organizationId: context.organizationId },
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
        const baseCurrency = (
          await tx.organization.findUniqueOrThrow({
            where: { id: context.organizationId },
            select: { currency: true }
          })
        ).currency.trim();
        if (invoice.currency.trim() !== baseCurrency && !fxRate) {
          throw new AppError(
            "FX_RATE_REQUIRED",
            "A locked FX rate snapshot is required before posting a foreign-currency invoice.",
            422
          );
        }
        const journal = await this.journalService.postJournalInTransaction(
          tx,
          context,
          buildInvoiceJournal(
            invoice.id,
            postingDate,
            number,
            lines,
            totals,
            ar.id,
            invoice.currency,
            fxRate
          ),
          true
        );
        const baseAmounts = invoiceBaseAmounts(lines, totals, invoice.currency, fxRate);
        for (const [index, baseLine] of baseAmounts.lines.entries()) {
          await tx.invoiceLine.updateMany({
            where: {
              organizationId: context.organizationId,
              invoiceId: invoice.id,
              lineNumber: index + 1
            },
            data: baseLine
          });
        }
        if (fxRate && invoice.currency.trim() !== baseCurrency) {
          await this.monetaryPositions.recognize(tx, {
            organizationId: context.organizationId,
            accountId: ar.id,
            kind: "ACCOUNTS_RECEIVABLE",
            currency: invoice.currency.trim(),
            sourceType: "invoice",
            sourceId: invoice.id,
            transactionMinor: totals.grandTotalMinor,
            baseMinor: baseAmounts.baseGrandTotalMinor,
            eventDate: postingDate,
            rateSnapshotId: fxRate.id,
            journalId: journal.id
          });
        }
        const templateConfig = await tx.invoiceTemplateConfig.findUnique({
          where: { organizationId: context.organizationId }
        });
        const template = templateConfig
          ? getInvoiceTemplate(templateConfig.templateKey)
          : defaultInvoiceTemplate();
        const renderConfiguration = templateConfig
          ? validateTemplateConfiguration(
              template,
              templateConfig.configuration as Partial<InvoiceTemplateConfiguration>
            )
          : template.defaultConfiguration;
        const configuredAssetIds = [
          renderConfiguration.logoAssetId,
          renderConfiguration.headerImageAssetId
        ].filter((id): id is string => Boolean(id));
        const assetRecords = configuredAssetIds.length
          ? await tx.logoAsset.findMany({
              where: {
                id: { in: configuredAssetIds },
                organizationId: context.organizationId,
                scanStatus: "CLEAN"
              }
            })
          : [];
        const assetReference = (id: string | null): InvoiceRenderAssetReference | null => {
          if (!id) return null;
          const asset = assetRecords.find((candidate) => candidate.id === id);
          if (!asset)
            throw new AppError(
              "INVOICE_RENDER_ASSET_NOT_FOUND",
              "A selected invoice image is unavailable.",
              422
            );
          if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(asset.mediaType))
            throw new AppError(
              "INVOICE_RENDER_ASSET_INVALID",
              "A selected invoice image has an unsupported media type.",
              422
            );
          return {
            id: asset.id,
            mediaType: asset.mediaType as InvoiceRenderAssetReference["mediaType"],
            checksum: asset.checksum,
            width: asset.width,
            height: asset.height
          };
        };
        const renderData = buildInvoiceRenderData(
          {
            organizationSnapshot: organizationSnapshot as Prisma.JsonValue,
            customerNameSnapshot: customer.displayName,
            customerEmailSnapshot: customer.email,
            customerDocumentLanguageSnapshot: customer.documentLanguage,
            paymentInstructionsSnapshot:
              await this.paymentInstructionService.renderSnapshotInTransaction(
                tx,
                context.organizationId,
                Array.isArray(invoice.paymentMethodSelection)
                  ? invoice.paymentMethodSelection.filter(
                      (value): value is string => typeof value === "string"
                    )
                  : null
              ),
            billingAddressSnapshot: addressSnapshot(
              customer.addresses,
              "BILLING"
            ) as Prisma.JsonValue,
            serviceAddressSnapshot: addressSnapshot(
              customer.addresses,
              "SERVICE"
            ) as Prisma.JsonValue,
            invoiceNumber: number,
            paymentReference: invoice.paymentReference,
            provisionalIdentifier: invoice.provisionalIdentifier,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            currency: invoice.currency,
            subtotalMinor: totals.subtotalMinor,
            discountTotalMinor: totals.discountTotalMinor,
            taxTotalMinor: totals.taxTotalMinor,
            grandTotalMinor: totals.grandTotalMinor,
            amountPaidMinor: invoice.amountPaidMinor,
            customerFacingNotes: invoice.customerFacingNotes,
            terms: invoice.terms,
            lines: lines.map((line) => ({
              description: line.description,
              quantityMicros: line.quantityMicros,
              unitPriceMinor: line.unitPriceMinor,
              netAmountMinor: line.netAmountMinor,
              taxTotalMinor: line.taxTotalMinor,
              totalMinor: line.totalMinor
            }))
          },
          template.key,
          templateConfig?.templateVersion ?? 1,
          renderConfiguration,
          {
            logo: assetReference(renderConfiguration.logoAssetId),
            headerImage: assetReference(renderConfiguration.headerImageAssetId)
          }
        );
        const posted = await tx.invoice.update({
          where: { id },
          data: {
            invoiceNumber: number,
            status: "POSTED",
            subtotalMinor: totals.subtotalMinor,
            discountTotalMinor: totals.discountTotalMinor,
            taxTotalMinor: totals.taxTotalMinor,
            grandTotalMinor: totals.grandTotalMinor,
            baseSubtotalMinor: baseAmounts.baseSubtotalMinor,
            baseDiscountTotalMinor: baseAmounts.baseDiscountTotalMinor,
            baseTaxTotalMinor: baseAmounts.baseTaxTotalMinor,
            baseGrandTotalMinor: baseAmounts.baseGrandTotalMinor,
            customerNameSnapshot: customer.displayName,
            customerEmailSnapshot: customer.email,
            customerDocumentLanguageSnapshot: customer.documentLanguage,
            billingAddressSnapshot:
              addressSnapshot(customer.addresses, "BILLING") ?? Prisma.JsonNull,
            serviceAddressSnapshot:
              addressSnapshot(customer.addresses, "SERVICE") ?? Prisma.JsonNull,
            organizationSnapshot,
            templateKey: template.key,
            templateVersion: templateConfig?.templateVersion ?? 1,
            renderData: renderData as unknown as Prisma.InputJsonObject,
            renderDataHash: renderDataHash(renderData),
            journalId: journal.id,
            postedAt: new Date(),
            postedByUserId: context.user.id,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        await depleteInvoiceInventoryInTransaction(
          tx,
          context,
          this.journalService,
          invoice.id,
          postingDate,
          inventoryLocationId
        );
        await audit(tx, context, "INVOICE_POSTED", "Invoice", id, {
          invoiceNumber: number,
          journalId: journal.id,
          grandTotalMinor: totals.grandTotalMinor.toString()
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "sales.invoice.posted",
            aggregateType: "Invoice",
            aggregateId: id,
            payload: { invoiceId: id, invoiceNumber: number, journalId: journal.id }
          }
        });
        const linkedCommerceEvent = await tx.commerceInboxEvent.findFirst({
          where: { organizationId: context.organizationId, resultingInvoiceId: id },
          select: { id: true }
        });
        if (linkedCommerceEvent) {
          await tx.commerceInboxEvent.update({
            where: { id: linkedCommerceEvent.id },
            data: {
              conversionStatus: "POSTED",
              conversionReviewNote:
                "The linked reviewed commerce order is now represented by a posted invoice.",
              version: { increment: 1 }
            }
          });
          await audit(
            tx,
            context,
            "COMMERCE_ORDER_INVOICE_POSTED",
            "CommerceInboxEvent",
            linkedCommerceEvent.id,
            {
              invoiceId: id,
              journalId: journal.id
            }
          );
        }
        return { statusCode: 201, body: { invoice: invoiceDto(posted, []) }, resourceId: id };
      }
    );
  }

  public async void(
    context: OrganizationContext,
    id: string,
    version: number,
    input: { effectiveDate?: string | undefined; reason: string },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "invoices:correct", "Invoice", id);
    return runIdempotent(
      this.prisma,
      context,
      "invoice.void",
      idempotencyKey,
      { invoiceId: id, version, ...input },
      async (tx) => {
        const invoice = await this.lockInvoice(tx, context.organizationId, id);
        if (invoice.status !== "POSTED")
          throw new AppError("INVOICE_NOT_VOIDABLE", "Only posted invoices can be voided.", 409);
        if (invoice.version !== version)
          throw new AppError("STALE_INVOICE", "Invoice was changed by another request.", 409);
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: context.organizationId },
          select: { currency: true }
        });
        if (invoice.currency.trim() !== organization.currency.trim())
          throw new AppError(
            "FOREIGN_INVOICE_CORRECTION_WORKFLOW_REQUIRED",
            "Foreign invoice voiding requires a linked monetary-position correction and is not available in this release.",
            409
          );
        const reversal = await this.journalService.reverseJournalInTransaction(
          tx,
          context,
          invoice.journalId!,
          {
            effectiveDate: input.effectiveDate ?? invoice.issueDate.toISOString().slice(0, 10),
            reason: input.reason
          },
          "invoice_void",
          invoice.id,
          `invoice:void:${invoice.id}`
        );
        await reverseInvoiceInventoryInTransaction(
          tx,
          context,
          this.journalService,
          invoice.id,
          parseDate(
            input.effectiveDate ?? invoice.issueDate.toISOString().slice(0, 10),
            "effectiveDate"
          ),
          input.reason
        );
        const updated = await tx.invoice.update({
          where: { id },
          data: {
            status: "VOIDED",
            voidedAt: new Date(),
            voidedByUserId: context.user.id,
            voidReason: input.reason,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        await audit(tx, context, "INVOICE_VOIDED", "Invoice", id, {
          reversalJournalId: reversal.id,
          reason: input.reason
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "sales.invoice.voided",
            aggregateType: "Invoice",
            aggregateId: id,
            payload: { invoiceId: id, reversalJournalId: reversal.id }
          }
        });
        return { statusCode: 200, body: { invoice: invoiceDto(updated, []) }, resourceId: id };
      }
    );
  }

  public async createCreditNote(
    context: OrganizationContext,
    input: {
      invoiceId: string;
      issueDate: string;
      reason: string;
      fullCredit: boolean;
      lines: readonly {
        invoiceLineId: string;
        quantity?: string | undefined;
        amountMinor?: string | undefined;
      }[];
    }
  ) {
    await this.authorization.assert(context, "credit-notes:create", "CreditNote");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: input.invoiceId,
          organizationId: context.organizationId,
          status: { in: ["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED"] }
        },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          creditNotes: { where: { status: "POSTED" }, include: { lines: true } }
        }
      });
      if (!invoice)
        throw new AppError(
          "INVOICE_NOT_CREDITABLE",
          "Only posted, non-voided invoices can be credited.",
          409
        );
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { currency: true }
      });
      if (invoice.currency.trim() !== organization.currency.trim())
        throw new AppError(
          "FOREIGN_CREDIT_NOTE_WORKFLOW_REQUIRED",
          "Foreign credit notes require carrying-value relief and are not available in this release.",
          409
        );
      const creditedByLine = creditedTotals(invoice.creditNotes);
      const sourceLines: readonly CreditRequestLine[] = input.fullCredit
        ? invoice.lines.map((line) => ({ invoiceLineId: line.id }))
        : input.lines;
      const seen = new Set<string>();
      const creditLines = [] as CreditDraftLine[];
      for (const requestLine of sourceLines) {
        if (seen.has(requestLine.invoiceLineId))
          throw new AppError(
            "DUPLICATE_CREDIT_LINE",
            "A credit note may reference each invoice line once.",
            422
          );
        seen.add(requestLine.invoiceLineId);
        const source = invoice.lines.find((line) => line.id === requestLine.invoiceLineId);
        if (!source)
          throw new AppError(
            "INVOICE_LINE_NOT_FOUND",
            "Credit note source line was not found.",
            422
          );
        const remaining = source.totalMinor - (creditedByLine.get(source.id) ?? 0n);
        if (remaining <= 0n)
          throw new AppError(
            "LINE_ALREADY_CREDITED",
            "The invoice line has no remaining eligible value.",
            409
          );
        let total: bigint;
        let quantity: bigint;
        if (requestLine.amountMinor) {
          total = parseMinorUnit(requestLine.amountMinor, "amountMinor");
          quantity = source.quantityMicros;
        } else if (requestLine.quantity) {
          quantity = parseQuantityMicros(requestLine.quantity);
          total = prorateAmount(source.totalMinor, quantity, source.quantityMicros);
        } else {
          quantity = source.quantityMicros;
          total = remaining;
        }
        if (total <= 0n || total > remaining)
          throw new AppError(
            "CREDIT_EXCEEDS_ELIGIBLE_VALUE",
            "Credit cannot exceed the remaining invoiced value.",
            409
          );
        if (source.totalMinor <= 0n)
          throw new AppError(
            "CREDIT_LINE_UNSUPPORTED",
            "Negative or zero invoice lines cannot be credited in Phase 4.",
            422
          );
        const taxAllocation = allocateTaxAdjustment({
          sourceNetMinor: source.netAmountMinor,
          sourceTaxTotalMinor: source.taxTotalMinor,
          sourceRecoverableTaxMinor: 0n,
          sourceTotalMinor: source.totalMinor,
          allocationTotalMinor: total,
          purpose: "CREDIT",
          sourceSnapshot: source.taxSnapshot
        });
        creditLines.push({
          invoiceLineId: source.id,
          lineNumber: creditLines.length + 1,
          description: source.description,
          quantityMicros: quantity,
          netAmountMinor: taxAllocation.netMinor,
          taxTotalMinor: taxAllocation.taxTotalMinor,
          totalMinor: total,
          taxSnapshot: taxAllocation.snapshot,
          incomeAccountId: source.incomeAccountId
        });
      }
      const totals = {
        subtotalMinor: sumMinorUnits(creditLines.map((line) => line.netAmountMinor)),
        taxTotalMinor: sumMinorUnits(creditLines.map((line) => line.taxTotalMinor)),
        grandTotalMinor: sumMinorUnits(creditLines.map((line) => line.totalMinor))
      };
      const note = await tx.creditNote.create({
        data: {
          organizationId: context.organizationId,
          invoiceId: invoice.id,
          provisionalIdentifier: `DRAFT-CN-${cryptoRandomId()}`,
          issueDate: parseDate(input.issueDate, "issueDate"),
          currency: invoice.currency,
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          grandTotalMinor: totals.grandTotalMinor,
          reason: input.reason,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await tx.creditNoteLine.createMany({
        data: creditLines.map((line) => ({
          organizationId: context.organizationId,
          creditNoteId: note.id,
          ...line,
          taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull
        }))
      });
      await audit(tx, context, "CREDIT_NOTE_DRAFT_CREATED", "CreditNote", note.id, {
        invoiceId: invoice.id,
        grandTotalMinor: totals.grandTotalMinor.toString()
      });
      const created = await tx.creditNote.findUniqueOrThrow({
        where: { id: note.id },
        include: { lines: true }
      });
      return creditNoteDto(created);
    });
  }

  public async postCreditNote(
    context: OrganizationContext,
    id: string,
    version: number,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "credit-notes:create", "CreditNote", id);
    return runIdempotent(
      this.prisma,
      context,
      "credit-note.post",
      idempotencyKey,
      { creditNoteId: id, version },
      async (tx) => {
        const note = await tx.creditNote.findFirst({
          where: { id, organizationId: context.organizationId, status: "DRAFT" },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        if (!note)
          throw new AppError("CREDIT_NOTE_NOT_FOUND", "Credit note draft was not found.", 404);
        if (note.version !== version)
          throw new AppError(
            "STALE_CREDIT_NOTE",
            "Credit note was changed by another request.",
            409
          );
        const invoice = await this.lockInvoice(tx, context.organizationId, note.invoiceId);
        if (!["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED"].includes(invoice.status))
          throw new AppError("INVOICE_NOT_CREDITABLE", "Invoice is not eligible for credit.", 409);
        const postedCredits = await tx.creditNote.findMany({
          where: {
            organizationId: context.organizationId,
            invoiceId: invoice.id,
            status: "POSTED"
          },
          include: { lines: true }
        });
        const already = creditedTotals(postedCredits);
        for (const line of note.lines) {
          const source =
            invoice.lines.find((item) => item.id === line.invoiceLineId) ??
            (await tx.invoiceLine.findFirst({
              where: { id: line.invoiceLineId, organizationId: context.organizationId }
            }));
          if (!source || line.totalMinor > source.totalMinor - (already.get(source.id) ?? 0n))
            throw new AppError(
              "CREDIT_EXCEEDS_ELIGIBLE_VALUE",
              "Credit exceeds remaining invoice value.",
              409
            );
        }
        const number = await allocateNumber(tx, context.organizationId, "credit-note");
        const ar = await this.findReceivableAccount(tx, context.organizationId);
        const journal = await this.journalService.postJournalInTransaction(
          tx,
          context,
          buildCreditJournal(note, number, ar.id),
          true
        );
        const posted = await tx.creditNote.update({
          where: { id },
          data: {
            creditNoteNumber: number,
            status: "POSTED",
            journalId: journal.id,
            postedAt: new Date(),
            postedByUserId: context.user.id,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        const creditedTotal =
          postedCredits.reduce((sum, item) => sum + item.grandTotalMinor, 0n) +
          note.grandTotalMinor;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: creditedTotal >= invoice.grandTotalMinor ? "CREDITED" : "PARTIALLY_CREDITED",
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await audit(tx, context, "CREDIT_NOTE_POSTED", "CreditNote", id, {
          invoiceId: invoice.id,
          creditNoteNumber: number,
          journalId: journal.id
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "sales.credit_note.posted",
            aggregateType: "CreditNote",
            aggregateId: id,
            payload: { creditNoteId: id, invoiceId: invoice.id, journalId: journal.id }
          }
        });
        return { statusCode: 201, body: { creditNote: creditNoteDto(posted) }, resourceId: id };
      }
    );
  }

  private async calculateLines(
    tx: TransactionClient,
    organizationId: string,
    issueDate: Date,
    inputs: readonly LineCalculationInput[]
  ) {
    const lines: CalculatedLine[] = [];
    for (const input of inputs)
      lines.push(await calculateLine(tx, organizationId, issueDate, input));
    return lines;
  }
  private async findActiveCustomer(tx: TransactionClient, organizationId: string, id: string) {
    const customer = await tx.customer.findFirst({
      where: { id, organizationId },
      include: { addresses: { orderBy: { createdAt: "asc" } } }
    });
    if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 422);
    if (!customer.active)
      throw new AppError(
        "CUSTOMER_INACTIVE",
        "Inactive customers cannot receive new invoices.",
        422
      );
    return customer;
  }
  private async findReceivableAccount(tx: TransactionClient, organizationId: string) {
    const account = await tx.account.findFirst({
      where: {
        organizationId,
        systemPurpose: "accounts-receivable",
        isControl: true,
        isArchived: false,
        type: "ASSET"
      }
    });
    if (!account)
      throw new AppError(
        "RECEIVABLE_CONTROL_ACCOUNT_REQUIRED",
        "An active accounts-receivable control account is required before posting invoices.",
        422
      );
    return account;
  }
  private async organizationSnapshot(tx: TransactionClient, organizationId: string) {
    const [organization, registrations, defaults] = await Promise.all([
      tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { settings: true }
      }),
      tx.taxRegistration.findMany({
        where: { organizationId, registered: true },
        select: { registrationType: true, jurisdiction: true, registrationNumber: true },
        orderBy: [{ registrationType: "asc" }, { jurisdiction: "asc" }]
      }),
      tx.businessDefaults.findUnique({
        where: { organizationId },
        select: { documentLanguage: true }
      })
    ]);
    return {
      legalName: organization.legalName,
      displayName: organization.displayName,
      currency: organization.currency,
      timezone: organization.timezone,
      businessNumber: organization.settings?.businessNumber ?? null,
      address: organization.settings?.businessAddress ?? null,
      documentLanguage: defaults?.documentLanguage ?? "en-CA",
      taxRegistrations: registrations
        .filter((registration) => registration.registrationNumber)
        .map((registration) => ({
          registrationType: registration.registrationType,
          jurisdiction: registration.jurisdiction,
          registrationNumber: registration.registrationNumber
        }))
    } as Prisma.InputJsonObject;
  }
  private async lockInvoice(tx: TransactionClient, organizationId: string, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
    const row = await tx.invoice.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });
    if (!row) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
    return row;
  }
}

interface CreditRequestLine {
  invoiceLineId: string;
  quantity?: string | undefined;
  amountMinor?: string | undefined;
}
interface CreditDraftLine {
  invoiceLineId: string;
  lineNumber: number;
  description: string;
  quantityMicros: bigint;
  netAmountMinor: bigint;
  taxTotalMinor: bigint;
  totalMinor: bigint;
  taxSnapshot: Prisma.InputJsonValue | null;
  incomeAccountId: string;
}
function lineTotals(
  lines: readonly Pick<
    CalculatedLine,
    "grossAmountMinor" | "discountMinor" | "taxTotalMinor" | "totalMinor"
  >[]
) {
  return {
    subtotalMinor: sumMinorUnits(lines.map((line) => line.grossAmountMinor)),
    discountTotalMinor: sumMinorUnits(lines.map((line) => line.discountMinor)),
    taxTotalMinor: sumMinorUnits(lines.map((line) => line.taxTotalMinor)),
    grandTotalMinor: sumMinorUnits(lines.map((line) => line.totalMinor))
  };
}
function serializeTotals(totals: ReturnType<typeof lineTotals>) {
  return {
    subtotalMinor: serializeMinorUnit(totals.subtotalMinor),
    discountTotalMinor: serializeMinorUnit(totals.discountTotalMinor),
    taxTotalMinor: serializeMinorUnit(totals.taxTotalMinor),
    grandTotalMinor: serializeMinorUnit(totals.grandTotalMinor)
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
function buildInvoiceJournal(
  invoiceId: string,
  effectiveDate: Date,
  invoiceNumber: string,
  lines: readonly CalculatedLine[],
  totals: ReturnType<typeof lineTotals>,
  arAccountId: string,
  currency: string,
  fxRate: PostingRate | null
): PostJournalInput {
  const journalLines: PostJournalInput["lines"][number][] = [
    {
      accountId: arAccountId,
      description: `Accounts receivable ${invoiceNumber}`,
      debitMinor: totals.grandTotalMinor.toString(),
      creditMinor: "0"
    }
  ];
  for (const line of lines)
    addSigned(journalLines, line.incomeAccountId, line.netAmountMinor, line.description);
  for (const line of lines)
    for (const tax of line.taxComponents) {
      if (tax.amountMinor !== 0n) {
        if (!tax.payableAccountId)
          throw new AppError(
            "TAX_CONTROL_ACCOUNT_REQUIRED",
            "Every posted tax component requires a payable account.",
            422
          );
        addSigned(journalLines, tax.payableAccountId, tax.amountMinor, `${tax.name} payable`);
      }
    }
  const transactionCurrency = currency.trim().toUpperCase();
  const baseCurrency = fxRate?.baseCurrency.trim().toUpperCase() ?? "CAD";
  const convertedLines =
    fxRate && transactionCurrency !== baseCurrency
      ? (() => {
          const transactionComponents = journalLines.map(
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
          return journalLines.map((line, index) => {
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
      : journalLines;
  return {
    description: `Invoice ${invoiceNumber}`,
    effectiveDate: effectiveDate.toISOString().slice(0, 10),
    sourceType: "invoice",
    sourceId: invoiceId,
    postingKey: `invoice:${invoiceId}`,
    transactionCurrency:
      fxRate && transactionCurrency !== baseCurrency ? transactionCurrency : undefined,
    fxRateSnapshotId: fxRate && transactionCurrency !== baseCurrency ? fxRate.id : undefined,
    allowControlAccountPosting: true,
    lines: convertedLines
  };
}

interface PostingRate {
  readonly id: string;
  readonly transactionCurrency: string;
  readonly baseCurrency: string;
  readonly transactionExponent: number;
  readonly baseExponent: number;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function invoiceBaseAmounts(
  lines: readonly CalculatedLine[],
  totals: ReturnType<typeof lineTotals>,
  currency: string,
  fxRate: PostingRate | null
) {
  if (!fxRate || currency.trim().toUpperCase() === fxRate.baseCurrency.trim().toUpperCase()) {
    return {
      baseSubtotalMinor: totals.subtotalMinor,
      baseDiscountTotalMinor: totals.discountTotalMinor,
      baseTaxTotalMinor: totals.taxTotalMinor,
      baseGrandTotalMinor: totals.grandTotalMinor,
      lines: lines.map((line) => ({
        baseGrossAmountMinor: line.grossAmountMinor,
        baseDiscountMinor: line.discountMinor,
        baseNetAmountMinor: line.netAmountMinor,
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
    const [baseNetAmountMinor, baseTaxTotalMinor] = allocateMinorUnits(baseLineTotals[index]!, [
      { weight: line.netAmountMinor },
      { weight: line.taxTotalMinor }
    ]);
    const baseDiscountMinor = convertMinorUnits(
      line.discountMinor,
      transactionCurrency,
      baseCurrency,
      rate
    );
    return {
      baseGrossAmountMinor: baseNetAmountMinor! + baseDiscountMinor,
      baseDiscountMinor,
      baseNetAmountMinor: baseNetAmountMinor!,
      baseTaxTotalMinor: baseTaxTotalMinor!,
      baseTotalMinor: baseLineTotals[index]!
    };
  });
  return {
    baseSubtotalMinor: sumMinorUnits(convertedLines.map((line) => line.baseGrossAmountMinor)),
    baseDiscountTotalMinor: sumMinorUnits(convertedLines.map((line) => line.baseDiscountMinor)),
    baseTaxTotalMinor: sumMinorUnits(convertedLines.map((line) => line.baseTaxTotalMinor)),
    baseGrandTotalMinor,
    lines: convertedLines
  };
}
function addSigned(
  lines: PostJournalInput["lines"][number][],
  accountId: string,
  amount: bigint,
  description: string
) {
  if (amount > 0n)
    lines.push({ accountId, description, debitMinor: "0", creditMinor: amount.toString() });
  else if (amount < 0n)
    lines.push({ accountId, description, debitMinor: (-amount).toString(), creditMinor: "0" });
}
function buildCreditJournal(
  note: {
    id: string;
    invoiceId: string;
    issueDate: Date;
    grandTotalMinor: bigint;
    lines: readonly {
      incomeAccountId: string;
      netAmountMinor: bigint;
      taxTotalMinor: bigint;
      taxSnapshot: Prisma.JsonValue | null;
    }[];
  },
  number: string,
  arAccountId: string
): PostJournalInput {
  const lines: PostJournalInput["lines"][number][] = [];
  const taxAccounts = new Map<string, bigint>();
  for (const line of note.lines) {
    addSigned(lines, line.incomeAccountId, -line.netAmountMinor, "Credit note revenue reversal");
    const snapshot = line.taxSnapshot as {
      components?: readonly { payableAccountId: string | null; amountMinor: string }[];
    } | null;
    for (const component of snapshot?.components ?? []) {
      if (!component.payableAccountId)
        throw new AppError(
          "TAX_CONTROL_ACCOUNT_REQUIRED",
          "Every credited tax component requires a payable account.",
          422
        );
      taxAccounts.set(
        component.payableAccountId,
        (taxAccounts.get(component.payableAccountId) ?? 0n) + BigInt(component.amountMinor)
      );
    }
  }
  for (const [accountId, amount] of taxAccounts)
    addSigned(lines, accountId, -amount, "Tax payable reversal");
  lines.push({
    accountId: arAccountId,
    description: `Accounts receivable credit ${number}`,
    debitMinor: "0",
    creditMinor: note.grandTotalMinor.toString()
  });
  return {
    description: `Credit note ${number}`,
    effectiveDate: note.issueDate.toISOString().slice(0, 10),
    sourceType: "credit_note",
    sourceId: note.id,
    postingKey: `credit-note:${note.id}`,
    allowControlAccountPosting: true,
    lines
  };
}
function invoiceDto(row: InvoiceRow, creditNotes: readonly CreditNoteRow[]) {
  const credited = creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
  const outstanding =
    row.status === "VOIDED"
      ? 0n
      : maxBigInt(0n, row.grandTotalMinor - credited - row.amountPaidMinor);
  return {
    ...row,
    paymentStatus: invoicePaymentStatus(row.status, row.amountPaidMinor, outstanding, row.dueDate),
    baseCurrency: organizationSnapshotCurrency(row.organizationSnapshot),
    subtotalMinor: row.subtotalMinor.toString(),
    discountTotalMinor: row.discountTotalMinor.toString(),
    taxTotalMinor: row.taxTotalMinor.toString(),
    grandTotalMinor: row.grandTotalMinor.toString(),
    baseSubtotalMinor: row.baseSubtotalMinor.toString(),
    baseDiscountTotalMinor: row.baseDiscountTotalMinor.toString(),
    baseTaxTotalMinor: row.baseTaxTotalMinor.toString(),
    baseGrandTotalMinor: row.baseGrandTotalMinor.toString(),
    amountPaidMinor: row.amountPaidMinor.toString(),
    outstandingBalanceMinor: outstanding.toString(),
    issueDate: serializeDate(row.issueDate),
    dueDate: serializeDate(row.dueDate),
    postedAt: row.postedAt ? serializeDate(row.postedAt) : null,
    approvedAt: row.approvedAt ? serializeDate(row.approvedAt) : null,
    voidedAt: row.voidedAt ? serializeDate(row.voidedAt) : null,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
    lines: row.lines.map(lineDto),
    creditNotes: creditNotes.map(creditNoteDto)
  };
}

function invoicePaymentStatus(
  status: string,
  amountPaidMinor: bigint,
  outstandingMinor: bigint,
  dueDate: Date
): "DRAFT" | "AWAITING_PAYMENT" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID" {
  if (status === "VOIDED") return "VOID";
  if (status === "DRAFT" || status === "APPROVED") return "DRAFT";
  if (outstandingMinor <= 0n) return "PAID";
  if (amountPaidMinor > 0n) return "PARTIALLY_PAID";
  if (dueDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) return "OVERDUE";
  return "AWAITING_PAYMENT";
}
function organizationSnapshotCurrency(snapshot: Prisma.JsonValue): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const currency = snapshot.currency;
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency.trim().toUpperCase())
    ? currency.trim().toUpperCase()
    : null;
}
function lineDto(line: InvoiceLineRow) {
  return {
    ...line,
    quantity: requireQuantity(line.quantityMicros),
    quantityMicros: line.quantityMicros.toString(),
    unitPriceMinor: line.unitPriceMinor.toString(),
    grossAmountMinor: line.grossAmountMinor.toString(),
    discountMinor: line.discountMinor.toString(),
    netAmountMinor: line.netAmountMinor.toString(),
    taxableAmountMinor: line.taxableAmountMinor.toString(),
    taxTotalMinor: line.taxTotalMinor.toString(),
    totalMinor: line.totalMinor.toString(),
    baseGrossAmountMinor: line.baseGrossAmountMinor.toString(),
    baseDiscountMinor: line.baseDiscountMinor.toString(),
    baseNetAmountMinor: line.baseNetAmountMinor.toString(),
    baseTaxTotalMinor: line.baseTaxTotalMinor.toString(),
    baseTotalMinor: line.baseTotalMinor.toString()
  };
}
function calculatedLineDto(line: CalculatedLine) {
  return {
    ...line,
    quantity: requireQuantity(line.quantityMicros),
    quantityMicros: line.quantityMicros.toString(),
    unitPriceMinor: line.unitPriceMinor.toString(),
    grossAmountMinor: line.grossAmountMinor.toString(),
    discountMinor: line.discountMinor.toString(),
    netAmountMinor: line.netAmountMinor.toString(),
    taxableAmountMinor: line.taxableAmountMinor.toString(),
    taxTotalMinor: line.taxTotalMinor.toString(),
    totalMinor: line.totalMinor.toString(),
    taxComponents: line.taxComponents.map((component) => ({
      ...component,
      amountMinor: component.amountMinor.toString()
    }))
  };
}
function creditNoteDto(note: CreditNoteRow) {
  return {
    ...note,
    subtotalMinor: note.subtotalMinor.toString(),
    taxTotalMinor: note.taxTotalMinor.toString(),
    grandTotalMinor: note.grandTotalMinor.toString(),
    issueDate: serializeDate(note.issueDate),
    postedAt: note.postedAt ? serializeDate(note.postedAt) : null,
    createdAt: serializeDate(note.createdAt),
    updatedAt: serializeDate(note.updatedAt),
    lines: note.lines.map((line: CreditNoteLineRow) => ({
      ...line,
      quantityMicros: line.quantityMicros.toString(),
      netAmountMinor: line.netAmountMinor.toString(),
      taxTotalMinor: line.taxTotalMinor.toString(),
      totalMinor: line.totalMinor.toString()
    }))
  };
}
function creditedTotals(
  notes: readonly { lines: readonly { invoiceLineId: string; totalMinor: bigint }[] }[]
) {
  const result = new Map<string, bigint>();
  for (const note of notes)
    for (const line of note.lines)
      result.set(line.invoiceLineId, (result.get(line.invoiceLineId) ?? 0n) + line.totalMinor);
  return result;
}
function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
function cryptoRandomId() {
  return randomUUID();
}
async function allocateNumber(
  tx: TransactionClient,
  organizationId: string,
  kind: "invoice" | "credit-note"
) {
  const rows = await tx.$queryRaw<
    readonly {
      invoicePrefix: string;
      invoiceNextPlaceholder: string;
      creditNotePrefix: string;
      creditNoteNextPlaceholder: string;
    }[]
  >`SELECT "invoicePrefix", "invoiceNextPlaceholder", "creditNotePrefix", "creditNoteNextPlaceholder" FROM "BusinessDefaults" WHERE "organizationId" = ${organizationId}::uuid FOR UPDATE`;
  const defaults = rows[0];
  if (!defaults)
    throw new AppError(
      "DOCUMENT_DEFAULTS_REQUIRED",
      "Document numbering defaults must be configured before posting.",
      422
    );
  const prefix = kind === "invoice" ? defaults.invoicePrefix : defaults.creditNotePrefix;
  const current =
    kind === "invoice" ? defaults.invoiceNextPlaceholder : defaults.creditNoteNextPlaceholder;
  const number = `${prefix}-${current}`;
  const next = (BigInt(current) + 1n).toString().padStart(current.length, "0");
  if (next.length > 12)
    throw new AppError(
      "DOCUMENT_SEQUENCE_EXHAUSTED",
      "Document number sequence is exhausted.",
      422
    );
  await tx.businessDefaults.update({
    where: { organizationId },
    data:
      kind === "invoice"
        ? { invoiceNextPlaceholder: next, version: { increment: 1 } }
        : { creditNoteNextPlaceholder: next, version: { increment: 1 } }
  });
  return number;
}
function requireQuantity(value: bigint) {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}
function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}
function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
async function audit(
  tx: TransactionClient,
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
