import PDFDocument from "pdfkit";
import { pdfSafeText, type PdfRenderResult } from "./invoice-render-service.js";

export interface PickingSlipRenderLine {
  readonly description: string;
  readonly variantAttributes: string | null;
  readonly sku: string | null;
  readonly barcode: string;
  readonly quantity: string;
  readonly location: string;
  readonly bin: string | null;
  readonly image: Buffer | null;
}

export interface PickingSlipRenderData {
  readonly organizationName: string;
  readonly orderReference: string;
  readonly date: string;
  readonly customerName: string;
  readonly lines: readonly PickingSlipRenderLine[];
}

const pageMargin = 36;
const headerHeight = 92;
const imageColumnWidth = 82;

export async function renderPickingSlip(data: PickingSlipRenderData): Promise<PdfRenderResult> {
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: false,
    displayTitle: true,
    info: {
      Title: `Picking slip ${pdfSafeText(data.orderReference)}`,
      Author: pdfSafeText(data.organizationName),
      Subject: "Warehouse picking slip",
      Creator: "PennyWise Accounting",
      Producer: "PennyWise Accounting picking-slip renderer",
      CreationDate: new Date("2000-01-01T00:00:00.000Z"),
      ModDate: new Date("2000-01-01T00:00:00.000Z")
    },
    lang: "en-CA",
    layout: "portrait",
    margin: pageMargin,
    pdfVersion: "1.7",
    size: "LETTER"
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const hasImages = data.lines.some((line) => line.image !== null);
  const contentWidth = 540;
  let pageNumber = 0;
  let rowY = 0;
  const addPage = () => {
    document.addPage({ margin: pageMargin, size: "LETTER" });
    pageNumber += 1;
    document
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#17202a")
      .text("Picking slip", pageMargin, pageMargin, { lineBreak: false });
    document
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#4b5563")
      .text(pdfSafeText(data.organizationName), pageMargin, pageMargin + 28, {
        lineBreak: false,
        width: contentWidth * 0.55,
        ellipsis: true
      });
    document
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#17202a")
      .text(`Order: ${pdfSafeText(data.orderReference)}`, pageMargin, pageMargin + 48, {
        lineBreak: false,
        width: contentWidth * 0.55,
        ellipsis: true
      })
      .font("Helvetica")
      .fontSize(9)
      .text(`Date: ${pdfSafeText(data.date)}`, pageMargin, pageMargin + 64, {
        lineBreak: false,
        width: contentWidth * 0.55,
        ellipsis: true
      });
    document
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(
        `Customer: ${pdfSafeText(data.customerName)}`,
        pageMargin + contentWidth * 0.55,
        pageMargin + 48,
        {
          lineBreak: false,
          width: contentWidth * 0.45,
          align: "right",
          ellipsis: true
        }
      );
    const tableY = pageMargin + headerHeight;
    document
      .moveTo(pageMargin, tableY - 8)
      .lineTo(pageMargin + contentWidth, tableY - 8)
      .lineWidth(1)
      .strokeColor("#17202a")
      .stroke();
    document
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#4b5563")
      .text(hasImages ? "IMAGE" : "ITEM", pageMargin, tableY, {
        lineBreak: false,
        width: hasImages ? imageColumnWidth : contentWidth * 0.46
      })
      .text("DETAILS", pageMargin + (hasImages ? imageColumnWidth : 0), tableY, {
        lineBreak: false,
        width: contentWidth * 0.32
      })
      .text("QTY", pageMargin + contentWidth * 0.68, tableY, {
        lineBreak: false,
        width: contentWidth * 0.08,
        align: "right"
      })
      .text("BIN", pageMargin + contentWidth * 0.77, tableY, {
        lineBreak: false,
        width: contentWidth * 0.13,
        align: "right"
      })
      .text("CHECK", pageMargin + contentWidth * 0.91, tableY, {
        lineBreak: false,
        width: contentWidth * 0.09,
        align: "right"
      });
    rowY = tableY + 18;
  };
  addPage();
  for (const line of data.lines) {
    const rowHeight = line.image ? 82 : 58;
    if (rowY + rowHeight > document.page.height - pageMargin - 24) addPage();
    const detailsX = pageMargin + (hasImages ? imageColumnWidth : 0);
    const detailsWidth = contentWidth * 0.31;
    const dividerY = rowY + rowHeight - 8;
    document
      .moveTo(pageMargin, dividerY)
      .lineTo(pageMargin + contentWidth, dividerY)
      .lineWidth(0.5)
      .strokeColor("#d1d5db")
      .stroke();
    if (line.image)
      document.image(line.image, pageMargin + 4, rowY + 2, {
        fit: [imageColumnWidth - 8, 68],
        align: "center",
        valign: "center"
      });
    document
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#17202a")
      .text(pdfSafeText(line.description), detailsX, rowY + 3, {
        width: detailsWidth,
        height: 23,
        ellipsis: true,
        lineBreak: false
      });
    if (line.variantAttributes)
      document
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#374151")
        .text(pdfSafeText(line.variantAttributes), detailsX, rowY + 18, {
          width: detailsWidth,
          height: 20,
          ellipsis: true,
          lineBreak: false
        });
    const identity = [line.sku ? `SKU ${line.sku}` : null, `Barcode ${line.barcode}`]
      .filter((value): value is string => value !== null)
      .join("  |  ");
    document
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#4b5563")
      .text(pdfSafeText(identity), detailsX, rowY + (line.variantAttributes ? 33 : 20), {
        width: detailsWidth,
        height: 14,
        ellipsis: true,
        lineBreak: false
      });
    drawCode128(
      document,
      line.barcode,
      pageMargin + contentWidth * 0.45,
      rowY + 40,
      contentWidth * 0.2,
      24
    );
    document
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#17202a")
      .text(pdfSafeText(line.quantity), pageMargin + contentWidth * 0.68, rowY + 22, {
        width: contentWidth * 0.08,
        align: "right",
        lineBreak: false
      })
      .font("Helvetica")
      .fontSize(8)
      .text(pdfSafeText(line.location), pageMargin + contentWidth * 0.77, rowY + 14, {
        width: contentWidth * 0.13,
        align: "right",
        height: 22,
        ellipsis: true,
        lineBreak: false
      })
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(line.bin ? pdfSafeText(line.bin) : "-", pageMargin + contentWidth * 0.77, rowY + 32, {
        width: contentWidth * 0.13,
        align: "right",
        lineBreak: false
      });
    document
      .rect(pageMargin + contentWidth * 0.94, rowY + 20, 14, 14)
      .lineWidth(1)
      .strokeColor("#17202a")
      .stroke();
    rowY += rowHeight;
  }
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#6b7280")
      .text(
        `Operational document - no accounting or inventory quantity change  |  Page ${String(index + 1)} of ${String(range.count)}`,
        pageMargin,
        document.page.height - pageMargin - 12,
        {
          width: contentWidth,
          align: "center",
          lineBreak: false
        }
      );
  }
  document.end();
  return { data: await completed, pageCount: pageNumber };
}

export function code128BModules(value: string): readonly number[] {
  if (!value) return [];
  const values: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 0x20 || codePoint > 0x7e) return [];
    values.push(codePoint - 32);
  }
  const checksum = values.reduce((sum, current, index) => sum + current * (index + 1), 104) % 103;
  const symbolValues = [104, ...values, checksum, 106];
  return symbolValues.flatMap((symbol) => {
    const pattern = CODE128_PATTERNS[symbol];
    if (!pattern) return [];
    const modules: number[] = [];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern.charAt(index));
      for (let repeat = 0; repeat < width; repeat += 1) modules.push(index % 2 === 0 ? 1 : 0);
    }
    return modules;
  });
}

function drawCode128(
  document: InstanceType<typeof PDFDocument>,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const modules = code128BModules(value);
  if (!modules.length) return;
  const moduleWidth = width / modules.length;
  let cursor = x;
  for (const [index, filled] of modules.entries()) {
    if (filled === 1) document.rect(cursor, y, moduleWidth + 0.15, height).fill("#17202a");
    cursor += moduleWidth;
    if (index === modules.length - 1) break;
  }
}

// Code 128 symbol patterns, values 0 through 106. Each digit is one
// alternating bar/space width; the final stop symbol has seven widths.
const CODE128_PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112"
] as const;
