const RECORD_LENGTH = 1464;
const DETAIL_SEGMENT_LENGTH = 240;
const SEGMENTS_PER_DETAIL_RECORD = 6;

export const CPA005_CREDIT_PERSONAL_CHEQUING_SAVINGS = "450";

export interface Cpa005FileIdentity {
  originatorId: string;
  fileCreationNumber: number;
  creationDate: Date;
  destinationDataCentre: number | string;
  directClearerCommunicationArea: string;
  currencyCode: string;
}

export interface Cpa005CreditTransaction {
  transactionType: string;
  amountMinor: bigint;
  dateFundsAvailable: Date;
  payeeInstitutionAndTransit: string | number;
  payeeAccountNumber: string;
  itemTraceNumber: string | number;
  originatorShortName: string;
  payeeName: string;
  originatorLongName: string;
  userId: string;
  crossReferenceNumber: string;
}

function assertSafeText(value: string, fieldName: string): string {
  const normalized = value.normalize("NFC");
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if ((codePoint >= 0 && codePoint <= 31) || codePoint === 127) {
      throw new Error(`${fieldName} contains a control character.`);
    }
  }
  return normalized;
}

function numeric(value: number | bigint | string, width: number, fieldName: string): string {
  const text = String(value);
  if (!/^\d+$/u.test(text)) {
    throw new Error(`${fieldName} must contain only digits.`);
  }
  if (text.length > width) {
    throw new Error(`${fieldName} exceeds its ${String(width)}-character limit.`);
  }
  return text.padStart(width, "0");
}

function text(value: string, width: number, fieldName: string): string {
  const normalized = assertSafeText(value, fieldName);
  if (normalized.length > width) {
    throw new Error(`${fieldName} exceeds its ${String(width)}-character limit.`);
  }
  return normalized.padEnd(width, " ");
}

function dayOfYear(date: Date, fieldName: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date.`);
  }
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = Math.floor((current - start) / 86_400_000) + 1;
  return `${numeric(date.getUTCFullYear() % 1000, 3, `${fieldName} year`)}${numeric(day, 3, `${fieldName} day`)}`;
}

function recordHeader(
  recordType: string,
  recordNumber: number,
  identity: Cpa005FileIdentity
): string {
  return `${recordType}${numeric(recordNumber, 9, "record number")}${numeric(identity.originatorId, 10, "originator id")}${numeric(identity.fileCreationNumber, 4, "file creation number")}`;
}

function validateIdentity(identity: Cpa005FileIdentity): void {
  numeric(identity.originatorId, 10, "originator id");
  numeric(identity.fileCreationNumber, 4, "file creation number");
  numeric(identity.destinationDataCentre, 5, "destination data centre");
  dayOfYear(identity.creationDate, "creation date");
  text(identity.directClearerCommunicationArea, 20, "direct clearer communication area");
  const currency = assertSafeText(identity.currencyCode, "currency code");
  if (currency.length !== 3) {
    throw new Error("currency code must be exactly 3 characters.");
  }
}

export function buildFileHeader(identity: Cpa005FileIdentity): string {
  validateIdentity(identity);
  const header = `${recordHeader("A", 1, identity)}${dayOfYear(identity.creationDate, "creation date")}${numeric(identity.destinationDataCentre, 5, "destination data centre")}${text(identity.directClearerCommunicationArea, 20, "direct clearer communication area")}${assertSafeText(identity.currencyCode, "currency code")}${" ".repeat(1406)}`;
  if (header.length !== RECORD_LENGTH)
    throw new Error("CPA-005 file header has an invalid length.");
  return header;
}

function buildTransactionSegment(transaction: Cpa005CreditTransaction): string {
  const segment = [
    numeric(transaction.transactionType, 3, "transaction type"),
    numeric(transaction.amountMinor, 10, "amount"),
    dayOfYear(transaction.dateFundsAvailable, "date funds available"),
    numeric(transaction.payeeInstitutionAndTransit, 9, "payee institution and transit"),
    text(transaction.payeeAccountNumber, 12, "payee account number"),
    numeric(transaction.itemTraceNumber, 22, "item trace number"),
    "000",
    text(transaction.originatorShortName, 15, "originator short name"),
    text(transaction.payeeName, 30, "payee name"),
    text(transaction.originatorLongName, 30, "originator long name"),
    text(transaction.userId, 10, "user id"),
    text(transaction.crossReferenceNumber, 19, "cross-reference number"),
    "000000000",
    " ".repeat(51),
    "00000000000"
  ].join("");
  if (segment.length !== DETAIL_SEGMENT_LENGTH)
    throw new Error("CPA-005 transaction segment has an invalid length.");
  return segment;
}

export function buildCreditDetailRecords(
  transactions: Cpa005CreditTransaction[],
  identity: Cpa005FileIdentity
): string[] {
  validateIdentity(identity);
  if (transactions.length === 0) return [];
  const records: string[] = [];
  for (let offset = 0; offset < transactions.length; offset += SEGMENTS_PER_DETAIL_RECORD) {
    const segments = transactions
      .slice(offset, offset + SEGMENTS_PER_DETAIL_RECORD)
      .map(buildTransactionSegment);
    const record = `${recordHeader("C", records.length + 2, identity)}${segments.join("")}${" ".repeat((SEGMENTS_PER_DETAIL_RECORD - segments.length) * DETAIL_SEGMENT_LENGTH)}`;
    if (record.length !== RECORD_LENGTH)
      throw new Error("CPA-005 detail record has an invalid length.");
    records.push(record);
  }
  return records;
}

export function buildFileTrailer(
  transactions: Cpa005CreditTransaction[],
  detailRecordCount: number,
  identity: Cpa005FileIdentity
): string {
  validateIdentity(identity);
  const creditTotal = transactions.reduce(
    (total, transaction) => total + transaction.amountMinor,
    0n
  );
  const trailer = `${recordHeader("Z", detailRecordCount + 2, identity)}${"0".repeat(14)}${"0".repeat(8)}${numeric(creditTotal, 14, "total credit value")}${numeric(transactions.length, 8, "total credit count")}${"0".repeat(14)}${"0".repeat(8)}${"0".repeat(14)}${"0".repeat(8)}${" ".repeat(1352)}`;
  if (trailer.length !== RECORD_LENGTH)
    throw new Error("CPA-005 file trailer has an invalid length.");
  return trailer;
}

export function buildCpa005CreditFile(
  identity: Cpa005FileIdentity,
  transactions: Cpa005CreditTransaction[]
): string {
  if (transactions.length === 0) {
    throw new Error("A CPA-005 file requires at least one transaction.");
  }
  const details = buildCreditDetailRecords(transactions, identity);
  return [
    buildFileHeader(identity),
    ...details,
    buildFileTrailer(transactions, details.length, identity)
  ].join("\n");
}
