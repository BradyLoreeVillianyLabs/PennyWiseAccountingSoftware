import { roundRatioHalfUp } from "@clearledger/accounting-core";
import { Prisma } from "@clearledger/db";
import { AppError } from "@clearledger/shared";

type TransactionClient = Prisma.TransactionClient;
type MonetaryPositionKind =
  | "ACCOUNTS_RECEIVABLE"
  | "ACCOUNTS_PAYABLE"
  | "BANK"
  | "CARD"
  | "UNDEPOSITED_FUNDS"
  | "PROCESSOR_CLEARING"
  | "MARKETPLACE_CLEARING"
  | "REFUNDABLE_DEPOSIT";

type PositionProjection = {
  id: string;
  organizationId: string;
  accountId: string;
  kind: MonetaryPositionKind;
  currency: string;
  sourceType: string;
  sourceId: string;
  originalTransactionMinor: bigint;
  outstandingTransactionMinor: bigint;
  originalBaseMinor: bigint;
  carryingBaseMinor: bigint;
  cumulativeRealizedFxMinor: bigint;
  cumulativeUnrealizedFxMinor: bigint;
  version: number;
  asOfDate: Date;
  lastValuationDate: Date | null;
  active: boolean;
};

export type PositionSettlement = Readonly<{
  positionId: string;
  transactionMinor: bigint;
  carryingBaseRelievedMinor: bigint;
  settlementBaseMinor: bigint;
  realizedFxBaseMinor: bigint;
  outstandingAfterMinor: bigint;
  carryingBaseAfterMinor: bigint;
}>;

export class MonetaryPositionService {
  public async recognize(
    tx: TransactionClient,
    input: {
      organizationId: string;
      accountId: string;
      kind: MonetaryPositionKind;
      currency: string;
      sourceType: string;
      sourceId: string;
      transactionMinor: bigint;
      baseMinor: bigint;
      eventDate: Date;
      rateSnapshotId: string;
      journalId: string;
    }
  ): Promise<PositionProjection> {
    if (input.transactionMinor <= 0n || input.baseMinor <= 0n)
      throw new AppError(
        "MONETARY_POSITION_AMOUNT_INVALID",
        "A monetary position must open with positive transaction and base amounts.",
        422
      );
    const existing = await tx.monetaryPosition.findUnique({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId
        }
      }
    });
    if (existing) return projection(existing);
    const position = await tx.monetaryPosition.create({
      data: {
        organizationId: input.organizationId,
        accountId: input.accountId,
        kind: input.kind,
        currency: input.currency,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        carryingMinor: input.baseMinor,
        originalTransactionMinor: input.transactionMinor,
        outstandingTransactionMinor: input.transactionMinor,
        originalBaseMinor: input.baseMinor,
        carryingBaseMinor: input.baseMinor,
        cumulativeRealizedFxMinor: 0n,
        cumulativeUnrealizedFxMinor: 0n,
        asOfDate: input.eventDate,
        active: true
      }
    });
    await tx.monetaryPositionEvent.create({
      data: {
        organizationId: input.organizationId,
        monetaryPositionId: position.id,
        kind: "RECOGNIZED",
        sequence: 1,
        eventDate: input.eventDate,
        transactionMinor: input.transactionMinor,
        baseMinor: input.baseMinor,
        transactionDeltaMinor: input.transactionMinor,
        carryingBaseDeltaMinor: input.baseMinor,
        outstandingAfterMinor: input.transactionMinor,
        carryingBaseAfterMinor: input.baseMinor,
        rateSnapshotId: input.rateSnapshotId,
        journalId: input.journalId,
        sourceType: input.sourceType,
        sourceId: `${input.sourceId}:recognized`,
        reason: "Foreign monetary position recognized"
      }
    });
    return projection(position);
  }

  public async quoteSettlement(
    tx: TransactionClient,
    input: {
      organizationId: string;
      positionSourceType: string;
      positionSourceId: string;
      transactionMinor: bigint;
      settlementBaseMinor: bigint;
      eventDate: Date;
    }
  ): Promise<PositionSettlement> {
    await tx.$queryRaw`
      SELECT "id"
      FROM "MonetaryPosition"
      WHERE "organizationId" = ${input.organizationId}::uuid
        AND "sourceType" = ${input.positionSourceType}
        AND "sourceId" = ${input.positionSourceId}
      FOR UPDATE
    `;
    const position = await tx.monetaryPosition.findUnique({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: input.positionSourceType,
          sourceId: input.positionSourceId
        }
      }
    });
    if (!position)
      throw new AppError(
        "MONETARY_POSITION_NOT_FOUND",
        "The linked foreign monetary position was not found.",
        409
      );
    return settlementQuote(position, input);
  }

  public async settle(
    tx: TransactionClient,
    input: {
      organizationId: string;
      positionSourceType: string;
      positionSourceId: string;
      transactionMinor: bigint;
      settlementBaseMinor: bigint;
      eventDate: Date;
      rateSnapshotId: string;
      journalId?: string | null;
      sourceType: string;
      sourceId: string;
    }
  ): Promise<PositionSettlement> {
    const existingEvent = await tx.monetaryPositionEvent.findUnique({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId
        }
      }
    });
    if (existingEvent) {
      return {
        positionId: existingEvent.monetaryPositionId,
        transactionMinor: -existingEvent.transactionDeltaMinor,
        carryingBaseRelievedMinor: -existingEvent.carryingBaseDeltaMinor,
        settlementBaseMinor: existingEvent.baseMinor,
        realizedFxBaseMinor: existingEvent.realizedFxBaseMinor,
        outstandingAfterMinor: existingEvent.outstandingAfterMinor,
        carryingBaseAfterMinor: existingEvent.carryingBaseAfterMinor
      };
    }
    await tx.$queryRaw`
      SELECT "id"
      FROM "MonetaryPosition"
      WHERE "organizationId" = ${input.organizationId}::uuid
        AND "sourceType" = ${input.positionSourceType}
        AND "sourceId" = ${input.positionSourceId}
      FOR UPDATE
    `;
    const position = await tx.monetaryPosition.findUnique({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: input.positionSourceType,
          sourceId: input.positionSourceId
        }
      }
    });
    if (!position)
      throw new AppError(
        "MONETARY_POSITION_NOT_FOUND",
        "The linked foreign monetary position was not found.",
        409
      );
    const quote = settlementQuote(position, input);
    const {
      carryingBaseRelievedMinor,
      outstandingAfterMinor,
      carryingBaseAfterMinor,
      realizedFxBaseMinor
    } = quote;
    const sequence = position.version + 1;
    await tx.monetaryPosition.update({
      where: { id: position.id },
      data: {
        carryingMinor: carryingBaseAfterMinor,
        outstandingTransactionMinor: outstandingAfterMinor,
        carryingBaseMinor: carryingBaseAfterMinor,
        cumulativeRealizedFxMinor: { increment: realizedFxBaseMinor },
        asOfDate: input.eventDate,
        active: outstandingAfterMinor !== 0n,
        version: { increment: 1 }
      }
    });
    await tx.monetaryPositionEvent.create({
      data: {
        organizationId: input.organizationId,
        monetaryPositionId: position.id,
        kind: outstandingAfterMinor === 0n ? "CLOSED" : "SETTLED",
        sequence,
        eventDate: input.eventDate,
        transactionMinor: -input.transactionMinor,
        baseMinor: input.settlementBaseMinor,
        transactionDeltaMinor: -input.transactionMinor,
        carryingBaseDeltaMinor: -carryingBaseRelievedMinor,
        realizedFxBaseMinor,
        outstandingAfterMinor,
        carryingBaseAfterMinor,
        rateSnapshotId: input.rateSnapshotId,
        journalId: input.journalId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reason: "Foreign monetary position settled"
      }
    });
    return {
      positionId: position.id,
      transactionMinor: input.transactionMinor,
      carryingBaseRelievedMinor,
      settlementBaseMinor: input.settlementBaseMinor,
      realizedFxBaseMinor,
      outstandingAfterMinor,
      carryingBaseAfterMinor
    };
  }

  public async revalue(
    tx: TransactionClient,
    input: {
      organizationId: string;
      positionId: string;
      targetBaseMinor: bigint;
      eventDate: Date;
      rateSnapshotId: string;
      journalId: string;
      runId: string;
    }
  ) {
    await tx.$queryRaw`
      SELECT "id" FROM "MonetaryPosition"
      WHERE "id" = ${input.positionId}::uuid
        AND "organizationId" = ${input.organizationId}::uuid
      FOR UPDATE
    `;
    const position = await tx.monetaryPosition.findFirst({
      where: { id: input.positionId, organizationId: input.organizationId }
    });
    if (!position || !position.active || position.outstandingTransactionMinor <= 0n)
      throw new AppError(
        "MONETARY_POSITION_NOT_OPEN",
        "The foreign monetary position is no longer open.",
        409
      );
    if (input.eventDate < position.asOfDate)
      throw new AppError(
        "MONETARY_POSITION_EVENT_OUT_OF_SEQUENCE",
        "A valuation cannot precede the latest position event.",
        409
      );
    const delta = input.targetBaseMinor - position.carryingBaseMinor;
    const unrealizedFxBaseMinor = isLiability(position.kind) ? -delta : delta;
    const sequence = position.version + 1;
    await tx.monetaryPosition.update({
      where: { id: position.id },
      data: {
        carryingMinor: input.targetBaseMinor,
        carryingBaseMinor: input.targetBaseMinor,
        cumulativeUnrealizedFxMinor: { increment: unrealizedFxBaseMinor },
        lastValuationDate: input.eventDate,
        asOfDate: input.eventDate,
        version: { increment: 1 }
      }
    });
    await tx.monetaryPositionEvent.create({
      data: {
        organizationId: input.organizationId,
        monetaryPositionId: position.id,
        kind: "REVALUED",
        sequence,
        eventDate: input.eventDate,
        transactionMinor: 0n,
        baseMinor: delta,
        transactionDeltaMinor: 0n,
        carryingBaseDeltaMinor: delta,
        unrealizedFxBaseMinor,
        outstandingAfterMinor: position.outstandingTransactionMinor,
        carryingBaseAfterMinor: input.targetBaseMinor,
        rateSnapshotId: input.rateSnapshotId,
        journalId: input.journalId,
        sourceType: "fx_revaluation",
        sourceId: `${input.runId}:${position.id}`,
        reason: "Period-end foreign monetary position revaluation"
      }
    });
    return { position: projection(position), delta, unrealizedFxBaseMinor };
  }

  public async reverseRevaluation(
    tx: TransactionClient,
    input: {
      organizationId: string;
      positionId: string;
      carryingBaseDeltaMinor: bigint;
      unrealizedFxBaseMinor: bigint;
      eventDate: Date;
      rateSnapshotId: string;
      journalId: string;
      runId: string;
    }
  ) {
    await tx.$queryRaw`
      SELECT "id" FROM "MonetaryPosition"
      WHERE "id" = ${input.positionId}::uuid
        AND "organizationId" = ${input.organizationId}::uuid
      FOR UPDATE
    `;
    const position = await tx.monetaryPosition.findFirst({
      where: { id: input.positionId, organizationId: input.organizationId }
    });
    if (!position)
      throw new AppError(
        "MONETARY_POSITION_NOT_FOUND",
        "The linked foreign monetary position was not found.",
        409
      );
    const carryingBaseAfterMinor = position.carryingBaseMinor - input.carryingBaseDeltaMinor;
    const sequence = position.version + 1;
    await tx.monetaryPosition.update({
      where: { id: position.id },
      data: {
        carryingMinor: carryingBaseAfterMinor,
        carryingBaseMinor: carryingBaseAfterMinor,
        cumulativeUnrealizedFxMinor: { decrement: input.unrealizedFxBaseMinor },
        asOfDate: input.eventDate,
        version: { increment: 1 }
      }
    });
    await tx.monetaryPositionEvent.create({
      data: {
        organizationId: input.organizationId,
        monetaryPositionId: position.id,
        kind: "REVALUATION_REVERSAL",
        sequence,
        eventDate: input.eventDate,
        transactionMinor: 0n,
        baseMinor: -input.carryingBaseDeltaMinor,
        transactionDeltaMinor: 0n,
        carryingBaseDeltaMinor: -input.carryingBaseDeltaMinor,
        unrealizedFxBaseMinor: -input.unrealizedFxBaseMinor,
        outstandingAfterMinor: position.outstandingTransactionMinor,
        carryingBaseAfterMinor,
        rateSnapshotId: input.rateSnapshotId,
        journalId: input.journalId,
        sourceType: "fx_revaluation_reversal",
        sourceId: `${input.runId}:${position.id}:reversal`,
        reason: "Automatic first-day next-period revaluation reversal"
      }
    });
  }
}

export function isLiability(kind: MonetaryPositionKind): boolean {
  return kind === "ACCOUNTS_PAYABLE" || kind === "CARD" || kind === "REFUNDABLE_DEPOSIT";
}

function projection(position: {
  id: string;
  organizationId: string;
  accountId: string;
  kind: MonetaryPositionKind;
  currency: string;
  sourceType: string;
  sourceId: string;
  originalTransactionMinor: bigint;
  outstandingTransactionMinor: bigint;
  originalBaseMinor: bigint;
  carryingBaseMinor: bigint;
  cumulativeRealizedFxMinor: bigint;
  cumulativeUnrealizedFxMinor: bigint;
  version: number;
  asOfDate: Date;
  lastValuationDate: Date | null;
  active: boolean;
}): PositionProjection {
  return {
    ...position,
    currency: position.currency.trim()
  };
}

function settlementQuote(
  position: {
    id: string;
    kind: MonetaryPositionKind;
    outstandingTransactionMinor: bigint;
    carryingBaseMinor: bigint;
    asOfDate: Date;
  },
  input: {
    transactionMinor: bigint;
    settlementBaseMinor: bigint;
    eventDate: Date;
  }
): PositionSettlement {
  if (input.transactionMinor <= 0n || input.transactionMinor > position.outstandingTransactionMinor)
    throw new AppError(
      "MONETARY_POSITION_OVER_SETTLEMENT",
      "Settlement exceeds the open foreign amount.",
      409
    );
  if (input.eventDate < position.asOfDate)
    throw new AppError(
      "MONETARY_POSITION_EVENT_OUT_OF_SEQUENCE",
      "A settlement cannot precede the monetary position.",
      409
    );
  const finalSettlement = input.transactionMinor === position.outstandingTransactionMinor;
  const carryingBaseRelievedMinor = finalSettlement
    ? position.carryingBaseMinor
    : roundRatioHalfUp(
        position.carryingBaseMinor * input.transactionMinor,
        position.outstandingTransactionMinor
      );
  const outstandingAfterMinor = position.outstandingTransactionMinor - input.transactionMinor;
  const carryingBaseAfterMinor = position.carryingBaseMinor - carryingBaseRelievedMinor;
  const realizedFxBaseMinor = isLiability(position.kind)
    ? carryingBaseRelievedMinor - input.settlementBaseMinor
    : input.settlementBaseMinor - carryingBaseRelievedMinor;
  return {
    positionId: position.id,
    transactionMinor: input.transactionMinor,
    carryingBaseRelievedMinor,
    settlementBaseMinor: input.settlementBaseMinor,
    realizedFxBaseMinor,
    outstandingAfterMinor,
    carryingBaseAfterMinor
  };
}
