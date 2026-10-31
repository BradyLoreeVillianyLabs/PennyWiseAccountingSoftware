import {
  parseMinorUnit,
  serializeMinorUnit,
  validateJournalLines
} from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import { JournalService } from "./journal-service.js";

interface OpeningLineInput {
  accountId: string;
  debitMinor: string;
  creditMinor: string;
  controlDifferenceMinor?: string | null | undefined;
  note?: string | null | undefined;
}

export class OpeningBalanceService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;
  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
  }

  public async saveDraft(
    context: OrganizationContext,
    input: {
      version?: number | undefined;
      effectiveDate: string;
      lines: readonly OpeningLineInput[];
    }
  ) {
    await this.authorization.assert(context, "opening-balances:manage", "OpeningBalanceDraft");
    const parsed = parseLines(input.lines);
    validateJournalLines(parsed);
    return withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        const posted = await tx.openingBalanceDraft.findFirst({
          where: { organizationId: context.organizationId, status: "POSTED" }
        });
        if (posted)
          throw new AppError(
            "OPENING_BALANCE_ALREADY_POSTED",
            "Reverse the posted opening balance before creating a correction.",
            409
          );
        const effectiveDate = parseDate(input.effectiveDate, "effectiveDate");
        const settings = await tx.organizationSettings.findUniqueOrThrow({
          where: { organizationId: context.organizationId }
        });
        if (
          !settings.accountingStartDate ||
          settings.accountingStartDate.getTime() !== effectiveDate.getTime()
        )
          throw new AppError(
            "OPENING_BALANCE_DATE_INVALID",
            "Opening balances must use the accounting start date.",
            422
          );
        let draft = await tx.openingBalanceDraft.findFirst({
          where: { organizationId: context.organizationId, status: "DRAFT" }
        });
        if (draft) {
          const updated = await tx.openingBalanceDraft.updateMany({
            where: {
              id: draft.id,
              organizationId: context.organizationId,
              version: input.version ?? -1
            },
            data: { effectiveDate, version: { increment: 1 } }
          });
          if (updated.count !== 1)
            throw new AppError(
              "STALE_VERSION",
              "Opening balances were changed by another request.",
              409
            );
          await tx.openingBalanceLine.deleteMany({
            where: { openingBalanceDraftId: draft.id, organizationId: context.organizationId }
          });
        } else {
          draft = await tx.openingBalanceDraft.create({
            data: { organizationId: context.organizationId, effectiveDate }
          });
        }
        await validateAccounts(tx, context.organizationId, input.lines);
        await tx.openingBalanceLine.createMany({
          data: input.lines.map((line) => ({
            organizationId: context.organizationId,
            openingBalanceDraftId: draft.id,
            accountId: line.accountId,
            debitMinor: parseMinorUnit(line.debitMinor, "debitMinor"),
            creditMinor: parseMinorUnit(line.creditMinor, "creditMinor"),
            controlDifferenceMinor:
              line.controlDifferenceMinor == null
                ? null
                : parseSignedMinor(line.controlDifferenceMinor),
            note: line.note ?? null
          }))
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "OPENING_BALANCE_DRAFT_SAVED",
            targetType: "OpeningBalanceDraft",
            targetId: draft.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, { lineCount: input.lines.length })
          }
        });
        return draftDto(
          await tx.openingBalanceDraft.findUniqueOrThrow({
            where: { id: draft.id },
            include: { lines: true }
          })
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async getDraft(context: OrganizationContext) {
    await this.authorization.assert(context, "settings:read", "OpeningBalanceDraft");
    const draft = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.openingBalanceDraft.findFirst({
        where: { organizationId: context.organizationId },
        include: { lines: true },
        orderBy: { createdAt: "desc" }
      })
    );
    return draft ? draftDto(draft) : null;
  }

  public async post(context: OrganizationContext, draftId: string, idempotencyKey?: string) {
    await this.authorization.assert(
      context,
      "opening-balances:manage",
      "OpeningBalanceDraft",
      draftId
    );
    return runIdempotent(
      this.prisma,
      context,
      "opening-balance.post",
      idempotencyKey,
      { draftId },
      async (tx) => {
        const draft = await tx.openingBalanceDraft.findFirst({
          where: { id: draftId, organizationId: context.organizationId, status: "DRAFT" },
          include: { lines: true }
        });
        if (!draft)
          throw new AppError(
            "OPENING_BALANCE_DRAFT_NOT_FOUND",
            "Opening balance draft was not found or is no longer editable.",
            404
          );
        const parsed = draft.lines.map((line) => ({
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor
        }));
        validateJournalLines(parsed);
        const journal = await this.journals.postJournalInTransaction(tx, context, {
          description: "Opening balances",
          effectiveDate: draft.effectiveDate.toISOString(),
          sourceType: "opening_balance",
          sourceId: draft.id,
          postingKey: `opening-balance:${draft.id}`,
          reason: "Initial accounting balances",
          allowControlAccountPosting: true,
          lines: draft.lines.map((line) => ({
            accountId: line.accountId,
            description: line.note ?? undefined,
            debitMinor: serializeMinorUnit(line.debitMinor),
            creditMinor: serializeMinorUnit(line.creditMinor)
          }))
        });
        const updated = await tx.openingBalanceDraft.update({
          where: { id: draft.id },
          data: {
            status: "POSTED",
            journalId: journal.id,
            postedAt: new Date(),
            postedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "OPENING_BALANCE_POSTED",
            targetType: "OpeningBalanceDraft",
            targetId: draft.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, {
              journalId: journal.id,
              unresolvedControlDifferences: draft.lines
                .filter((line) => line.controlDifferenceMinor !== null)
                .map((line) => ({
                  accountId: line.accountId,
                  minor: line.controlDifferenceMinor!.toString()
                }))
            })
          }
        });
        return {
          statusCode: 201,
          body: { openingBalance: draftDto({ ...updated, lines: draft.lines }) },
          resourceId: journal.id
        };
      }
    );
  }

  public async markReversed(context: OrganizationContext, draftId: string) {
    await this.authorization.assert(
      context,
      "opening-balances:manage",
      "OpeningBalanceDraft",
      draftId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const draft = await tx.openingBalanceDraft.findFirst({
        where: { id: draftId, organizationId: context.organizationId, status: "POSTED" }
      });
      if (!draft?.journalId)
        throw new AppError(
          "OPENING_BALANCE_NOT_POSTED",
          "Posted opening balances were not found.",
          404
        );
      const reversal = await tx.journal.findFirst({
        where: {
          organizationId: context.organizationId,
          reversedJournalId: draft.journalId,
          status: "POSTED"
        }
      });
      if (!reversal)
        throw new AppError(
          "OPENING_BALANCE_REVERSAL_REQUIRED",
          "Reverse the opening-balance journal before starting a correction.",
          409
        );
      return tx.openingBalanceDraft.update({
        where: { id: draft.id },
        data: { status: "REVERSED", version: { increment: 1 } }
      });
    });
  }
}

function parseLines(lines: readonly OpeningLineInput[]) {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitMinor: parseMinorUnit(line.debitMinor, "debitMinor"),
    creditMinor: parseMinorUnit(line.creditMinor, "creditMinor")
  }));
}
function parseSignedMinor(value: string) {
  if (!/^-?\d+$/.test(value))
    throw new AppError(
      "INVALID_MINOR_UNIT",
      "Control difference must be an integer minor-unit string.",
      422
    );
  return BigInt(value);
}
async function validateAccounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lines: readonly OpeningLineInput[]
) {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  if (ids.length !== lines.length)
    throw new AppError("DUPLICATE_OPENING_ACCOUNT", "Each account may appear once.", 422);
  const count = await tx.account.count({
    where: { organizationId, id: { in: ids }, isArchived: false }
  });
  if (count !== ids.length)
    throw new AppError(
      "OPENING_ACCOUNT_INVALID",
      "One or more opening-balance accounts are invalid.",
      422
    );
}
function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
function draftDto<
  T extends {
    lines: readonly {
      accountId: string;
      debitMinor: bigint;
      creditMinor: bigint;
      controlDifferenceMinor: bigint | null;
    }[];
  }
>(draft: T) {
  return {
    ...draft,
    lines: draft.lines.map((line) => ({
      ...line,
      debitMinor: line.debitMinor.toString(),
      creditMinor: line.creditMinor.toString(),
      controlDifferenceMinor: line.controlDifferenceMinor?.toString() ?? null
    })),
    warnings: draft.lines
      .filter((line) => line.controlDifferenceMinor !== null)
      .map((line) => ({
        accountId: line.accountId,
        code: "CONTROL_DETAIL_PENDING"
      }))
  };
}
