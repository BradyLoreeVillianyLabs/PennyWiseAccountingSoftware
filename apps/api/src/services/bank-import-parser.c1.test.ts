import { describe, expect, it } from "vitest";
import { canadianBankImportProfiles, parseBankImport } from "./bank-import-parser.js";

describe("Canadian e-Transfer import profiles", () => {
  it.each([
    [
      "RBC_GENERIC_CSV",
      "rbc.csv",
      "date,description,amount,currency,balance,reference\n2026-09-15,INTERAC E-TRANSFER,125.00,CAD,1125.00,P7K-4Q\n"
    ],
    [
      "SCOTIACONNECT_CSV",
      "scotia.csv",
      "Transaction Date,Description,Debit,Credit,Currency,Balance,Reference Number\n2026-09-15,DEPOSIT INTERAC, ,125.00,CAD,1125.00,P7K4Q\n"
    ],
    [
      "TD_BUSINESS_CSV",
      "td.csv",
      "Date,Memo,Withdrawal,Deposit,Currency,Balance,Reference\n2026-09-15,INTERAC E-TRANSFER,,125.00,CAD,1125.00,\n"
    ]
  ] as const)("parses the synthetic %s shape without posting", (profile, fileName, csv) => {
    const rows = parseBankImport({
      format: "CSV",
      fileName,
      data: Buffer.from(csv),
      mapping: canadianBankImportProfiles[profile].mapping
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "CREDIT",
      amountMinor: "12500",
      currency: "CAD"
    });
  });
});
