import { createHash } from "node:crypto";
import { AppError } from "@clearledger/shared";

export interface CsvBankMapping {
  readonly postingDate: string;
  readonly transactionDate?: string | undefined;
  readonly description: string;
  readonly payee?: string | undefined;
  readonly memo?: string | undefined;
  readonly amount?: string | undefined;
  readonly debit?: string | undefined;
  readonly credit?: string | undefined;
  readonly currency?: string | undefined;
  readonly balance?: string | undefined;
  readonly referenceNumber?: string | undefined;
  readonly sourceRowIdentifier?: string | undefined;
}

/**
 * Explicit, user-selected mappings for common Canadian export shapes. These
 * are deliberately mappings rather than a claim of a live bank integration;
 * banks change headers and the upload screen still shows the mapping before
 * anything is committed.
 */
export const canadianBankImportProfiles = {
  RBC_GENERIC_CSV: {
    label: "RBC generic CSV",
    mapping: {
      postingDate: "date",
      description: "description",
      amount: "amount",
      currency: "currency",
      balance: "balance",
      referenceNumber: "reference"
    } satisfies CsvBankMapping
  },
  SCOTIACONNECT_CSV: {
    label: "ScotiaConnect debit/credit CSV",
    mapping: {
      postingDate: "transaction date",
      description: "description",
      debit: "debit",
      credit: "credit",
      currency: "currency",
      balance: "balance",
      referenceNumber: "reference number"
    } satisfies CsvBankMapping
  },
  TD_BUSINESS_CSV: {
    label: "TD Business debit/deposit CSV",
    mapping: {
      postingDate: "date",
      description: "memo",
      debit: "withdrawal",
      credit: "deposit",
      currency: "currency",
      balance: "balance",
      referenceNumber: "reference"
    } satisfies CsvBankMapping
  }
} as const;

export interface NormalizedBankRow {
  readonly sourceRowNumber: number;
  readonly sourceRowIdentifier: string | null;
  readonly providerTransactionId: string | null;
  readonly postingDate: string;
  readonly transactionDate: string | null;
  readonly description: string;
  readonly normalizedDescription: string;
  readonly payee: string | null;
  readonly memo: string | null;
  readonly amountMinor: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly currency: string;
  readonly balanceMinor: string | null;
  readonly referenceNumber: string | null;
  readonly rawFingerprint: string;
}

export interface BankImportParseInput {
  readonly format: "CSV" | "OFX" | "QFX";
  readonly fileName: string;
  readonly data: Buffer;
  readonly mapping?: CsvBankMapping | undefined;
}

const maximumImportBytes = 5 * 1024 * 1024;
const maximumImportRows = 20_000;

export function parseBankImport(input: BankImportParseInput): readonly NormalizedBankRow[] {
  validateFile(input);
  const text = input.data.toString("utf8").replace(/^\uFEFF/, "");
  const rows =
    input.format === "CSV"
      ? parseCsvImport(text, input.mapping ?? defaultCsvMapping)
      : parseOfxImport(text);
  if (rows.length === 0)
    throw importError(1, "file", "The import does not contain any transactions.");
  if (rows.length > maximumImportRows)
    throw importError(
      1,
      "file",
      `An import may contain at most ${String(maximumImportRows)} rows.`
    );
  const fingerprints = new Set<string>();
  for (const row of rows) {
    if (fingerprints.has(row.rawFingerprint))
      throw importError(
        row.sourceRowNumber,
        "row",
        "The file contains an exact duplicate transaction row."
      );
    fingerprints.add(row.rawFingerprint);
  }
  return rows;
}

function validateFile(input: BankImportParseInput): void {
  if (input.data.length === 0 || input.data.length > maximumImportBytes)
    throw new AppError(
      "BANK_IMPORT_SIZE_INVALID",
      "Statement files must be between 1 byte and 5 MiB.",
      413
    );
  if (input.data.includes(0))
    throw new AppError(
      "BANK_IMPORT_TYPE_INVALID",
      "Binary statement content is not accepted.",
      422
    );
  const extension = input.fileName.toLowerCase().split(".").pop();
  const expected = input.format.toLowerCase();
  if (extension !== expected)
    throw new AppError(
      "BANK_IMPORT_TYPE_INVALID",
      "The file extension does not match the selected import format.",
      422
    );
}

const defaultCsvMapping: CsvBankMapping = {
  postingDate: "date",
  transactionDate: "transaction_date",
  description: "description",
  payee: "payee",
  memo: "memo",
  amount: "amount",
  debit: "debit",
  credit: "credit",
  currency: "currency",
  balance: "balance",
  referenceNumber: "reference",
  sourceRowIdentifier: "id"
};

function parseCsvImport(text: string, mapping: CsvBankMapping): readonly NormalizedBankRow[] {
  const records = parseCsvRecords(text);
  if (records.length < 2)
    throw importError(1, "file", "CSV requires a header and at least one row.");
  const headers = records[0]!.map((value) => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length)
    throw importError(1, "header", "CSV headers must be unique.");
  const column = (name: string | undefined, required = false): number | null => {
    if (!name) {
      if (required) throw importError(1, "mapping", "A required CSV mapping is missing.");
      return null;
    }
    const index = headers.indexOf(name.trim().toLowerCase());
    if (index < 0 && required)
      throw importError(1, name, `Mapped CSV column "${name}" was not found.`);
    return index < 0 ? null : index;
  };
  const columns = {
    postingDate: column(mapping.postingDate, true)!,
    transactionDate: column(mapping.transactionDate),
    description: column(mapping.description, true)!,
    payee: column(mapping.payee),
    memo: column(mapping.memo),
    amount: column(mapping.amount),
    debit: column(mapping.debit),
    credit: column(mapping.credit),
    currency: column(mapping.currency),
    balance: column(mapping.balance),
    referenceNumber: column(mapping.referenceNumber),
    sourceRowIdentifier: column(mapping.sourceRowIdentifier)
  };
  if (columns.amount === null && columns.debit === null && columns.credit === null)
    throw importError(1, "mapping", "Map an amount column or debit and credit columns.");

  return records.slice(1).map((record, index) => {
    const rowNumber = index + 2;
    if (record.length > headers.length)
      throw importError(rowNumber, "row", "The row has more fields than the header.");
    const value = (position: number | null): string =>
      position === null ? "" : (record[position] ?? "").trim();
    const description = value(columns.description);
    if (!description) throw importError(rowNumber, mapping.description, "Description is required.");
    const amount = csvAmount(
      value(columns.amount),
      value(columns.debit),
      value(columns.credit),
      rowNumber
    );
    return normalizedRow({
      sourceRowNumber: rowNumber,
      sourceRowIdentifier: nullable(value(columns.sourceRowIdentifier)),
      providerTransactionId: nullable(value(columns.sourceRowIdentifier)),
      postingDate: parseImportDate(value(columns.postingDate), rowNumber, mapping.postingDate),
      transactionDate: nullableDate(
        value(columns.transactionDate),
        rowNumber,
        mapping.transactionDate ?? "transactionDate"
      ),
      description,
      payee: nullable(value(columns.payee)),
      memo: nullable(value(columns.memo)),
      amountMinor: amount.amountMinor,
      direction: amount.direction,
      currency: normalizeCurrency(value(columns.currency), rowNumber),
      balanceMinor: nullableMinor(value(columns.balance), rowNumber, "balance"),
      referenceNumber: nullable(value(columns.referenceNumber))
    });
  });
}

function parseCsvRecords(text: string): readonly (readonly string[])[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length > 0) throw importError(records.length + 1, "row", "Malformed CSV quote.");
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw importError(records.length + 1, "row", "Unterminated CSV quote.");
  record.push(field.replace(/\r$/, ""));
  if (record.some((value) => value.trim())) records.push(record);
  return records;
}

function parseOfxImport(text: string): readonly NormalizedBankRow[] {
  if (!/<OFX>/i.test(text) || !/<STMTTRN>/i.test(text))
    throw importError(1, "file", "The OFX/QFX statement structure is invalid.");
  const blocks = [
    ...text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi)
  ];
  return blocks.map((match, index) => {
    const rowNumber = index + 1;
    const block = match[1] ?? "";
    const field = (tag: string): string =>
      (
        block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"))?.[1] ??
        block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1] ??
        ""
      ).trim();
    const signedAmount = parseSignedDecimal(field("TRNAMT"), rowNumber, "TRNAMT");
    const description = field("NAME") || field("MEMO");
    if (!description) throw importError(rowNumber, "NAME", "OFX transaction name is required.");
    const providerId = nullable(field("FITID"));
    return normalizedRow({
      sourceRowNumber: rowNumber,
      sourceRowIdentifier: providerId,
      providerTransactionId: providerId,
      postingDate: parseImportDate(field("DTPOSTED"), rowNumber, "DTPOSTED"),
      transactionDate: nullableDate(field("DTUSER"), rowNumber, "DTUSER"),
      description,
      payee: nullable(field("NAME")),
      memo: nullable(field("MEMO")),
      amountMinor: absolute(signedAmount).toString(),
      direction: signedAmount < 0n ? "DEBIT" : "CREDIT",
      currency: normalizeCurrency(field("CURDEF") || ofxCurrency(text), rowNumber),
      balanceMinor: null,
      referenceNumber: nullable(field("CHECKNUM") || field("REFNUM"))
    });
  });
}

function csvAmount(
  amountText: string,
  debitText: string,
  creditText: string,
  row: number
): { readonly amountMinor: string; readonly direction: "DEBIT" | "CREDIT" } {
  if (amountText) {
    const amount = parseSignedDecimal(amountText, row, "amount");
    if (amount === 0n) throw importError(row, "amount", "Transaction amount cannot be zero.");
    return {
      amountMinor: absolute(amount).toString(),
      direction: amount < 0n ? "DEBIT" : "CREDIT"
    };
  }
  if (debitText && creditText)
    throw importError(row, "amount", "A transaction cannot contain both debit and credit values.");
  if (!debitText && !creditText)
    throw importError(row, "amount", "A debit or credit amount is required.");
  const amount = parseUnsignedDecimal(debitText || creditText, row, debitText ? "debit" : "credit");
  if (amount === 0n) throw importError(row, "amount", "Transaction amount cannot be zero.");
  return { amountMinor: amount.toString(), direction: debitText ? "DEBIT" : "CREDIT" };
}

function normalizedRow(
  row: Omit<NormalizedBankRow, "normalizedDescription" | "rawFingerprint">
): NormalizedBankRow {
  const normalizedDescription = normalizeDescription(
    [row.description, row.payee, row.memo].filter(Boolean).join(" ")
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        row.providerTransactionId,
        row.postingDate,
        row.transactionDate,
        normalizedDescription,
        row.amountMinor,
        row.direction,
        row.currency,
        row.referenceNumber
      ])
    )
    .digest("hex");
  return { ...row, normalizedDescription, rawFingerprint: fingerprint };
}

export function normalizeDescription(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseImportDate(value: string, row: number, field: string): string {
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})/);
  const normalized = compact
    ? `${compact[1] ?? ""}-${compact[2] ?? ""}-${compact[3] ?? ""}`
    : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized))
    throw importError(row, field, "Date must be YYYY-MM-DD or an OFX YYYYMMDD value.");
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized)
    throw importError(row, field, "Date is not a valid calendar date.");
  return normalized;
}

function nullableDate(value: string, row: number, field: string): string | null {
  return value ? parseImportDate(value, row, field) : null;
}

function parseSignedDecimal(value: string, row: number, field: string): bigint {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw importError(row, field, "Amount must have at most two decimal places.");
  const sign = match[1] === "-" ? -1n : 1n;
  return sign * (BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
}

function parseUnsignedDecimal(value: string, row: number, field: string): bigint {
  const amount = parseSignedDecimal(value, row, field);
  if (amount < 0n) throw importError(row, field, "Debit and credit columns cannot be negative.");
  return amount;
}

function nullableMinor(value: string, row: number, field: string): string | null {
  return value ? parseSignedDecimal(value, row, field).toString() : null;
}

function normalizeCurrency(value: string, row: number): string {
  const currency = (value || "CAD").toUpperCase();
  if (currency !== "CAD")
    throw importError(row, "currency", "Only CAD statement activity is supported.");
  return currency;
}

function ofxCurrency(text: string): string {
  return text.match(/<CURDEF>([^<\r\n]*)/i)?.[1]?.trim() ?? "CAD";
}

function nullable(value: string): string | null {
  return value || null;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function importError(row: number, field: string, message: string): AppError {
  return new AppError("BANK_IMPORT_ROW_INVALID", message, 422, { row, field });
}
