import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { parseDate, serializeDate } from "../utils/dates.js";

export type BooksHealthCategory =
  | "COMMERCE"
  | "BANKING"
  | "IMPORTS"
  | "TAX_SETTINGS"
  | "PERIOD_CLOSE";
export type BooksHealthSeverity = "BLOCKER" | "WARNING" | "NOTICE";

export interface BooksHealthTarget {
  readonly workspaceId: string;
  readonly anchorId: string;
  readonly label: string;
  readonly setupStep?: "BUSINESS_PROFILE" | "FISCAL_CURRENCY" | "TAX_REGISTRATION";
}

export interface BooksHealthFinding {
  readonly id: string;
  readonly category: BooksHealthCategory;
  readonly severity: BooksHealthSeverity;
  readonly title: string;
  readonly reason: string;
  readonly count: number;
  readonly target: BooksHealthTarget;
}

interface PeriodCloseSnapshot {
  readonly id: string;
  readonly name: string;
  readonly endDate: string;
  readonly overdue: boolean;
  readonly blockers: readonly { readonly label: string; readonly count: number }[];
}

export interface BooksHealthSnapshot {
  readonly commerce: {
    readonly reviewRequired: number;
    readonly received: number;
    readonly deadLetter: number;
    readonly mappingIssueEvents: number;
    readonly openConflicts: number;
  };
  readonly banking: {
    readonly unmatched: number;
    readonly unreconciled: number;
    readonly previewImports: number;
    readonly failedImports: number;
  };
  readonly imports: {
    readonly incomplete: number;
    readonly awaitingAcknowledgement: number;
    readonly failed: number;
    readonly compensationRequired: number;
    readonly variance: number;
  };
  readonly settings: {
    readonly setupCompleted: boolean;
    readonly missingFields: readonly string[];
    readonly taxStepReady: boolean;
    readonly registeredTaxCount: number;
    readonly effectiveTaxVersionCount: number;
    readonly missingTaxAccountCount: number;
  };
  readonly period: PeriodCloseSnapshot | null;
  readonly fiscalPeriodCoversAsOf: boolean;
}

const targets: Readonly<Record<BooksHealthCategory, BooksHealthTarget>> = {
  COMMERCE: {
    workspaceId: "integrations-workspace",
    anchorId: "commerce-inbox-heading",
    label: "Open commerce review"
  },
  BANKING: {
    workspaceId: "banking-workspace",
    anchorId: "banking-heading",
    label: "Review banking"
  },
  IMPORTS: {
    workspaceId: "portability-workspace",
    anchorId: "portability-heading",
    label: "Open Switching Centre"
  },
  TAX_SETTINGS: {
    workspaceId: "setup-workspace",
    anchorId: "setup-tabs",
    label: "Review company settings",
    setupStep: "TAX_REGISTRATION"
  },
  PERIOD_CLOSE: {
    workspaceId: "accountant-workspace",
    anchorId: "accountant-periods",
    label: "Review period close"
  }
};

const categoryLabels: Readonly<Record<BooksHealthCategory, string>> = {
  COMMERCE: "Commerce",
  BANKING: "Banking",
  IMPORTS: "Switching and imports",
  TAX_SETTINGS: "Tax and settings",
  PERIOD_CLOSE: "Period close"
};

export class BooksHealthService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date()
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async get(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "dashboard:read", "BooksHealth");
    const asOfDate = parseDate(asOf, "asOf");
    const snapshot = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [
        commerceReviewRequired,
        commerceReceived,
        commerceDeadLetter,
        openConnectorConflicts,
        mappingIssueRows,
        unmatchedBankTransactions,
        unreconciledBankTransactions,
        previewBankImports,
        failedBankImports,
        importBatches,
        settings,
        taxStep,
        registeredTaxCount,
        effectiveTaxVersions,
        coveringPeriod
      ] = await Promise.all([
        tx.commerceInboxEvent.count({
          where: { organizationId: context.organizationId, status: "REVIEW_REQUIRED" }
        }),
        tx.commerceInboxEvent.count({
          where: { organizationId: context.organizationId, status: "RECEIVED" }
        }),
        tx.commerceInboxEvent.count({
          where: { organizationId: context.organizationId, status: "DEAD_LETTER" }
        }),
        tx.connectorConflict.count({
          where: { organizationId: context.organizationId, status: "OPEN" }
        }),
        tx.$queryRaw<readonly { mappingIssueEvents: bigint }[]>`
          SELECT COUNT(*)::bigint AS "mappingIssueEvents"
            FROM "CommerceInboxEvent" event
           WHERE event."organizationId" = ${context.organizationId}::uuid
             AND event.status::text = 'REVIEW_REQUIRED'
             AND EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(
                   CASE
                     WHEN jsonb_typeof(event."normalizationIssues") = 'array'
                       THEN event."normalizationIssues"
                     ELSE '[]'::jsonb
                   END
                 ) issue
                WHERE issue->>'code' IN (
                  'ITEM_MAPPING_REQUIRED',
                  'SKU_MISSING',
                  'TAX_MAPPING_REQUIRED'
                )
             )
        `,
        tx.bankImportedTransaction.count({
          where: {
            organizationId: context.organizationId,
            postingDate: { lte: asOfDate },
            status: "UNMATCHED"
          }
        }),
        tx.bankImportedTransaction.count({
          where: {
            organizationId: context.organizationId,
            postingDate: { lte: asOfDate },
            reconciliationItems: {
              none: { active: true, reconciliation: { status: "COMPLETED" } }
            }
          }
        }),
        tx.bankImportBatch.count({
          where: { organizationId: context.organizationId, status: "PREVIEWED" }
        }),
        tx.bankImportBatch.count({
          where: { organizationId: context.organizationId, status: "FAILED" }
        }),
        tx.dataImportBatch.findMany({
          where: { organizationId: context.organizationId },
          select: { status: true, reconciliation: true, acknowledgedAt: true }
        }),
        tx.organizationSettings.findUnique({
          where: { organizationId: context.organizationId }
        }),
        tx.setupStepState.findUnique({
          where: {
            organizationId_step: {
              organizationId: context.organizationId,
              step: "TAX_REGISTRATION"
            }
          }
        }),
        tx.taxRegistration.count({
          where: {
            organizationId: context.organizationId,
            registered: true,
            OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: asOfDate } }],
            AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] }]
          }
        }),
        tx.taxCodeVersion.findMany({
          where: {
            organizationId: context.organizationId,
            effectiveFrom: { lte: asOfDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
            taxCode: { active: true }
          },
          select: {
            components: {
              select: {
                rate: true,
                recoverablePercent: true,
                payableAccountId: true,
                recoverableAccountId: true
              }
            }
          }
        }),
        tx.fiscalPeriod.findFirst({
          where: {
            organizationId: context.organizationId,
            startDate: { lte: asOfDate },
            endDate: { gte: asOfDate }
          },
          orderBy: [{ startDate: "desc" }, { id: "asc" }]
        })
      ]);

      const oldestOpenPeriod = await tx.fiscalPeriod.findFirst({
        where: {
          organizationId: context.organizationId,
          status: "OPEN",
          startDate: { lte: asOfDate }
        },
        orderBy: [{ endDate: "asc" }, { id: "asc" }]
      });
      const period = oldestOpenPeriod
        ? await periodCloseSnapshot(tx, context.organizationId, oldestOpenPeriod, asOfDate)
        : null;
      const missingFields = settingsMissingFields(settings);
      const importStatuses = importBatches.map((batch) => batch.status);

      return {
        commerce: {
          reviewRequired: commerceReviewRequired,
          received: commerceReceived,
          deadLetter: commerceDeadLetter,
          mappingIssueEvents: Number(mappingIssueRows[0]?.mappingIssueEvents ?? 0n),
          openConflicts: openConnectorConflicts
        },
        banking: {
          unmatched: unmatchedBankTransactions,
          unreconciled: unreconciledBankTransactions,
          previewImports: previewBankImports,
          failedImports: failedBankImports
        },
        imports: {
          incomplete: importStatuses.filter((status) =>
            ["UPLOADED", "VALIDATED", "PREVIEWED", "DRY_RUN", "COMMITTING"].includes(status)
          ).length,
          awaitingAcknowledgement: importBatches.filter(
            (batch) => batch.status === "COMMITTED" && !batch.acknowledgedAt
          ).length,
          failed: importStatuses.filter((status) => status === "FAILED").length,
          compensationRequired: importStatuses.filter(
            (status) => status === "COMPENSATION_REQUIRED"
          ).length,
          variance: importBatches.filter(
            (batch) => importReconciliationSignals(batch.reconciliation).length > 0
          ).length
        },
        settings: {
          setupCompleted: Boolean(settings?.setupCompletedAt),
          missingFields,
          taxStepReady: ["COMPLETED", "SKIPPED"].includes(taxStep?.status ?? "NOT_STARTED"),
          registeredTaxCount,
          effectiveTaxVersionCount: effectiveTaxVersions.length,
          missingTaxAccountCount: effectiveTaxVersions
            .flatMap((version) => version.components)
            .filter(
              (component) =>
                (decimalIsNonZero(component.rate) && !component.payableAccountId) ||
                (decimalIsNonZero(component.recoverablePercent) && !component.recoverableAccountId)
            ).length
        },
        period,
        fiscalPeriodCoversAsOf: Boolean(coveringPeriod)
      } satisfies BooksHealthSnapshot;
    });

    return buildBooksHealth(snapshot, asOf, this.now().toISOString());
  }
}

export function buildBooksHealth(snapshot: BooksHealthSnapshot, asOf: string, generatedAt: string) {
  const findings: BooksHealthFinding[] = [];
  const commerceBlocked = snapshot.commerce.deadLetter + snapshot.commerce.openConflicts;
  if (commerceBlocked > 0)
    findings.push({
      id: "COMMERCE_BLOCKED",
      category: "COMMERCE",
      severity: "BLOCKER",
      title: pluralized(
        commerceBlocked,
        "commerce issue cannot complete review",
        "commerce issues cannot complete review"
      ),
      reason: `${countPhrase(snapshot.commerce.deadLetter, "event cannot be processed", "events cannot be processed")} and ${countPhrase(snapshot.commerce.openConflicts, "connector conflict remains open", "connector conflicts remain open")}. Review the retained provider evidence; no accounting entry was created.`,
      count: commerceBlocked,
      target: targets.COMMERCE
    });
  const commerceWaiting = snapshot.commerce.reviewRequired + snapshot.commerce.received;
  if (commerceWaiting > 0)
    findings.push({
      id: "COMMERCE_REVIEW_REQUIRED",
      category: "COMMERCE",
      severity: "WARNING",
      title: pluralized(
        commerceWaiting,
        "commerce event is waiting for review",
        "commerce events are waiting for review"
      ),
      reason:
        snapshot.commerce.mappingIssueEvents > 0
          ? `${countPhrase(snapshot.commerce.mappingIssueEvents, "event has an item, SKU, or tax mapping issue", "events have item, SKU, or tax mapping issues")}. Resolve import rules and reconciliation findings in the review inbox; this remains non-posting.`
          : "Review normalization and reconciliation findings in the commerce inbox. These events remain non-posting.",
      count: commerceWaiting,
      target: targets.COMMERCE
    });

  if (snapshot.banking.failedImports > 0)
    findings.push({
      id: "BANK_IMPORT_FAILED",
      category: "BANKING",
      severity: "BLOCKER",
      title: pluralized(
        snapshot.banking.failedImports,
        "bank import failed",
        "bank imports failed"
      ),
      reason:
        "Review the failed statement import before relying on the bank activity shown in PennyWise Accounting.",
      count: snapshot.banking.failedImports,
      target: targets.BANKING
    });
  if (
    snapshot.banking.unmatched > 0 ||
    snapshot.banking.unreconciled > 0 ||
    snapshot.banking.previewImports > 0
  )
    findings.push({
      id: "BANK_REVIEW_REQUIRED",
      category: "BANKING",
      severity: "WARNING",
      title:
        snapshot.banking.unreconciled > 0
          ? pluralized(
              snapshot.banking.unreconciled,
              "bank transaction is outside a completed reconciliation",
              "bank transactions are outside a completed reconciliation"
            )
          : pluralized(
              snapshot.banking.previewImports,
              "bank import is still a preview",
              "bank imports are still previews"
            ),
      reason: `${countPhrase(snapshot.banking.unmatched, "transaction is unmatched", "transactions are unmatched")}; ${countPhrase(snapshot.banking.previewImports, "statement import is still a preview", "statement imports are still previews")}. Match or categorize activity, then complete statement reconciliation separately.`,
      count: snapshot.banking.unreconciled + snapshot.banking.previewImports,
      target: targets.BANKING
    });

  const failedImports = snapshot.imports.failed + snapshot.imports.compensationRequired;
  if (failedImports > 0)
    findings.push({
      id: "DATA_IMPORT_FAILED",
      category: "IMPORTS",
      severity: "BLOCKER",
      title: pluralized(failedImports, "data import needs recovery", "data imports need recovery"),
      reason:
        snapshot.imports.compensationRequired > 0
          ? `${countPhrase(snapshot.imports.compensationRequired, "batch requires compensation", "batches require compensation")} after a partial commit. Preserve history and follow the recorded recovery guidance.`
          : "Review the recorded import error before retrying. Failed imports do not silently complete.",
      count: failedImports,
      target: targets.IMPORTS
    });
  const importReview =
    snapshot.imports.incomplete +
    snapshot.imports.awaitingAcknowledgement +
    snapshot.imports.variance;
  if (importReview > 0)
    findings.push({
      id: "DATA_IMPORT_RECONCILIATION",
      category: "IMPORTS",
      severity: "WARNING",
      title: pluralized(
        importReview,
        "import check needs attention",
        "import checks need attention"
      ),
      reason: `${countPhrase(snapshot.imports.incomplete, "batch is incomplete", "batches are incomplete")}; ${countPhrase(snapshot.imports.awaitingAcknowledgement, "committed batch awaits review confirmation", "committed batches await review confirmation")}; ${countPhrase(snapshot.imports.variance, "batch records a reconciliation variance", "batches record reconciliation variances")}. Review the evidence before confirming migration completeness.`,
      count: importReview,
      target: targets.IMPORTS
    });

  if (!snapshot.settings.setupCompleted || snapshot.settings.missingFields.length > 0) {
    const setupTarget: BooksHealthTarget = {
      ...targets.TAX_SETTINGS,
      setupStep: snapshot.settings.missingFields.some((field) => field.includes("fiscal"))
        ? "FISCAL_CURRENCY"
        : "BUSINESS_PROFILE"
    };
    findings.push({
      id: "ACCOUNTING_SETTINGS_INCOMPLETE",
      category: "TAX_SETTINGS",
      severity: "WARNING",
      title: "Company accounting setup is not final",
      reason:
        snapshot.settings.missingFields.length > 0
          ? `Complete ${plainList(snapshot.settings.missingFields)} and finish the setup review before relying on period readiness.`
          : "The required fields are present, but the final setup review has not been completed.",
      count: Math.max(1, snapshot.settings.missingFields.length),
      target: setupTarget
    });
  }
  if (!snapshot.settings.taxStepReady)
    findings.push({
      id: "TAX_SETUP_UNREVIEWED",
      category: "TAX_SETTINGS",
      severity: "WARNING",
      title: "Tax registration choice needs review",
      reason:
        "Mark the tax step complete after configuring registrations, or explicitly skip it if the company is not registered. This automated check is not tax advice.",
      count: 1,
      target: targets.TAX_SETTINGS
    });
  if (snapshot.settings.registeredTaxCount > 0 && snapshot.settings.effectiveTaxVersionCount === 0)
    findings.push({
      id: "TAX_CODE_NOT_EFFECTIVE",
      category: "TAX_SETTINGS",
      severity: "BLOCKER",
      title: "Registered tax settings have no effective tax code",
      reason: `At least one registration is marked active, but no versioned tax code is effective on ${asOf}. Configure and review the tax treatment before posting taxable activity.`,
      count: snapshot.settings.registeredTaxCount,
      target: targets.TAX_SETTINGS
    });
  if (snapshot.settings.missingTaxAccountCount > 0)
    findings.push({
      id: "TAX_ACCOUNT_MAPPING_MISSING",
      category: "TAX_SETTINGS",
      severity: "BLOCKER",
      title: pluralized(
        snapshot.settings.missingTaxAccountCount,
        "tax component is missing a ledger account",
        "tax components are missing ledger accounts"
      ),
      reason:
        "An effective tax component with a non-zero rate needs a payable account, and a recoverable component needs a recoverable account. Posting taxable activity can fail until those mappings are reviewed.",
      count: snapshot.settings.missingTaxAccountCount,
      target: targets.TAX_SETTINGS
    });

  if (!snapshot.fiscalPeriodCoversAsOf)
    findings.push({
      id: "FISCAL_PERIOD_MISSING",
      category: "PERIOD_CLOSE",
      severity: "BLOCKER",
      title: "No fiscal period covers the selected date",
      reason: `Create or initialize a fiscal period that includes ${asOf}. Books Health did not infer a calendar or override company settings.`,
      count: 1,
      target: {
        workspaceId: "setup-workspace",
        anchorId: "setup-tabs",
        label: "Set fiscal calendar",
        setupStep: "FISCAL_CURRENCY"
      }
    });
  if (snapshot.period) {
    const closeCount = snapshot.period.blockers.reduce((sum, item) => sum + item.count, 0);
    if (closeCount > 0)
      findings.push({
        id: "PERIOD_CLOSE_REVIEW",
        category: "PERIOD_CLOSE",
        severity: snapshot.period.overdue ? "BLOCKER" : "WARNING",
        title: `${snapshot.period.name} has ${pluralized(closeCount, "close check", "close checks")} to review`,
        reason: `${closeBlockerSummary(snapshot.period.blockers)}. The period close preview requires these warnings to be reviewed; Books Health cannot close or post anything.`,
        count: closeCount,
        target: targets.PERIOD_CLOSE
      });
    else if (snapshot.period.overdue)
      findings.push({
        id: "PERIOD_READY_FOR_CLOSE_REVIEW",
        category: "PERIOD_CLOSE",
        severity: "NOTICE",
        title: `${snapshot.period.name} has ended and remains open`,
        reason:
          "No basic close blockers were found. Review the complete close preview before deciding whether to close the period.",
        count: 1,
        target: targets.PERIOD_CLOSE
      });
  }

  findings.sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      categoryRank(left.category) - categoryRank(right.category) ||
      left.id.localeCompare(right.id)
  );
  const blockerCount = findings.filter((finding) => finding.severity === "BLOCKER").length;
  const warningCount = findings.filter((finding) => finding.severity === "WARNING").length;
  const noticeCount = findings.filter((finding) => finding.severity === "NOTICE").length;

  return {
    asOf,
    generatedAt,
    status:
      blockerCount > 0
        ? "ACTION_REQUIRED"
        : warningCount > 0
          ? "REVIEW_RECOMMENDED"
          : noticeCount > 0
            ? "NOTICE"
            : "NO_FINDINGS",
    summary: {
      checkedAreas: 5,
      findingCount: findings.length,
      blockerCount,
      warningCount,
      noticeCount
    },
    areas: (Object.keys(categoryLabels) as BooksHealthCategory[]).map((category) => {
      const areaFindings = findings.filter((finding) => finding.category === category);
      return {
        category,
        label: categoryLabels[category],
        status: areaFindings.length ? areaFindings[0]!.severity : "NO_FINDINGS",
        findingCount: areaFindings.length,
        target: targets[category]
      };
    }),
    findings,
    mode: "READ_ONLY",
    accountingEntriesCreated: 0,
    disclaimer:
      "Automated checks use the records currently available in PennyWise Accounting. No finding means no automated exception was detected; it is not accountant, tax, provider, or professional approval."
  };
}

export function importReconciliationSignals(value: Prisma.JsonValue | null): readonly string[] {
  if (!isRecord(value)) return [];
  const signals: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (importDifferenceKeys.has(key) && !isExactZero(entry)) signals.push(key);
    else if (key === "inventoryReconciled" && entry === false) signals.push(key);
    else if (/^(failedRows|skippedRows)$/i.test(key) && positiveCount(entry) > 0) signals.push(key);
    else if (key === "unsupportedFields" && Array.isArray(entry) && entry.length > 0)
      signals.push(key);
  }
  return signals;
}

async function periodCloseSnapshot(
  tx: Prisma.TransactionClient,
  organizationId: string,
  period: { readonly id: string; readonly name: string; readonly endDate: Date },
  asOf: Date
): Promise<PeriodCloseSnapshot> {
  const cutoff = period.endDate < asOf ? period.endDate : asOf;
  const [
    manualDrafts,
    invoiceDrafts,
    billDrafts,
    unmatchedBank,
    unreconciledBankAccounts,
    incompleteBankImports,
    unresolvedPaymentWebhooks,
    failedOutboxEvents
  ] = await Promise.all([
    tx.manualJournalDraft.count({
      where: { organizationId, status: "DRAFT", effectiveDate: { lte: cutoff } }
    }),
    tx.invoice.count({
      where: { organizationId, status: { in: ["DRAFT", "APPROVED"] }, issueDate: { lte: cutoff } }
    }),
    tx.bill.count({
      where: { organizationId, status: { in: ["DRAFT", "APPROVED"] }, issueDate: { lte: cutoff } }
    }),
    tx.bankImportedTransaction.count({
      where: { organizationId, status: "UNMATCHED", postingDate: { lte: cutoff } }
    }),
    tx.bankAccount.count({
      where: {
        organizationId,
        isActive: true,
        importedTransactions: {
          some: {
            postingDate: { lte: cutoff },
            reconciliationItems: {
              none: { active: true, reconciliation: { status: "COMPLETED" } }
            }
          }
        }
      }
    }),
    tx.bankImportBatch.count({ where: { organizationId, status: "PREVIEWED" } }),
    tx.paymentWebhookEvent.count({
      where: { organizationId, status: { in: ["RECEIVED", "FAILED"] } }
    }),
    tx.outboxEvent.count({ where: { organizationId, status: "FAILED" } })
  ]);
  return {
    id: period.id,
    name: period.name,
    endDate: serializeDate(period.endDate).slice(0, 10),
    overdue: period.endDate < asOf,
    blockers: [
      { label: "manual journal drafts", count: manualDrafts },
      { label: "draft invoices", count: invoiceDrafts },
      { label: "draft bills", count: billDrafts },
      { label: "unmatched bank transactions", count: unmatchedBank },
      { label: "bank accounts with unreconciled activity", count: unreconciledBankAccounts },
      { label: "uncommitted bank imports", count: incompleteBankImports },
      { label: "unresolved payment webhooks", count: unresolvedPaymentWebhooks },
      { label: "failed outbox events", count: failedOutboxEvents }
    ].filter((item) => item.count > 0)
  };
}

function settingsMissingFields(
  settings: {
    readonly businessType: string | null;
    readonly accountingStartDate: Date | null;
    readonly fiscalYearEndMonth: number | null;
    readonly fiscalYearEndDay: number | null;
    readonly baseCurrency: string;
  } | null
): readonly string[] {
  if (!settings)
    return ["business type", "accounting start date", "fiscal year end", "base currency"];
  return [
    ...(settings.businessType?.trim() ? [] : ["business type"]),
    ...(settings.accountingStartDate ? [] : ["accounting start date"]),
    ...(settings.fiscalYearEndMonth && settings.fiscalYearEndDay ? [] : ["fiscal year end"]),
    ...(settings.baseCurrency.trim() ? [] : ["base currency"])
  ];
}

function closeBlockerSummary(
  blockers: readonly { readonly label: string; readonly count: number }[]
): string {
  const shown = blockers.slice(0, 3).map((item) => `${item.count.toString()} ${item.label}`);
  const remaining = blockers.length - shown.length;
  return `${shown.join(", ")}${remaining > 0 ? `, plus ${remaining.toString()} more ${remaining === 1 ? "area" : "areas"}` : ""}`;
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count.toString()} ${count === 1 ? singular : plural}`;
}

function pluralized(count: number, singular: string, plural: string): string {
  return `${count.toString()} ${count === 1 ? singular : plural}`;
}

function plainList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "the missing settings";
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)!}`;
}

function severityRank(value: BooksHealthSeverity): number {
  return value === "BLOCKER" ? 0 : value === "WARNING" ? 1 : 2;
}

function categoryRank(value: BooksHealthCategory): number {
  return ["COMMERCE", "BANKING", "IMPORTS", "TAX_SETTINGS", "PERIOD_CLOSE"].indexOf(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExactZero(value: unknown): boolean {
  if (typeof value === "number") return value === 0;
  return typeof value === "string" && /^[+-]?0+$/.test(value.trim());
}

const importDifferenceKeys = new Set([
  "openingTrialBalanceDifferenceMinor",
  "receivablesDifferenceMinor",
  "payablesDifferenceMinor",
  "inventoryDifferenceMinor"
]);

function decimalIsNonZero(value: { toString(): string }): boolean {
  return !/^[+-]?0+(?:\.0+)?$/.test(value.toString());
}

function positiveCount(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return Math.max(0, value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
