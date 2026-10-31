import { describe, expect, it } from "vitest";
import { inspectAttachmentBytes } from "./invoice-document-service.js";

describe("development attachment byte inspection", () => {
  it("accepts text CSV only when it contains no binary null bytes", () => {
    expect(inspectAttachmentBytes(Buffer.from("sku,name\n001,Widget\n"), "text/csv")).toBe(true);
    expect(inspectAttachmentBytes(Buffer.from([0x73, 0x6b, 0x75, 0x00]), "application/csv")).toBe(
      false
    );
  });

  it("recognizes the ZIP container signature required by XLSX preflight", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(
      inspectAttachmentBytes(
        zip,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe(true);
    expect(
      inspectAttachmentBytes(
        Buffer.from("not a workbook"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe(false);
  });
});
