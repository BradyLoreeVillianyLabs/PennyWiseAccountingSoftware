import {
  buildReversalLines,
  convertMinorUnits,
  parseMinorUnit,
  serializeMinorUnit,
  validateJournalLines,
  type JournalLineInput
} from "@clearledger/accounting-core";
import {
  Prisma,
  withTenantTransaction,
  type JournalStatus,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import { assertMultiCurrencyPostingReleased } from "./multi-currency-release-gate.js";

type TransactionClient = Prisma.TransactionClient;

export interface PostJournalInput {
  readonly description: string;
  readonly effectiveDate: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly postingKey: string;
  readonly transactionCurrency?: string | undefined;
  readonly fxRateSnapshotId?: string | undefined;
  readonly reason?: string | undefined;
  readonly allowControlAccountPosting: boolean;
  readonly lines: readonly {
    readonly accountId: string;
    readonly description?: string | undefined;
    readonly debitMinor: string;
    readonly creditMinor: string;
    readonly transactionMinor?: string | undefined;
    readonly fxRateSnapshotId?: string | undefined;
    readonly conversionPolicy?: "SPOT" | "CARRYING_VALUE" | undefined;
  }[];
}

export interface ReverseJournalInput {
  readonly effectiveDate: string;
  readonly reason: string;
}

interface JournalLineRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly companyId: string | null;
  readonly journalId: string;
  readonly accountId: string;
  readonly lineNumber: number;
  readonly description: string | null;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly transactionCurrency: string | null;
  readonly transactionMinor: bigint | null;
  readonly baseCurrency: string;
  readonly transactionExponentSnapshot: number | null;
  readonly baseExponentSnapshot: number | null;
  readonly conversionNumerator: bigint | null;
  readonly conversionDenominator: bigint | null;
  readonly fxRateSnapshotId: string | null;
  readonly createdAt: Date;
}

interface JournalRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly companyId: string | null;
  readonly fiscalPeriodId: string;
  readonly status: JournalStatus;
  readonly effectiveDate: Date;
  readonly description: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly postingKey: string;
  readonly baseCurrency: string;
  readonly fxRateSnapshotId: string | null;
  readonly reversedJournalId: string | null;
  readonly postedAt: Date | null;
  readonly postedByUserId: string | null;
  readonly createdAt: Date;
  readonly lines: readonly JournalLineRecord[];
}

export class JournalService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listJournals(context: OrganizationContext) {
    await this.authorization.assert(context, "reports:read", "Journal");

    const journals = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.journal.findMany({
        where: {
          organizationId: context.organizationId,
          ...companyScope(context),
          status: "POSTED"
        },
        include: {
          lines: { orderBy: { lineNumber: "asc" } }
        },
        orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }]
      })
    );

    return journals.map((journal) => this.journalDto(journal));
  }

  public async getJournal(context: OrganizationContext, journalId: string) {
    await this.authorization.assert(context, "reports:read", "Journal", journalId);

    const journal = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.journal.findFirst({
        where: {
          id: journalId,
          organizationId: context.organizationId,
          ...companyScope(context)
        },
        include: {
          lines: { orderBy: { lineNumber: "asc" } }
        }
      })
    );

    if (!journal) {
      throw new AppError("JOURNAL_NOT_FOUND", "Journal was not found.", 404);
    }

    return this.journalDto(journal);
  }

  public async postJournal(
    context: OrganizationContext,
    input: PostJournalInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "journals:post", "Journal");

    const requestPayload = { operation: "journal.post", body: input };

    try {
      return await runIdempotent(
        this.prisma,
        context,
        "journal.post",
        idempotencyKey,
        requestPayload,
        async (tx) => {
          const journal = await this.createPostedJournal(tx, context, input, null);

          return {
            statusCode: 201,
            body: { journal: this.journalDto(journal) },
            resourceId: journal.id
          };
        }
      );
    } catch (error) {
      await this.throwDuplicatePostingIfPresent(context, input, error);
      throw error;
    }
  }

  public async reverseJournal(
    context: OrganizationContext,
    journalId: string,
    input: ReverseJournalInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "journals:reverse", "Journal", journalId);

    const requestPayload = { operation: "journal.reverse", journalId, body: input };

    try {
      return await runIdempotent(
        this.prisma,
        context,
        "journal.reverse",
        idempotencyKey,
        requestPayload,
        async (tx) => {
          const original = await tx.journal.findFirst({
            where: {
              id: journalId,
              organizationId: context.organizationId,
              ...companyScope(context),
              status: "POSTED"
            },
            include: {
              lines: { orderBy: { lineNumber: "asc" } }
            }
          });

          if (!original) {
            throw new AppError("JOURNAL_NOT_FOUND", "Journal was not found.", 404);
          }

          const existingReversal = await tx.journal.findFirst({
            where: {
              organizationId: context.organizationId,
              ...companyScope(context),
              reversedJournalId: original.id
            }
          });

          if (existingReversal) {
            throw new AppError("JOURNAL_ALREADY_REVERSED", "Journal already has a reversal.", 409, {
              reversalJournalId: existingReversal.id
            });
          }

          const reversalLines = buildReversalLines(
            original.lines.map((line) => ({
              accountId: line.accountId,
              description: line.description,
              debitMinor: line.debitMinor,
              creditMinor: line.creditMinor
            }))
          );

          const reversal = await this.createPostedJournal(
            tx,
            context,
            {
              description: `Reversal: ${original.description}`,
              effectiveDate: input.effectiveDate,
              sourceType: "journal_reversal",
              sourceId: original.id,
              postingKey: `reversal:${original.id}`,
              reason: input.reason,
              allowControlAccountPosting: true,
              transactionCurrency:
                original.baseCurrency === original.lines[0]?.transactionCurrency
                  ? undefined
                  : (original.lines[0]?.transactionCurrency ?? undefined),
              fxRateSnapshotId: original.fxRateSnapshotId ?? undefined,
              lines: reversalLines.map((line, index) => ({
                accountId: line.accountId,
                description: line.description ?? undefined,
                debitMinor: serializeMinorUnit(line.debitMinor),
                creditMinor: serializeMinorUnit(line.creditMinor),
                transactionMinor: negateOptionalMinor(original.lines[index]?.transactionMinor),
                conversionPolicy: "CARRYING_VALUE"
              }))
            },
            original.id,
            true
          );

          return {
            statusCode: 201,
            body: { journal: this.journalDto(reversal) },
            resourceId: reversal.id
          };
        }
      );
    } catch (error) {
      await this.throwReversalConflictIfPresent(context, journalId, error);
      throw error;
    }
  }

  public async postJournalInTransaction(
    tx: TransactionClient,
    context: OrganizationContext,
    input: PostJournalInput,
    domainWorkflow = false
  ): Promise<{ readonly id: string }> {
    return this.createPostedJournal(tx, context, input, null, false, domainWorkflow);
  }

  public async reverseJournalInTransaction(
    tx: TransactionClient,
    context: OrganizationContext,
    journalId: string,
    input: ReverseJournalInput,
    sourceType: string,
    sourceId: string,
    postingKey: string
  ): Promise<{ readonly id: string }> {
    const original = await tx.journal.findFirst({
      where: {
        id: journalId,
        organizationId: context.organizationId,
        ...companyScope(context),
        status: "POSTED"
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });
    if (!original) throw new AppError("JOURNAL_NOT_FOUND", "Journal was not found.", 404);
    const existing = await tx.journal.findFirst({
      where: {
        organizationId: context.organizationId,
        ...companyScope(context),
        reversedJournalId: journalId
      }
    });
    if (existing)
      throw new AppError("JOURNAL_ALREADY_REVERSED", "Journal already has a reversal.", 409, {
        reversalJournalId: existing.id
      });
    const reversalLines = buildReversalLines(
      original.lines.map((line) => ({
        accountId: line.accountId,
        description: line.description,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor
      }))
    );
    return this.createPostedJournal(
      tx,
      context,
      {
        description: `Reversal: ${original.description}`,
        effectiveDate: input.effectiveDate,
        sourceType,
        sourceId,
        postingKey,
        reason: input.reason,
        allowControlAccountPosting: true,
        transactionCurrency:
          original.baseCurrency === original.lines[0]?.transactionCurrency
            ? undefined
            : (original.lines[0]?.transactionCurrency ?? undefined),
        fxRateSnapshotId: original.fxRateSnapshotId ?? undefined,
        lines: reversalLines.map((line, index) => ({
          accountId: line.accountId,
          description: line.description ?? undefined,
          debitMinor: line.debitMinor.toString(),
          creditMinor: line.creditMinor.toString(),
          transactionMinor: negateOptionalMinor(original.lines[index]?.transactionMinor),
          conversionPolicy: "CARRYING_VALUE"
        }))
      },
      original.id,
      true,
      true
    );
  }

  private async throwReversalConflictIfPresent(
    context: OrganizationContext,
    journalId: string,
    error: unknown
  ): Promise<void> {
    if (error instanceof AppError || !isDatabaseConflict(error)) {
      throw error;
    }

    const existingReversal = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.journal.findFirst({
        where: {
          organizationId: context.organizationId,
          ...companyScope(context),
          reversedJournalId: journalId
        },
        select: { id: true }
      })
    );

    if (!existingReversal) {
      throw error;
    }

    throw new AppError("JOURNAL_ALREADY_REVERSED", "Journal already has a reversal.", 409, {
      reversalJournalId: existingReversal.id
    });
  }

  private async throwDuplicatePostingIfPresent(
    context: OrganizationContext,
    input: PostJournalInput,
    error: unknown
  ): Promise<void> {
    if (error instanceof AppError || !isDatabaseConflict(error)) {
      throw error;
    }

    const existing = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.journal.findFirst({
        where: {
          organizationId: context.organizationId,
          ...companyScope(context),
          OR: [
            { postingKey: input.postingKey },
            {
              sourceType: input.sourceType,
              sourceId: input.sourceId
            }
          ]
        },
        select: {
          id: true,
          postingKey: true,
          sourceType: true,
          sourceId: true
        }
      })
    );

    if (!existing) {
      throw error;
    }

    throw new AppError(
      "DUPLICATE_POSTING",
      "A journal has already been posted for this source.",
      409,
      {
        journalId: existing.id,
        postingKey: existing.postingKey,
        sourceType: existing.sourceType,
        sourceId: existing.sourceId
      }
    );
  }

  private async createPostedJournal(
    tx: TransactionClient,
    context: OrganizationContext,
    input: PostJournalInput,
    reversedJournalId: string | null,
    isSystemReversal = false,
    isDomainWorkflow = false
  ): Promise<JournalRecord> {
    const effectiveDate = parseDate(input.effectiveDate, "effectiveDate");
    const organization = await tx.organization.findUnique({
      where: { id: context.organizationId },
      select: { currency: true }
    });
    if (!organization)
      throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
    const company = context.companyId
      ? await tx.company.findFirst({
          where: {
            id: context.companyId,
            organizationId: context.organizationId,
            status: "ACTIVE"
          },
          select: { baseCurrency: true }
        })
      : null;
    if (context.companyId && !company) {
      throw new AppError("COMPANY_NOT_FOUND", "The selected company was not found.", 404);
    }
    const baseCurrency = (company?.baseCurrency ?? organization.currency).trim();
    const transactionCurrency = (input.transactionCurrency ?? baseCurrency).trim().toUpperCase();
    assertMultiCurrencyPostingReleased(transactionCurrency, baseCurrency);
    if (transactionCurrency !== baseCurrency) {
      if (!isDomainWorkflow && !isSystemReversal)
        throw new AppError(
          "FOREIGN_MANUAL_JOURNAL_UNSUPPORTED",
          "Foreign-currency journals must be posted from a supported invoice, payment, bill, settlement, or revaluation workflow.",
          422
        );
      const settings = await tx.organizationSettings.findUnique({
        where: { organizationId: context.organizationId },
        select: { multiCurrencyEnabled: true }
      });
      const enabledCurrency = await tx.organizationCurrency.findUnique({
        where: {
          organizationId_currencyCode: {
            organizationId: context.organizationId,
            currencyCode: transactionCurrency
          }
        },
        select: { enabled: true }
      });
      if (!settings?.multiCurrencyEnabled || !enabledCurrency?.enabled)
        throw new AppError(
          "MULTI_CURRENCY_NOT_ENABLED",
          `Enable ${transactionCurrency} in multi-currency settings before posting.`,
          409
        );
    }
    type RateSnapshot = {
      id: string;
      transactionCurrency: string;
      baseCurrency: string;
      transactionExponent: number;
      baseExponent: number;
      numerator: bigint;
      denominator: bigint;
    };
    const rateIds = [
      ...(input.fxRateSnapshotId ? [input.fxRateSnapshotId] : []),
      ...input.lines
        .map((line) => line.fxRateSnapshotId)
        .filter((value): value is string => Boolean(value))
    ];
    const snapshots = new Map<string, RateSnapshot>();
    for (const rateId of [...new Set(rateIds)]) {
      const snapshot = await tx.fxRateSnapshot.findFirst({
        where: { id: rateId, organizationId: context.organizationId },
        select: {
          id: true,
          transactionCurrency: true,
          baseCurrency: true,
          transactionExponent: true,
          baseExponent: true,
          numerator: true,
          denominator: true
        }
      });
      if (!snapshot)
        throw new AppError("FX_RATE_NOT_FOUND", "FX rate snapshot was not found.", 422);
      snapshots.set(rateId, {
        ...snapshot,
        transactionCurrency: snapshot.transactionCurrency.trim(),
        baseCurrency: snapshot.baseCurrency.trim()
      });
    }
    const journalRate = input.fxRateSnapshotId
      ? (snapshots.get(input.fxRateSnapshotId) ?? null)
      : null;
    if (
      transactionCurrency !== baseCurrency &&
      !journalRate &&
      !input.lines.some((line) => line.fxRateSnapshotId)
    )
      throw new AppError(
        "FX_RATE_REQUIRED",
        "A locked FX rate snapshot is required for a foreign-currency journal.",
        422
      );
    const lines = input.lines.map<JournalLineInput>((line) => ({
      accountId: line.accountId,
      description: line.description,
      debitMinor: parseMinorUnit(line.debitMinor, "debitMinor"),
      creditMinor: parseMinorUnit(line.creditMinor, "creditMinor")
    }));
    const currencyLines = input.lines.map((line, index) => {
      const lineRate = line.fxRateSnapshotId
        ? (snapshots.get(line.fxRateSnapshotId) ?? null)
        : line.transactionMinor !== undefined
          ? journalRate
          : null;
      if (
        lineRate &&
        (lineRate.transactionCurrency !== transactionCurrency ||
          lineRate.baseCurrency !== baseCurrency)
      )
        throw new AppError(
          "FX_RATE_CURRENCY_MISMATCH",
          "FX rate snapshot does not match the journal currencies.",
          422
        );
      const transactionMinor = line.transactionMinor
        ? parseMinorUnit(line.transactionMinor, "transactionMinor")
        : transactionCurrency === baseCurrency
          ? lines[index]!.debitMinor - lines[index]!.creditMinor
          : null;
      if (transactionMinor === null && lineRate)
        throw new AppError(
          "TRANSACTION_AMOUNT_REQUIRED",
          "Foreign-currency journal lines require transactionMinor.",
          422
        );
      if (lineRate && line.conversionPolicy !== "CARRYING_VALUE") {
        const expectedBase = convertMinorUnits(
          transactionMinor!,
          {
            code: transactionCurrency,
            exponent: lineRate.transactionExponent,
            name: transactionCurrency
          },
          { code: baseCurrency, exponent: lineRate.baseExponent, name: baseCurrency },
          { numerator: lineRate.numerator, denominator: lineRate.denominator }
        );
        const actualBase = lines[index]!.debitMinor - lines[index]!.creditMinor;
        const variance =
          expectedBase > actualBase ? expectedBase - actualBase : actualBase - expectedBase;
        if (variance > 1n) {
          throw new AppError(
            "FX_CONVERSION_MISMATCH",
            "Transaction and base amounts do not match the locked FX rate.",
            422,
            {
              lineNumber: index + 1,
              expectedBase: expectedBase.toString(),
              actualBase: actualBase.toString()
            }
          );
        }
      }
      return {
        transactionMinor,
        rate: lineRate
      };
    });
    const totals = validateJournalLines(lines);
    const fiscalPeriod = await this.findPostingPeriod(
      tx,
      context.organizationId,
      context.companyId,
      effectiveDate
    );

    await this.assertAccountsPostable(
      tx,
      context,
      lines,
      input,
      isSystemReversal,
      isDomainWorkflow
    );
    await this.assertUniquePosting(tx, context, input);

    const draftJournal = await tx.journal.create({
      data: {
        organizationId: context.organizationId,
        companyId: context.companyId ?? null,
        fiscalPeriodId: fiscalPeriod.id,
        status: "DRAFT",
        effectiveDate,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        postingKey: input.postingKey,
        baseCurrency,
        fxRateSnapshotId: journalRate?.id ?? null,
        reversedJournalId
      }
    });

    await tx.journalLine.createMany({
      data: lines.map((line, index) => ({
        organizationId: context.organizationId,
        companyId: context.companyId ?? null,
        journalId: draftJournal.id,
        accountId: line.accountId,
        lineNumber: index + 1,
        description: line.description ?? null,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        transactionCurrency:
          currencyLines[index]!.transactionMinor === null ? null : transactionCurrency,
        transactionMinor: currencyLines[index]!.transactionMinor,
        baseCurrency,
        transactionExponentSnapshot: currencyLines[index]!.rate?.transactionExponent ?? 2,
        baseExponentSnapshot: currencyLines[index]!.rate?.baseExponent ?? 2,
        conversionNumerator: currencyLines[index]!.rate?.numerator ?? 1n,
        conversionDenominator: currencyLines[index]!.rate?.denominator ?? 1n,
        fxRateSnapshotId: currencyLines[index]!.rate?.id ?? null
      }))
    });

    const postedJournal = await tx.journal.update({
      where: { id: draftJournal.id },
      data: {
        status: "POSTED",
        postedAt: new Date(),
        postedByUserId: context.user.id
      },
      include: {
        lines: { orderBy: { lineNumber: "asc" } }
      }
    });

    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        action: reversedJournalId ? "JOURNAL_REVERSED" : "JOURNAL_POSTED",
        targetType: "Journal",
        targetId: postedJournal.id,
        requestId: context.requestId,
        reason: input.reason ?? null,
        metadata: withAuditOrigin(context, {
          debitMinor: totals.debitMinor.toString(),
          creditMinor: totals.creditMinor.toString(),
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          postingKey: input.postingKey,
          reversedJournalId
        })
      }
    });

    await tx.outboxEvent.create({
      data: {
        organizationId: context.organizationId,
        eventType: reversedJournalId ? "ledger.journal.reversed" : "ledger.journal.posted",
        aggregateType: "Journal",
        aggregateId: postedJournal.id,
        payload: {
          journalId: postedJournal.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          reversedJournalId
        }
      }
    });

    return postedJournal;
  }

  private async findPostingPeriod(
    tx: TransactionClient,
    organizationId: string,
    companyId: string | null | undefined,
    effectiveDate: Date
  ) {
    const candidate = await tx.fiscalPeriod.findFirst({
      where: {
        organizationId,
        ...(companyId ? { companyId } : {}),
        startDate: { lte: effectiveDate },
        endDate: { gte: effectiveDate }
      },
      orderBy: { startDate: "desc" },
      select: { id: true }
    });
    if (candidate) {
      if (companyId) {
        await tx.$queryRaw`
          SELECT id FROM "FiscalPeriod"
           WHERE id = ${candidate.id}::uuid
             AND "organizationId" = ${organizationId}::uuid
             AND "companyId" = ${companyId}::uuid
           FOR SHARE
        `;
      } else {
        await tx.$queryRaw`
          SELECT id FROM "FiscalPeriod"
           WHERE id = ${candidate.id}::uuid
             AND "organizationId" = ${organizationId}::uuid
           FOR SHARE
        `;
      }
    }
    const period = candidate
      ? await tx.fiscalPeriod.findUnique({ where: { id: candidate.id } })
      : null;

    if (!period) {
      throw new AppError(
        "FISCAL_PERIOD_NOT_FOUND",
        "No fiscal period contains the effective date.",
        422
      );
    }

    if (period.status === "CLOSED") {
      throw new AppError(
        "PERIOD_LOCKED",
        "The transaction date is in a locked fiscal period.",
        409,
        {
          periodId: period.id
        }
      );
    }

    return period;
  }

  private async assertUniquePosting(
    tx: TransactionClient,
    context: OrganizationContext,
    input: PostJournalInput
  ): Promise<void> {
    const existing = await tx.journal.findFirst({
      where: {
        organizationId: context.organizationId,
        ...companyScope(context),
        OR: [
          { postingKey: input.postingKey },
          {
            sourceType: input.sourceType,
            sourceId: input.sourceId
          }
        ]
      },
      select: {
        id: true,
        postingKey: true,
        sourceType: true,
        sourceId: true
      }
    });

    if (!existing) {
      return;
    }

    throw new AppError(
      "DUPLICATE_POSTING",
      "A journal has already been posted for this source.",
      409,
      {
        journalId: existing.id,
        postingKey: existing.postingKey,
        sourceType: existing.sourceType,
        sourceId: existing.sourceId
      }
    );
  }

  private async assertAccountsPostable(
    tx: TransactionClient,
    context: OrganizationContext,
    lines: readonly JournalLineInput[],
    input: PostJournalInput,
    isSystemReversal: boolean,
    isDomainWorkflow: boolean
  ): Promise<void> {
    const uniqueAccountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await tx.account.findMany({
      where: {
        organizationId: context.organizationId,
        ...companyScope(context),
        id: { in: uniqueAccountIds }
      }
    });

    if (accounts.length !== uniqueAccountIds.length) {
      throw new AppError("ACCOUNT_NOT_FOUND", "One or more accounts were not found.", 422);
    }

    const archived = accounts.find((account) => account.isArchived);
    if (archived) {
      throw new AppError("ACCOUNT_ARCHIVED", "Archived accounts cannot be posted to.", 422, {
        accountId: archived.id
      });
    }

    const controlAccounts = accounts.filter((account) => account.isControl);
    if (controlAccounts.length === 0 || isSystemReversal || isDomainWorkflow) {
      return;
    }

    if (!input.allowControlAccountPosting) {
      throw new AppError(
        "CONTROL_ACCOUNT_RESTRICTED",
        "Manual journals cannot post to control accounts without an explicit override.",
        403
      );
    }

    await this.authorization.assert(context, "control-accounts:post", "Account");

    if (!input.reason?.trim()) {
      throw new AppError(
        "CONTROL_ACCOUNT_REASON_REQUIRED",
        "A reason is required to post directly to a control account.",
        400
      );
    }
  }

  private journalDto(journal: JournalRecord) {
    return {
      id: journal.id,
      organizationId: journal.organizationId,
      companyId: journal.companyId,
      fiscalPeriodId: journal.fiscalPeriodId,
      status: journal.status,
      effectiveDate: serializeDate(journal.effectiveDate),
      description: journal.description,
      sourceType: journal.sourceType,
      sourceId: journal.sourceId,
      postingKey: journal.postingKey,
      baseCurrency: journal.baseCurrency.trim(),
      fxRateSnapshotId: journal.fxRateSnapshotId,
      reversedJournalId: journal.reversedJournalId,
      postedAt: journal.postedAt ? serializeDate(journal.postedAt) : null,
      postedByUserId: journal.postedByUserId,
      createdAt: serializeDate(journal.createdAt),
      lines: journal.lines.map((line) => ({
        id: line.id,
        organizationId: line.organizationId,
        companyId: line.companyId,
        journalId: line.journalId,
        accountId: line.accountId,
        lineNumber: line.lineNumber,
        description: line.description,
        debitMinor: serializeMinorUnit(line.debitMinor),
        creditMinor: serializeMinorUnit(line.creditMinor),
        transactionCurrency: line.transactionCurrency?.trim() ?? null,
        transactionMinor:
          line.transactionMinor === null ? null : serializeMinorUnit(line.transactionMinor),
        baseCurrency: line.baseCurrency.trim(),
        transactionExponentSnapshot: line.transactionExponentSnapshot,
        baseExponentSnapshot: line.baseExponentSnapshot,
        conversionNumerator:
          line.conversionNumerator === null ? null : serializeMinorUnit(line.conversionNumerator),
        conversionDenominator:
          line.conversionDenominator === null
            ? null
            : serializeMinorUnit(line.conversionDenominator),
        fxRateSnapshotId: line.fxRateSnapshotId,
        createdAt: serializeDate(line.createdAt)
      }))
    };
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function companyScope(context: OrganizationContext) {
  return context.companyId ? { companyId: context.companyId } : {};
}

function isDatabaseConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2004" || error.code === "P2034")
  );
}

function negateOptionalMinor(value: bigint | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : (-value).toString();
}
