import { AppError } from "@clearledger/shared";
import { sumMinorUnits, type MinorUnit } from "./money.js";

export interface JournalLineInput {
  readonly accountId: string;
  readonly description?: string | null | undefined;
  readonly debitMinor: MinorUnit;
  readonly creditMinor: MinorUnit;
}

export interface JournalTotals {
  readonly debitMinor: MinorUnit;
  readonly creditMinor: MinorUnit;
}

export function calculateJournalTotals(lines: readonly JournalLineInput[]): JournalTotals {
  return {
    debitMinor: sumMinorUnits(lines.map((line) => line.debitMinor)),
    creditMinor: sumMinorUnits(lines.map((line) => line.creditMinor))
  };
}

export function validateJournalLines(lines: readonly JournalLineInput[]): JournalTotals {
  if (lines.length < 2) {
    throw new AppError("JOURNAL_REQUIRES_LINES", "A journal must contain at least two lines.");
  }

  for (const [index, line] of lines.entries()) {
    if (line.debitMinor < 0n || line.creditMinor < 0n) {
      throw new AppError("NEGATIVE_JOURNAL_LINE", "Journal line amounts cannot be negative.", 400, {
        index
      });
    }

    if (line.debitMinor === 0n && line.creditMinor === 0n) {
      throw new AppError(
        "ZERO_JOURNAL_LINE",
        "A journal line must contain a debit or a credit.",
        400,
        {
          index
        }
      );
    }

    if (line.debitMinor > 0n && line.creditMinor > 0n) {
      throw new AppError(
        "MIXED_DEBIT_CREDIT_LINE",
        "A journal line cannot contain both a debit and a credit.",
        400,
        { index }
      );
    }
  }

  const totals = calculateJournalTotals(lines);

  if (totals.debitMinor !== totals.creditMinor) {
    throw new AppError("UNBALANCED_JOURNAL", "Journal debits and credits must balance.", 422, {
      debitMinor: totals.debitMinor.toString(),
      creditMinor: totals.creditMinor.toString()
    });
  }

  return totals;
}

export function buildReversalLines(lines: readonly JournalLineInput[]): JournalLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    description: line.description ?? null,
    debitMinor: line.creditMinor,
    creditMinor: line.debitMinor
  }));
}
