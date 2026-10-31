import { createHash } from "node:crypto";
import { convertMinorUnits } from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { parseDate } from "../utils/dates.js";
import { JournalService, type PostJournalInput } from "./journal-service.js";
import { isLiability, MonetaryPositionService } from "./monetary-position-service.js";

export interface FxRevaluationInput {
  readonly valuationDate: string;
  readonly rateSnapshotIds: readonly string[];
  readonly post: boolean;
}

type Tx = Prisma.TransactionClient;

type RevaluationPosition = {
  id: string;
  accountId: string;
  kind: Parameters<typeof isLiability>[0];
  currency: string;
  outstandingTransactionMinor: bigint;
  carryingBaseMinor: bigint;
  targetBaseMinor: bigint;
  deltaBaseMinor: bigint;
  unrealizedFxBaseMinor: bigint;
  rateSnapshotId: string;
};

type RevaluationPreview = {
  valuationDate: string;
  baseCurrency: string;
  positions: RevaluationPosition[];
  totalUnrealizedGainMinor: bigint;
  totalUnrealizedLossMinor: bigint;
  missingAccounts: string[];
  missingRates: string[];
  nextPeriodStart: Date | null;
  sourceFingerprint: string;
  readyToPost: boolean;
};

export class FxRevaluationService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;
  private readonly monetaryPositions = new MonetaryPositionService();

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
  }

  public async preview(context: OrganizationContext, input: FxRevaluationInput) {
    await this.authorization.assert(context, "reports:read", "FxRevaluationRun");
    const preview = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.buildPreview(tx, context.organizationId, input)
    );
    return previewDto(preview);
  }

  public async overview(context: OrganizationContext) {
    await this.authorization.assert(context, "reports:read", "MonetaryPosition");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [positions, runs, rates] = await Promise.all([
        tx.monetaryPosition.findMany({
          where: { organizationId: context.organizationId },
          include: { events: { orderBy: { sequence: "asc" } } },
          orderBy: [{ active: "desc" }, { currency: "asc" }, { asOfDate: "asc" }]
        }),
        tx.fxRevaluationRun.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ valuationDate: "desc" }, { createdAt: "desc" }],
          take: 100
        }),
        tx.fxRateSnapshot.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
          take: 250
        })
      ]);
      return {
        positions: positions.map((position) => ({
          id: position.id,
          accountId: position.accountId,
          kind: position.kind,
          currency: position.currency.trim(),
          sourceType: position.sourceType,
          sourceId: position.sourceId,
          originalTransactionMinor: position.originalTransactionMinor.toString(),
          outstandingTransactionMinor: position.outstandingTransactionMinor.toString(),
          originalBaseMinor: position.originalBaseMinor.toString(),
          carryingBaseMinor: position.carryingBaseMinor.toString(),
          cumulativeRealizedFxMinor: position.cumulativeRealizedFxMinor.toString(),
          cumulativeUnrealizedFxMinor: position.cumulativeUnrealizedFxMinor.toString(),
          active: position.active,
          asOfDate: position.asOfDate.toISOString().slice(0, 10),
          events: position.events.map((event) => ({
            id: event.id,
            sequence: event.sequence,
            kind: event.kind,
            eventDate: event.eventDate.toISOString().slice(0, 10),
            transactionDeltaMinor: event.transactionDeltaMinor.toString(),
            carryingBaseDeltaMinor: event.carryingBaseDeltaMinor.toString(),
            realizedFxBaseMinor: event.realizedFxBaseMinor.toString(),
            unrealizedFxBaseMinor: event.unrealizedFxBaseMinor.toString(),
            outstandingAfterMinor: event.outstandingAfterMinor.toString(),
            carryingBaseAfterMinor: event.carryingBaseAfterMinor.toString(),
            rateSnapshotId: event.rateSnapshotId,
            journalId: event.journalId
          }))
        })),
        revaluationRuns: runs.map(revaluationRunDto),
        rates: rates.map((rate) => ({
          id: rate.id,
          transactionCurrency: rate.transactionCurrency.trim(),
          baseCurrency: rate.baseCurrency.trim(),
          numerator: rate.numerator.toString(),
          denominator: rate.denominator.toString(),
          purpose: rate.purpose,
          method: rate.method,
          sourceReference: rate.sourceReference,
          effectiveAt: rate.effectiveAt.toISOString(),
          observedAt: rate.observedAt?.toISOString() ?? null
        }))
      };
    });
  }

  public async post(context: OrganizationContext, input: FxRevaluationInput) {
    await this.authorization.assert(context, "journals:post", "FxRevaluationRun");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${context.organizationId}),
          hashtext(${"fx-revaluation:" + input.valuationDate})
        )
      `;
      const preview = await this.buildPreview(tx, context.organizationId, input);
      if (!preview.readyToPost)
        throw new AppError(
          "FX_REVALUATION_NOT_READY",
          "Revaluation requires exact closing rates, FX accounts, open positions, and the next open fiscal period.",
          422,
          {
            missingRates: preview.missingRates,
            missingAccounts: preview.missingAccounts,
            nextPeriodAvailable: Boolean(preview.nextPeriodStart)
          }
        );
      const existing = await tx.fxRevaluationRun.findUnique({
        where: {
          organizationId_valuationDate_sourceFingerprint: {
            organizationId: context.organizationId,
            valuationDate: parseDate(input.valuationDate, "valuationDate"),
            sourceFingerprint: preview.sourceFingerprint
          }
        }
      });
      if (existing?.status === "POSTED") {
        return { run: revaluationRunDto(existing), preview: previewDto(preview) };
      }
      const run =
        existing ??
        (await tx.fxRevaluationRun.create({
          data: {
            organizationId: context.organizationId,
            valuationDate: parseDate(input.valuationDate, "valuationDate"),
            baseCurrency: preview.baseCurrency,
            rateSnapshotIds: input.rateSnapshotIds,
            sourceFingerprint: preview.sourceFingerprint
          }
        }));
      const accounts = await fxAccounts(tx, context.organizationId);
      const journal = await this.journals.postJournalInTransaction(
        tx,
        context,
        revaluationJournalInput(run.id, preview, accounts),
        true
      );
      for (const position of preview.positions) {
        await this.monetaryPositions.revalue(tx, {
          organizationId: context.organizationId,
          positionId: position.id,
          targetBaseMinor: position.targetBaseMinor,
          eventDate: parseDate(input.valuationDate, "valuationDate"),
          rateSnapshotId: position.rateSnapshotId,
          journalId: journal.id,
          runId: run.id
        });
      }
      const reversal = await this.journals.reverseJournalInTransaction(
        tx,
        context,
        journal.id,
        {
          effectiveDate: preview.nextPeriodStart!.toISOString().slice(0, 10),
          reason: "Automatic first-day next-period FX revaluation reversal"
        },
        "fx_revaluation_reversal",
        run.id,
        `fx-revaluation-reversal:${run.id}`
      );
      for (const position of preview.positions) {
        await this.monetaryPositions.reverseRevaluation(tx, {
          organizationId: context.organizationId,
          positionId: position.id,
          carryingBaseDeltaMinor: position.deltaBaseMinor,
          unrealizedFxBaseMinor: position.unrealizedFxBaseMinor,
          eventDate: preview.nextPeriodStart!,
          rateSnapshotId: position.rateSnapshotId,
          journalId: reversal.id,
          runId: run.id
        });
      }
      const posted = await tx.fxRevaluationRun.update({
        where: { id: run.id },
        data: {
          status: "POSTED",
          valuationJournalId: journal.id,
          reversalJournalId: reversal.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "FX_REVALUATION_POSTED",
          targetType: "FxRevaluationRun",
          targetId: run.id,
          requestId: context.requestId,
          metadata: {
            valuationDate: input.valuationDate,
            positionCount: preview.positions.length,
            valuationJournalId: journal.id,
            reversalJournalId: reversal.id
          }
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "accounting.fx-revaluation.posted",
          aggregateType: "FxRevaluationRun",
          aggregateId: run.id,
          payload: {
            runId: run.id,
            valuationJournalId: journal.id,
            reversalJournalId: reversal.id
          }
        }
      });
      return { run: revaluationRunDto(posted), preview: previewDto(preview) };
    });
  }

  private async buildPreview(
    tx: Tx,
    organizationId: string,
    input: FxRevaluationInput
  ): Promise<RevaluationPreview> {
    const valuationDate = parseDate(input.valuationDate, "valuationDate");
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { currency: true, settings: { select: { multiCurrencyEnabled: true } } }
    });
    if (!organization)
      throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
    if (!organization.settings?.multiCurrencyEnabled)
      throw new AppError(
        "MULTI_CURRENCY_NOT_ENABLED",
        "Enable CAD/USD multi-currency before revaluation.",
        409
      );
    const baseCurrency = organization.currency.trim();
    const rawPositions = await tx.monetaryPosition.findMany({
      where: {
        organizationId,
        active: true,
        outstandingTransactionMinor: { gt: 0n },
        currency: { not: baseCurrency }
      },
      orderBy: [{ currency: "asc" }, { accountId: "asc" }, { id: "asc" }]
    });
    const requestedRates = await tx.fxRateSnapshot.findMany({
      where: { organizationId, id: { in: [...new Set(input.rateSnapshotIds)] } }
    });
    const rateByCurrency = new Map(
      requestedRates.map((rate) => [rate.transactionCurrency.trim(), rate] as const)
    );
    const currencies = [...new Set(rawPositions.map((position) => position.currency.trim()))];
    const missingRates = currencies.filter((currency) => {
      const rate = rateByCurrency.get(currency);
      return (
        !rate ||
        rate.baseCurrency.trim() !== baseCurrency ||
        rate.purpose !== "CLOSING" ||
        rate.effectiveAt.toISOString().slice(0, 10) !== input.valuationDate
      );
    });
    const positions: RevaluationPosition[] = [];
    for (const position of rawPositions) {
      const currency = position.currency.trim();
      const rate = rateByCurrency.get(currency);
      if (
        !rate ||
        rate.baseCurrency.trim() !== baseCurrency ||
        rate.purpose !== "CLOSING" ||
        rate.effectiveAt.toISOString().slice(0, 10) !== input.valuationDate
      )
        continue;
      const targetBaseMinor = convertMinorUnits(
        position.outstandingTransactionMinor,
        {
          code: currency,
          exponent: rate.transactionExponent,
          name: currency
        },
        {
          code: baseCurrency,
          exponent: rate.baseExponent,
          name: baseCurrency
        },
        { numerator: rate.numerator, denominator: rate.denominator }
      );
      const deltaBaseMinor = targetBaseMinor - position.carryingBaseMinor;
      if (deltaBaseMinor === 0n) continue;
      positions.push({
        id: position.id,
        accountId: position.accountId,
        kind: position.kind,
        currency,
        outstandingTransactionMinor: position.outstandingTransactionMinor,
        carryingBaseMinor: position.carryingBaseMinor,
        targetBaseMinor,
        deltaBaseMinor,
        unrealizedFxBaseMinor: isLiability(position.kind) ? -deltaBaseMinor : deltaBaseMinor,
        rateSnapshotId: rate.id
      });
    }
    const accounts = await fxAccounts(tx, organizationId);
    const missingAccounts = [
      ...(accounts.gain ? [] : ["unrealized-fx-gain"]),
      ...(accounts.loss ? [] : ["unrealized-fx-loss"])
    ];
    const nextPeriod = await tx.fiscalPeriod.findFirst({
      where: { organizationId, status: "OPEN", startDate: { gt: valuationDate } },
      orderBy: { startDate: "asc" },
      select: { startDate: true }
    });
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          valuationDate: input.valuationDate,
          positions: rawPositions.map((position) => ({
            id: position.id,
            version: position.version,
            outstanding: position.outstandingTransactionMinor.toString(),
            carrying: position.carryingBaseMinor.toString()
          })),
          rates: requestedRates
            .map((rate) => ({
              id: rate.id,
              numerator: rate.numerator.toString(),
              denominator: rate.denominator.toString()
            }))
            .sort((left, right) => left.id.localeCompare(right.id))
        })
      )
      .digest("hex");
    return {
      valuationDate: input.valuationDate,
      baseCurrency,
      positions,
      totalUnrealizedGainMinor: positions
        .filter((position) => position.unrealizedFxBaseMinor > 0n)
        .reduce((sum, position) => sum + position.unrealizedFxBaseMinor, 0n),
      totalUnrealizedLossMinor: positions
        .filter((position) => position.unrealizedFxBaseMinor < 0n)
        .reduce((sum, position) => sum - position.unrealizedFxBaseMinor, 0n),
      missingAccounts,
      missingRates,
      nextPeriodStart: nextPeriod?.startDate ?? null,
      sourceFingerprint: fingerprint,
      readyToPost:
        positions.length > 0 &&
        missingRates.length === 0 &&
        missingAccounts.length === 0 &&
        Boolean(nextPeriod)
    };
  }
}

function revaluationJournalInput(
  runId: string,
  preview: RevaluationPreview,
  accounts: { gain: string | null; loss: string | null }
): PostJournalInput {
  const lines: PostJournalInput["lines"][number][] = [];
  for (const position of preview.positions) {
    const liability = isLiability(position.kind);
    const delta = position.deltaBaseMinor;
    if (!liability && delta > 0n) {
      lines.push(positionLine(position, delta, true));
      lines.push(baseLine(accounts.gain!, delta, false, "Unrealized FX gain"));
    } else if (!liability && delta < 0n) {
      lines.push(positionLine(position, -delta, false));
      lines.push(baseLine(accounts.loss!, -delta, true, "Unrealized FX loss"));
    } else if (liability && delta > 0n) {
      lines.push(positionLine(position, delta, false));
      lines.push(baseLine(accounts.loss!, delta, true, "Unrealized FX loss"));
    } else if (liability && delta < 0n) {
      lines.push(positionLine(position, -delta, true));
      lines.push(baseLine(accounts.gain!, -delta, false, "Unrealized FX gain"));
    }
  }
  return {
    description: `Foreign-currency revaluation ${preview.valuationDate}`,
    effectiveDate: preview.valuationDate,
    sourceType: "fx_revaluation",
    sourceId: runId,
    postingKey: `fx-revaluation:${runId}`,
    transactionCurrency: preview.positions[0]!.currency,
    fxRateSnapshotId: preview.positions[0]!.rateSnapshotId,
    allowControlAccountPosting: true,
    lines
  };
}

function positionLine(
  position: RevaluationPosition,
  amount: bigint,
  debit: boolean
): PostJournalInput["lines"][number] {
  return {
    accountId: position.accountId,
    description: `Revalue ${position.currency} monetary position`,
    debitMinor: debit ? amount.toString() : "0",
    creditMinor: debit ? "0" : amount.toString(),
    transactionMinor: "0",
    fxRateSnapshotId: position.rateSnapshotId,
    conversionPolicy: "CARRYING_VALUE"
  };
}

function baseLine(
  accountId: string,
  amount: bigint,
  debit: boolean,
  description: string
): PostJournalInput["lines"][number] {
  return {
    accountId,
    description,
    debitMinor: debit ? amount.toString() : "0",
    creditMinor: debit ? "0" : amount.toString()
  };
}

async function fxAccounts(tx: Tx, organizationId: string) {
  const accounts = await tx.account.findMany({
    where: {
      organizationId,
      systemPurpose: { in: ["unrealized-fx-gain", "unrealized-fx-loss"] },
      isArchived: false
    },
    select: { id: true, systemPurpose: true }
  });
  return {
    gain: accounts.find((account) => account.systemPurpose === "unrealized-fx-gain")?.id ?? null,
    loss: accounts.find((account) => account.systemPurpose === "unrealized-fx-loss")?.id ?? null
  };
}

function previewDto(preview: RevaluationPreview) {
  return {
    valuationDate: preview.valuationDate,
    baseCurrency: preview.baseCurrency,
    positions: preview.positions.map((position) => ({
      id: position.id,
      accountId: position.accountId,
      kind: position.kind,
      currency: position.currency,
      outstandingTransactionMinor: position.outstandingTransactionMinor.toString(),
      carryingBaseMinor: position.carryingBaseMinor.toString(),
      targetBaseMinor: position.targetBaseMinor.toString(),
      deltaBaseMinor: position.deltaBaseMinor.toString(),
      gainLoss: position.unrealizedFxBaseMinor >= 0n ? "GAIN" : "LOSS",
      rateSnapshotId: position.rateSnapshotId
    })),
    totalUnrealizedGainMinor: preview.totalUnrealizedGainMinor.toString(),
    totalUnrealizedLossMinor: preview.totalUnrealizedLossMinor.toString(),
    missingAccounts: preview.missingAccounts,
    missingRates: preview.missingRates,
    nextPeriodStart: preview.nextPeriodStart?.toISOString().slice(0, 10) ?? null,
    sourceFingerprint: preview.sourceFingerprint,
    readyToPost: preview.readyToPost
  };
}

function revaluationRunDto(run: {
  id: string;
  valuationDate: Date;
  status: string;
  baseCurrency: string;
  sourceFingerprint: string;
  valuationJournalId: string | null;
  reversalJournalId: string | null;
  staleAt: Date | null;
}) {
  return {
    id: run.id,
    valuationDate: run.valuationDate.toISOString().slice(0, 10),
    status: run.status,
    baseCurrency: run.baseCurrency.trim(),
    sourceFingerprint: run.sourceFingerprint,
    valuationJournalId: run.valuationJournalId,
    reversalJournalId: run.reversalJournalId,
    staleAt: run.staleAt?.toISOString() ?? null
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
