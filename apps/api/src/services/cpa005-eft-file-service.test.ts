import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CPA005_CREDIT_PERSONAL_CHEQUING_SAVINGS,
  buildCpa005CreditFile,
  buildCreditDetailRecords,
  buildFileHeader,
  buildFileTrailer,
  type Cpa005CreditTransaction,
  type Cpa005FileIdentity
} from "./cpa005-eft-file-service.js";

const identity: Cpa005FileIdentity = {
  originatorId: "0123456789",
  fileCreationNumber: 1,
  creationDate: new Date(Date.UTC(2026, 0, 15)), // day-of-year 15
  destinationDataCentre: 12345,
  directClearerCommunicationArea: "PENNYWISE PAYROLL",
  currencyCode: "CAD"
};

function transaction(overrides: Partial<Cpa005CreditTransaction> = {}): Cpa005CreditTransaction {
  return {
    transactionType: CPA005_CREDIT_PERSONAL_CHEQUING_SAVINGS,
    amountMinor: 123_45n,
    dateFundsAvailable: new Date(Date.UTC(2026, 0, 20)), // day-of-year 20
    payeeInstitutionAndTransit: "00312345",
    payeeAccountNumber: "9876543210",
    itemTraceNumber: "0000000000000000000001",
    originatorShortName: "PENNYWISE",
    payeeName: "JORDAN LEBLANC",
    originatorLongName: "PENNYWISE ACCOUNTING",
    userId: "PW0001",
    crossReferenceNumber: "RUN-2026-01-A",
    ...overrides
  };
}

describe("CPA-005 file header", () => {
  it("is exactly 1464 bytes with the record header, date, data centre, and currency in their verified positions", () => {
    const header = buildFileHeader(identity);
    expect(header).toHaveLength(1464);
    expect(header.slice(0, 1)).toBe("A");
    expect(header.slice(1, 10)).toBe("000000001"); // record count, zero-padded to 9
    expect(header.slice(10, 20)).toBe("0123456789"); // originator id, zero-padded to 10
    expect(header.slice(20, 24)).toBe("0001"); // file creation number, zero-padded to 4
    expect(header.slice(24, 30)).toBe("026015"); // 2026 -> "026", day-of-year 15 -> "015"
    expect(header.slice(30, 35)).toBe("12345"); // destination data centre, zero-padded to 5
    expect(header.slice(35, 55)).toBe("PENNYWISE PAYROLL   "); // communication area, space-padded to 20
    expect(header.slice(55, 58)).toBe("CAD");
    expect(header.slice(58)).toBe(" ".repeat(1406));
  });
});

describe("CPA-005 credit detail records", () => {
  it("places every field of a single transaction at its verified byte offset", () => {
    const [record] = buildCreditDetailRecords([transaction()], identity);
    expect(record).toHaveLength(1464);

    const segment = record.slice(24, 264); // first (and only) 240-byte segment after the 24-byte record header
    expect(segment.slice(0, 3)).toBe("450"); // transaction type
    expect(segment.slice(3, 13)).toBe("0000012345"); // amount, zero-padded to 10
    expect(segment.slice(13, 19)).toBe("026020"); // date funds available, day-of-year 20
    expect(segment.slice(19, 28)).toBe("000312345"); // institution+transit, zero-padded to 9
    expect(segment.slice(28, 40)).toBe("9876543210  "); // payee account, space-padded to 12
    expect(segment.slice(40, 62)).toBe("0000000000000000000001"); // item trace, zero-padded to 22
    expect(segment.slice(62, 65)).toBe("000"); // stored transaction type
    expect(segment.slice(65, 80)).toBe("PENNYWISE      "); // originator short name, space-padded to 15
    expect(segment.slice(80, 110)).toBe("JORDAN LEBLANC" + " ".repeat(16)); // payee name, space-padded to 30
    expect(segment.slice(110, 140)).toBe("PENNYWISE ACCOUNTING" + " ".repeat(10)); // originator long name
    expect(segment.slice(140, 150)).toBe("PW0001    "); // user id, space-padded to 10
    expect(segment.slice(150, 169)).toBe("RUN-2026-01-A" + " ".repeat(6)); // cross reference
    expect(segment.slice(169, 178)).toBe("000000000"); // return institution id, unused
    expect(segment.slice(227, 229)).toBe("  "); // settlement code, unused
    expect(segment).toHaveLength(240);
  });

  it("keeps names' accented Latin characters intact through NFC normalization", () => {
    const [record] = buildCreditDetailRecords(
      [transaction({ payeeName: "FRANÇOIS ÉLÉONORE" })],
      identity
    );
    const payeeName = record.slice(24 + 80, 24 + 110);
    expect(payeeName.trim()).toBe("FRANÇOIS ÉLÉONORE");
  });

  it("packs up to six transactions per 1464-byte record and starts a new record for the seventh", () => {
    const transactions = Array.from({ length: 7 }, (_, i) =>
      transaction({ itemTraceNumber: String(i + 1).padStart(22, "0") })
    );
    const records = buildCreditDetailRecords(transactions, identity);
    expect(records).toHaveLength(2);
    expect(records[0]).toHaveLength(1464);
    expect(records[1]).toHaveLength(1464);
    // the second record has one real segment and five blank ones
    const secondRecordFirstSegment = records[1].slice(24, 264);
    expect(secondRecordFirstSegment.slice(40, 62)).toBe("0000000000000000000007");
    const blankTail = records[1].slice(24 + 240);
    expect(blankTail).toBe(" ".repeat(5 * 240));
  });

  it("throws rather than silently truncating a field that exceeds its CPA-005 length", () => {
    expect(() =>
      buildCreditDetailRecords([transaction({ itemTraceNumber: "1".repeat(23) })], identity)
    ).toThrow(/exceeds its 22-character/);
  });

  it("throws rather than embedding a '-' inside a numeric field for a negative amount", () => {
    expect(() => buildCreditDetailRecords([transaction({ amountMinor: -100n })], identity)).toThrow(
      /must contain only digits/
    );
  });

  it("throws rather than letting an embedded newline fabricate a record boundary in a text field", () => {
    expect(() =>
      buildCreditDetailRecords([transaction({ payeeName: "JORDAN\nLEBLANC" })], identity)
    ).toThrow(/control character/);
  });
});

describe("CPA-005 file trailer", () => {
  it("sums credit amounts and counts transactions, zero-pads every numeric total, and is exactly 1464 bytes", () => {
    const transactions = [
      transaction({ amountMinor: 10_00n }),
      transaction({ amountMinor: 25_50n })
    ];
    const trailer = buildFileTrailer(transactions, 1, identity);
    expect(trailer).toHaveLength(1464);
    expect(trailer.slice(0, 1)).toBe("Z");
    expect(trailer.slice(24, 38)).toBe("00000000000000"); // total value of debit — this module only builds credits
    expect(trailer.slice(38, 46)).toBe("00000000"); // total count of debit
    expect(trailer.slice(46, 60)).toBe("00000000003550"); // total value of credit: 1000 + 2550 = 3550 cents
    expect(trailer.slice(60, 68)).toBe("00000002"); // total count of credit
    expect(trailer.slice(112)).toBe(" ".repeat(1352));
  });
});

describe("buildCpa005CreditFile end to end", () => {
  it("joins records with a single LF, adds no trailing terminator, and every record is exactly 1464 bytes", () => {
    const transactions = [
      transaction({ amountMinor: 500_00n }),
      transaction({ amountMinor: 250_00n })
    ];
    const file = buildCpa005CreditFile(identity, transactions);
    const lines = file.split("\n");
    expect(lines).toHaveLength(3); // header, one detail record, trailer
    for (const line of lines) expect(line).toHaveLength(1464);
    expect(file.endsWith("\n")).toBe(false);
    expect(lines[0]!.slice(0, 1)).toBe("A");
    expect(lines[1]!.slice(0, 1)).toBe("C");
    expect(lines[2]!.slice(0, 1)).toBe("Z");
    expect(lines[2]!.slice(46, 60)).toBe("00000000075000"); // 500.00 + 250.00 = 750.00 -> 75000 cents
  });

  it("refuses to build a file with no transactions rather than emitting a header-and-trailer-only file", () => {
    expect(() => buildCpa005CreditFile(identity, [])).toThrow(/at least one transaction/);
  });

  it("matches the real cadeft reference implementation byte-for-byte", () => {
    // __fixtures__/cadeft-reference-output.txt is the real, byte-for-byte output of
    // moov-io/cadeft's own reference implementation (github.com/moov-io/cadeft),
    // generated with the exact same identity and transaction fixture used above via a
    // Go program built and run against the real library on 2026-09-08 — checked in
    // verbatim (cmp-confirmed identical to the Go program's own output) rather than
    // hand-reconstructed, since manually re-deriving this file's padding is exactly the
    // kind of step that produced two contradictory byte layouts earlier while
    // researching this format from summarized documentation instead of primary source.
    // This test failing means this file's output has drifted from a real, independent
    // implementation — a stronger signal than any internal self-consistency check this
    // file's own logic could produce.
    const referenceOutput = readFileSync(
      join(import.meta.dirname, "__fixtures__", "cadeft-reference-output.txt"),
      "utf8"
    );
    const file = buildCpa005CreditFile(identity, [transaction()]);
    expect(file).toHaveLength(referenceOutput.length);
    expect(file).toBe(referenceOutput);
  });
});
