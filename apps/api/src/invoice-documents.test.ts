import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildInvoiceRenderData,
  DeterministicPdfRenderer,
  assertCustomerFacingPaymentUrl,
  formatMinor,
  pdfSafeText,
  renderDataHash,
  renderInvoiceHtml,
  resolveInvoiceDesignTokens,
  type InvoiceRenderAsset,
  type InvoiceRenderData
} from "./services/invoice-render-service.js";
import {
  defaultInvoiceTemplate,
  listInvoiceTemplates,
  validateTemplateConfiguration
} from "./services/invoice-template-service.js";

function source(lineCount = 1, currency = "CAD") {
  return {
    organizationSnapshot: {
      legalName: "Northwind Services Ltd.",
      displayName: "Northwind",
      address: {
        line1: "1 Main Street",
        city: "Calgary",
        province: "AB",
        postalCode: "T2P 1J9",
        countryCode: "CA"
      },
      businessNumber: "BN-123"
    },
    customerNameSnapshot: "<customer> & customer",
    customerEmailSnapshot: "customer@example.test",
    billingAddressSnapshot: { line1: "2 Main Street", city: "Calgary", province: "AB" },
    serviceAddressSnapshot: { line1: "3 Jobsite Road", city: "Airdrie", province: "AB" },
    invoiceNumber: "INV-0001",
    provisionalIdentifier: "draft-1",
    issueDate: new Date("2026-01-01T00:00:00.000Z"),
    dueDate: new Date("2026-01-31T00:00:00.000Z"),
    currency,
    subtotalMinor: 50_000_000_000n,
    discountTotalMinor: 100n,
    taxTotalMinor: 2_495_000_000n,
    grandTotalMinor: 52_494_999_900n,
    amountPaidMinor: 0n,
    customerFacingNotes: "<script>bad()</script>",
    terms: "Pay within 30 days.",
    lines: Array.from({ length: lineCount }, (_, index) => ({
      description:
        index === 0
          ? "<img src=x onerror=alert(1)>"
          : `Line ${index.toString()} - field service and materials`,
      quantityMicros: 1_000_000n,
      unitPriceMinor: 50_000_000_000n,
      netAmountMinor: 50_000_000_000n,
      taxTotalMinor: 2_495_000_000n,
      totalMinor: 52_495_000_000n
    }))
  };
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function logoAsset(id = "11111111-1111-4111-8111-111111111111"): InvoiceRenderAsset {
  return {
    id,
    mediaType: "image/png",
    checksum: createHash("sha256").update(png).digest("hex"),
    width: 1,
    height: 1,
    data: png
  };
}

describe("premium invoice rendering", () => {
  it("keeps eight polished named themes with constrained design choices", () => {
    expect(listInvoiceTemplates()).toHaveLength(8);
    expect(listInvoiceTemplates().map((item) => item.key)).toEqual([
      "clean-professional",
      "contractor",
      "ranch-agriculture",
      "retail",
      "creative",
      "modern",
      "minimal",
      "service-professional"
    ]);
    expect(
      new Set(listInvoiceTemplates().map((item) => item.defaultConfiguration.fontPairing)).size
    ).toBeGreaterThanOrEqual(4);
    expect(
      new Set(listInvoiceTemplates().map((item) => item.defaultConfiguration.spacing))
    ).toEqual(new Set(["compact", "comfortable", "airy"]));
  });

  it("renders hostile text as text in accessible semantic HTML", () => {
    const data = buildInvoiceRenderData(source());
    const html = renderInvoiceHtml(data, true);

    expect(html).toContain('<main class="invoice"');
    expect(html).toContain('<table><caption class="sr-only">');
    expect(html).toContain('<th scope="row">&lt;img src=x onerror=alert(1)&gt;</th>');
    expect(html).toContain("<address>");
    expect(html).toContain('<time datetime="2026-01-01">');
    expect(html).toContain('<abbr title="Currency">Currency</abbr>: CAD');
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });

  it("keeps internal draft identifiers out of customer-facing invoice headers", () => {
    const data = buildInvoiceRenderData({ ...source(), invoiceNumber: null });
    const html = renderInvoiceHtml(data, true);

    expect(data.invoice.number).toBe("DRAFT");
    expect(html).toContain(">DRAFT<");
    expect(html).not.toContain("draft-1");
  });

  it("renders only the documented rich-text markers in customer-facing sections", async () => {
    const data = buildInvoiceRenderData({
      ...source(),
      customerFacingNotes:
        "## Before your appointment\n**Please bring** _photo ID_.\n- Park at the rear entrance\n- Quote `INV-0001`\n<script>not markup</script>"
    });
    const html = renderInvoiceHtml(data, true);
    const pdf = await new DeterministicPdfRenderer().render(data);

    expect(html).toContain('<h3 class="document-rich-heading">Before your appointment</h3>');
    expect(html).toContain("<strong>Please bring</strong> <em>photo ID</em>.");
    expect(html).toContain("<li>Park at the rear entrance</li>");
    expect(html).toContain("<code>INV-0001</code>");
    expect(html).toContain("&lt;script&gt;not markup&lt;/script&gt;");
    expect(html).not.toContain("<script>not markup</script>");
    expect(pdf.data.subarray(0, 8).toString("ascii")).toContain("%PDF-1.7");
  });

  it("prints Canadian tax registrations and bilingual labels from the immutable snapshot", () => {
    const original = source();
    const data = buildInvoiceRenderData({
      ...original,
      organizationSnapshot: {
        ...original.organizationSnapshot,
        documentLanguage: "BILINGUAL",
        taxRegistrations: [
          {
            registrationType: "GST_HST",
            jurisdiction: "CA",
            registrationNumber: "123456789RT0001"
          },
          { registrationType: "QST", jurisdiction: "QC", registrationNumber: "1234567890TQ0001" }
        ]
      }
    });
    const html = renderInvoiceHtml(data, true);
    expect(data.languageMode).toBe("BILINGUAL");
    expect(html).toContain("123456789RT0001");
    expect(html).toContain("1234567890TQ0001");
    expect(html).toContain("INVOICE / FACTURE");
    expect(html).toContain("GST/HST registration number / Numéro d&#39;inscription TPS/TVH");
    const french = buildInvoiceRenderData({
      ...original,
      customerDocumentLanguageSnapshot: "fr-CA"
    });
    expect(renderInvoiceHtml(french, true)).toContain(">FACTURE<");
  });

  it("renders structured offline payment instructions and an invoice reference in HTML and PDF", async () => {
    const data = buildInvoiceRenderData({
      ...source(),
      paymentInstructionsSnapshot: {
        legacyInstructions: "Please do not include confidential information.",
        methods: [
          {
            key: "E_TRANSFER",
            position: 0,
            recipientEmail: "payments@example.test",
            autodeposit: true
          }
        ]
      }
    });
    const html = renderInvoiceHtml(data, true);
    const pdf = await new DeterministicPdfRenderer().render(data);
    expect(html).toContain("How to pay");
    expect(html).toContain("Interac e-Transfer");
    expect(html).toContain("payments@example.test");
    expect(html).toContain("INV-0001");
    expect(pdf.data.subarray(0, 8).toString("ascii")).toContain("%PDF-1.7");
    expect(pdf.pageCount).toBeGreaterThanOrEqual(1);
    expect(renderDataHash(data)).toBe(renderDataHash({ ...data }));
  });

  it("renders a durable provider link and refuses loopback or private hosts", () => {
    const data = buildInvoiceRenderData({
      ...source(),
      durablePaymentLink: {
        provider: "STRIPE",
        url: "https://checkout.stripe.com/pay/test-link"
      }
    });
    const html = renderInvoiceHtml(data, true);
    expect(html).toContain("Pay securely online");
    expect(html).toContain("https://checkout.stripe.com/pay/test-link");
    expect(() => assertCustomerFacingPaymentUrl("http://127.0.0.1:3001/pay/test")).toThrow(
      /public provider host/i
    );
    expect(() =>
      renderInvoiceHtml({
        ...data,
        durablePaymentLink: { provider: "SQUARE", url: "https://192.168.1.10/pay/test" }
      })
    ).toThrow(/public provider host/i);
  });

  it("uses the same immutable asset snapshot and design tokens for HTML and PDF", async () => {
    const logo = logoAsset();
    const configuration = {
      ...defaultInvoiceTemplate().defaultConfiguration,
      logoAssetId: logo.id,
      primaryColor: "#1f4e79",
      accentColor: "#d9eaf7"
    };
    const data = buildInvoiceRenderData(source(), "clean-professional", 1, configuration, {
      logo: {
        id: logo.id,
        mediaType: logo.mediaType,
        checksum: logo.checksum,
        width: logo.width,
        height: logo.height
      },
      headerImage: null
    });
    const assets = { logo, headerImage: null };
    const html = renderInvoiceHtml(data, false, assets);
    const pdf = await new DeterministicPdfRenderer().render(data, assets);
    const tokens = resolveInvoiceDesignTokens(data);

    expect(html).toContain(`--primary:${tokens.primary}`);
    expect(html).toContain(`data:${logo.mediaType};base64,${png.toString("base64")}`);
    expect(pdf.data.subarray(0, 8).toString("ascii")).toContain("%PDF-1.7");
    expect(pdf.data.includes(png)).toBe(false); // PDFKit embeds a normalized image stream.
    expect(pdf.pageCount).toBe(1);
  });

  it("applies controlled typography and a print-safe image watermark through the shared renderer", async () => {
    const background = logoAsset("22222222-2222-4222-8222-222222222222");
    const configuration = {
      ...defaultInvoiceTemplate().defaultConfiguration,
      headerImageAssetId: background.id,
      headingFontSize: 36,
      bodyFontSize: 12,
      tableFontSize: 10,
      notesFontSize: 11,
      backgroundTreatment: "image-watermark" as const
    };
    const data = buildInvoiceRenderData(source(), "clean-professional", 1, configuration, {
      logo: null,
      headerImage: {
        id: background.id,
        mediaType: background.mediaType,
        checksum: background.checksum,
        width: background.width,
        height: background.height
      }
    });
    const assets = { logo: null, headerImage: background };
    const html = renderInvoiceHtml(data, false, assets);
    const pdf = await new DeterministicPdfRenderer().render(data, assets);

    expect(resolveInvoiceDesignTokens(data)).toMatchObject({
      headingFontSize: 36,
      bodyFontSize: 12,
      tableFontSize: 10,
      notesFontSize: 11,
      backgroundTreatment: "image-watermark"
    });
    expect(html).toContain("--heading-font-size:36px");
    expect(html).toContain("--body-font-size:12px");
    expect(html).toContain('class="invoice-watermark"');
    expect(html).not.toContain('class="header-image"');
    expect(html).toContain("z-index:0");
    expect(pdf.data.subarray(0, 8).toString("ascii")).toContain("%PDF-1.7");
  });

  it("paginates a long line-item table and emits both A4 and Letter media boxes", async () => {
    const renderer = new DeterministicPdfRenderer();
    const letter = await renderer.render(buildInvoiceRenderData(source(85)));
    const a4Data = buildInvoiceRenderData(source(), defaultInvoiceTemplate().key, 1, {
      ...defaultInvoiceTemplate().defaultConfiguration,
      pageSize: "A4"
    });
    const a4 = await renderer.render(a4Data);

    expect(letter.pageCount).toBeGreaterThan(2);
    expect(
      (letter.data.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length
    ).toBeGreaterThanOrEqual(letter.pageCount);
    expect(letter.data.toString("latin1")).toContain("/MediaBox [0 0 612 792]");
    expect(a4.data.toString("latin1")).toMatch(/\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/);
  });

  it("formats CAD and USD from bigint minor units with explicit tax and currency clarity", () => {
    const cad = renderInvoiceHtml(buildInvoiceRenderData(source(1, "CAD")));
    const usd = renderInvoiceHtml(buildInvoiceRenderData(source(1, "USD")));

    expect(formatMinor("52494999900", "CAD")).toBe("CAD\u00a0524,949,999.00");
    expect(formatMinor("-105", "USD")).toBe("-USD\u00a01.05");
    expect(cad).toContain("Total (CAD)");
    expect(cad).toContain("CAD\u00a024,950,000.00");
    expect(usd).toContain("Total (USD)");
    expect(usd).toContain("USD\u00a024,950,000.00");
  });

  it("shows preserved payment and deposit progress without mutating money values", () => {
    const built = buildInvoiceRenderData(source());
    const data: InvoiceRenderData = {
      ...built,
      invoice: {
        ...built.invoice,
        amountPaidMinor: "1200",
        depositAppliedMinor: "300"
      }
    };
    const html = renderInvoiceHtml(data);

    expect(html).toContain("Payment progress");
    expect(html).toContain("Payments received");
    expect(html).toContain("Deposits applied");
    expect(html).toContain("CAD\u00a0524,949,984.00");
  });

  it("produces deterministic render hashes and byte-identical PDFs", async () => {
    const data = buildInvoiceRenderData(source(12));
    const renderer = new DeterministicPdfRenderer();
    const [first, second] = await Promise.all([renderer.render(data), renderer.render(data)]);

    expect(renderDataHash(data)).toMatch(/^[a-f0-9]{64}$/);
    expect(renderDataHash(data)).toBe(renderDataHash(structuredClone(data)));
    expect(first.data.equals(second.data)).toBe(true);
    expect(createHash("sha256").update(first.data).digest("hex")).toBe(
      createHash("sha256").update(second.data).digest("hex")
    );
  });

  it("uses readable deterministic fallbacks for unsupported Unicode glyphs", async () => {
    expect(pdfSafeText("Crème brûlée — 🚀")).toBe("Creme brulee - [U+1F680]");
    const data = buildInvoiceRenderData({
      ...source(),
      customerNameSnapshot: "Crème brûlée — 🚀"
    });
    const pdf = await new DeterministicPdfRenderer().render(data);

    expect(pdf.data.length).toBeGreaterThan(1_000);
    expect(pdf.data.toString("latin1")).not.toContain("????");
  });

  it("rejects malformed, mismatched, and tampered image assets", async () => {
    const logo = logoAsset();
    const configuration = {
      ...defaultInvoiceTemplate().defaultConfiguration,
      logoAssetId: logo.id
    };
    const data = buildInvoiceRenderData(source(), "clean-professional", 1, configuration, {
      logo: {
        id: logo.id,
        mediaType: logo.mediaType,
        checksum: logo.checksum,
        width: logo.width,
        height: logo.height
      },
      headerImage: null
    });
    const malformed = { ...logo, data: Buffer.from("not an image") };
    const tampered = { ...logo, checksum: "0".repeat(64) };

    await expect(
      new DeterministicPdfRenderer().render(data, { logo: malformed, headerImage: null })
    ).rejects.toMatchObject({ code: "INVOICE_RENDER_ASSET_INVALID" });
    expect(() => renderInvoiceHtml(data, false, { logo: tampered, headerImage: null })).toThrow(
      /integrity/i
    );
  });

  it("rejects unsafe design values before they can become HTML or PDF instructions", () => {
    expect(() =>
      validateTemplateConfiguration(defaultInvoiceTemplate(), {
        ...defaultInvoiceTemplate().defaultConfiguration,
        primaryColor: "#ffffff"
      })
    ).toThrow(/contrast/i);
    expect(() =>
      validateTemplateConfiguration(defaultInvoiceTemplate(), {
        ...defaultInvoiceTemplate().defaultConfiguration,
        spacing: "untrusted" as "airy"
      })
    ).toThrow(/spacing/i);
    expect(() =>
      validateTemplateConfiguration(defaultInvoiceTemplate(), {
        ...defaultInvoiceTemplate().defaultConfiguration,
        headingFontSize: 43
      })
    ).toThrow(/font size/i);
    expect(() =>
      validateTemplateConfiguration(defaultInvoiceTemplate(), {
        ...defaultInvoiceTemplate().defaultConfiguration,
        backgroundTreatment: "image-watermark"
      })
    ).toThrow(/background image/i);
  });
});
