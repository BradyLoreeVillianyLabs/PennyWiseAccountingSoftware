import { describe, expect, it } from "vitest";
import { parseBankImport } from "./bank-import-parser.js";

describe("bank import parser", () => {
  it("parses quoted CSV values and exact decimal cents", () => {
    const rows = parseBankImport({
      format: "CSV",
      fileName: "statement.csv",
      data: Buffer.from(
        'date,description,amount,currency,reference\n2026-04-01,"Coffee, team",-12.34,CAD,R-1\n'
      )
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      postingDate: "2026-04-01",
      description: "Coffee, team",
      amountMinor: "1234",
      direction: "DEBIT",
      currency: "CAD",
      referenceNumber: "R-1"
    });
  });

  it("reports the exact CSV row and field for invalid amounts", () => {
    expect(() =>
      parseBankImport({
        format: "CSV",
        fileName: "statement.csv",
        data: Buffer.from("date,description,amount\n2026-04-01,Coffee,12.345\n")
      })
    ).toThrow(/two decimal places/i);
  });

  it("rejects invalid mappings before producing rows", () => {
    expect(() =>
      parseBankImport({
        format: "CSV",
        fileName: "statement.csv",
        data: Buffer.from("posted,narrative,value\n2026-04-01,Coffee,-1.00\n"),
        mapping: {
          postingDate: "missing",
          description: "narrative",
          amount: "value"
        }
      })
    ).toThrow(/was not found/i);
  });

  it("parses OFX and QFX statement transactions", () => {
    const fixture =
      "OFXHEADER:100\n<OFX><CURDEF>CAD<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260402<TRNAMT>-45.67<FITID>FIT-1<NAME>Prairie Shop<MEMO>Office supplies</STMTTRN></BANKTRANLIST></OFX>";
    for (const format of ["OFX", "QFX"] as const) {
      const rows = parseBankImport({
        format,
        fileName: `statement.${format.toLowerCase()}`,
        data: Buffer.from(fixture)
      });
      expect(rows[0]).toMatchObject({
        providerTransactionId: "FIT-1",
        postingDate: "2026-04-02",
        amountMinor: "4567",
        direction: "DEBIT"
      });
    }
  });

  it("rejects malformed and oversized input", () => {
    expect(() =>
      parseBankImport({
        format: "OFX",
        fileName: "statement.ofx",
        data: Buffer.from("<OFX>broken")
      })
    ).toThrow(/structure/i);
    expect(() =>
      parseBankImport({
        format: "CSV",
        fileName: "statement.csv",
        data: Buffer.alloc(5 * 1024 * 1024 + 1, "x")
      })
    ).toThrow(/5 MiB/i);
  });
});
