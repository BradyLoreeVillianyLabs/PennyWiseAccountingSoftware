import { AppError } from "@clearledger/shared";
import { readSheet } from "read-excel-file/node";
import * as yauzl from "yauzl";

export interface ParsedImportFile {
  readonly headers: readonly string[];
  readonly rows: readonly {
    readonly rowNumber: number;
    readonly values: Readonly<Record<string, string>>;
  }[];
  /** Present for spreadsheet imports so a later route can expose source-sheet provenance. */
  readonly metadata?: {
    readonly format: "XLSX";
    readonly sheet: {
      readonly name: string;
      readonly index: number;
      readonly availableSheetCount: number;
    };
    readonly warnings: readonly string[];
  };
}

export const maximumMigrationBytes = 5 * 1024 * 1024;
export const maximumMigrationRows = 20_000;
export const maximumXlsxEntries = 1_000;
export const maximumXlsxEntryBytes = 5 * 1024 * 1024;
export const maximumXlsxExpandedBytes = 20 * 1024 * 1024;
export const maximumXlsxCompressionRatio = 100;

const csvMediaTypes = new Set(["text/csv", "application/csv"]);
const xlsxMediaType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Strict migration-file adapter. CSV remains synchronous for backwards compatibility;
 * XLSX preflighting is asynchronous because ZIP entries must be inspected before parsing.
 */
export async function parseMigrationFile(
  fileName: string,
  mediaType: string,
  data: Buffer
): Promise<ParsedImportFile> {
  assertMigrationSize(data);
  const extension = extensionOf(fileName);
  const normalizedMediaType = mediaType.toLowerCase();
  if (extension === ".csv" && csvMediaTypes.has(normalizedMediaType))
    return parseMigrationCsv(fileName, mediaType, data);
  if (extension === ".xlsx" && normalizedMediaType === xlsxMediaType)
    return parseMigrationXlsx(data);
  throw new AppError(
    "IMPORT_TYPE_INVALID",
    "Migration files must be CSV (text/csv) or XLSX (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet).",
    422
  );
}

export function parseMigrationCsv(
  fileName: string,
  mediaType: string,
  data: Buffer
): ParsedImportFile {
  assertMigrationSize(data);
  if (extensionOf(fileName) !== ".csv" || !csvMediaTypes.has(mediaType.toLowerCase()))
    throw new AppError("IMPORT_TYPE_INVALID", "Only CSV migration files are accepted.", 422);
  if (data.includes(0))
    throw new AppError("IMPORT_TYPE_INVALID", "Binary migration content is not accepted.", 422);
  return parsedRowsFromRecords(parseCsvRecords(data.toString("utf8").replace(/^\uFEFF/, "")), true);
}

export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

async function parseMigrationXlsx(data: Buffer): Promise<ParsedImportFile> {
  const entries = await readXlsxArchive(data);
  assertSafeXlsx(entries);
  const sheets = workbookSheets(entries);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml"));
  const parsedSheets = sheets.map((sheet) => ({
    sheet,
    records: parseWorksheetRecords(requiredEntry(entries, sheet.path), sharedStrings, sheet.name)
  }));
  const selected = parsedSheets.find((candidate) => candidate.records.length >= 2);
  if (!selected)
    throw new AppError("IMPORT_EMPTY", "XLSX requires a header and at least one data row.", 422);

  // Keep the maintained XLSX parser in the validation path. Raw XML values below are
  // intentionally used for persistence so identifiers and monetary strings are never
  // coerced through JavaScript Number or Date values.
  try {
    await readSheet(data, selected.sheet.name, { trim: false });
  } catch {
    throw new AppError("IMPORT_XLSX_MALFORMED", "The XLSX workbook could not be read.", 422);
  }

  const parsed = parsedRowsFromRecords(selected.records, false);
  return {
    ...parsed,
    metadata: {
      format: "XLSX",
      sheet: {
        name: selected.sheet.name,
        index: selected.sheet.index,
        availableSheetCount: sheets.length
      },
      warnings: selected.records.flatMap((record) => record.warnings)
    }
  };
}

function assertMigrationSize(data: Buffer): void {
  if (data.length === 0 || data.length > maximumMigrationBytes)
    throw new AppError(
      "IMPORT_SIZE_INVALID",
      "Migration files must be between 1 byte and 5 MiB.",
      413
    );
}

function parsedRowsFromRecords(
  records: readonly ParsedRecord[],
  trimValues: boolean
): ParsedImportFile {
  if (records.length < 2)
    throw new AppError("IMPORT_EMPTY", "Imports require a header and at least one data row.", 422);
  if (records.length - 1 > maximumMigrationRows)
    throw new AppError(
      "IMPORT_ROW_LIMIT",
      `Migration files may contain at most ${String(maximumMigrationRows)} rows.`,
      422
    );
  const headers = records[0]!.values.map(normalizeHeader);
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length)
    throw new AppError(
      "IMPORT_HEADERS_INVALID",
      "Import headers must be non-empty and unique.",
      422
    );
  return {
    headers,
    rows: records.slice(1).map((record) => {
      if (record.values.length > headers.length)
        throw new AppError(
          "IMPORT_ROW_MALFORMED",
          `Row ${String(record.rowNumber)} has more fields than the header.`,
          422,
          { row: record.rowNumber, field: "row" }
        );
      return {
        rowNumber: record.rowNumber,
        values: Object.fromEntries(
          headers.map((header, position) => [
            header,
            trimValues ? (record.values[position] ?? "").trim() : (record.values[position] ?? "")
          ])
        )
      };
    })
  };
}

interface ParsedRecord {
  readonly rowNumber: number;
  readonly values: readonly string[];
  readonly warnings: readonly string[];
}

interface WorkbookSheet {
  readonly index: number;
  readonly name: string;
  readonly path: string;
}

async function readXlsxArchive(data: Buffer): Promise<Map<string, Buffer>> {
  let archive: yauzl.ZipFile;
  try {
    archive = await new Promise<yauzl.ZipFile>((resolve, reject) =>
      yauzl.fromBuffer(
        data,
        { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
        (error, value) => (error ? reject(error) : resolve(value))
      )
    );
  } catch {
    throw new AppError("IMPORT_XLSX_MALFORMED", "The XLSX file is not a valid ZIP workbook.", 422);
  }
  return new Promise((resolve, reject) => {
    const files = new Map<string, Buffer>();
    let entryCount = 0;
    let expandedBytes = 0;
    let settled = false;
    const fail = (error: AppError) => {
      if (settled) return;
      settled = true;
      archive.close();
      reject(error);
    };
    archive.on("error", () =>
      fail(new AppError("IMPORT_XLSX_MALFORMED", "The XLSX ZIP archive is malformed.", 422))
    );
    archive.on("entry", (entry: yauzl.Entry) => {
      entryCount += 1;
      expandedBytes += entry.uncompressedSize;
      const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1);
      if (
        entryCount > maximumXlsxEntries ||
        entry.uncompressedSize > maximumXlsxEntryBytes ||
        expandedBytes > maximumXlsxExpandedBytes ||
        ratio > maximumXlsxCompressionRatio ||
        entry.isEncrypted() ||
        (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
      ) {
        fail(
          new AppError(
            "IMPORT_XLSX_ARCHIVE_LIMIT",
            "The XLSX archive exceeds safe entry, expanded-size, or compression limits.",
            422
          )
        );
        return;
      }
      archive.openReadStream(entry, (error, stream) => {
        if (error) {
          fail(new AppError("IMPORT_XLSX_MALFORMED", "The XLSX archive could not be read.", 422));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        stream.on("error", () =>
          fail(new AppError("IMPORT_XLSX_MALFORMED", "The XLSX archive could not be read.", 422))
        );
        stream.on("end", () => {
          if (settled) return;
          files.set(entry.fileName, Buffer.concat(chunks));
          archive.readEntry();
        });
      });
    });
    archive.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(files);
      }
    });
    archive.readEntry();
  });
}

function assertSafeXlsx(entries: ReadonlyMap<string, Buffer>): void {
  const names = [...entries.keys()];
  if (
    !entries.has("[Content_Types].xml") ||
    !entries.has("xl/workbook.xml") ||
    !entries.has("xl/_rels/workbook.xml.rels")
  )
    throw new AppError(
      "IMPORT_XLSX_MALFORMED",
      "The XLSX workbook is missing required parts.",
      422
    );
  const packageText = names
    .filter((name) => name.endsWith(".xml") || name.endsWith(".rels"))
    .map((name) => entries.get(name)!.toString("utf8"))
    .join("\n");
  if (
    names.some((name) => /(^|\/)vbaProject\.bin$|^xl\/embeddings\//i.test(name)) ||
    /<(?:\w+:)?(?:oleObjects?|externalReferences?)\b|vbaProject|TargetMode\s*=\s*["']External["']/i.test(
      packageText
    )
  )
    throw new AppError(
      "IMPORT_XLSX_ACTIVE_CONTENT",
      "Macro, OLE, or external-link content is not accepted in XLSX migration files.",
      422
    );
}

function workbookSheets(entries: ReadonlyMap<string, Buffer>): readonly WorkbookSheet[] {
  const relationships = new Map<string, string>();
  const relationshipsXml = requiredEntry(entries, "xl/_rels/workbook.xml.rels").toString("utf8");
  for (const match of relationshipsXml.matchAll(
    /<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g
  )) {
    const attributes = xmlAttributes(match[1]!);
    if (attributes.Id && attributes.Target)
      relationships.set(attributes.Id, workbookTarget(attributes.Target));
  }
  const sheets: WorkbookSheet[] = [];
  const workbookXml = requiredEntry(entries, "xl/workbook.xml").toString("utf8");
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)) {
    const attributes = xmlAttributes(match[1]!);
    const relationshipId = attributes["r:id"];
    const path = relationshipId ? relationships.get(relationshipId) : undefined;
    if (!attributes.name || !path || !entries.has(path))
      throw new AppError(
        "IMPORT_XLSX_MALFORMED",
        "The XLSX workbook has an invalid sheet reference.",
        422
      );
    sheets.push({ index: sheets.length, name: decodeXml(attributes.name), path });
  }
  if (!sheets.length)
    throw new AppError("IMPORT_XLSX_MALFORMED", "The XLSX workbook contains no worksheets.", 422);
  return sheets;
}

function parseWorksheetRecords(
  data: Buffer,
  sharedStrings: readonly string[],
  sheetName: string
): readonly ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const xml = data.toString("utf8");
  let fallbackRowNumber = 1;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttributes = xmlAttributes(rowMatch[1]!);
    const rowNumber = Number.parseInt(rowAttributes.r ?? String(fallbackRowNumber), 10);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1)
      throw new AppError(
        "IMPORT_XLSX_MALFORMED",
        "The XLSX workbook has an invalid row reference.",
        422
      );
    fallbackRowNumber = rowNumber + 1;
    const values: string[] = [];
    const warnings: string[] = [];
    let nextColumn = 0;
    for (const cellMatch of rowMatch[2]!.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = xmlAttributes(cellMatch[1]!);
      const column = attributes.r ? columnIndex(attributes.r) : nextColumn;
      nextColumn = column + 1;
      if (column < 0 || column > 16_383)
        throw new AppError(
          "IMPORT_XLSX_MALFORMED",
          "The XLSX workbook has an invalid cell reference.",
          422
        );
      while (values.length <= column) values.push("");
      const cell = parseCellValue(
        attributes,
        cellMatch[2] ?? "",
        sharedStrings,
        sheetName,
        rowNumber
      );
      values[column] = cell.value;
      warnings.push(...cell.warnings);
    }
    if (values.some((value) => value.length > 0)) records.push({ rowNumber, values, warnings });
  }
  return records;
}

function parseCellValue(
  attributes: Readonly<Record<string, string>>,
  content: string,
  sharedStrings: readonly string[],
  sheetName: string,
  rowNumber: number
): { readonly value: string; readonly warnings: readonly string[] } {
  const type = attributes.t;
  const formula = /<f\b[^>]*>([\s\S]*?)<\/f>|<f\b[^>]*\/>/.test(content);
  const rawValue = xmlTagText(content, "v");
  if (formula && rawValue === undefined)
    throw new AppError(
      "IMPORT_XLSX_FORMULA_UNCACHED",
      `Formula cell in ${sheetName} row ${String(rowNumber)} has no cached value.`,
      422
    );
  const value =
    type === "s"
      ? (() => {
          const sharedIndex = Number.parseInt(rawValue ?? "", 10);
          if (
            !Number.isSafeInteger(sharedIndex) ||
            sharedIndex < 0 ||
            sharedIndex >= sharedStrings.length
          )
            throw new AppError(
              "IMPORT_XLSX_MALFORMED",
              "The XLSX workbook has an invalid shared string.",
              422
            );
          return sharedStrings[sharedIndex]!;
        })()
      : type === "inlineStr"
        ? (xmlTagText(content, "is", true) ?? "")
        : (rawValue ?? "");
  if (formula && /\[|HYPERLINK\s*\(/i.test(xmlTagText(content, "f") ?? ""))
    throw new AppError(
      "IMPORT_XLSX_ACTIVE_CONTENT",
      "External formula references are not accepted in XLSX migration files.",
      422
    );
  return {
    value,
    warnings: formula
      ? [`Formula in ${sheetName} row ${String(rowNumber)} was imported from its cached value.`]
      : []
  };
}

function parseSharedStrings(data: Buffer | undefined): readonly string[] {
  if (!data) return [];
  return [...data.toString("utf8").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    xmlText(match[1]!)
  );
}

function xmlTagText(content: string, tag: string, preserveNestedText = false): string | undefined {
  const match = content.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return undefined;
  return preserveNestedText ? xmlText(match[1]!) : decodeXml(match[1]!);
}

function xmlText(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, ""));
}

function xmlAttributes(value: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g))
    attributes[match[1]!] = match[3]!;
  return attributes;
}

function decodeXml(value: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    quot: '"',
    lt: "<",
    gt: ">"
  };
  return value.replace(
    /&(amp|apos|quot|lt|gt);|&#(\d+);|&#x([\da-f]+);/gi,
    (
      _match: string,
      named: string | undefined,
      decimal: string | undefined,
      hex: string | undefined
    ): string => {
      if (named) return namedEntities[named.toLowerCase()]!;
      const numericValue = decimal ?? hex;
      return numericValue
        ? String.fromCodePoint(Number.parseInt(numericValue, hex ? 16 : 10))
        : _match;
    }
  );
}

function workbookTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\//, "");
  if (normalized.includes("..") || /^[a-z]+:/i.test(normalized))
    throw new AppError("IMPORT_XLSX_MALFORMED", "The XLSX workbook has an unsafe sheet path.", 422);
  return `xl/${normalized.replace(/^xl\//, "")}`;
}

function requiredEntry(entries: ReadonlyMap<string, Buffer>, path: string): Buffer {
  const entry = entries.get(path);
  if (!entry)
    throw new AppError(
      "IMPORT_XLSX_MALFORMED",
      "The XLSX workbook is missing a required part.",
      422
    );
  return entry;
}

function columnIndex(reference: string): number {
  const match = reference.match(/^\$?([A-Z]+)\$?\d+$/i);
  if (!match) return -1;
  let result = 0;
  for (const character of match[1]!.toUpperCase())
    result = result * 26 + character.charCodeAt(0) - 64;
  return result - 1;
}

function extensionOf(fileName: string): string {
  const match = fileName
    .trim()
    .toLowerCase()
    .match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

function parseCsvRecords(text: string): readonly ParsedRecord[] {
  const records: ParsedRecord[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let rowNumber = 1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else field += character;
    } else if (closedQuote && character !== "," && character !== "\n" && character !== "\r") {
      throw new AppError("IMPORT_CSV_MALFORMED", "Unexpected data after a quoted field.", 422);
    } else if (character === '"') {
      if (field.length) throw new AppError("IMPORT_CSV_MALFORMED", "Malformed CSV quote.", 422);
      quoted = true;
      closedQuote = false;
    } else if (character === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value.trim()))
        records.push({ rowNumber, values: record, warnings: [] });
      record = [];
      field = "";
      closedQuote = false;
      rowNumber += 1;
    } else if (character !== "\r" || closedQuote) field += character;
  }
  if (quoted) throw new AppError("IMPORT_CSV_MALFORMED", "Unterminated CSV quote.", 422);
  record.push(field.replace(/\r$/, ""));
  if (record.some((value) => value.trim()))
    records.push({ rowNumber, values: record, warnings: [] });
  return records;
}
