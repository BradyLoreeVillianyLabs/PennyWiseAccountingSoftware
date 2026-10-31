import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  BundledTesseractLocalOcrEngine,
  LocalCaptureExtractionService
} from "./local-capture-extraction-service.js";

const service = new LocalCaptureExtractionService();

describe("LocalCaptureExtractionService", () => {
  it("extracts deterministic Canadian invoice fields from a local text layer", async () => {
    const result = await service.extract({
      kind: "BILL",
      fileName: "invoice.txt",
      mediaType: "text/plain",
      data: Buffer.from(
        "Acme Supplies\nInvoice number: INV-42\nInvoice date: 2026-08-01\nCurrency: CAD\nSubtotal: 100.00\nGST: 5.00\nTotal: 105.00\n"
      )
    });
    expect(result.processingState).toBe("VALIDATED");
    expect(result.fields.supplierName.normalizedValue).toBe("Acme Supplies");
    expect(result.fields.invoiceNumber.normalizedValue).toBe("INV-42");
    expect(result.fields.currency.normalizedValue).toBe("CAD");
    expect(result.fields.totalMinor.normalizedValue).toBe("10500");
    expect(result.validation.arithmetic).toBe("PASS");
    expect(result.autoPostEligible).toBe(false);
    expect(result.engine.networkAccess).toBe("NONE");
  });

  it("fails closed on ambiguous dates and arithmetic mismatches", async () => {
    const result = await service.extract({
      kind: "RECEIPT",
      fileName: "receipt.txt",
      mediaType: "text/plain",
      data: Buffer.from(
        "Store\nTransaction date: 08/08/2026\nCurrency: USD\nSubtotal: 10.00\nTax: 1.00\nTotal: 12.00"
      )
    });
    expect(result.processingState).toBe("NEEDS_REVIEW");
    expect(result.reviewReasons).toEqual(
      expect.arrayContaining(["DATE_AMBIGUOUS", "TOTAL_ARITHMETIC_MISMATCH"])
    );
    expect(result.fields.invoiceDate.normalizedValue).toBeNull();
  });

  it("recognizes a real local receipt image using the bundled offline model", async () => {
    const png = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="700">
          <rect width="100%" height="100%" fill="white" />
          <text x="70" y="170" font-family="Arial" font-size="76" fill="black">ACME SUPPLIES</text>
          <text x="70" y="290" font-family="Arial" font-size="64" fill="black">Invoice number: IMG-42</text>
          <text x="70" y="390" font-family="Arial" font-size="64" fill="black">Currency: CAD</text>
          <text x="70" y="490" font-family="Arial" font-size="64" fill="black">Subtotal: 100.00</text>
          <text x="70" y="590" font-family="Arial" font-size="64" fill="black">Total: 105.00</text>
        </svg>`
      )
    )
      .png()
      .toBuffer();
    const result = await service.extract({
      kind: "RECEIPT",
      fileName: "receipt.png",
      mediaType: "image/png",
      data: png
    });
    expect(result.engine.name).toBe("tesseract.js");
    expect(result.engine.model).toBe("eng@4.0.0-bundled");
    expect(result.engine.networkAccess).toBe("NONE");
    expect(result.text).toContain("ACME SUPPLIES");
    expect(result.fields.totalMinor.normalizedValue).toBe("10500");
    expect(result.reviewReasons).not.toContain("LOCAL_OCR_FAILED");
    expect(result.quality.width).toBe(1400);
    expect(result.quality.height).toBe(700);
  }, 30_000);

  it("extracts a PDF embedded text layer without a network call", async () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (Invoice number: PDF-7) Tj (Total: 20.00) Tj ET\n%%EOF",
      "latin1"
    );
    const result = await service.extract({
      kind: "RECEIPT",
      fileName: "receipt.pdf",
      mediaType: "application/pdf",
      data: pdf
    });
    expect(result.text).toContain("Invoice number: PDF-7");
    expect(result.fields.totalMinor.normalizedValue).toBe("2000");
    expect(result.quality.pageCount).toBe(1);
    expect(result.engine.networkAccess).toBe("NONE");
  });

  it("rasterizes and recognizes a scanned PDF locally when no text layer exists", async () => {
    const image = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="500">
          <rect width="100%" height="100%" fill="white" />
          <text x="70" y="180" font-family="Arial" font-size="72" fill="black">SCANNED RECEIPT</text>
          <text x="70" y="330" font-family="Arial" font-size="72" fill="black">TOTAL: CAD 42.50</text>
        </svg>`
      )
    )
      .png()
      .toBuffer();
    const pdf = await imageOnlyPdf(image, 1400, 500);
    const directOcr = await new BundledTesseractLocalOcrEngine().recognize({
      kind: "RECEIPT",
      fileName: "scanned-receipt.pdf",
      mediaType: "application/pdf",
      data: pdf
    });
    expect(directOcr.text).toContain("SCANNED RECEIPT");
    const result = await service.extract({
      kind: "RECEIPT",
      fileName: "scanned-receipt.pdf",
      mediaType: "application/pdf",
      data: pdf
    });
    expect(result.engine.name).toBe("tesseract.js");
    expect(result.engine.networkAccess).toBe("NONE");
    expect(result.text).toContain("SCANNED RECEIPT");
    expect(result.fields.totalMinor.normalizedValue).toBe("4250");
    expect(result.reviewReasons).not.toContain("LOCAL_OCR_FAILED");
  }, 30_000);

  it("rejects an oversized PDF before it reaches storage", () => {
    const pdf = Buffer.from(
      `%PDF-1.4\n${Array.from({ length: 11 }, () => "/Type /Page ").join("")}%%EOF`,
      "latin1"
    );
    expect(() => service.validateEnvelope({ mediaType: "application/pdf", data: pdf })).toThrow(
      "limited to 10 pages"
    );
  });
});

function imageOnlyPdf(image: Buffer, width: number, height: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: [width, height], margin: 0, compress: true });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.image(image, 0, 0, { width, height });
    document.end();
  });
}
