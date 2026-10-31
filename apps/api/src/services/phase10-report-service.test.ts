import { describe, expect, it } from "vitest";
import { toCsv } from "./phase10-report-service.js";

describe("Phase 10 report CSV", () => {
  it("escapes formulas, quotes, commas, and line breaks without changing exact minor units", () => {
    const csv = toCsv([
      {
        description: '=HYPERLINK("https://example.test")',
        memo: 'Quoted, "value"\nnext line',
        amountMinor: "9007199254740993"
      }
    ]);

    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).toContain(`"Quoted, ""value""\nnext line"`);
    expect(csv).toContain(`"9007199254740993"`);
  });

  it.each(["+SUM(A1:A2)", "-1+2", "@command", "\tformula", "\rformula"])(
    "neutralizes spreadsheet control prefix %j",
    (value) => {
      expect(toCsv([{ value }])).toContain(`"'${value.replaceAll('"', '""')}"`);
    }
  );
});
