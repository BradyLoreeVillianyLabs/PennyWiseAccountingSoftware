import { describe, expect, it } from "vitest";
import { buildReversalLines, validateJournalLines } from "./journal.js";
import { parseMinorUnit } from "./money.js";

describe("journal validation", () => {
  it("accepts balanced integer minor-unit lines", () => {
    const totals = validateJournalLines([
      { accountId: "cash", debitMinor: 1000n, creditMinor: 0n },
      { accountId: "equity", debitMinor: 0n, creditMinor: 1000n }
    ]);

    expect(totals).toEqual({ debitMinor: 1000n, creditMinor: 1000n });
  });

  it("rejects unbalanced lines", () => {
    expect(() =>
      validateJournalLines([
        { accountId: "cash", debitMinor: 1000n, creditMinor: 0n },
        { accountId: "revenue", debitMinor: 0n, creditMinor: 999n }
      ])
    ).toThrow("Journal debits and credits must balance.");
  });

  it("rejects binary floating-point money input", () => {
    expect(() => parseMinorUnit(10.01, "debitMinor")).toThrow(
      "debitMinor must be an integer minor-unit string."
    );
  });

  it("rejects values outside the PostgreSQL BIGINT range", () => {
    expect(() => parseMinorUnit("9223372036854775808", "debitMinor")).toThrow(
      "debitMinor exceeds database range."
    );
  });

  it("builds exact inverse reversal lines", () => {
    expect(
      buildReversalLines([
        { accountId: "cash", description: "Cash", debitMinor: 2500n, creditMinor: 0n },
        { accountId: "revenue", description: "Revenue", debitMinor: 0n, creditMinor: 2500n }
      ])
    ).toEqual([
      { accountId: "cash", description: "Cash", debitMinor: 0n, creditMinor: 2500n },
      { accountId: "revenue", description: "Revenue", debitMinor: 2500n, creditMinor: 0n }
    ]);
  });
});
