import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { AppError } from "@clearledger/shared";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

export const localCaptureExtractionVersion = "2.0.0";

const localRequire = createRequire(import.meta.url);

interface BundledTesseractLanguage {
  readonly code: string;
  readonly gzip: boolean;
  readonly langPath: string;
}

const bundledEnglishLanguage = localRequire("@tesseract.js-data/eng") as BundledTesseractLanguage;

export type CaptureProcessingState =
  | "CAPTURED"
  | "PROCESSING"
  | "NEEDS_REVIEW"
  | "VALIDATED"
  | "FAILED"
  | "REJECTED"
  | "DUPLICATE";

export interface CaptureExtractionField {
  readonly value: string | null;
  readonly normalizedValue: string | null;
  readonly confidence: number;
  readonly method: "DOCUMENT_KIND" | "TEXT_LABEL" | "TEXT_HEURISTIC" | "UNAVAILABLE";
  readonly regions: readonly CaptureTextRegion[];
  readonly evidence: string | null;
}

export interface CaptureTextRegion {
  readonly page: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CaptureExtractionResult {
  readonly schemaVersion: 1;
  readonly processingState: CaptureProcessingState;
  readonly engine: {
    readonly name: "clearledger-local-text-extractor" | "tesseract.js";
    readonly version: string;
    readonly networkAccess: "NONE";
    readonly model: string | null;
  };
  readonly text: string;
  readonly fields: Readonly<Record<string, CaptureExtractionField>>;
  readonly quality: {
    readonly checks: Readonly<Record<string, "PASS" | "FAIL" | "NOT_EVALUATED">>;
    readonly width: number | null;
    readonly height: number | null;
    readonly pageCount: number | null;
  };
  readonly validation: {
    readonly valid: boolean;
    readonly issues: readonly string[];
    readonly arithmetic: "PASS" | "FAIL" | "NOT_EVALUATED";
  };
  readonly reviewReasons: readonly string[];
  readonly autoPostEligible: false;
  readonly confidence: number;
}

interface ExtractionInput {
  readonly kind: "RECEIPT" | "BILL";
  readonly fileName: string;
  readonly mediaType: string;
  readonly data: Buffer;
}

export interface LocalOcrResult {
  readonly text: string;
  readonly confidence: number;
  readonly regions: readonly CaptureTextRegion[];
  readonly engine: {
    readonly name: "tesseract.js";
    readonly version: string;
    readonly model: string;
  };
}

/** A local-only boundary: implementations must never receive a network URL or credential. */
export interface LocalOcrEngine {
  recognize(input: ExtractionInput): Promise<LocalOcrResult>;
}

const emptyField = (method: CaptureExtractionField["method"] = "UNAVAILABLE") => ({
  value: null,
  normalizedValue: null,
  confidence: 0,
  method,
  regions: [],
  evidence: null
});

const fieldNames = [
  "documentType",
  "supplierName",
  "supplierTaxNumber",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "currency",
  "subtotalMinor",
  "discountMinor",
  "shippingMinor",
  "tipMinor",
  "gstHstMinor",
  "pstMinor",
  "qstMinor",
  "taxTotalMinor",
  "totalMinor",
  "paymentStatus"
] as const;

export class LocalCaptureExtractionService {
  public constructor(private readonly ocr: LocalOcrEngine = new BundledTesseractLocalOcrEngine()) {}

  public validateEnvelope(input: Pick<ExtractionInput, "mediaType" | "data">): void {
    const dimensions = imageDimensions(input.data, input.mediaType);
    if (input.mediaType.startsWith("image/")) {
      if (!dimensions)
        throw new AppError(
          "CAPTURE_IMAGE_DIMENSIONS_INVALID",
          "The image dimensions could not be verified.",
          422
        );
      if (
        dimensions.width > 12_000 ||
        dimensions.height > 12_000 ||
        dimensions.width * dimensions.height > 50_000_000
      )
        throw new AppError(
          "CAPTURE_PIXEL_LIMIT",
          "The image exceeds the safe pixel-dimension limit.",
          422
        );
    }
    if (input.mediaType === "application/pdf") {
      const pages = pdfPageCount(input.data);
      if (pages !== null && pages > 10)
        throw new AppError("CAPTURE_PAGE_LIMIT", "PDF captures are limited to 10 pages.", 422);
    }
  }

  public async extract(input: ExtractionInput): Promise<CaptureExtractionResult> {
    if (input.data.length === 0)
      throw new AppError("CAPTURE_CONTENT_INVALID", "Empty capture.", 422);
    const textResult = extractLocalText(input.data, input.mediaType);
    const dimensions = imageDimensions(input.data, input.mediaType);
    const pageCount = input.mediaType === "application/pdf" ? pdfPageCount(input.data) : null;
    const qualityChecks: Readonly<Record<string, "PASS" | "FAIL" | "NOT_EVALUATED">> =
      qualityCheckResults(input.mediaType, dimensions, pageCount);
    const fields: Record<string, CaptureExtractionField> = Object.fromEntries(
      fieldNames.map((name) => [name, emptyField()])
    );
    fields.documentType = {
      value: input.kind === "BILL" ? "SUPPLIER_INVOICE" : "RECEIPT",
      normalizedValue: input.kind,
      confidence: 1,
      method: "DOCUMENT_KIND",
      regions: [],
      evidence: "User-selected capture type"
    };

    const reviewReasons = [...textResult.reasons];
    let ocrResult: LocalOcrResult | null = null;
    if (
      input.mediaType.startsWith("image/") ||
      (input.mediaType === "application/pdf" && !textResult.text.trim())
    ) {
      try {
        ocrResult = await this.ocr.recognize(input);
        if (!ocrResult.text.trim()) reviewReasons.push("LOCAL_OCR_NO_TEXT");
      } catch {
        // A failed local worker must not fabricate extracted fields or silently fall back to a cloud call.
        reviewReasons.push("LOCAL_OCR_FAILED");
      }
    }
    if (input.mediaType.startsWith("image/")) {
      if (dimensions === null) reviewReasons.push("IMAGE_DIMENSIONS_UNAVAILABLE");
      else if (dimensions.width < 640 || dimensions.height < 480)
        reviewReasons.push("IMAGE_RESOLUTION_LOW");
    }
    if (input.mediaType === "application/pdf" && pageCount !== null && pageCount > 10)
      reviewReasons.push("PDF_PAGE_LIMIT_EXCEEDED");
    if (input.mediaType === "application/pdf" && pageCount === null)
      reviewReasons.push("PDF_PAGE_COUNT_UNAVAILABLE");

    const extractedText = [textResult.text, ocrResult?.text ?? ""].filter(Boolean).join("\n");
    if (extractedText.trim()) extractFields(extractedText, fields, reviewReasons);
    const validation: CaptureExtractionResult["validation"] = validateFields(fields, input.kind);
    reviewReasons.push(...validation.issues);
    const processingState: CaptureProcessingState =
      validation.valid && reviewReasons.length === 0 ? "VALIDATED" : "NEEDS_REVIEW";
    const confidence = confidenceFor(fields, processingState);
    return {
      schemaVersion: 1,
      processingState,
      engine: {
        name: ocrResult?.engine.name ?? "clearledger-local-text-extractor",
        version: ocrResult?.engine.version ?? localCaptureExtractionVersion,
        networkAccess: "NONE",
        model: ocrResult?.engine.model ?? null
      },
      text: redactSensitiveText(extractedText).slice(0, 50_000),
      fields,
      quality: {
        checks: qualityChecks,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        pageCount
      },
      validation,
      reviewReasons: [...new Set(reviewReasons)],
      autoPostEligible: false,
      confidence
    };
  }
}

/**
 * Uses only package-resolved files: Tesseract's Node worker, core WASM and the
 * English traineddata archive are all production dependencies staged by the
 * desktop packager. `langPath` deliberately points at that installed archive;
 * the engine is never given a remote language URL and cacheMethod prevents it
 * from writing a downloaded model into a user's books directory.
 */
export class BundledTesseractLocalOcrEngine implements LocalOcrEngine {
  public async recognize(input: ExtractionInput): Promise<LocalOcrResult> {
    const pages = await rasterizeForOcr(input);
    if (pages.length === 0) throw new Error("No local OCR page could be rendered.");
    const worker = await createWorker(bundledEnglishLanguage.code, 1, {
      langPath: bundledEnglishLanguage.langPath,
      gzip: bundledEnglishLanguage.gzip,
      cacheMethod: "none"
    });
    try {
      const text: string[] = [];
      const regions: CaptureTextRegion[] = [];
      let confidenceTotal = 0;
      for (const [index, page] of pages.entries()) {
        const result = await worker.recognize(page);
        text.push(result.data.text);
        confidenceTotal += normalizeOcrConfidence(result.data.confidence);
        for (const block of result.data.blocks ?? []) {
          regions.push({
            page: index + 1,
            left: block.bbox.x0,
            top: block.bbox.y0,
            width: block.bbox.x1 - block.bbox.x0,
            height: block.bbox.y1 - block.bbox.y0
          });
        }
      }
      return {
        text: text.join("\n").trim(),
        confidence: Math.round((confidenceTotal / pages.length) * 100) / 100,
        regions,
        engine: {
          name: "tesseract.js",
          version: "7.0.0",
          model: `${bundledEnglishLanguage.code}@4.0.0-bundled`
        }
      };
    } finally {
      await worker.terminate();
    }
  }
}

async function rasterizeForOcr(input: ExtractionInput): Promise<Buffer[]> {
  if (input.mediaType.startsWith("image/")) return [await normalizeOcrImage(input.data)];
  if (input.mediaType !== "application/pdf") return [];
  return rasterizePdfForOcr(input.data);
}

async function rasterizePdfForOcr(data: Buffer): Promise<Buffer[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    stopAtErrors: true,
    useSystemFonts: true
  });
  const document = await loadingTask.promise;
  const pages: Buffer[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 10); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2.5,
        Math.sqrt(50_000_000 / Math.max(1, baseViewport.width * baseViewport.height))
      );
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      await page.render({
        canvas: null,
        canvasContext: context as never,
        viewport
      }).promise;
      pages.push(canvas.toBuffer("image/png"));
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

function normalizeOcrImage(data: Buffer): Promise<Buffer> {
  return sharp(data, { limitInputPixels: 50_000_000, failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
}

function normalizeOcrConfidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : 0;
}

function extractLocalText(data: Buffer, mediaType: string): { text: string; reasons: string[] } {
  if (mediaType === "text/plain")
    return { text: data.toString("utf8").replaceAll("\u0000", ""), reasons: [] };
  if (mediaType === "application/pdf") {
    const text = extractPdfText(data);
    return {
      text,
      reasons: text.trim() ? [] : ["PDF_TEXT_LAYER_MISSING"]
    };
  }
  if (mediaType.startsWith("image/")) return { text: "", reasons: [] };
  return { text: "", reasons: ["LOCAL_EXTRACTION_FORMAT_UNSUPPORTED"] };
}

function extractPdfText(data: Buffer): string {
  const source = data.toString("latin1");
  const chunks: string[] = [];
  const textOperator = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  for (const match of source.matchAll(textOperator)) chunks.push(decodePdfString(match[1] ?? ""));
  const arrayOperator = /\[((?:\\.|[^\]])*)\]\s*TJ/g;
  for (const match of source.matchAll(arrayOperator)) {
    for (const stringMatch of (match[1] ?? "").matchAll(/\(((?:\\.|[^\\)])*)\)/g))
      chunks.push(decodePdfString(stringMatch[1] ?? ""));
  }
  return chunks.join(" ").replaceAll(/\s+/g, " ").trim();
}

function decodePdfString(value: string): string {
  return value
    .replaceAll(/\\([\\()])/g, "$1")
    .replaceAll(/\\n/g, "\n")
    .replaceAll(/\\r/g, "\r")
    .replaceAll(/\\t/g, "\t")
    .replaceAll(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

function redactSensitiveText(value: string): string {
  return value
    .replaceAll(/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED_NUMBER]")
    .replaceAll(/\b\d{3,4}[ -]\d{3,4}[ -]\d{3,4}\b/g, "[REDACTED_NUMBER]");
}

function extractFields(
  text: string,
  fields: Record<string, CaptureExtractionField>,
  reviewReasons: string[]
): void {
  const lines = text
    .split(/\r?\n|(?<=\s)(?=(?:subtotal|total|invoice|gst|hst|pst|qst|tax)\b)/i)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines.find((line) => !/^(invoice|receipt|subtotal|total|tax)\b/i.test(line));
  if (firstLine && firstLine.length <= 160)
    fields.supplierName = textField(firstLine, 0.4, "TEXT_HEURISTIC");

  assignLabel(
    fields,
    "supplierTaxNumber",
    text,
    /(?:GST|HST|PST|QST|tax\s*(?:id|no|number)|registration)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 -]{4,24})/i,
    0.78
  );
  assignLabel(
    fields,
    "invoiceNumber",
    text,
    /(?:invoice|receipt)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{1,64})/i,
    0.82
  );
  assignDate(
    fields,
    "invoiceDate",
    text,
    /(?:invoice|transaction|receipt|purchase)\s*date\s*[:#-]?\s*((?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20?\d{2}))/i,
    reviewReasons
  );
  assignDate(
    fields,
    "dueDate",
    text,
    /due\s*date\s*[:#-]?\s*((?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20?\d{2}))/i,
    reviewReasons
  );
  const currency = /\b(CAD|USD)\b|(?:CA\$|US\$)/i.exec(text);
  if (currency) {
    const value =
      currency[1]?.toUpperCase() ?? (currency[0].toUpperCase().startsWith("CA") ? "CAD" : "USD");
    fields.currency = textField(value, 0.9, "TEXT_LABEL");
  } else if (/\$/.test(text)) reviewReasons.push("CURRENCY_SYMBOL_AMBIGUOUS");

  const moneyLabels: ReadonlyArray<readonly [string, RegExp]> = [
    ["subtotalMinor", /subtotal\s*[:#-]?\s*([^\n,;]+)/i],
    ["discountMinor", /discount(?:s)?\s*[:#-]?\s*([^\n,;]+)/i],
    ["shippingMinor", /(?:shipping|freight|delivery)\s*[:#-]?\s*([^\n,;]+)/i],
    ["tipMinor", /tip\s*[:#-]?\s*([^\n,;]+)/i],
    ["gstHstMinor", /(?:gst|hst|gst\/hst)\s*[:#-]?\s*([^\n,;]+)/i],
    ["pstMinor", /pst\s*[:#-]?\s*([^\n,;]+)/i],
    ["qstMinor", /qst\s*[:#-]?\s*([^\n,;]+)/i],
    ["taxTotalMinor", /(?:tax|taxes)\s*[:#-]?\s*([^\n,;]+)/i],
    ["totalMinor", /(?:grand\s*total|amount\s*due|\btotal\b)\s*[:#-]?\s*([^\n,;]+)/i]
  ];
  for (const [name, pattern] of moneyLabels) {
    const match = pattern.exec(text);
    if (!match) continue;
    const parsed = parseMinor(match[1] ?? "");
    if (parsed === null) reviewReasons.push(`MONEY_UNREADABLE_${name.toUpperCase()}`);
    else fields[name] = textField(parsed, 0.78, "TEXT_LABEL", (match[1] ?? "").trim());
  }
  const paid = /\b(paid|payment received|settled)\b/i.test(text);
  const unpaid = /\b(unpaid|amount due|balance due|due)\b/i.test(text);
  if (paid !== unpaid && (paid || unpaid))
    fields.paymentStatus = textField(paid ? "PAID" : "UNPAID", 0.72, "TEXT_HEURISTIC");
}

function assignLabel(
  fields: Record<string, CaptureExtractionField>,
  name: string,
  text: string,
  pattern: RegExp,
  confidence: number
): void {
  const match = pattern.exec(text);
  if (match?.[1])
    fields[name] = textField(match[1].trim(), confidence, "TEXT_LABEL", match[1].trim());
}

function assignDate(
  fields: Record<string, CaptureExtractionField>,
  name: string,
  text: string,
  pattern: RegExp,
  reviewReasons: string[]
): void {
  const match = pattern.exec(text);
  if (!match?.[1]) return;
  const parsed = normalizeDate(match[1]);
  if (parsed.value === null) {
    reviewReasons.push(parsed.reason);
    return;
  }
  fields[name] = textField(parsed.value, parsed.confidence, "TEXT_LABEL", match[1].trim());
}

function normalizeDate(value: string): {
  value: string | null;
  confidence: number;
  reason: string;
} {
  const clean = value.trim().replaceAll(".", "/");
  const iso = /^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$/.exec(clean);
  if (iso)
    return {
      value: validDate(iso[1] ?? "", iso[2] ?? "", iso[3] ?? ""),
      confidence: 0.92,
      reason: "DATE_INVALID"
    };
  const parts = /^(\d{1,2})[-/](\d{1,2})[-/](20?\d{2})$/.exec(clean);
  if (!parts) return { value: null, confidence: 0, reason: "DATE_UNREADABLE" };
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  if (first <= 12 && second <= 12) return { value: null, confidence: 0, reason: "DATE_AMBIGUOUS" };
  const day = first > 12 ? first : second;
  const month = first > 12 ? second : first;
  const year = parts[3] ?? "";
  return {
    value: validDate(year.length === 2 ? `20${year}` : year, String(month), String(day)),
    confidence: 0.76,
    reason: "DATE_INVALID"
  };
}

function validDate(year: string, month: string, day: string): string | null {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  )
    return null;
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseMinor(value: string): string | null {
  const clean = value
    .replaceAll(",", "")
    .replaceAll(/[^0-9.()-]/g, "")
    .trim();
  if (!/^\(?\d+(?:\.\d+)?\)?$/.test(clean)) return null;
  const negative = clean.startsWith("(");
  const unsigned = clean.replace(/[()]/g, "");
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > 2 && !/^\d{3,}$/.test(fraction)) return null;
  let minor = BigInt(whole ?? "0") * 100n;
  const cents = fraction.padEnd(3, "0").slice(0, 3);
  minor += BigInt(cents.slice(0, 2));
  if (cents.length === 3 && Number(cents[2] ?? "0") >= 5) minor += 1n;
  return (negative ? -minor : minor).toString();
}

function textField(
  value: string,
  confidence: number,
  method: CaptureExtractionField["method"],
  evidence = value
): CaptureExtractionField {
  return { value, normalizedValue: value, confidence, method, regions: [], evidence };
}

function validateFields(fields: Record<string, CaptureExtractionField>, kind: "RECEIPT" | "BILL") {
  const issues: string[] = [];
  for (const name of ["currency", "totalMinor"])
    if (!fields[name]?.normalizedValue) issues.push(`FIELD_REQUIRED_${name.toUpperCase()}`);
  if (kind === "BILL" && !fields.invoiceNumber?.normalizedValue)
    issues.push("FIELD_REQUIRED_INVOICE_NUMBER");
  const subtotal = numberValue(fields.subtotalMinor!);
  const discount = numberValue(fields.discountMinor!) ?? 0n;
  const shipping = numberValue(fields.shippingMinor!) ?? 0n;
  const tax =
    numberValue(fields.taxTotalMinor!) ??
    (numberValue(fields.gstHstMinor!) ?? 0n) +
      (numberValue(fields.pstMinor!) ?? 0n) +
      (numberValue(fields.qstMinor!) ?? 0n);
  const tip = numberValue(fields.tipMinor!) ?? 0n;
  const total = numberValue(fields.totalMinor!);
  const arithmetic: "PASS" | "FAIL" | "NOT_EVALUATED" =
    subtotal !== null && total !== null
      ? subtotal - discount + shipping + tax + tip === total
        ? "PASS"
        : "FAIL"
      : "NOT_EVALUATED";
  if (arithmetic === "FAIL") issues.push("TOTAL_ARITHMETIC_MISMATCH");
  return { valid: issues.length === 0 && arithmetic !== "FAIL", issues, arithmetic };
}

function numberValue(field: CaptureExtractionField): bigint | null {
  return field.normalizedValue && /^-?\d+$/.test(field.normalizedValue)
    ? BigInt(field.normalizedValue)
    : null;
}

function confidenceFor(
  fields: Record<string, CaptureExtractionField>,
  state: CaptureProcessingState
): number {
  if (state !== "VALIDATED") return 0;
  const values = Object.values(fields)
    .map((field) => field.confidence)
    .filter((value) => value > 0);
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
    : 0;
}

function qualityCheckResults(
  mediaType: string,
  dimensions: { width: number; height: number } | null,
  pageCount: number | null
): Readonly<Record<string, "PASS" | "FAIL" | "NOT_EVALUATED">> {
  return {
    signature: "PASS" as const,
    boundedSize: "PASS" as const,
    dimensions: mediaType.startsWith("image/") ? (dimensions ? "PASS" : "FAIL") : "NOT_EVALUATED",
    blur: "NOT_EVALUATED" as const,
    glare: "NOT_EVALUATED" as const,
    perspective: "NOT_EVALUATED" as const,
    documentBounds: "NOT_EVALUATED" as const,
    pageCount:
      mediaType === "application/pdf"
        ? pageCount && pageCount <= 10
          ? "PASS"
          : "FAIL"
        : "NOT_EVALUATED"
  };
}

function pdfPageCount(data: Buffer): number | null {
  const matches = data.toString("latin1").match(/\/Type\s*\/Page(?:\s|\/|>)/g);
  return matches?.length ?? null;
}

function imageDimensions(
  data: Buffer,
  mediaType: string
): { width: number; height: number } | null {
  if (
    mediaType === "image/png" &&
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (
    mediaType === "image/webp" &&
    data.length >= 30 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP" &&
    data.toString("ascii", 12, 16) === "VP8X"
  )
    return {
      width: 1 + data.readUIntLE(24, 3),
      height: 1 + data.readUIntLE(27, 3)
    };
  if (mediaType === "image/jpeg") return jpegDimensions(data);
  return null;
}

function jpegDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xd9) return null;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    if (offset + 4 > data.length) return null;
    const length = data.readUInt16BE(offset + 2);
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 9 < data.length)
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    if (!length) return null;
    offset += 2 + length;
  }
  return null;
}
