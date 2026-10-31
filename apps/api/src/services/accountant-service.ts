import { createHash } from "node:crypto";
import {
  parseMinorUnit,
  validateJournalLines,
  type JournalLineInput
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import { InventoryService } from "./inventory-service.js";
import { JournalService } from "./journal-service.js";
import { Phase10ReportService, toCsv } from "./phase10-report-service.js";

type Tx = Prisma.TransactionClient;

export interface ManualJournalDraftInput {
  readonly description: string;
  readonly effectiveDate: string;
  readonly reason: string;
  readonly allowControlAccountPosting: boolean;
  readonly lines: readonly {
    readonly accountId: string;
    readonly description?: string | undefined;
    readonly debitMinor: string;
    readonly creditMinor: string;
  }[];
}

export interface ManualJournalDraftUpdateInput extends ManualJournalDraftInput {
  readonly version: number;
}

export interface AuditFilters {
  readonly actorUserId?: string | undefined;
  readonly action?: string | undefined;
  readonly targetType?: string | undefined;
  readonly targetId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export class AccountantService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;
  private readonly reports: Phase10ReportService;
  private readonly inventory: InventoryService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
    this.reports = new Phase10ReportService(prisma);
    this.inventory = new InventoryService(prisma);
  }

  public async createManualDraft(context: OrganizationContext, input: ManualJournalDraftInput) {
    await this.authorization.assert(context, "manual-journals:create", "ManualJournalDraft");
    const lines = parsedLines(input);
    validateJournalLines(lines);
    const effectiveDate = parseDate(input.effectiveDate, "effectiveDate");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const accountCount = await tx.account.count({
        where: {
          organizationId: context.organizationId,
          id: { in: [...new Set(lines.map((line) => line.accountId))] },
          isArchived: false
        }
      });
      if (accountCount !== new Set(lines.map((line) => line.accountId)).size)
        throw new AppError("ACCOUNT_NOT_FOUND", "One or more accounts were not found.", 422);
      const draft = await tx.manualJournalDraft.create({
        data: {
          organizationId: context.organizationId,
          description: input.description,
          effectiveDate,
          reason: input.reason,
          allowControlAccountPosting: input.allowControlAccountPosting,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id,
          lines: {
            create: lines.map((line, index) => ({
              organizationId: context.organizationId,
              accountId: line.accountId,
              lineNumber: index + 1,
              description: line.description ?? null,
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor
            }))
          }
        },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      await audit(tx, context, "MANUAL_JOURNAL_DRAFT_CREATED", "ManualJournalDraft", draft.id, {
        effectiveDate: input.effectiveDate,
        reason: input.reason
      });
      return draftDto(draft);
    });
  }

  public async listManualDrafts(context: OrganizationContext) {
    await this.authorization.assert(context, "accountant-view:read", "ManualJournalDraft");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const drafts = await tx.manualJournalDraft.findMany({
        where: { organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } },
        orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
        take: 500
      });
      return drafts.map(draftDto);
    });
  }

  public async updateManualDraft(
    context: OrganizationContext,
    draftId: string,
    input: ManualJournalDraftUpdateInput
  ) {
    await this.authorization.assert(
      context,
      "manual-journals:create",
      "ManualJournalDraft",
      draftId
    );
    const lines = parsedLines(input);
    validateJournalLines(lines);
    const effectiveDate = parseDate(input.effectiveDate, "effectiveDate");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await lockManualDraft(tx, context.organizationId, draftId);
      const existing = await tx.manualJournalDraft.findFirst({
        where: { id: draftId, organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      assertEditableManualDraft(existing, input.version);
      await assertDraftAccounts(tx, context.organizationId, lines);

      const oldContentHash = draftContentHash({
        description: existing.description,
        effectiveDate: serializeDate(existing.effectiveDate).slice(0, 10),
        reason: existing.reason,
        allowControlAccountPosting: existing.allowControlAccountPosting,
        lines: existing.lines.map((line) => ({
          accountId: line.accountId,
          description: line.description ?? undefined,
          debitMinor: line.debitMinor.toString(),
          creditMinor: line.creditMinor.toString()
        }))
      });
      const newContentHash = draftContentHash({
        description: input.description,
        effectiveDate: serializeDate(effectiveDate).slice(0, 10),
        reason: input.reason,
        allowControlAccountPosting: input.allowControlAccountPosting,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          description: line.description ?? undefined,
          debitMinor: line.debitMinor.toString(),
          creditMinor: line.creditMinor.toString()
        }))
      });

      await tx.manualJournalDraftLine.deleteMany({
        where: { draftId, organizationId: context.organizationId }
      });
      await tx.manualJournalDraft.update({
        where: { id: draftId },
        data: {
          description: input.description,
          effectiveDate,
          reason: input.reason,
          allowControlAccountPosting: input.allowControlAccountPosting,
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      await tx.manualJournalDraftLine.createMany({
        data: lines.map((line, index) => ({
          organizationId: context.organizationId,
          draftId,
          accountId: line.accountId,
          lineNumber: index + 1,
          description: line.description ?? null,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor
        }))
      });
      const updated = await tx.manualJournalDraft.findUniqueOrThrow({
        where: { id: draftId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      await audit(tx, context, "MANUAL_JOURNAL_DRAFT_UPDATED", "ManualJournalDraft", draftId, {
        priorVersion: input.version,
        version: updated.version,
        oldContentHash,
        newContentHash,
        oldLineCount: existing.lines.length,
        newLineCount: updated.lines.length,
        financialPosting: false
      });
      return draftDto(updated);
    });
  }

  public async cancelManualDraft(context: OrganizationContext, draftId: string, version: number) {
    await this.authorization.assert(
      context,
      "manual-journals:create",
      "ManualJournalDraft",
      draftId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await lockManualDraft(tx, context.organizationId, draftId);
      const existing = await tx.manualJournalDraft.findFirst({
        where: { id: draftId, organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      assertEditableManualDraft(existing, version);
      const cancelled = await tx.manualJournalDraft.update({
        where: { id: draftId },
        data: {
          status: "CANCELLED",
          version: { increment: 1 },
          updatedByUserId: context.user.id
        },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      await audit(tx, context, "MANUAL_JOURNAL_DRAFT_CANCELLED", "ManualJournalDraft", draftId, {
        priorVersion: version,
        version: cancelled.version,
        retainedLineCount: cancelled.lines.length,
        financialPosting: false
      });
      return draftDto(cancelled);
    });
  }

  public async postManualDraft(
    context: OrganizationContext,
    draftId: string,
    version: number,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "manual-journals:post", "ManualJournalDraft", draftId);
    return runIdempotent(
      this.prisma,
      context,
      "manual-journal.post",
      idempotencyKey,
      { draftId, version },
      async (tx) => {
        await lockManualDraft(tx, context.organizationId, draftId);
        const draft = await tx.manualJournalDraft.findFirst({
          where: { id: draftId, organizationId: context.organizationId },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        if (!draft)
          throw new AppError("MANUAL_JOURNAL_DRAFT_NOT_FOUND", "Draft was not found.", 404);
        if (draft.status !== "DRAFT")
          throw new AppError(
            "MANUAL_JOURNAL_DRAFT_NOT_EDITABLE",
            "Only drafts can be posted.",
            409
          );
        if (draft.version !== version)
          throw new AppError("STALE_MANUAL_JOURNAL_DRAFT", "Draft was changed.", 409);
        const journal = await this.journals.postJournalInTransaction(tx, context, {
          description: draft.description,
          effectiveDate: serializeDate(draft.effectiveDate).slice(0, 10),
          sourceType: "manual_journal",
          sourceId: draft.id,
          postingKey: `manual-journal:${draft.id}`,
          reason: draft.reason,
          allowControlAccountPosting: draft.allowControlAccountPosting,
          lines: draft.lines.map((line) => ({
            accountId: line.accountId,
            description: line.description ?? undefined,
            debitMinor: line.debitMinor.toString(),
            creditMinor: line.creditMinor.toString()
          }))
        });
        const posted = await tx.manualJournalDraft.update({
          where: { id: draft.id },
          data: { status: "POSTED", journalId: journal.id, version: { increment: 1 } },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        await audit(tx, context, "MANUAL_JOURNAL_DRAFT_POSTED", "ManualJournalDraft", draft.id, {
          journalId: journal.id,
          reason: draft.reason
        });
        return {
          statusCode: 201,
          body: { draft: draftDto(posted), journalId: journal.id },
          resourceId: journal.id
        };
      }
    );
  }

  public async reviewQueue(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "accountant-view:read", "ReviewQueue");
    const asOfDate = parseDate(asOf, "asOf");
    const [receivables, payables, tax, inventory, raw] = await Promise.all([
      this.reports.receivables(context, asOf),
      this.reports.payables(context, asOf),
      this.reports.taxReport(context, { from: "0001-01-01", to: asOf }),
      this.inventory.controlReconciliation(context, asOf),
      withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const [
          bank,
          bankAccounts,
          drafts,
          invoiceDrafts,
          billDrafts,
          outbox,
          webhooks,
          ledgerAccounts,
          registeredTax,
          taxVersions,
          dismissals
        ] = await Promise.all([
          tx.bankImportedTransaction.findMany({
            where: {
              organizationId: context.organizationId,
              status: "UNMATCHED",
              postingDate: { lte: asOfDate }
            },
            orderBy: { postingDate: "asc" },
            take: 500
          }),
          tx.bankAccount.findMany({
            where: {
              organizationId: context.organizationId,
              isActive: true,
              importedTransactions: {
                some: {
                  postingDate: { lte: asOfDate },
                  reconciliationItems: {
                    none: { active: true, reconciliation: { status: "COMPLETED" } }
                  }
                }
              }
            },
            take: 500
          }),
          tx.manualJournalDraft.findMany({
            where: {
              organizationId: context.organizationId,
              status: "DRAFT",
              createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) }
            },
            take: 500
          }),
          tx.invoice.findMany({
            where: {
              organizationId: context.organizationId,
              status: { in: ["DRAFT", "APPROVED"] },
              createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) }
            },
            take: 500
          }),
          tx.bill.findMany({
            where: {
              organizationId: context.organizationId,
              status: { in: ["DRAFT", "APPROVED"] },
              createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) }
            },
            take: 500
          }),
          tx.outboxEvent.findMany({
            where: { organizationId: context.organizationId, status: "FAILED" },
            take: 500
          }),
          tx.paymentWebhookEvent.findMany({
            where: { organizationId: context.organizationId, status: "FAILED" },
            take: 500
          }),
          tx.account.findMany({
            where: { organizationId: context.organizationId },
            include: {
              journalLines: {
                where: {
                  journal: { status: "POSTED", effectiveDate: { lte: asOfDate } }
                },
                select: { debitMinor: true, creditMinor: true }
              }
            }
          }),
          tx.taxRegistration.count({
            where: { organizationId: context.organizationId, registered: true }
          }),
          tx.taxCodeVersion.count({ where: { organizationId: context.organizationId } }),
          tx.reviewItemDismissal.findMany({
            where: { organizationId: context.organizationId },
            select: { fingerprint: true }
          })
        ]);
        return {
          bank,
          bankAccounts,
          drafts,
          invoiceDrafts,
          billDrafts,
          outbox,
          webhooks,
          ledgerAccounts,
          taxConfigurationMissing: registeredTax > 0 && taxVersions === 0,
          dismissed: new Set(dismissals.map((row) => row.fingerprint))
        };
      })
    ]);
    const items = [
      ...raw.bank.map((row) =>
        reviewItem(
          "UNMATCHED_BANK",
          row.id,
          "BankImportedTransaction",
          row.id,
          "Imported bank transaction is unmatched."
        )
      ),
      ...raw.bankAccounts.map((row) =>
        reviewItem(
          "UNRECONCILED_ACCOUNT",
          row.id,
          "BankAccount",
          row.id,
          "Bank account contains activity not included in a completed reconciliation."
        )
      ),
      ...raw.drafts.map((row) =>
        reviewItem(
          "STALE_DRAFT",
          row.id,
          "ManualJournalDraft",
          row.id,
          "Manual journal draft is older than 30 days."
        )
      ),
      ...raw.invoiceDrafts.map((row) =>
        reviewItem(
          "STALE_DRAFT",
          `invoice:${row.id}`,
          "Invoice",
          row.id,
          "Invoice draft is older than 30 days."
        )
      ),
      ...raw.billDrafts.map((row) =>
        reviewItem(
          "STALE_DRAFT",
          `bill:${row.id}`,
          "Bill",
          row.id,
          "Bill draft is older than 30 days."
        )
      ),
      ...raw.outbox.map((row) =>
        reviewItem("FAILED_OUTBOX", row.id, "OutboxEvent", row.id, "Outbox delivery failed.")
      ),
      ...raw.webhooks.map((row) =>
        reviewItem(
          "FAILED_WEBHOOK",
          row.id,
          "PaymentWebhookEvent",
          row.id,
          "Payment webhook processing failed."
        )
      ),
      ...(!receivables.isReconciled
        ? [
            reviewItem(
              "AR_CONTROL",
              asOf,
              "Report",
              null,
              `AR differs by ${receivables.differenceMinor} minor units.`
            )
          ]
        : []),
      ...(!payables.isReconciled
        ? [
            reviewItem(
              "AP_CONTROL",
              asOf,
              "Report",
              null,
              `AP differs by ${payables.differenceMinor} minor units.`
            )
          ]
        : []),
      ...(!tax.isReconciled
        ? [
            reviewItem(
              "TAX_CONTROL",
              asOf,
              "Report",
              null,
              "Tax source snapshots do not reconcile to control activity."
            )
          ]
        : []),
      ...(!inventory.isReconciled
        ? [
            reviewItem(
              "INVENTORY_CONTROL",
              asOf,
              "Report",
              null,
              `Inventory differs by ${inventory.differenceMinor} minor units.`
            )
          ]
        : []),
      ...raw.ledgerAccounts.flatMap((account) => {
        const debit = account.journalLines.reduce((sum, line) => sum + line.debitMinor, 0n);
        const credit = account.journalLines.reduce((sum, line) => sum + line.creditMinor, 0n);
        const natural = account.normalBalance === "DEBIT" ? debit - credit : credit - debit;
        const suspense =
          /(suspense|clearing)/i.test(`${account.name} ${account.systemPurpose ?? ""}`) &&
          natural !== 0n;
        const unusual = natural < 0n;
        return [
          ...(suspense
            ? [
                reviewItem(
                  "SUSPENSE_BALANCE",
                  `${account.id}:${natural.toString()}`,
                  "Account",
                  account.id,
                  `${account.name} has a ${natural.toString()} minor-unit balance requiring review.`
                )
              ]
            : []),
          ...(unusual
            ? [
                reviewItem(
                  "UNUSUAL_BALANCE",
                  `${account.id}:${natural.toString()}`,
                  "Account",
                  account.id,
                  `${account.name} has a balance opposite its configured normal side.`
                )
              ]
            : [])
        ];
      }),
      ...(raw.taxConfigurationMissing
        ? [
            reviewItem(
              "TAX_CONFIGURATION",
              "registered-without-tax-version",
              "TaxConfiguration",
              null,
              "A registered tax account has no effective tax-code version."
            )
          ]
        : [])
    ];
    return { asOf, items: items.filter((item) => !raw.dismissed.has(item.fingerprint)) };
  }

  public async dismissReviewItem(
    context: OrganizationContext,
    input: { fingerprint: string; category: string; reason: string; asOf: string }
  ) {
    await this.authorization.assert(
      context,
      "review-items:resolve",
      "ReviewItem",
      input.fingerprint
    );
    const queue = await this.reviewQueue(context, input.asOf);
    const activeItem = queue.items.find((item) => item.fingerprint === input.fingerprint);
    if (!activeItem)
      throw new AppError("REVIEW_ITEM_NOT_ACTIVE", "Review item is not active.", 409);
    if (activeItem.category !== input.category)
      throw new AppError(
        "REVIEW_ITEM_CATEGORY_MISMATCH",
        "Review item category does not match.",
        409
      );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const dismissal = await tx.reviewItemDismissal.create({
        data: {
          organizationId: context.organizationId,
          fingerprint: input.fingerprint,
          category: input.category,
          reason: input.reason,
          dismissedByUserId: context.user.id
        }
      });
      await audit(tx, context, "REVIEW_ITEM_DISMISSED", "ReviewItem", input.fingerprint, {
        category: input.category,
        reason: input.reason
      });
      return dismissal;
    });
  }

  public async auditEvents(context: OrganizationContext, filters: AuditFilters) {
    await this.authorization.assert(context, "audit:read", "AuditEvent");
    const from = filters.from ? parseDate(filters.from, "from") : undefined;
    const to = filters.to ? parseDate(filters.to, "to") : undefined;
    const where: Prisma.AuditEventWhereInput = {
      organizationId: context.organizationId,
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.action ? { action: { contains: filters.action, mode: "insensitive" } } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.targetId ? { targetId: filters.targetId } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {})
    };
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [total, events] = await Promise.all([
        tx.auditEvent.count({ where }),
        tx.auditEvent.findMany({
          where,
          include: { actor: { select: { email: true, displayName: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (filters.page - 1) * filters.pageSize,
          take: filters.pageSize
        })
      ]);
      return {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        events: events.map((event) => ({
          ...event,
          metadata: redactAudit(event.metadata),
          createdAt: serializeDate(event.createdAt)
        }))
      };
    });
  }

  public async exportAudit(context: OrganizationContext, filters: AuditFilters) {
    await this.authorization.assert(context, "audit:export", "AuditExport");
    const result = await this.auditEvents(context, { ...filters, page: 1, pageSize: 100 });
    const content = toCsv(
      result.events.map((event) => ({ ...event, metadata: JSON.stringify(event.metadata) }))
    );
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      audit(tx, context, "AUDIT_EXPORT_CREATED", "AuditExport", null, {
        rowCount: result.events.length
      })
    );
    return { content, filename: `clearledger-audit-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  public async traceJournal(context: OrganizationContext, journalId: string) {
    await this.authorization.assert(context, "accountant-view:read", "JournalTrace", journalId);
    const journal = await this.journals.getJournal(context, journalId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const reversal = await tx.journal.findFirst({
        where: { organizationId: context.organizationId, reversedJournalId: journalId },
        select: { id: true }
      });
      return {
        journal,
        source: {
          type: journal.sourceType,
          id: journal.sourceId,
          url: sourceUrl(journal.sourceType, journal.sourceId)
        },
        originalJournalId: journal.reversedJournalId,
        reversalJournalId: reversal?.id ?? null
      };
    });
  }

  public async correctionGuide(context: OrganizationContext, journalId: string) {
    const trace = await this.traceJournal(context, journalId);
    const strategy = trace.journal.sourceType.includes("invoice")
      ? "Use a credit note or invoice void workflow."
      : trace.journal.sourceType.includes("bill")
        ? "Use a vendor credit or bill-payment reversal workflow."
        : trace.journal.sourceType.includes("inventory")
          ? "Use an inventory adjustment or exact movement reversal."
          : "Reverse the journal, then post a separately reviewed replacement.";
    return {
      journalId,
      strategy,
      reverseUrl: `/v1/journals/${journalId}/reverse`,
      originalPreserved: true
    };
  }

  public async createNextFiscalYear(context: OrganizationContext, finalPeriodId: string) {
    await this.authorization.assert(context, "periods:close", "FiscalPeriod", finalPeriodId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "FiscalPeriod"
         WHERE id = ${finalPeriodId}::uuid
           AND "organizationId" = ${context.organizationId}::uuid
         FOR UPDATE
      `;
      const final = await tx.fiscalPeriod.findFirst({
        where: {
          id: finalPeriodId,
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {})
        }
      });
      if (!final)
        throw new AppError("FISCAL_PERIOD_NOT_FOUND", "Fiscal period was not found.", 404);
      if (final.status !== "CLOSED")
        throw new AppError("FINAL_PERIOD_NOT_CLOSED", "Final period must be closed first.", 409);
      const startDate = new Date(final.endDate);
      startDate.setUTCDate(startDate.getUTCDate() + 1);
      const endDate = new Date(startDate);
      endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      const existing = await tx.fiscalPeriod.findFirst({
        where: {
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {}),
          startDate,
          endDate
        }
      });
      if (existing) return existing;
      const period = await tx.fiscalPeriod.create({
        data: {
          organizationId: context.organizationId,
          companyId: context.companyId ?? null,
          name: `Fiscal year ${String(endDate.getUTCFullYear())}`,
          startDate,
          endDate
        }
      });
      await audit(tx, context, "NEXT_FISCAL_YEAR_CREATED", "FiscalPeriod", period.id, {
        priorPeriodId: final.id,
        retainedEarningsStrategy:
          "Closing entries remain explicit posted journals; no automatic transfer is posted."
      });
      return period;
    });
  }
}

function parsedLines(input: ManualJournalDraftInput): JournalLineInput[] {
  return input.lines.map((line) => ({
    accountId: line.accountId,
    description: line.description,
    debitMinor: parseMinorUnit(line.debitMinor, "debitMinor"),
    creditMinor: parseMinorUnit(line.creditMinor, "creditMinor")
  }));
}

async function assertDraftAccounts(
  tx: Tx,
  organizationId: string,
  lines: readonly JournalLineInput[]
) {
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accountCount = await tx.account.count({
    where: { organizationId, id: { in: accountIds }, isArchived: false }
  });
  if (accountCount !== accountIds.length)
    throw new AppError("ACCOUNT_NOT_FOUND", "One or more accounts were not found.", 422);
}

function assertEditableManualDraft(
  draft: Prisma.ManualJournalDraftGetPayload<{
    include: { lines: { orderBy: { lineNumber: "asc" } } };
  }> | null,
  version: number
): asserts draft is Prisma.ManualJournalDraftGetPayload<{
  include: { lines: { orderBy: { lineNumber: "asc" } } };
}> {
  if (!draft) throw new AppError("MANUAL_JOURNAL_DRAFT_NOT_FOUND", "Draft was not found.", 404);
  if (draft.status !== "DRAFT")
    throw new AppError(
      "MANUAL_JOURNAL_DRAFT_NOT_EDITABLE",
      "Only non-posting drafts can be changed or cancelled.",
      409
    );
  if (draft.version !== version)
    throw new AppError("STALE_MANUAL_JOURNAL_DRAFT", "Draft was changed.", 409);
}

async function lockManualDraft(tx: Tx, organizationId: string, draftId: string) {
  await tx.$queryRaw`
    SELECT id FROM "ManualJournalDraft"
     WHERE id = ${draftId}::uuid AND "organizationId" = ${organizationId}::uuid
     FOR UPDATE
  `;
}

function draftContentHash(input: ManualJournalDraftInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        description: input.description,
        effectiveDate: input.effectiveDate,
        reason: input.reason,
        allowControlAccountPosting: input.allowControlAccountPosting,
        lines: input.lines.map((line) => ({
          accountId: line.accountId,
          description: line.description ?? null,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor
        }))
      })
    )
    .digest("hex");
}

function draftDto(draft: Prisma.ManualJournalDraftGetPayload<{ include: { lines: true } }>) {
  const accountingBoundary =
    draft.status === "POSTED"
      ? {
          classification: "AUTHORITATIVE_POSTED_JOURNAL" as const,
          financialPosting: true,
          authoritative: true,
          editable: false,
          cancellable: false
        }
      : {
          classification:
            draft.status === "DRAFT"
              ? ("NON_POSTING_DRAFT" as const)
              : ("NON_POSTING_CANCELLED" as const),
          financialPosting: false,
          authoritative: false,
          editable: draft.status === "DRAFT",
          cancellable: draft.status === "DRAFT"
        };
  return {
    ...draft,
    accountingBoundary,
    effectiveDate: serializeDate(draft.effectiveDate),
    createdAt: serializeDate(draft.createdAt),
    updatedAt: serializeDate(draft.updatedAt),
    lines: draft.lines.map((line) => ({
      ...line,
      debitMinor: line.debitMinor.toString(),
      creditMinor: line.creditMinor.toString(),
      createdAt: serializeDate(line.createdAt)
    }))
  };
}

function reviewItem(
  category: string,
  key: string,
  targetType: string,
  targetId: string | null,
  explanation: string
) {
  return {
    fingerprint: createHash("sha256").update(`${category}:${key}`).digest("hex"),
    category,
    severity: category.includes("CONTROL") || category.includes("FAILED") ? "MATERIAL" : "REVIEW",
    targetType,
    targetId,
    explanation
  };
}

function redactAudit(value: Prisma.JsonValue | null | undefined): Prisma.JsonValue | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((entry) => redactAudit(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /(token|secret|password|registrationnumber|businessnumber|accountnumber|payload)/i.test(key)
        ? "[REDACTED]"
        : redactAudit(entry)
    ])
  );
}

function sourceUrl(sourceType: string, sourceId: string): string | null {
  const type = sourceType.toLowerCase();
  if (type.includes("invoice")) return `/v1/invoices/${encodeURIComponent(sourceId)}`;
  if (type.includes("payment")) return `/v1/payments/${encodeURIComponent(sourceId)}`;
  if (type.includes("bill")) return `/v1/bills/${encodeURIComponent(sourceId)}`;
  if (type.includes("inventory"))
    return `/v1/inventory/movements?sourceId=${encodeURIComponent(sourceId)}`;
  return null;
}

function audit(
  tx: Tx,
  context: OrganizationContext,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Prisma.InputJsonObject
) {
  return tx.auditEvent.create({
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

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
