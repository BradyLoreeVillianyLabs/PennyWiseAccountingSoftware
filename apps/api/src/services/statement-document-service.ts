import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import PDFDocument from "pdfkit";
import { AuthorizationService } from "../auth/permissions.js";
import type { EmailProvider } from "./invoice-document-service.js";
import {
  Phase10ReportService,
  type CustomerStatementType,
  type ReportRange
} from "./phase10-report-service.js";

export interface StatementRequest extends ReportRange {
  readonly type: CustomerStatementType;
}

export class StatementDocumentService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly reports: Phase10ReportService,
    private readonly emailProvider: EmailProvider,
    private readonly emailDeliveryEnabled = false
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async generate(context: OrganizationContext, customerId: string, input: StatementRequest) {
    await this.authorization.assert(context, "receivables:read", "CustomerStatement", customerId);
    const report = await this.reports.customerStatement(context, customerId, input);
    const data = await renderStatementPdf(report, input.type);
    return {
      report,
      data: data.data,
      fileName: `customer-statement-${report.customerNumber}-${input.type.toLowerCase()}-${input.from}-${input.to}.pdf`
    };
  }

  public async send(
    context: OrganizationContext,
    customerId: string,
    input: StatementRequest & {
      readonly recipientEmail: string;
      readonly subject?: string | undefined;
      readonly message?: string | null | undefined;
    }
  ) {
    if (!this.emailDeliveryEnabled)
      throw new AppError(
        "EMAIL_DELIVERY_DISABLED",
        "Email delivery is not enabled for this installation.",
        409
      );
    const recipientEmail = normalizeEmail(input.recipientEmail);
    if (!recipientEmail)
      throw new AppError(
        "STATEMENT_RECIPIENT_INVALID",
        "A valid recipient email is required.",
        422
      );
    const generated = await this.generate(context, customerId, input);
    const subject = input.subject?.trim() || `Customer statement ${input.from} to ${input.to}`;
    const message =
      input.message?.trim() || "Please find the requested customer statement attached.";
    const result = await this.emailProvider.send({
      to: recipientEmail,
      subject,
      message,
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      requestId: context.requestId,
      pdf: generated.data
    });
    await this.recordCommunication(context, customerId, {
      channel: "EMAIL_PROVIDER",
      status: "SENT",
      recipientEmail,
      type: input.type,
      from: input.from,
      to: input.to,
      providerMessageId: result.providerMessageId
    });
    return {
      status: "SENT",
      recipientEmail,
      providerMessageId: result.providerMessageId,
      fileName: generated.fileName
    };
  }

  public async recordManualDelivery(
    context: OrganizationContext,
    customerId: string,
    input: StatementRequest & { readonly recipientEmail: string }
  ) {
    const recipientEmail = normalizeEmail(input.recipientEmail);
    if (!recipientEmail)
      throw new AppError(
        "STATEMENT_RECIPIENT_INVALID",
        "A valid recipient email is required.",
        422
      );
    const generated = await this.generate(context, customerId, input);
    await this.recordCommunication(context, customerId, {
      channel: "OWN_EMAIL_APP",
      status: "SENT",
      recipientEmail,
      type: input.type,
      from: input.from,
      to: input.to,
      providerMessageId: null
    });
    return { status: "MANUAL", recipientEmail, fileName: generated.fileName, data: generated.data };
  }

  private async recordCommunication(
    context: OrganizationContext,
    customerId: string,
    input: {
      readonly channel: string;
      readonly status: "SENT";
      readonly recipientEmail: string;
      readonly type: CustomerStatementType;
      readonly from: string;
      readonly to: string;
      readonly providerMessageId: string | null;
    }
  ) {
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.communication.create({
        data: {
          organizationId: context.organizationId,
          customerId,
          kind: "STATEMENT",
          channel: input.channel,
          deduplicationKey: `statement:${customerId}:${input.type}:${input.from}:${input.to}:${context.requestId}`,
          status: input.status,
          sentAt: new Date(),
          createdByUserId: context.user.id,
          payload: {
            recipientEmail: input.recipientEmail,
            type: input.type,
            from: input.from,
            to: input.to,
            providerMessageId: input.providerMessageId,
            requestId: context.requestId
          }
        }
      })
    );
  }
}

async function renderStatementPdf(
  report: {
    customerNumber: string;
    customerName: string;
    from: string;
    to: string;
    openingBalanceMinor?: string;
    closingActivityBalanceMinor: string;
    currency?: string;
    entries: readonly {
      date: string;
      type: string;
      reference: string | null;
      chargeMinor: string;
      creditMinor: string;
      runningBalanceMinor: string;
    }[];
  },
  type: CustomerStatementType
) {
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: false,
    info: {
      Title: `Customer statement ${report.customerNumber}`,
      Author: "PennyWise Accounting",
      Creator: "PennyWise Accounting statement renderer",
      CreationDate: new Date("2000-01-01T00:00:00.000Z"),
      ModDate: new Date("2000-01-01T00:00:00.000Z")
    },
    margin: 48,
    size: "LETTER"
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const addPage = () => {
    document.addPage({ margin: 48, size: "LETTER" });
    document.fontSize(20).fillColor("#15252a").text("Customer statement");
    document
      .moveDown(0.25)
      .fontSize(11)
      .fillColor("#42545a")
      .text(`${report.customerName} (${report.customerNumber})`);
    document
      .fontSize(10)
      .text(`${type === "OPEN_ITEM" ? "Open item" : "Activity"} · ${report.from} to ${report.to}`);
    document.moveDown(1);
  };
  const ensureSpace = (height: number) => {
    if (document.y + height > document.page.height - 54) addPage();
  };
  addPage();
  const currency = report.currency ?? "CAD";
  document
    .fontSize(10)
    .fillColor("#42545a")
    .text(`Opening balance: ${formatMinor(report.openingBalanceMinor ?? "0", currency)}`);
  document.text(`Closing balance: ${formatMinor(report.closingActivityBalanceMinor, currency)}`);
  document.moveDown(1);
  document.font("Helvetica-Bold").fillColor("#15252a").text("Date", 48, document.y, { width: 76 });
  document.text("Type", 124, document.y, { width: 98 });
  document.text("Reference", 222, document.y, { width: 128 });
  document.text("Charge", 350, document.y, { width: 78, align: "right" });
  document.text("Credit", 428, document.y, { width: 78, align: "right" });
  document.text("Balance", 506, document.y, { width: 58, align: "right" });
  document
    .moveDown(0.35)
    .moveTo(48, document.y)
    .lineTo(564, document.y)
    .strokeColor("#cad6d8")
    .stroke();
  document.font("Helvetica").fillColor("#15252a");
  for (const entry of report.entries) {
    ensureSpace(22);
    const y = document.y + 4;
    document.text(entry.date, 48, y, { width: 76 });
    document.text(entry.type, 124, y, { width: 98 });
    document.text(entry.reference ?? "", 222, y, { width: 128 });
    document.text(formatMinor(entry.chargeMinor, currency), 350, y, { width: 78, align: "right" });
    document.text(formatMinor(entry.creditMinor, currency), 428, y, { width: 78, align: "right" });
    document.text(formatMinor(entry.runningBalanceMinor, currency), 506, y, {
      width: 58,
      align: "right"
    });
    document.moveDown(0.7);
  }
  document.end();
  const data = await completed;
  return { data, pageCount: document.bufferedPageRange().count };
}

function formatMinor(value: string, currency: string) {
  const amount = Number(BigInt(value)) / 100;
  return `${currency} ${amount.toFixed(2)}`;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
