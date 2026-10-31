import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve, sep } from "node:path";
import { Prisma } from "@clearledger/db";
import { AppError } from "@clearledger/shared";
import PDFDocument from "pdfkit";
import {
  defaultInvoiceTemplate,
  getInvoiceTemplate,
  validateTemplateConfiguration,
  type InvoiceTemplateConfiguration,
  type InvoiceTemplateKey
} from "./invoice-template-service.js";
import type {
  RenderPaymentInstructions,
  RenderPaymentInstructionMethod
} from "./payment-instruction-service.js";

export interface DocumentStorage {
  put(key: string, data: Buffer, mediaType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class DevelopmentDocumentStorage implements DocumentStorage {
  public constructor(private readonly root = resolve(process.cwd(), ".data", "documents")) {}

  public async put(key: string, data: Buffer): Promise<void> {
    const path = safePath(this.root, key);
    await mkdir(resolve(path, ".."), { recursive: true });
    try {
      await writeFile(path, data, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  public get(key: string): Promise<Buffer> {
    return readFile(safePath(this.root, key));
  }
}

export interface InvoiceRenderLine {
  readonly description: string;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly netAmountMinor: string;
  readonly taxTotalMinor: string;
  readonly totalMinor: string;
}

export interface InvoiceRenderData {
  readonly schemaVersion: 1;
  readonly seller: {
    readonly legalName: string;
    readonly displayName: string;
    readonly currency: string;
    readonly address: unknown;
    readonly businessNumber: string | null;
    readonly taxRegistrations?: readonly {
      readonly registrationType: string;
      readonly jurisdiction: string;
      readonly registrationNumber: string;
    }[];
  };
  readonly customer: {
    readonly name: string;
    readonly email: string | null;
    readonly billingAddress: unknown;
    readonly serviceAddress: unknown;
  };
  readonly invoice: {
    readonly number: string;
    readonly paymentReference?: string;
    readonly issueDate: string;
    readonly dueDate: string;
    readonly currency: string;
    readonly subtotalMinor: string;
    readonly discountTotalMinor: string;
    readonly taxTotalMinor: string;
    readonly grandTotalMinor: string;
    readonly amountPaidMinor: string;
    readonly depositAppliedMinor?: string;
  };
  readonly lines: readonly InvoiceRenderLine[];
  readonly customerFacingNotes: string | null;
  readonly terms: string | null;
  readonly branding: InvoiceTemplateConfiguration;
  readonly templateKey: InvoiceTemplateKey;
  readonly templateVersion: number;
  readonly locale: "en-CA" | "fr-CA";
  readonly languageMode?: "en-CA" | "fr-CA" | "BILINGUAL";
  readonly paymentInstructions?: RenderPaymentInstructions;
  readonly durablePaymentLink?: {
    readonly provider: "STRIPE" | "SQUARE";
    readonly url: string;
  };
  readonly assets?: InvoiceRenderAssetSnapshot;
}

export interface InvoiceRenderAssetReference {
  readonly id: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp";
  readonly checksum: string;
  readonly width: number;
  readonly height: number;
}

export interface InvoiceRenderAssetSnapshot {
  readonly logo: InvoiceRenderAssetReference | null;
  readonly headerImage: InvoiceRenderAssetReference | null;
}

export interface InvoiceRenderAsset extends InvoiceRenderAssetReference {
  readonly data: Buffer;
}

export interface InvoiceRenderAssets {
  readonly logo: InvoiceRenderAsset | null;
  readonly headerImage: InvoiceRenderAsset | null;
}

export interface InvoiceRenderSource {
  readonly id?: string;
  readonly organizationSnapshot: Prisma.JsonValue;
  readonly customerNameSnapshot: string;
  readonly customerEmailSnapshot: string | null;
  readonly customerDocumentLanguageSnapshot?: string | null;
  readonly paymentInstructionsSnapshot?: RenderPaymentInstructions;
  readonly billingAddressSnapshot: Prisma.JsonValue | null;
  readonly serviceAddressSnapshot: Prisma.JsonValue | null;
  readonly invoiceNumber: string | null;
  readonly paymentReference?: string;
  readonly provisionalIdentifier: string;
  readonly issueDate: Date;
  readonly dueDate: Date;
  readonly currency: string;
  readonly subtotalMinor: bigint;
  readonly discountTotalMinor: bigint;
  readonly taxTotalMinor: bigint;
  readonly grandTotalMinor: bigint;
  readonly amountPaidMinor: bigint;
  readonly customerFacingNotes: string | null;
  readonly terms: string | null;
  readonly durablePaymentLink?: InvoiceRenderData["durablePaymentLink"];
  readonly lines: readonly {
    readonly description: string;
    readonly quantityMicros: bigint;
    readonly unitPriceMinor: bigint;
    readonly netAmountMinor: bigint;
    readonly taxTotalMinor: bigint;
    readonly totalMinor: bigint;
  }[];
}

export function buildInvoiceRenderData(
  invoice: InvoiceRenderSource,
  templateKey = defaultInvoiceTemplate().key,
  templateVersion = 1,
  configuration: InvoiceTemplateConfiguration = defaultInvoiceTemplate().defaultConfiguration,
  assets?: InvoiceRenderAssetSnapshot
): InvoiceRenderData {
  const definition = getInvoiceTemplate(templateKey);
  return {
    schemaVersion: 1,
    seller: {
      legalName: readString(invoice.organizationSnapshot, "legalName"),
      displayName: readString(invoice.organizationSnapshot, "displayName"),
      currency: invoice.currency,
      address: readValue(invoice.organizationSnapshot, "address"),
      businessNumber: readNullableString(invoice.organizationSnapshot, "businessNumber"),
      taxRegistrations: readTaxRegistrations(invoice.organizationSnapshot)
    },
    customer: {
      name: invoice.customerNameSnapshot,
      email: invoice.customerEmailSnapshot,
      billingAddress: invoice.billingAddressSnapshot,
      serviceAddress: invoice.serviceAddressSnapshot
    },
    invoice: {
      // The provisional identifier is an internal idempotency/audit value, not a
      // customer-facing document number. A draft therefore stays clearly labelled
      // until the immutable invoice sequence is allocated on finalization.
      number: invoice.invoiceNumber ?? "DRAFT",
      ...(invoice.paymentReference ? { paymentReference: invoice.paymentReference } : {}),
      issueDate: isoDate(invoice.issueDate),
      dueDate: isoDate(invoice.dueDate),
      currency: invoice.currency,
      subtotalMinor: invoice.subtotalMinor.toString(),
      discountTotalMinor: invoice.discountTotalMinor.toString(),
      taxTotalMinor: invoice.taxTotalMinor.toString(),
      grandTotalMinor: invoice.grandTotalMinor.toString(),
      amountPaidMinor: invoice.amountPaidMinor.toString()
    },
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: formatQuantity(line.quantityMicros),
      unitPriceMinor: line.unitPriceMinor.toString(),
      netAmountMinor: line.netAmountMinor.toString(),
      taxTotalMinor: line.taxTotalMinor.toString(),
      totalMinor: line.totalMinor.toString()
    })),
    customerFacingNotes: invoice.customerFacingNotes,
    terms: invoice.terms,
    branding: configuration,
    templateKey: definition.key,
    templateVersion,
    locale:
      renderLanguage(invoice.organizationSnapshot, invoice.customerDocumentLanguageSnapshot) ===
      "fr-CA"
        ? "fr-CA"
        : "en-CA",
    languageMode: renderLanguage(
      invoice.organizationSnapshot,
      invoice.customerDocumentLanguageSnapshot
    ),
    ...(invoice.paymentInstructionsSnapshot
      ? { paymentInstructions: invoice.paymentInstructionsSnapshot }
      : {}),
    ...(invoice.durablePaymentLink ? { durablePaymentLink: invoice.durablePaymentLink } : {}),
    ...(assets ? { assets } : {})
  };
}

export function renderDataHash(data: InvoiceRenderData): string {
  return createHash("sha256").update(canonicalJson(data)).digest("hex");
}

export function parseStoredRenderData(value: Prisma.JsonValue | null): InvoiceRenderData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Partial<InvoiceRenderData>;
  if (
    data.schemaVersion !== 1 ||
    typeof data.templateKey !== "string" ||
    typeof data.templateVersion !== "number" ||
    !Array.isArray(data.lines) ||
    !data.branding ||
    typeof data.invoice !== "object" ||
    !data.seller ||
    !data.customer
  )
    throw new AppError(
      "INVOICE_RENDER_DATA_INVALID",
      "The preserved invoice render data is invalid.",
      500
    );
  const definition = getInvoiceTemplate(data.templateKey);
  validateTemplateConfiguration(definition, data.branding);
  return value as unknown as InvoiceRenderData;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface InvoiceDesignTokens {
  readonly primary: string;
  readonly accent: string;
  readonly bodyFont: string;
  readonly headingFont: string;
  readonly headingFontSize: number;
  readonly bodyFontSize: number;
  readonly tableFontSize: number;
  readonly notesFontSize: number;
  readonly backgroundTreatment: "none" | "brand-wash" | "image-watermark";
  readonly pdfBodyFont: "Helvetica" | "Times-Roman" | "Courier";
  readonly pdfBoldFont: "Helvetica-Bold" | "Times-Bold" | "Courier-Bold";
  readonly pageMargin: number;
  readonly rowPadding: number;
  readonly sectionGap: number;
  readonly radius: number;
  readonly headerTreatment: "rule" | "band" | "quiet";
}

export function resolveInvoiceDesignTokens(data: InvoiceRenderData): InvoiceDesignTokens {
  const fontOptions = {
    system: {
      body: "system-ui,-apple-system,Segoe UI,sans-serif",
      heading: "system-ui,-apple-system,Segoe UI,sans-serif",
      pdfBody: "Helvetica" as const,
      pdfBold: "Helvetica-Bold" as const
    },
    modern: {
      body: "Arial,Helvetica,sans-serif",
      heading: "Arial,Helvetica,sans-serif",
      pdfBody: "Helvetica" as const,
      pdfBold: "Helvetica-Bold" as const
    },
    classic: {
      body: "Georgia,Times New Roman,serif",
      heading: "Georgia,Times New Roman,serif",
      pdfBody: "Times-Roman" as const,
      pdfBold: "Times-Bold" as const
    },
    editorial: {
      body: "Arial,Helvetica,sans-serif",
      heading: "Georgia,Times New Roman,serif",
      pdfBody: "Helvetica" as const,
      pdfBold: "Times-Bold" as const
    },
    technical: {
      body: "Arial,Helvetica,sans-serif",
      heading: "Courier New,Courier,monospace",
      pdfBody: "Helvetica" as const,
      pdfBold: "Courier-Bold" as const
    }
  };
  const fonts = fontOptions[data.branding.fontPairing];
  const spacingOptions = {
    compact: { margin: 38, row: 6, section: 14 },
    comfortable: { margin: 46, row: 9, section: 20 },
    airy: { margin: 54, row: 12, section: 26 }
  };
  const spacingKey = (data.branding as Partial<InvoiceTemplateConfiguration>).spacing;
  const spacing = spacingKey ? spacingOptions[spacingKey] : spacingOptions.comfortable;
  return {
    primary: data.branding.primaryColor,
    accent: data.branding.accentColor,
    bodyFont: fonts.body,
    headingFont: fonts.heading,
    headingFontSize: data.branding.headingFontSize,
    bodyFontSize: data.branding.bodyFontSize,
    tableFontSize: data.branding.tableFontSize,
    notesFontSize: data.branding.notesFontSize,
    backgroundTreatment: data.branding.backgroundTreatment,
    pdfBodyFont: fonts.pdfBody,
    pdfBoldFont: fonts.pdfBold,
    pageMargin: spacing.margin,
    rowPadding: spacing.row,
    sectionGap: spacing.section,
    radius: data.branding.detailStyle === "tinted" ? 8 : 0,
    headerTreatment:
      data.branding.detailStyle === "tinted"
        ? "band"
        : data.branding.detailStyle === "minimal"
          ? "quiet"
          : "rule"
  };
}

export function renderInvoiceHtml(
  data: InvoiceRenderData,
  publicView = false,
  assets?: InvoiceRenderAssets
): string {
  if (assets) validateRenderAssets(data, assets);
  if (data.durablePaymentLink) assertCustomerFacingPaymentUrl(data.durablePaymentLink.url);
  const tokens = resolveInvoiceDesignTokens(data);
  const columns = new Set(data.branding.visibleColumns);
  const money = (value: string) => formatMinor(value, data.invoice.currency, data.locale);
  const moneyLabel = (label: string) => `${label} (${data.invoice.currency})`;
  const lineRows = data.lines
    .map(
      (line) => `<tr>
        <th scope="row">${inlineText(line.description)}</th>
        ${columns.has("quantity") ? `<td class="number">${escapeHtml(line.quantity)}</td>` : ""}
        ${columns.has("unitPrice") ? `<td class="number">${money(line.unitPriceMinor)}</td>` : ""}
        ${columns.has("tax") && data.branding.showTaxDetails ? `<td class="number">${money(line.taxTotalMinor)}</td>` : ""}
        ${columns.has("total") ? `<td class="number">${money(line.totalMinor)}</td>` : ""}
      </tr>`
    )
    .join("\n");
  const notes = data.customerFacingNotes
    ? `<section aria-labelledby="invoice-notes"><h2 id="invoice-notes">Notes</h2><div class="document-rich-text">${richText(data.customerFacingNotes)}</div></section>`
    : "";
  const customerMessage = data.branding.customerNotes
    ? `<section aria-labelledby="customer-message"><h2 id="customer-message">Customer message</h2><div class="document-rich-text">${richText(data.branding.customerNotes)}</div></section>`
    : "";
  const terms = data.terms
    ? `<section aria-labelledby="invoice-terms"><h2 id="invoice-terms">Terms</h2><div class="document-rich-text">${richText(data.terms)}</div></section>`
    : "";
  const legacyPaymentInstructions = data.branding.paymentInstructions
    ? `<section aria-labelledby="payment-instructions"><h2 id="payment-instructions">Payment instructions</h2><div class="document-rich-text">${richText(data.branding.paymentInstructions)}</div></section>`
    : "";
  const howToPay = renderHowToPayHtml(data);
  const footer = data.branding.footer ? `<footer>${escapeHtml(data.branding.footer)}</footer>` : "";
  const customFields = data.branding.customFields
    .map(
      (field) =>
        `<div class="total-row"><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`
    )
    .join("");
  const alignment = data.branding.headerAlignment;
  const labels = documentLabels(data);
  const registrationDetails = (data.seller.taxRegistrations ?? [])
    .map(
      (registration) =>
        `<div>${escapeHtml(registrationLabel(registration, data.languageMode ?? "en-CA"))}: ${escapeHtml(registration.registrationNumber)}</div>`
    )
    .join("");
  const title = publicView ? labels.invoice : `${labels.invoice} preview`;
  const sellerAddress = addressHtml(data.seller.address);
  const billingAddress = addressHtml(data.customer.billingAddress);
  const serviceAddress = addressHtml(data.customer.serviceAddress);
  const logo = assets?.logo
    ? imageHtml(assets.logo, `${data.seller.displayName} logo`, "logo")
    : "";
  const headerImage =
    assets?.headerImage && tokens.backgroundTreatment !== "image-watermark"
      ? imageHtml(assets.headerImage, "", "header-image")
      : "";
  const watermark =
    assets?.headerImage && tokens.backgroundTreatment === "image-watermark"
      ? imageHtml(assets.headerImage, "", "invoice-watermark")
      : "";
  const paid = BigInt(data.invoice.amountPaidMinor);
  const deposits = BigInt(data.invoice.depositAppliedMinor ?? "0");
  const balance = BigInt(data.invoice.grandTotalMinor) - paid - deposits;
  const paymentProgress =
    paid !== 0n || deposits !== 0n
      ? `<section class="payment-progress" aria-labelledby="payment-progress"><h2 id="payment-progress">Payment progress</h2><dl>${paid !== 0n ? `<div class="total-row"><dt>Payments received</dt><dd>${money(paid.toString())}</dd></div>` : ""}${deposits !== 0n ? `<div class="total-row"><dt>Deposits applied</dt><dd>${money(deposits.toString())}</dd></div>` : ""}<div class="total-row balance"><dt>Balance due</dt><dd>${money(balance.toString())}</dd></div></dl></section>`
      : "";
  return `<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} ${escapeHtml(data.invoice.number)}</title>
<style>
:root{--primary:${tokens.primary};--accent:${tokens.accent};--row-padding:${tokens.rowPadding.toString()}px;--section-gap:${tokens.sectionGap.toString()}px;color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#17202a;font-family:${tokens.bodyFont};line-height:1.45}.invoice{max-width:816px;margin:24px auto;background:#fff;padding:${tokens.pageMargin.toString()}px;box-shadow:0 3px 18px #17202a22}.header-image{display:block;width:100%;max-height:150px;object-fit:cover;margin:calc(-1 * var(--section-gap)) 0 var(--section-gap);border-radius:${tokens.radius.toString()}px}.logo{display:block;max-width:180px;max-height:72px;object-fit:contain;margin-bottom:12px}header{${tokens.headerTreatment === "band" ? "background:var(--accent);padding:20px;border-radius:8px" : tokens.headerTreatment === "rule" ? "border-bottom:4px solid var(--primary);padding-bottom:20px" : "padding-bottom:10px"};display:flex;justify-content:space-between;gap:20px;align-items:flex-start;text-align:${alignment}}h1,h2{font-family:${tokens.headingFont}}h1{color:var(--primary);margin:0 0 8px;font-size:30px;letter-spacing:-.02em}h2{font-size:15px;color:var(--primary);margin:var(--section-gap) 0 6px}.meta{text-align:right}.meta strong{display:block;font-size:18px}.addresses{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:var(--section-gap) 0}.address{${data.branding.detailStyle === "minimal" ? "padding-left:0" : "border-left:5px solid var(--accent);padding-left:12px"}}address{font-style:normal;white-space:normal}.label{font-size:12px;font-weight:700;text-transform:uppercase;color:#4b5563;letter-spacing:.05em}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;margin-top:var(--section-gap)}caption.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}thead{display:table-header-group}tr{break-inside:avoid}thead th{background:${data.branding.detailStyle === "minimal" ? "transparent" : "var(--accent)"};color:#17202a;text-align:left;font-size:12px}tbody th{font-weight:400;text-align:left}th,td{padding:var(--row-padding) 8px;border-bottom:1px solid #d1d5db;overflow-wrap:anywhere}td.number,th.number{text-align:right;white-space:nowrap}.totals,.payment-progress dl{margin:var(--section-gap) 0 0 auto;max-width:330px}.total-row{display:flex;justify-content:space-between;padding:5px 0;gap:16px}.total-row dd{margin:0;text-align:right}.grand-total,.balance{border-top:2px solid var(--primary);font-weight:700;font-size:18px;color:var(--primary);margin-top:6px;padding-top:10px}.document-rich-text{font-size:var(--notes-font-size)}.document-rich-text>*:first-child{margin-top:0}.document-rich-text>*:last-child{margin-bottom:0}.document-rich-text p{margin:0 0 8px;white-space:normal}.document-rich-text ul{margin:0 0 8px;padding-left:20px}.document-rich-text li+li{margin-top:3px}.document-rich-text .document-rich-heading{margin:12px 0 5px;color:var(--primary);font-family:${tokens.headingFont};font-size:calc(var(--notes-font-size) + 2px);letter-spacing:.01em}.document-rich-text code{padding:1px 4px;background:#17202a0d;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em}.invoice[data-template="creative"] header{background:transparent!important;border:0!important;border-bottom:2px solid var(--primary)!important;border-radius:0!important;padding:0 0 18px!important}.invoice[data-template="creative"] .meta{min-width:184px;padding:14px 16px;background:var(--primary);color:#fff;text-align:left}.invoice[data-template="creative"] .meta strong,.invoice[data-template="creative"] .meta abbr{color:#fff}.invoice[data-template="creative"] .addresses{gap:30px}.invoice[data-template="creative"] h1{font-weight:500;letter-spacing:-.04em}.invoice[data-template="creative"] .grand-total{padding:12px;background:var(--accent);border:0}.invoice[data-template="contractor"]{border-left:26px solid var(--primary);padding-left:calc(${tokens.pageMargin.toString()}px - 8px)}.invoice[data-template="contractor"] header{border:0!important;background:transparent!important;border-radius:0!important;padding-bottom:14px!important}.invoice[data-template="contractor"] thead th{background:var(--primary);color:#fff}.invoice[data-template="contractor"] .address{border-left:0;border-top:3px solid var(--accent);padding:8px 0 0}.invoice[data-template="contractor"] .grand-total{padding:10px 12px;background:var(--primary);color:#fff;border:0}.invoice[data-template="retail"] header{align-items:center}.invoice[data-template="retail"] h1{letter-spacing:.045em;text-transform:uppercase}.invoice[data-template="retail"] .meta{padding:10px 0;border-top:3px solid var(--primary);border-bottom:1px solid var(--primary)}.invoice[data-template="modern"] header{border-radius:0!important}.invoice[data-template="modern"] .address{border-radius:8px;background:#17202a08;padding:12px;border-left:0}.invoice[data-template="minimal"] .invoice,.invoice[data-template="minimal"]{box-shadow:none}.invoice[data-template="minimal"] h1{font-weight:500}.invoice[data-template="minimal"] .grand-total{border-width:1px}.invoice[data-template="ranch-agriculture"] h1{letter-spacing:.01em}.invoice[data-template="ranch-agriculture"] thead th{border-top:2px solid var(--primary);border-bottom:2px solid var(--primary)}.invoice[data-template="service-professional"] .meta{padding-left:16px;border-left:4px solid var(--primary)}footer{margin-top:30px;padding-top:14px;border-top:1px solid #d1d5db;color:#4b5563;font-size:12px}@page{size:${data.branding.pageSize === "A4" ? "A4" : "Letter"};margin:12mm}@media(max-width:640px){.invoice{margin:0;padding:22px;box-shadow:none}.addresses{grid-template-columns:1fr}header{display:block}.meta{text-align:left}.invoice[data-template="creative"] .meta{margin-top:14px}.invoice[data-template="contractor"]{border-left-width:10px;padding-left:22px}}
</style><style>:root{--heading-font-size:${tokens.headingFontSize.toString()}px;--body-font-size:${tokens.bodyFontSize.toString()}px;--table-font-size:${tokens.tableFontSize.toString()}px;--notes-font-size:${tokens.notesFontSize.toString()}px}body{font-size:var(--body-font-size)}.invoice{position:relative;isolation:isolate;overflow:hidden}.invoice.has-brand-wash{background:linear-gradient(135deg,#fff 0%,#fff 58%,var(--accent) 180%)}.invoice-watermark{position:absolute;inset:12%;width:76%;height:76%;object-fit:contain;opacity:.075;pointer-events:none;z-index:0;filter:grayscale(1)}.invoice>*:not(.invoice-watermark){position:relative;z-index:1}h1{font-size:var(--heading-font-size)}h2{font-size:calc(var(--notes-font-size) + 5px)}.label,thead th,footer{font-size:calc(var(--table-font-size) - 1px)}table{font-size:var(--table-font-size)}section p{font-size:var(--notes-font-size)}@media print{.invoice.has-brand-wash{background:#fff}.invoice-watermark{opacity:.045}}</style></head><body><main class="${tokens.backgroundTreatment === "brand-wash" ? "invoice has-brand-wash" : "invoice"}" data-template="${escapeHtml(data.templateKey)}">
${watermark}${headerImage}<header><div>${logo}<div class="label">${escapeHtml(data.seller.displayName)}</div><h1>${escapeHtml(labels.invoice)}</h1><div>${escapeHtml(data.seller.legalName)}</div>${sellerAddress ? `<address>${sellerAddress}</address>` : ""}${data.seller.businessNumber ? `<div>${escapeHtml(labels.businessNumber)}: ${escapeHtml(data.seller.businessNumber)}</div>` : ""}${registrationDetails}</div><div class="meta"><strong>${escapeHtml(data.invoice.number)}</strong><div>${escapeHtml(labels.issued)} <time datetime="${escapeHtml(data.invoice.issueDate)}">${escapeHtml(data.invoice.issueDate)}</time></div><div>${escapeHtml(labels.due)} <time datetime="${escapeHtml(data.invoice.dueDate)}">${escapeHtml(data.invoice.dueDate)}</time></div><div><abbr title="Currency">${escapeHtml(labels.currency)}</abbr>: ${escapeHtml(data.invoice.currency)}</div></div></header>
<section class="addresses" aria-label="Invoice parties"><div class="address"><div class="label">${escapeHtml(labels.billTo)}</div><strong>${escapeHtml(data.customer.name)}</strong>${data.customer.email ? `<div><a href="mailto:${escapeHtml(data.customer.email)}">${escapeHtml(data.customer.email)}</a></div>` : ""}${billingAddress ? `<address>${billingAddress}</address>` : ""}</div>${serviceAddress ? `<div class="address"><div class="label">${escapeHtml(labels.serviceAddress)}</div><address>${serviceAddress}</address></div>` : `<div class="address"><div class="label">${escapeHtml(labels.invoiceCurrency)}</div><strong>${escapeHtml(data.invoice.currency)}</strong><div>${escapeHtml(labels.allAmounts)} ${escapeHtml(data.invoice.currency)}</div></div>`}</section>
<div class="table-wrap"><table><caption class="sr-only">${escapeHtml(labels.lineItems)} ${escapeHtml(data.invoice.number)}</caption><thead><tr><th scope="col">${escapeHtml(labels.description)}</th>${columns.has("quantity") ? `<th scope="col" class="number">${escapeHtml(labels.quantity)}</th>` : ""}${columns.has("unitPrice") ? `<th scope="col" class="number">${escapeHtml(moneyLabel(labels.unitPrice))}</th>` : ""}${columns.has("tax") && data.branding.showTaxDetails ? `<th scope="col" class="number">${escapeHtml(moneyLabel(labels.tax))}</th>` : ""}${columns.has("total") ? `<th scope="col" class="number">${escapeHtml(moneyLabel(labels.total))}</th>` : ""}</tr></thead><tbody>${lineRows}</tbody></table></div>
<dl class="totals"><div class="total-row"><dt>${escapeHtml(labels.subtotal)}</dt><dd>${money(data.invoice.subtotalMinor)}</dd></div><div class="total-row"><dt>${escapeHtml(labels.discounts)}</dt><dd>${money(data.invoice.discountTotalMinor)}</dd></div><div class="total-row"><dt>${escapeHtml(labels.tax)}</dt><dd>${money(data.invoice.taxTotalMinor)}</dd></div><div class="total-row grand-total"><dt>${escapeHtml(labels.total)} (${escapeHtml(data.invoice.currency)})</dt><dd>${money(data.invoice.grandTotalMinor)}</dd></div>${customFields}</dl>
${paymentProgress}${customerMessage}${notes}${terms}${howToPay}${legacyPaymentInstructions}${data.branding.signatureBlock ? `<section aria-labelledby="invoice-signature"><h2 id="invoice-signature">Signature</h2><div class="document-rich-text">${richText(data.branding.signatureBlock)}</div></section>` : ""}${footer}</main></body></html>`;
}

function renderHowToPayHtml(data: InvoiceRenderData): string {
  const snapshot = data.paymentInstructions;
  if (
    (!snapshot || (snapshot.methods.length === 0 && !snapshot.legacyInstructions)) &&
    !data.durablePaymentLink
  )
    return "";
  const methodRows =
    snapshot?.methods.map((method) => {
      const label = paymentMethodLabel(method.key);
      const detail = paymentMethodText(method);
      return `<li><strong>${escapeHtml(label)}</strong>${detail ? `<div>${htmlText(detail)}</div>` : ""}</li>`;
    }) ?? [];
  const paymentReference = data.invoice.paymentReference ?? data.invoice.number;
  const reference = `Please quote ${paymentReference} with your payment.`;
  const legacy = snapshot?.legacyInstructions
    ? `<p>${htmlText(snapshot.legacyInstructions)}</p>`
    : "";
  const durable = data.durablePaymentLink
    ? `<p><strong>Pay securely online:</strong> <a href="${escapeHtml(data.durablePaymentLink.url)}" rel="noopener noreferrer">${escapeHtml(data.durablePaymentLink.url)}</a></p>`
    : "";
  return `<section aria-labelledby="how-to-pay"><h2 id="how-to-pay">How to pay</h2><p>${escapeHtml(reference)}</p>${durable}${methodRows.length ? `<ul>${methodRows.join("")}</ul>` : ""}${legacy}</section>`;
}

function renderHowToPayText(data: InvoiceRenderData): string | null {
  const snapshot = data.paymentInstructions;
  if (
    (!snapshot || (snapshot.methods.length === 0 && !snapshot.legacyInstructions)) &&
    !data.durablePaymentLink
  )
    return null;
  const paymentReference = data.invoice.paymentReference ?? data.invoice.number;
  const lines = [`Please quote ${paymentReference} with your payment.`];
  if (data.durablePaymentLink) lines.push(`Pay securely online: ${data.durablePaymentLink.url}`);
  for (const method of snapshot?.methods ?? []) {
    const detail = paymentMethodText(method);
    lines.push(`${paymentMethodLabel(method.key)}${detail ? `: ${detail}` : ""}`);
  }
  if (snapshot?.legacyInstructions) lines.push(snapshot.legacyInstructions);
  return lines.join("\n");
}

export function assertCustomerFacingPaymentUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "PAYMENT_LINK_URL_INVALID",
      "The payment provider returned an invalid link.",
      502
    );
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const ipVersion = isIP(hostname);
  const privateIpv4 =
    ipVersion === 4 &&
    (hostname.startsWith("0.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("127.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      hostname.startsWith("169.254."));
  const privateIpv6 =
    ipVersion === 6 &&
    (hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8") ||
      hostname === "::1");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !hostname ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    privateIpv4 ||
    privateIpv6 ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new AppError(
      "PAYMENT_LINK_URL_PRIVATE",
      "A payment link must use a public provider host.",
      502
    );
}

function paymentMethodLabel(key: RenderPaymentInstructionMethod["key"]): string {
  return {
    E_TRANSFER: "Interac e-Transfer",
    EFT: "Direct deposit / EFT",
    CHEQUE: "Cheque",
    PAY_ONLINE: "Pay online",
    CASH: "Cash",
    OTHER: "Other"
  }[key];
}

function paymentMethodText(method: RenderPaymentInstructionMethod): string {
  switch (method.key) {
    case "E_TRANSFER":
      return [
        method.recipientEmail ? `Send to ${method.recipientEmail}.` : "",
        method.autodeposit
          ? "Autodeposit is enabled."
          : "Autodeposit is not enabled; the security answer will be shared separately."
      ]
        .filter(Boolean)
        .join(" ");
    case "EFT":
      return [
        method.institution,
        method.transitNumber ? `Transit ${method.transitNumber}` : "",
        method.accountNumber ? `Account ${method.accountNumber}` : ""
      ]
        .filter(Boolean)
        .join(" · ");
    case "CHEQUE":
      return [
        method.payableTo ? `Payable to ${method.payableTo}.` : "",
        method.mailingAddress ? `Mail to ${method.mailingAddress}.` : ""
      ]
        .filter(Boolean)
        .join(" ");
    case "PAY_ONLINE":
      return method.url ? `Pay at ${method.url}.` : "";
    case "CASH":
    case "OTHER":
      return method.description ?? "";
  }
}

export interface PdfRenderResult {
  readonly data: Buffer;
  readonly pageCount: number;
}

export interface PdfRenderer {
  render(data: InvoiceRenderData, assets?: InvoiceRenderAssets): Promise<PdfRenderResult>;
}

export class DeterministicPdfRenderer implements PdfRenderer {
  public async render(
    data: InvoiceRenderData,
    assets: InvoiceRenderAssets = { logo: null, headerImage: null }
  ): Promise<PdfRenderResult> {
    validateRenderAssets(data, assets);
    const tokens = resolveInvoiceDesignTokens(data);
    const document = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: false,
      displayTitle: true,
      info: {
        Title: `Invoice ${pdfSafeText(data.invoice.number)}`,
        Author: pdfSafeText(data.seller.legalName || data.seller.displayName),
        Subject: `Invoice in ${pdfSafeText(data.invoice.currency)}`,
        Creator: "PennyWise Accounting",
        Producer: "PennyWise Accounting PDFKit renderer",
        CreationDate: new Date("2000-01-01T00:00:00.000Z"),
        ModDate: new Date("2000-01-01T00:00:00.000Z")
      },
      lang: data.locale,
      layout: "portrait",
      margin: tokens.pageMargin,
      pdfVersion: "1.7",
      size: data.branding.pageSize
    });
    const chunks: Buffer[] = [];
    const completed = new Promise<Buffer>((resolveBuffer, reject) => {
      document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      document.on("error", reject);
      document.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    });
    const addPage = (continued = false): void => {
      document.addPage({ margin: tokens.pageMargin, size: data.branding.pageSize });
      if (tokens.backgroundTreatment === "brand-wash") {
        document
          .rect(0, 0, document.page.width, document.page.height)
          .fill(lightenHex(tokens.accent, 0.86));
      }
      if (tokens.backgroundTreatment === "image-watermark" && assets.headerImage) {
        const watermarkWidth = document.page.width - tokens.pageMargin * 2;
        const watermarkHeight = document.page.height - tokens.pageMargin * 4;
        document.save();
        document
          .opacity(0.055)
          .image(assets.headerImage.data, tokens.pageMargin, tokens.pageMargin * 2, {
            fit: [watermarkWidth, watermarkHeight],
            align: "center",
            valign: "center"
          });
        document.restore();
      }
      if (continued) {
        document
          .font(tokens.pdfBoldFont)
          .fontSize(9)
          .fillColor(tokens.primary)
          .text(`INVOICE ${pdfSafeText(data.invoice.number)} - CONTINUED`, tokens.pageMargin, 26, {
            align: "right",
            width: document.page.width - tokens.pageMargin * 2
          });
      }
      document.y = tokens.pageMargin;
    };
    const bottomLimit = (): number => document.page.height - tokens.pageMargin - 32;
    const ensureSpace = (height: number, continued = true): void => {
      if (document.y + height > bottomLimit()) addPage(continued);
    };
    const text = (value: string): string => pdfSafeText(value);
    const labels = documentLabels(data);

    addPage();
    if (assets.headerImage && tokens.backgroundTreatment !== "image-watermark") {
      document.image(assets.headerImage.data, tokens.pageMargin, document.y, {
        align: "center",
        fit: [document.page.width - tokens.pageMargin * 2, 92],
        valign: "center"
      });
      document.y += 98;
    }

    const headerTop = document.y;
    const contentWidth = document.page.width - tokens.pageMargin * 2;
    if (tokens.headerTreatment === "band") {
      document
        .roundedRect(tokens.pageMargin, headerTop, contentWidth, 116, tokens.radius)
        .fill(tokens.accent);
    }
    const headerInset = tokens.headerTreatment === "band" ? 16 : 0;
    const left = tokens.pageMargin + headerInset;
    let sellerTop = headerTop + headerInset;
    if (assets.logo) {
      document.image(assets.logo.data, left, sellerTop, { fit: [150, 48] });
      sellerTop += 54;
    }
    document
      .font(tokens.pdfBoldFont)
      .fontSize(tokens.headingFontSize)
      .fillColor(tokens.primary)
      .text(text(labels.invoice), left, sellerTop, { lineBreak: false });
    document
      .font(tokens.pdfBoldFont)
      .fontSize(tokens.bodyFontSize)
      .fillColor("#17202a")
      .text(text(data.seller.displayName), left, sellerTop + 29, { width: contentWidth * 0.52 });
    if (data.seller.legalName && data.seller.legalName !== data.seller.displayName)
      document
        .font(tokens.pdfBodyFont)
        .fontSize(Math.max(8, tokens.bodyFontSize - 2))
        .fillColor("#4b5563")
        .text(text(data.seller.legalName), left, sellerTop + 44, { width: contentWidth * 0.52 });
    const metaX = tokens.pageMargin + contentWidth * 0.59;
    const metaWidth = contentWidth * 0.41 - headerInset;
    document
      .font(tokens.pdfBoldFont)
      .fontSize(Math.max(13, Math.round(tokens.headingFontSize * 0.55)))
      .fillColor(tokens.primary)
      .text(text(data.invoice.number), metaX, headerTop + headerInset, {
        align: "right",
        width: metaWidth
      });
    document
      .font(tokens.pdfBodyFont)
      .fontSize(Math.max(8, tokens.bodyFontSize - 1))
      .fillColor("#374151")
      .text(
        `${text(labels.issued)}  ${text(data.invoice.issueDate)}`,
        metaX,
        headerTop + headerInset + 27,
        {
          align: "right",
          width: metaWidth
        }
      )
      .text(`${text(labels.due)}  ${text(data.invoice.dueDate)}`, metaX, undefined, {
        align: "right",
        width: metaWidth
      })
      .font(tokens.pdfBoldFont)
      .text(`${text(labels.currency)}  ${text(data.invoice.currency)}`, metaX, undefined, {
        align: "right",
        width: metaWidth
      });
    if (tokens.headerTreatment === "rule")
      document
        .moveTo(tokens.pageMargin, headerTop + 112)
        .lineTo(document.page.width - tokens.pageMargin, headerTop + 112)
        .lineWidth(3)
        .strokeColor(tokens.primary)
        .stroke();
    document.y = headerTop + 128;

    const sellerAddress = addressLines(data.seller.address);
    const billAddress = addressLines(data.customer.billingAddress);
    const serviceAddress = addressLines(data.customer.serviceAddress);
    const addressWidth = (contentWidth - 22) / 2;
    const sellerDetails = [
      ...sellerAddress,
      ...(data.seller.businessNumber
        ? [`${labels.businessNumber}: ${data.seller.businessNumber}`]
        : []),
      ...(data.seller.taxRegistrations ?? []).map(
        (registration) =>
          `${registrationLabel(registration, data.languageMode ?? "en-CA")}: ${registration.registrationNumber}`
      )
    ];
    const billDetails = [
      data.customer.name,
      ...(data.customer.email ? [data.customer.email] : []),
      ...billAddress
    ];
    const detailsTop = document.y;
    drawPdfDetailBlock(
      document,
      labels.from,
      sellerDetails,
      tokens.pageMargin,
      detailsTop,
      addressWidth,
      tokens
    );
    drawPdfDetailBlock(
      document,
      serviceAddress.length ? labels.billToService : labels.billTo,
      [...billDetails, ...serviceAddress.map((line) => `Service: ${line}`)],
      tokens.pageMargin + addressWidth + 22,
      detailsTop,
      addressWidth,
      tokens
    );
    const detailsHeight = Math.max(
      pdfDetailHeight(document, sellerDetails, addressWidth, tokens),
      pdfDetailHeight(document, [...billDetails, ...serviceAddress], addressWidth, tokens)
    );
    document.y = detailsTop + detailsHeight + tokens.sectionGap;

    const columns = pdfColumns(data, contentWidth);
    const drawTableHeader = (): void => {
      const y = document.y;
      if (data.branding.detailStyle !== "minimal")
        document.rect(tokens.pageMargin, y, contentWidth, 25).fill(tokens.accent);
      let x = tokens.pageMargin;
      for (const column of columns) {
        document
          .font(tokens.pdfBoldFont)
          .fontSize(Math.max(7, tokens.tableFontSize - 1))
          .fillColor("#17202a")
          .text(column.label, x + 5, y + 8, {
            align: column.numeric ? "right" : "left",
            lineBreak: false,
            width: column.width - 10
          });
        x += column.width;
      }
      document.y = y + 25;
    };
    const ensureTableSpace = (height: number): void => {
      if (document.y + height <= bottomLimit()) return;
      addPage(true);
      drawTableHeader();
    };
    drawTableHeader();
    for (const [lineIndex, line] of data.lines.entries()) {
      const values = pdfLineValues(line, data.invoice.currency, data.locale, columns);
      document.font(tokens.pdfBodyFont).fontSize(tokens.tableFontSize);
      const rowHeight =
        Math.max(
          22,
          ...columns.map((column, index) =>
            document.heightOfString(text(values[index] ?? ""), { width: column.width - 10 })
          )
        ) + tokens.rowPadding;
      ensureTableSpace(rowHeight);
      const y = document.y;
      let x = tokens.pageMargin;
      if (data.branding.detailStyle === "tinted" && lineIndex % 2 === 1)
        document.rect(tokens.pageMargin, y, contentWidth, rowHeight).fill("#f8fafc");
      for (const [index, column] of columns.entries()) {
        document
          .font(tokens.pdfBodyFont)
          .fontSize(tokens.tableFontSize)
          .fillColor("#17202a")
          .text(text(values[index] ?? ""), x + 5, y + tokens.rowPadding / 2, {
            align: column.numeric ? "right" : "left",
            width: column.width - 10
          });
        x += column.width;
      }
      document
        .moveTo(tokens.pageMargin, y + rowHeight)
        .lineTo(document.page.width - tokens.pageMargin, y + rowHeight)
        .lineWidth(0.5)
        .strokeColor("#d1d5db")
        .stroke();
      document.y = y + rowHeight;
    }

    document.y += tokens.sectionGap;
    const totals = [
      [
        labels.subtotal,
        formatMinor(data.invoice.subtotalMinor, data.invoice.currency, data.locale)
      ],
      [
        labels.discounts,
        formatMinor(data.invoice.discountTotalMinor, data.invoice.currency, data.locale)
      ],
      [labels.tax, formatMinor(data.invoice.taxTotalMinor, data.invoice.currency, data.locale)],
      [
        `${labels.total} (${data.invoice.currency})`,
        formatMinor(data.invoice.grandTotalMinor, data.invoice.currency, data.locale)
      ]
    ] as const;
    ensureSpace(105 + data.branding.customFields.length * 18);
    const totalWidth = 250;
    const totalX = document.page.width - tokens.pageMargin - totalWidth;
    for (const [index, [label, value]] of totals.entries()) {
      if (index === totals.length - 1)
        document
          .moveTo(totalX, document.y)
          .lineTo(totalX + totalWidth, document.y)
          .lineWidth(2)
          .strokeColor(tokens.primary)
          .stroke();
      drawPdfAmountRow(
        document,
        label,
        value,
        totalX,
        totalWidth,
        tokens,
        index === totals.length - 1
      );
    }
    for (const field of data.branding.customFields)
      drawPdfAmountRow(document, field.label, field.value, totalX, totalWidth, tokens, false);

    const paid = BigInt(data.invoice.amountPaidMinor);
    const deposits = BigInt(data.invoice.depositAppliedMinor ?? "0");
    if (paid !== 0n || deposits !== 0n) {
      ensureSpace(96);
      document.y += tokens.sectionGap;
      drawPdfSectionHeading(document, labels.paymentProgress, tokens);
      if (paid !== 0n)
        drawPdfAmountRow(
          document,
          labels.paymentsReceived,
          formatMinor(paid.toString(), data.invoice.currency, data.locale),
          totalX,
          totalWidth,
          tokens,
          false
        );
      if (deposits !== 0n)
        drawPdfAmountRow(
          document,
          labels.depositsApplied,
          formatMinor(deposits.toString(), data.invoice.currency, data.locale),
          totalX,
          totalWidth,
          tokens,
          false
        );
      drawPdfAmountRow(
        document,
        labels.balanceDue,
        formatMinor(
          (BigInt(data.invoice.grandTotalMinor) - paid - deposits).toString(),
          data.invoice.currency,
          data.locale
        ),
        totalX,
        totalWidth,
        tokens,
        true
      );
    }

    const sections = [
      [labels.customerMessage, data.branding.customerNotes],
      [labels.notes, data.customerFacingNotes],
      [labels.terms, data.terms],
      ["How to pay", renderHowToPayText(data)],
      [labels.paymentInstructions, data.branding.paymentInstructions],
      [labels.signature, data.branding.signatureBlock]
    ] as const;
    const preparedSections = sections.flatMap(([heading, body]) => {
      if (!body) return [];
      const blocks = pdfRichTextBlocks(body).map((block) => {
        const prefix = block.kind === "bullet" ? "- " : "";
        const font = block.kind === "heading" ? tokens.pdfBoldFont : tokens.pdfBodyFont;
        const fontSize =
          block.kind === "heading"
            ? Math.max(tokens.notesFontSize, tokens.notesFontSize + 1)
            : tokens.notesFontSize;
        document.font(font).fontSize(fontSize);
        return {
          ...block,
          text: text(`${prefix}${block.value}`),
          font,
          fontSize,
          height:
            document.heightOfString(text(`${prefix}${block.value}`), { width: contentWidth }) + 4
        };
      });
      const bodyHeight = blocks.reduce((sum, block) => sum + block.height, 0);
      const height = tokens.sectionGap + 17 + bodyHeight;
      return [{ heading, blocks, height }];
    });
    const combinedSectionHeight = preparedSections.reduce(
      (sum, section) => sum + section.height,
      0
    );
    const freshPageCapacity = bottomLimit() - tokens.pageMargin;
    if (
      combinedSectionHeight <= freshPageCapacity &&
      document.y + combinedSectionHeight > bottomLimit()
    )
      addPage(true);
    for (const { heading, blocks, height } of preparedSections) {
      ensureSpace(Math.min(height, bottomLimit() - tokens.pageMargin));
      document.y += tokens.sectionGap;
      drawPdfSectionHeading(document, heading, tokens);
      document.y += 3;
      for (const block of blocks) {
        document
          .font(block.font)
          .fontSize(block.fontSize)
          .fillColor(block.kind === "heading" ? tokens.primary : "#374151")
          .text(block.text, tokens.pageMargin, document.y, { width: contentWidth });
        document.y += 4;
      }
    }

    const pageRange = document.bufferedPageRange();
    for (
      let pageIndex = pageRange.start;
      pageIndex < pageRange.start + pageRange.count;
      pageIndex += 1
    ) {
      document.switchToPage(pageIndex);
      const footerY = document.page.height - tokens.pageMargin - 14;
      document
        .moveTo(tokens.pageMargin, footerY - 8)
        .lineTo(document.page.width - tokens.pageMargin, footerY - 8)
        .lineWidth(0.5)
        .strokeColor("#d1d5db")
        .stroke();
      document
        .font(tokens.pdfBodyFont)
        .fontSize(Math.max(7.5, tokens.notesFontSize - 2))
        .fillColor("#6b7280")
        .text(
          text(
            data.branding.footer ?? `${data.seller.displayName} - Invoice ${data.invoice.number}`
          ),
          tokens.pageMargin,
          footerY,
          { ellipsis: true, lineBreak: false, width: contentWidth * 0.72 }
        )
        .text(
          `Page ${(pageIndex - pageRange.start + 1).toString()} of ${pageRange.count.toString()}`,
          tokens.pageMargin,
          footerY,
          {
            align: "right",
            lineBreak: false,
            width: contentWidth
          }
        );
    }
    const finalPageRange = document.bufferedPageRange();
    if (finalPageRange.count !== pageRange.count)
      throw new Error("Invoice footer rendering unexpectedly changed the page count.");
    document.end();
    return { data: await completed, pageCount: finalPageRange.count };
  }
}

export function formatMinor(
  value: string,
  currency: string,
  locale: "en-CA" | "fr-CA" = "en-CA"
): string {
  const code = currency.trim().toUpperCase();
  const exponent = { CAD: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 }[code] ?? 2;
  const amount = BigInt(value);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const scale = 10n ** BigInt(exponent);
  const whole = absolute / scale;
  const fraction =
    exponent === 0 ? "" : `.${(absolute % scale).toString().padStart(exponent, "0")}`;
  const decimal = `${sign}${whole.toString()}${fraction}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent
      // The ECMA-402 runtime accepts a numeric string without rounding it, but
      // TypeScript's lib.dom declaration only exposes number|bigint here.
    }).format(decimal as unknown as number);
  } catch {
    return decimal;
  }
}

function formatQuantity(value: bigint): string {
  const whole = value / 1_000_000n;
  const remainder = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return remainder ? `${whole.toString()}.${remainder}` : whole.toString();
}

type InvoicePdfDocument = InstanceType<typeof PDFDocument>;

interface PdfColumn {
  readonly key: "description" | "quantity" | "unitPrice" | "tax" | "total";
  readonly label: string;
  readonly numeric: boolean;
  readonly width: number;
}

function pdfColumns(data: InvoiceRenderData, contentWidth: number): readonly PdfColumn[] {
  const visible = new Set(data.branding.visibleColumns);
  const labels = documentLabels(data);
  const definitions = [
    { key: "quantity", label: labels.quantity, width: 48 },
    { key: "unitPrice", label: `${labels.unitPrice} (${data.invoice.currency})`, width: 78 },
    { key: "tax", label: `${labels.tax} (${data.invoice.currency})`, width: 68 },
    { key: "total", label: `${labels.total} (${data.invoice.currency})`, width: 82 }
  ] as const;
  const numeric = definitions.filter(
    (item) => visible.has(item.key) && (item.key !== "tax" || data.branding.showTaxDetails)
  );
  const numericWidth = numeric.reduce((sum, item) => sum + item.width, 0);
  return [
    {
      key: "description",
      label: labels.description,
      numeric: false,
      width: contentWidth - numericWidth
    },
    ...numeric.map((item) => ({ ...item, numeric: true }))
  ];
}

function pdfLineValues(
  line: InvoiceRenderLine,
  currency: string,
  locale: "en-CA" | "fr-CA",
  columns: readonly PdfColumn[]
): readonly string[] {
  return columns.map((column) => {
    if (column.key === "description") return line.description;
    if (column.key === "quantity") return line.quantity;
    if (column.key === "unitPrice") return formatMinor(line.unitPriceMinor, currency, locale);
    if (column.key === "tax") return formatMinor(line.taxTotalMinor, currency, locale);
    return formatMinor(line.totalMinor, currency, locale);
  });
}

function drawPdfDetailBlock(
  document: InvoicePdfDocument,
  label: string,
  lines: readonly string[],
  x: number,
  y: number,
  width: number,
  tokens: InvoiceDesignTokens
): void {
  if (tokens.headerTreatment !== "quiet")
    document
      .rect(x, y, 4, Math.max(48, pdfDetailHeight(document, lines, width, tokens)))
      .fill(tokens.accent);
  document
    .font(tokens.pdfBoldFont)
    .fontSize(Math.max(7.5, tokens.tableFontSize - 1))
    .fillColor(tokens.primary)
    .text(label, x + 11, y + 2, { width: width - 11 });
  document
    .font(tokens.pdfBodyFont)
    .fontSize(Math.max(8, tokens.bodyFontSize - 2))
    .fillColor("#374151")
    .text(lines.map(pdfSafeText).join("\n"), x + 11, y + 17, { width: width - 11 });
}

function pdfDetailHeight(
  document: InvoicePdfDocument,
  lines: readonly string[],
  width: number,
  tokens: InvoiceDesignTokens
): number {
  document.font(tokens.pdfBodyFont).fontSize(Math.max(8, tokens.bodyFontSize - 2));
  return Math.max(
    48,
    23 + document.heightOfString(lines.map(pdfSafeText).join("\n"), { width: width - 11 })
  );
}

function drawPdfAmountRow(
  document: InvoicePdfDocument,
  label: string,
  value: string,
  x: number,
  width: number,
  tokens: InvoiceDesignTokens,
  emphasized: boolean
): void {
  const y = document.y + (emphasized ? 7 : 3);
  document
    .font(emphasized ? tokens.pdfBoldFont : tokens.pdfBodyFont)
    .fontSize(emphasized ? Math.max(11, tokens.bodyFontSize + 1) : tokens.bodyFontSize)
    .fillColor(emphasized ? tokens.primary : "#374151")
    .text(pdfSafeText(label), x, y, { lineBreak: false, width: width * 0.5 })
    .text(pdfSafeText(value), x + width * 0.45, y, {
      align: "right",
      lineBreak: false,
      width: width * 0.55
    });
  document.y = y + (emphasized ? 19 : 15);
}

function drawPdfSectionHeading(
  document: InvoicePdfDocument,
  heading: string,
  tokens: InvoiceDesignTokens
): void {
  const y = document.y;
  document
    .font(tokens.pdfBoldFont)
    .fontSize(Math.max(8, tokens.notesFontSize - 1))
    .fillColor(tokens.primary)
    .text(heading, document.page.margins.left, y, {
      characterSpacing: 0.5,
      width: document.page.width - document.page.margins.left - document.page.margins.right
    });
  document.y = y + 11;
}

/**
 * Customer-entered document text is deliberately a tiny, deterministic markup
 * language. Escaping happens before the supported markers are interpreted, so
 * it cannot become arbitrary invoice HTML or script.
 */
function inlineText(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*\n][\s\S]*?)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_\n][\s\S]*?)_/g, "<em>$1</em>")
    .replace(/`([^`\n][\s\S]*?)`/g, "<code>$1</code>");
}

function htmlText(value: string): string {
  return inlineText(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "<br>");
}

function richText(value: string): string {
  const rendered: string[] = [];
  const bullets: string[] = [];
  const flushBullets = (): void => {
    if (!bullets.length) return;
    rendered.push(`<ul>${bullets.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    bullets.length = 0;
  };
  const flushParagraphs = (paragraphs: readonly string[]): void => {
    for (const paragraph of paragraphs) rendered.push(`<p>${inlineText(paragraph)}</p>`);
  };
  let paragraphs: string[] = [];
  for (const rawLine of value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraphs(paragraphs);
      paragraphs = [];
      flushBullets();
      continue;
    }
    const heading = /^(?:##|###)\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraphs(paragraphs);
      paragraphs = [];
      flushBullets();
      rendered.push(`<h3 class="document-rich-heading">${inlineText(heading[1]!)}</h3>`);
      continue;
    }
    const bullet = /^(?:[-*])\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraphs(paragraphs);
      paragraphs = [];
      bullets.push(inlineText(bullet[1]!));
      continue;
    }
    flushBullets();
    paragraphs.push(line);
  }
  flushParagraphs(paragraphs);
  flushBullets();
  return rendered.join("");
}

function pdfRichTextBlocks(
  value: string
): readonly { readonly kind: "paragraph" | "heading" | "bullet"; readonly value: string }[] {
  const blocks: { kind: "paragraph" | "heading" | "bullet"; value: string }[] = [];
  for (const rawLine of value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^(?:##|###)\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", value: removeInlineMarkup(heading[1]!) });
      continue;
    }
    const bullet = /^(?:[-*])\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: "bullet", value: removeInlineMarkup(bullet[1]!) });
      continue;
    }
    blocks.push({ kind: "paragraph", value: removeInlineMarkup(line) });
  }
  return blocks;
}

function removeInlineMarkup(value: string): string {
  return value.replaceAll("**", "").replaceAll("_", "").replaceAll("`", "");
}

function addressHtml(value: unknown): string {
  return addressLines(value).map(escapeHtml).join("<br>");
}

function addressLines(value: unknown): string[] {
  if (typeof value === "string")
    return value.trim()
      ? value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const take = (key: string): string => (typeof record[key] === "string" ? record[key].trim() : "");
  const lines = [take("line1"), take("line2")];
  const locality = [
    take("city"),
    take("province") || take("state"),
    take("postalCode") || take("zip")
  ]
    .filter(Boolean)
    .join(", ");
  if (locality) lines.push(locality);
  const country = take("country") || take("countryCode");
  if (country) lines.push(country);
  return lines.filter(Boolean);
}

function lightenHex(value: string, whiteFraction: number): string {
  const fraction = Math.max(0, Math.min(1, whiteFraction));
  const parts = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  if (parts.some((part) => Number.isNaN(part))) return "#ffffff";
  return `#${parts
    .map((part) =>
      Math.round(part + (255 - part) * fraction)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function imageHtml(asset: InvoiceRenderAsset, alt: string, className: string): string {
  return `<img class="${className}" src="data:${asset.mediaType};base64,${asset.data.toString("base64")}" alt="${escapeHtml(alt)}" width="${asset.width.toString()}" height="${asset.height.toString()}">`;
}

export function validateRenderAssets(data: InvoiceRenderData, assets: InvoiceRenderAssets): void {
  validateRenderAsset(data.branding.logoAssetId, data.assets?.logo, assets.logo, "logo");
  validateRenderAsset(
    data.branding.headerImageAssetId,
    data.assets?.headerImage,
    assets.headerImage,
    "header image"
  );
}

function validateRenderAsset(
  configuredId: string | null,
  snapshot: InvoiceRenderAssetReference | null | undefined,
  asset: InvoiceRenderAsset | null,
  label: string
): void {
  const expectedId = snapshot?.id ?? configuredId;
  if (!expectedId) {
    if (asset)
      throw new AppError(
        "INVOICE_RENDER_ASSET_UNEXPECTED",
        `The ${label} is not part of this invoice snapshot.`,
        422
      );
    return;
  }
  if (!asset || asset.id !== expectedId)
    throw new AppError(
      "INVOICE_RENDER_ASSET_MISSING",
      `The preserved ${label} is not available.`,
      422
    );
  if (!inspectInvoiceImage(asset.data, asset.mediaType))
    throw new AppError(
      "INVOICE_RENDER_ASSET_INVALID",
      `The preserved ${label} bytes are malformed.`,
      422
    );
  const checksum = createHash("sha256").update(asset.data).digest("hex");
  if (checksum !== asset.checksum || (snapshot && checksum !== snapshot.checksum))
    throw new AppError(
      "INVOICE_RENDER_ASSET_TAMPERED",
      `The preserved ${label} failed its integrity check.`,
      500
    );
  if (
    snapshot &&
    (snapshot.mediaType !== asset.mediaType ||
      snapshot.width !== asset.width ||
      snapshot.height !== asset.height)
  )
    throw new AppError(
      "INVOICE_RENDER_ASSET_TAMPERED",
      `The preserved ${label} metadata failed its integrity check.`,
      500
    );
}

function inspectInvoiceImage(data: Buffer, mediaType: string): boolean {
  if (mediaType === "image/png")
    return (
      data.length >= 24 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      data.toString("ascii", 12, 16) === "IHDR"
    );
  if (mediaType === "image/jpeg")
    return (
      data.length >= 4 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[data.length - 2] === 0xff &&
      data[data.length - 1] === 0xd9
    );
  if (mediaType === "image/webp")
    return (
      data.length >= 20 &&
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP" &&
      data.readUInt32LE(4) + 8 <= data.length
    );
  return false;
}

export function pdfSafeText(value: string): string {
  const punctuation = new Map<string, string>([
    ["\u2013", "-"],
    ["\u2014", "-"],
    ["\u2018", "'"],
    ["\u2019", "'"],
    ["\u201c", '"'],
    ["\u201d", '"'],
    ["\u2022", "*"],
    ["\u2026", "..."]
  ]);
  let result = "";
  for (const character of value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")) {
    const codePoint = character.codePointAt(0)!;
    if (character === "\n" || character === "\r" || character === "\t") result += character;
    else if (codePoint >= 0x20 && codePoint <= 0x7e) result += character;
    else result += punctuation.get(character) ?? `[U+${codePoint.toString(16).toUpperCase()}]`;
  }
  return result;
}

function readValue(value: Prisma.JsonValue, key: string): Prisma.JsonValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (value as Record<string, Prisma.JsonValue>)[key] ?? null;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function readString(value: Prisma.JsonValue, key: string): string {
  const item = readValue(value, key);
  return typeof item === "string" ? item : "";
}

function readNullableString(value: Prisma.JsonValue, key: string): string | null {
  const item = readValue(value, key);
  return typeof item === "string" ? item : null;
}

type DocumentLanguage = "en-CA" | "fr-CA" | "BILINGUAL";

interface DocumentLabels {
  readonly invoice: string;
  readonly issued: string;
  readonly due: string;
  readonly currency: string;
  readonly businessNumber: string;
  readonly from: string;
  readonly billTo: string;
  readonly billToService: string;
  readonly serviceAddress: string;
  readonly invoiceCurrency: string;
  readonly allAmounts: string;
  readonly lineItems: string;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly tax: string;
  readonly total: string;
  readonly subtotal: string;
  readonly discounts: string;
  readonly paymentProgress: string;
  readonly paymentsReceived: string;
  readonly depositsApplied: string;
  readonly balanceDue: string;
  readonly customerMessage: string;
  readonly notes: string;
  readonly terms: string;
  readonly paymentInstructions: string;
  readonly signature: string;
}

function renderLanguage(
  snapshot: Prisma.JsonValue,
  customerLanguage?: string | null
): DocumentLanguage {
  const value = customerLanguage || readString(snapshot, "documentLanguage");
  return value === "fr-CA" || value === "BILINGUAL" ? value : "en-CA";
}

function documentLabels(data: InvoiceRenderData): DocumentLabels {
  const language = data.languageMode ?? data.locale;
  if (language === "fr-CA")
    return {
      invoice: "FACTURE",
      issued: "Émise",
      due: "Échéance",
      currency: "Devise",
      businessNumber: "Numéro d'entreprise",
      from: "DE",
      billTo: "FACTURER À",
      billToService: "FACTURER À / SERVICE À",
      serviceAddress: "Adresse de service",
      invoiceCurrency: "Devise de la facture",
      allAmounts: "Tous les montants sont en",
      lineItems: "Postes de la facture",
      description: "DESCRIPTION",
      quantity: "QTÉ",
      unitPrice: "PRIX UNITAIRE",
      tax: "TAXE",
      total: "TOTAL",
      subtotal: "Sous-total",
      discounts: "Rabais",
      paymentProgress: "PROGRÈS DES PAIEMENTS",
      paymentsReceived: "Paiements reçus",
      depositsApplied: "Dépôts appliqués",
      balanceDue: "Solde dû",
      customerMessage: "MESSAGE AU CLIENT",
      notes: "NOTES",
      terms: "MODALITÉS",
      paymentInstructions: "INSTRUCTIONS DE PAIEMENT",
      signature: "SIGNATURE"
    };
  if (language === "BILINGUAL")
    return {
      invoice: "INVOICE / FACTURE",
      issued: "Issued / Émise",
      due: "Due / Échéance",
      currency: "Currency / Devise",
      businessNumber: "Business number / Numéro d'entreprise",
      from: "FROM / DE",
      billTo: "BILL TO / FACTURER À",
      billToService: "BILL TO / FACTURER À · SERVICE / SERVICE",
      serviceAddress: "Service address / Adresse de service",
      invoiceCurrency: "Invoice currency / Devise de la facture",
      allAmounts: "All amounts shown in / Tous les montants sont en",
      lineItems: "Invoice line items / Postes de la facture",
      description: "DESCRIPTION",
      quantity: "QTY / QTÉ",
      unitPrice: "UNIT PRICE / PRIX UNITAIRE",
      tax: "TAX / TAXE",
      total: "TOTAL",
      subtotal: "Subtotal / Sous-total",
      discounts: "Discounts / Rabais",
      paymentProgress: "PAYMENT PROGRESS / PROGRÈS DES PAIEMENTS",
      paymentsReceived: "Payments received / Paiements reçus",
      depositsApplied: "Deposits applied / Dépôts appliqués",
      balanceDue: "Balance due / Solde dû",
      customerMessage: "CUSTOMER MESSAGE / MESSAGE AU CLIENT",
      notes: "NOTES",
      terms: "TERMS / MODALITÉS",
      paymentInstructions: "PAYMENT INSTRUCTIONS / INSTRUCTIONS DE PAIEMENT",
      signature: "SIGNATURE"
    };
  return {
    invoice: "INVOICE",
    issued: "Issued",
    due: "Due",
    currency: "Currency",
    businessNumber: "Business number",
    from: "FROM",
    billTo: "BILL TO",
    billToService: "BILL TO / SERVICE AT",
    serviceAddress: "Service address",
    invoiceCurrency: "Invoice currency",
    allAmounts: "All amounts shown in",
    lineItems: "Line items for invoice",
    description: "DESCRIPTION",
    quantity: "QTY",
    unitPrice: "UNIT PRICE",
    tax: "TAX",
    total: "Total",
    subtotal: "Subtotal",
    discounts: "Discounts",
    paymentProgress: "PAYMENT PROGRESS",
    paymentsReceived: "Payments received",
    depositsApplied: "Deposits applied",
    balanceDue: "Balance due",
    customerMessage: "CUSTOMER MESSAGE",
    notes: "NOTES",
    terms: "TERMS",
    paymentInstructions: "PAYMENT INSTRUCTIONS",
    signature: "SIGNATURE"
  };
}

function registrationLabel(
  registration: { readonly registrationType: string; readonly jurisdiction: string },
  language: DocumentLanguage
): string {
  const isGst = registration.registrationType === "GST_HST";
  const isQst = registration.registrationType === "QST";
  const english = isGst
    ? "GST/HST registration number"
    : isQst
      ? "QST registration number"
      : `${registration.registrationType} registration number`;
  const french = isGst
    ? "Numéro d'inscription TPS/TVH"
    : isQst
      ? "Numéro d'inscription TVQ"
      : `Numéro d'inscription ${registration.registrationType}`;
  if (language === "fr-CA") return french;
  if (language === "BILINGUAL") return `${english} / ${french}`;
  return english;
}

function readTaxRegistrations(snapshot: Prisma.JsonValue): readonly {
  registrationType: string;
  jurisdiction: string;
  registrationNumber: string;
}[] {
  const value = readValue(snapshot, "taxRegistrations");
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, Prisma.JsonValue>;
    const registrationType = record.registrationType;
    const jurisdiction = record.jurisdiction;
    const registrationNumber = record.registrationNumber;
    return typeof registrationType === "string" &&
      typeof jurisdiction === "string" &&
      typeof registrationNumber === "string"
      ? [{ registrationType, jurisdiction, registrationNumber }]
      : [];
  });
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function safePath(root: string, key: string): string {
  const path = resolve(root, key);
  const prefix = `${resolve(root)}${sep}`;
  if (!path.startsWith(prefix) || key.includes("..")) throw new Error("Unsafe storage key");
  return path;
}
