import { AppError } from "@clearledger/shared";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  maximumMigrationBytes,
  maximumMigrationRows,
  maximumXlsxEntryBytes,
  normalizeHeader,
  parseMigrationFile,
  parseMigrationCsv
} from "./data-import-parser.js";

function parse(text: string, fileName = "migration.csv", mediaType = "text/csv") {
  return parseMigrationCsv(fileName, mediaType, Buffer.from(text));
}

function expectCode(work: () => unknown, code: string) {
  try {
    work();
    throw new Error("Expected parsing to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe("migration CSV parser", () => {
  it("normalizes QuickBooks-style headers and parses escaped multiline fields", () => {
    const result = parse(
      '\uFEFFCustomer No.,Display Name,Notes\r\nC-1,"North, Inc.","First line\r\nSecond ""quoted"" line"\r\n'
    );
    expect(result.headers).toEqual(["customer_no", "display_name", "notes"]);
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        values: {
          customer_no: "C-1",
          display_name: "North, Inc.",
          notes: 'First line\r\nSecond "quoted" line'
        }
      }
    ]);
    expect(normalizeHeader("  A/R Account  ")).toBe("a_r_account");
  });

  it("rejects invalid media, binary content, duplicate headers, and malformed quotes", () => {
    expectCode(() => parse("a\nb\n", "migration.txt"), "IMPORT_TYPE_INVALID");
    expectCode(
      () => parseMigrationCsv("migration.csv", "text/csv", Buffer.from([97, 0, 10])),
      "IMPORT_TYPE_INVALID"
    );
    expectCode(() => parse("Name,name\nA,B\n"), "IMPORT_HEADERS_INVALID");
    expectCode(() => parse('name\n"unterminated\n'), "IMPORT_CSV_MALFORMED");
    expectCode(() => parse('name\n"closed"tail\n'), "IMPORT_CSV_MALFORMED");
    expectCode(() => parse("a\n1,2\n"), "IMPORT_ROW_MALFORMED");
  });

  it("enforces exact byte and row limits", () => {
    expectCode(
      () =>
        parseMigrationCsv("migration.csv", "text/csv", Buffer.alloc(maximumMigrationBytes + 1, 97)),
      "IMPORT_SIZE_INVALID"
    );
    const tooManyRows = `id\n${Array.from({ length: maximumMigrationRows + 1 }, (_, index) =>
      String(index)
    ).join("\n")}\n`;
    expectCode(() => parse(tooManyRows), "IMPORT_ROW_LIMIT");
  });
});

describe("migration XLSX parser", () => {
  it("uses the first non-empty sheet and preserves identifier and money cell text", async () => {
    const result = await parseMigrationFile(
      "migration.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      workbook({
        sheet1: "",
        sheet2:
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>120.00</v></c><c r="C2"><f>SUM(1,2)</f><v>3.00</v></c></row>',
        sharedStrings: ["Customer No.", "Amount Minor", "Calculated", "00123"]
      })
    );
    expect(result.headers).toEqual(["customer_no", "amount_minor", "calculated"]);
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        values: { customer_no: "00123", amount_minor: "120.00", calculated: "3.00" }
      }
    ]);
    expect(result.metadata).toEqual({
      format: "XLSX",
      sheet: { name: "Data", index: 1, availableSheetCount: 2 },
      warnings: ["Formula in Data row 2 was imported from its cached value."]
    });
  });

  it("rejects strict type mismatches, malformed workbooks, macros, and archive bombs", async () => {
    for (const [fileName, mediaType] of [
      ["migration.xls", "application/vnd.ms-excel"],
      ["migration.xlsm", "application/vnd.ms-excel.sheet.macroenabled.12"],
      ["migration.xlsb", "application/vnd.ms-excel.sheet.binary.macroenabled.12"]
    ])
      await expect(
        parseMigrationFile(fileName, mediaType, Buffer.from("legacy"))
      ).rejects.toMatchObject({
        code: "IMPORT_TYPE_INVALID"
      });
    await expect(
      parseMigrationFile("migration.xlsx", "text/csv", Buffer.from("not an xlsx"))
    ).rejects.toMatchObject({ code: "IMPORT_TYPE_INVALID" });
    await expect(
      parseMigrationFile(
        "migration.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Buffer.from("not an xlsx")
      )
    ).rejects.toMatchObject({ code: "IMPORT_XLSX_MALFORMED" });
    await expect(
      parseMigrationFile(
        "migration.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        workbook({ sheet1: '<row r="1"><c r="A1"><v>name</v></c></row>', macro: true })
      )
    ).rejects.toMatchObject({ code: "IMPORT_XLSX_ACTIVE_CONTENT" });
    await expect(
      parseMigrationFile(
        "migration.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        workbook({
          sheet1: '<row r="1"><c r="A1"><v>name</v></c></row>',
          external: true
        })
      )
    ).rejects.toMatchObject({ code: "IMPORT_XLSX_ACTIVE_CONTENT" });
    await expect(
      parseMigrationFile(
        "migration.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        zip({ "xl/worksheets/bomb.xml": "A".repeat(maximumXlsxEntryBytes + 1) })
      )
    ).rejects.toMatchObject({ code: "IMPORT_XLSX_ARCHIVE_LIMIT" });
  });

  it("rejects formula cells without a cached result", async () => {
    await expect(
      parseMigrationFile(
        "migration.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        workbook({
          sheet1:
            '<row r="1"><c r="A1"><v>name</v></c></row><row r="2"><c r="A2"><f>NOW()</f></c></row>'
        })
      )
    ).rejects.toMatchObject({ code: "IMPORT_XLSX_FORMULA_UNCACHED" });
  });
});

function workbook(input: {
  readonly sheet1: string;
  readonly sheet2?: string;
  readonly sharedStrings?: readonly string[];
  readonly macro?: boolean;
  readonly external?: boolean;
}): Buffer {
  const sheets =
    input.sheet2 === undefined
      ? [{ name: "Sheet1", rows: input.sheet1 }]
      : [
          { name: "Empty", rows: input.sheet1 },
          { name: "Data", rows: input.sheet2 }
        ];
  const entries: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"/>`).join("")}</sheets>${input.external ? "<externalReferences/>" : ""}</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${String(index + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(index + 1)}.xml"/>`).join("")}</Relationships>`
  };
  for (const [index, sheet] of sheets.entries())
    entries[`xl/worksheets/sheet${String(index + 1)}.xml`] =
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows}</sheetData></worksheet>`;
  if (input.sharedStrings)
    entries["xl/sharedStrings.xml"] =
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${input.sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`;
  if (input.macro) entries["xl/vbaProject.bin"] = "macro";
  return zip(entries);
}

function zip(entries: Readonly<Record<string, string>>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [fileName, value] of Object.entries(entries)) {
    const name = Buffer.from(fileName);
    const source = Buffer.from(value);
    const compressed = deflateRawSync(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
