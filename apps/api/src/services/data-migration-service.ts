import { createHash, randomUUID } from "node:crypto";
import {
  parseMinorUnit,
  parseQuantityMicros,
  validateJournalLines
} from "@clearledger/accounting-core";
import {
  AccountType,
  Prisma,
  ProductItemType,
  withTenantTransaction,
  type DataImportSourceSystem,
  type DataImportType,
  type PrismaClient,
  type RuntimeTransaction
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate } from "../utils/dates.js";
import { normalizeHeader, parseMigrationFile } from "./data-import-parser.js";
import {
  nearestLocalCatalogSuggestions,
  normalizeCatalogIdentifier,
  type CatalogReviewSuggestion
} from "./catalog-mapping-service.js";
import type { AttachmentScanner } from "./invoice-document-service.js";
import type { DocumentStorage } from "./invoice-render-service.js";
import { InventoryService } from "./inventory-service.js";
import { InvoiceService } from "./invoice-service.js";
import { OpeningBalanceService } from "./opening-balance-service.js";
import { Phase10ReportService } from "./phase10-report-service.js";
import { PurchaseService } from "./purchase-service.js";
import { ReportService } from "./report-service.js";
import {
  assertCustomerAddress,
  customerAddressSchema,
  type NormalizedCustomerAddress
} from "./customer-address.js";

type MappedRow = Readonly<Record<string, string>>;

const financialTypes = new Set<DataImportType>([
  "OPENING_BALANCES",
  "OUTSTANDING_INVOICES",
  "OUTSTANDING_BILLS",
  "CUSTOMER_CREDITS",
  "VENDOR_CREDITS",
  "INVENTORY_OPENING"
]);

const sourceControlRequiredTypes = new Set<DataImportType>([
  "OPENING_BALANCES",
  "OUTSTANDING_INVOICES",
  "OUTSTANDING_BILLS",
  "INVENTORY_OPENING"
]);

export interface ImportSourceControlsInput {
  readonly sourceReportName: string;
  readonly sourceReportDate: string;
  readonly sourceReportChecksum?: string | undefined;
  readonly sourceDebitMinor?: string | undefined;
  readonly sourceCreditMinor?: string | undefined;
  readonly sourceBalanceMinor?: string | undefined;
}

const atomicImportTypes = new Set<DataImportType>([
  "CHART_OF_ACCOUNTS",
  "CUSTOMERS",
  "VENDORS",
  "PRODUCTS",
  "CUSTOMER_CREDITS",
  "VENDOR_CREDITS",
  "HISTORICAL_ARCHIVE"
]);
const importCommitLeaseMilliseconds = 5 * 60 * 1000;

const requiredFields: Readonly<Record<DataImportType, readonly string[]>> = {
  CHART_OF_ACCOUNTS: ["code", "name", "type"],
  CUSTOMERS: ["customer_number", "display_name"],
  VENDORS: ["vendor_number", "legal_name", "display_name"],
  PRODUCTS: ["name", "item_type", "sales_price_minor", "income_account_code"],
  OPENING_BALANCES: ["account_code", "debit_minor", "credit_minor", "effective_date"],
  OUTSTANDING_INVOICES: ["customer_number", "issue_date", "due_date", "amount_minor"],
  OUTSTANDING_BILLS: [
    "vendor_number",
    "vendor_invoice_number",
    "issue_date",
    "due_date",
    "amount_minor",
    "expense_account_code",
    "description"
  ],
  CUSTOMER_CREDITS: ["customer_number", "amount_minor", "effective_date"],
  VENDOR_CREDITS: ["vendor_number", "amount_minor", "effective_date"],
  INVENTORY_OPENING: ["sku", "quantity", "unit_cost_minor", "effective_date"],
  HISTORICAL_ARCHIVE: ["record_type", "external_id"]
};

const optionalFields: Readonly<Record<DataImportType, readonly string[]>> = {
  CHART_OF_ACCOUNTS: ["subtype", "is_control", "external_id"],
  CUSTOMERS: [
    "legal_name",
    "email",
    "payment_terms_days",
    "external_id",
    "billing_address_recipient_name",
    "billing_address_organization",
    "billing_address_line1",
    "billing_address_line2",
    "billing_address_city",
    "billing_address_subdivision_code",
    "billing_address_postal_code",
    "billing_address_country_code",
    "billing_address_phone",
    "billing_address_email",
    "shipping_address_recipient_name",
    "shipping_address_organization",
    "shipping_address_line1",
    "shipping_address_line2",
    "shipping_address_city",
    "shipping_address_subdivision_code",
    "shipping_address_postal_code",
    "shipping_address_country_code",
    "shipping_address_phone",
    "shipping_address_email",
    "service_address_recipient_name",
    "service_address_organization",
    "service_address_line1",
    "service_address_line2",
    "service_address_city",
    "service_address_subdivision_code",
    "service_address_postal_code",
    "service_address_country_code",
    "service_address_phone",
    "service_address_email"
  ],
  VENDORS: ["email", "payment_terms_days", "external_id"],
  PRODUCTS: [
    "sku",
    "description",
    "unit_of_measure",
    "external_id",
    "hs_tariff_code",
    "country_of_origin"
  ],
  OPENING_BALANCES: ["note", "external_id"],
  OUTSTANDING_INVOICES: [
    "external_id",
    "description",
    "sku",
    "quantity",
    "unit_price_minor",
    "tax_amount_minor",
    "discount_amount_minor",
    "tax_code",
    "tax_code_id",
    "payment_terms_days",
    "terms",
    "memo"
  ],
  OUTSTANDING_BILLS: [
    "external_id",
    "sku",
    "quantity",
    "unit_cost_minor",
    "discount_amount_minor",
    "tax_amount_minor",
    "tax_code",
    "tax_code_id",
    "memo",
    "payment_terms_days",
    "terms"
  ],
  CUSTOMER_CREDITS: ["external_id"],
  VENDOR_CREDITS: ["external_id"],
  INVENTORY_OPENING: ["external_id"],
  HISTORICAL_ARCHIVE: ["occurred_at"]
};

const aliases: Readonly<Record<string, readonly string[]>> = {
  code: ["code", "account_code", "account_number", "account_no", "number"],
  name: [
    "name",
    "account_name",
    "account_title",
    "account_description",
    "item_name",
    "product_name",
    "service_name",
    "description"
  ],
  customer_number: [
    "customer_number",
    "customer_no",
    "customer_id",
    "customer_code",
    "customer",
    "customer_name",
    "contact_code",
    "contact_name",
    "client_id",
    "client_name",
    "name"
  ],
  vendor_number: [
    "vendor_number",
    "vendor_no",
    "vendor_id",
    "vendor_code",
    "vendor",
    "vendor_name",
    "supplier_id",
    "supplier_code",
    "supplier",
    "supplier_name",
    "name"
  ],
  display_name: [
    "display_name",
    "displayname",
    "company",
    "company_name",
    "customer_name",
    "contact_name",
    "client_name",
    "vendor_name",
    "supplier_name",
    "name"
  ],
  legal_name: [
    "legal_name",
    "company",
    "company_name",
    "customer_name",
    "contact_name",
    "client_name",
    "vendor_name",
    "supplier_name",
    "display_name",
    "name"
  ],
  email: ["email", "email_address", "contact_email", "e_mail"],
  item_type: ["item_type", "type", "product_service_type", "item_type_name"],
  sales_price_minor: [
    "sales_price_minor",
    "sales_price",
    "price_minor",
    "price",
    "rate",
    "unit_price",
    "sales_rate"
  ],
  income_account_code: [
    "income_account_code",
    "income_account",
    "sales_account",
    "sales_account_code",
    "revenue_account",
    "account_code"
  ],
  expense_account_code: [
    "expense_account_code",
    "expense_account",
    "account_code",
    "nominal_code",
    "account"
  ],
  account_code: [
    "account_code",
    "account_number",
    "account_no",
    "nominal_code",
    "account",
    "number"
  ],
  debit_minor: ["debit_minor", "debit"],
  credit_minor: ["credit_minor", "credit"],
  effective_date: ["effective_date", "date", "as_of_date"],
  issue_date: [
    "issue_date",
    "transaction_date",
    "invoice_date",
    "bill_date",
    "document_date",
    "date_issued",
    "txn_date",
    "date"
  ],
  due_date: ["due_date", "due", "due_on", "payment_due_date", "invoice_due_date"],
  amount_minor: [
    "amount_minor",
    "open_balance_minor",
    "open_balance",
    "line_amount",
    "item_total",
    "amount",
    "total"
  ],
  vendor_invoice_number: [
    "vendor_invoice_number",
    "vendor_invoice_no",
    "bill_number",
    "bill_no",
    "invoice_number",
    "invoice_no",
    "reference_number",
    "ref_no",
    "reference"
  ],
  external_id: [
    "external_id",
    "id",
    "transaction_id",
    "invoice_number",
    "invoice_no",
    "document_number",
    "document_id",
    "bill_number",
    "bill_no"
  ],
  description: [
    "description",
    "memo",
    "line_description",
    "item_description",
    "details",
    "service_description"
  ],
  memo: ["memo", "description", "invoice_memo", "reference", "notes", "details"],
  sku: [
    "sku",
    "item",
    "item_code",
    "item_number",
    "item_id",
    "item_name",
    "product",
    "product_code",
    "product_id",
    "product_name",
    "service_code",
    "service_name"
  ],
  quantity: ["quantity", "qty", "qty_sold", "units", "unit_count", "hours", "count"],
  unit_price_minor: [
    "unit_price_minor",
    "unit_price",
    "unit_cost",
    "rate",
    "price",
    "sales_price_minor",
    "sales_price"
  ],
  unit_cost_minor: ["unit_cost_minor", "unit_cost", "unit_price", "rate", "cost", "price"],
  tax_amount_minor: [
    "tax_amount_minor",
    "tax_amount",
    "tax_total",
    "tax_value",
    "sales_tax",
    "gst",
    "hst",
    "pst",
    "vat",
    "tax"
  ],
  discount_amount_minor: [
    "discount_amount_minor",
    "discount_amount",
    "discount_total",
    "discount_value",
    "discount"
  ],
  tax_code: ["tax_code", "tax_rate_code", "tax_rate", "tax_name", "tax_type"],
  tax_code_id: ["tax_code_id", "tax_id"],
  payment_terms_days: ["payment_terms_days", "terms_days", "payment_days", "net_days"],
  terms: ["terms", "payment_terms", "terms_name", "payment_terms_name"],
  unit_of_measure: ["unit_of_measure", "unit", "uom"],
  hs_tariff_code: ["hs_tariff_code", "hs_code", "harmonized_system_code", "tariff_code"],
  country_of_origin: ["country_of_origin", "origin_country", "made_in_country", "origin"],
  record_type: ["record_type", "transaction_type", "type"]
};

export class DataMigrationService {
  private readonly authorization: AuthorizationService;
  private readonly purchases: PurchaseService;
  private readonly invoices: InvoiceService;
  private readonly openingBalances: OpeningBalanceService;
  private readonly inventory: InventoryService;
  private readonly reports: Phase10ReportService;
  private readonly ledgerReports: ReportService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage,
    private readonly scanner: AttachmentScanner
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.purchases = new PurchaseService(prisma);
    this.invoices = new InvoiceService(prisma);
    this.openingBalances = new OpeningBalanceService(prisma);
    this.inventory = new InventoryService(prisma);
    this.reports = new Phase10ReportService(prisma);
    this.ledgerReports = new ReportService(prisma);
  }

  public async list(
    context: OrganizationContext,
    importType: DataImportType,
    limit = 10
  ): Promise<readonly Record<string, unknown>[]> {
    await this.assertImportPermission(context, importType, false);
    const companyId = context.companyId;
    if (!companyId)
      throw new AppError(
        "IMPORT_COMPANY_REQUIRED",
        "Select a company before reviewing import history.",
        422
      );
    const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
    const batches = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportBatch.findMany({
        where: { organizationId: context.organizationId, companyId, importType },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: boundedLimit,
        select: {
          id: true,
          importType: true,
          sourceSystem: true,
          status: true,
          sourceFilename: true,
          byteSize: true,
          checksum: true,
          committedAt: true,
          acknowledgedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { rows: true } }
        }
      })
    );
    return batches.map(({ _count, ...batch }) => ({ ...batch, rowCount: _count.rows }));
  }

  public async upload(
    context: OrganizationContext,
    input: {
      importType: DataImportType;
      sourceSystem: DataImportSourceSystem;
      fileName: string;
      mediaType: string;
      data: Buffer;
    }
  ) {
    await this.assertImportPermission(context, input.importType, false);
    const companyId = context.companyId;
    if (!companyId) {
      throw new AppError(
        "IMPORT_COMPANY_REQUIRED",
        "Select a company before uploading an import file.",
        422
      );
    }
    const parsed = await parseMigrationFile(input.fileName, input.mediaType, input.data);
    if ((await this.scanner.scan(input.data, input.mediaType)) !== "CLEAN")
      throw new AppError(
        "IMPORT_MALWARE_REJECTED",
        "The migration file failed safety scanning.",
        422
      );
    const checksum = createHash("sha256").update(input.data).digest("hex");
    const existing = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportBatch.findUnique({
        where: {
          organizationId_companyId_importType_checksum: {
            organizationId: context.organizationId,
            companyId,
            importType: input.importType,
            checksum
          }
        },
        include: { rows: { orderBy: { rowNumber: "asc" } } }
      })
    );
    if (existing) {
      assertReplaySourceSystem(existing.sourceSystem, input.sourceSystem);
      return batchDto(existing);
    }
    // The content-addressed key makes concurrent replays safe for object storage too.
    const id = randomUUID();
    const storageKey = `imports/${context.organizationId}/${input.importType}/${checksum}/source${migrationFileExtension(input.fileName)}`;
    await this.storage.put(storageKey, input.data, input.mediaType);
    try {
      const batch = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await tx.dataImportBatch.create({
          data: {
            id,
            organizationId: context.organizationId,
            companyId,
            importType: input.importType,
            sourceSystem: input.sourceSystem,
            sourceFilename: safeFileName(input.fileName),
            storageKey,
            mediaType: input.mediaType,
            byteSize: input.data.length,
            checksum,
            sourceMetadata: parsed.metadata ?? Prisma.JsonNull,
            createdByUserId: context.user.id
          }
        });
        await tx.dataImportRow.createMany({
          data: parsed.rows.map((source) => ({
            organizationId: context.organizationId,
            companyId,
            batchId: id,
            rowNumber: source.rowNumber,
            rawData: source.values
          }))
        });
        const row = await tx.dataImportBatch.findUniqueOrThrow({
          where: { id },
          include: { rows: { orderBy: { rowNumber: "asc" } } }
        });
        await audit(tx, context, "DATA_IMPORT_UPLOADED", "DataImportBatch", row.id, {
          importType: row.importType,
          sourceSystem: row.sourceSystem,
          checksum,
          rowCount: parsed.rows.length
        });
        return row;
      });
      return batchDto(batch);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
        throw error;
      const replay = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.dataImportBatch.findUnique({
          where: {
            organizationId_companyId_importType_checksum: {
              organizationId: context.organizationId,
              companyId,
              importType: input.importType,
              checksum
            }
          },
          include: { rows: { orderBy: { rowNumber: "asc" } } }
        })
      );
      if (replay) {
        assertReplaySourceSystem(replay.sourceSystem, input.sourceSystem);
        return batchDto(replay);
      }
      throw error;
    }
  }

  public async preview(
    context: OrganizationContext,
    batchId: string,
    mapping: Readonly<Record<string, string>>
  ) {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, false);
    if (["COMMITTED", "RECONCILED", "COMPENSATION_REQUIRED"].includes(batch.status))
      throw new AppError("IMPORT_FINALIZED", "Finalized imports cannot be remapped.", 409);
    const mapped = mapAndValidate(batch.importType, batch.rows, mapping);
    const errorReport = mapped.flatMap((row) =>
      row.errors.map((error) => ({
        row: row.rowNumber,
        field: error.field,
        message: error.message
      }))
    );
    const { updated, itemMatchSuggestions } = await withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        for (const row of mapped) {
          await tx.dataImportRow.update({
            where: { id: row.id },
            data: {
              mappedData: row.values,
              externalId: row.values.external_id || null,
              status: row.errors.length ? "INVALID" : "VALID",
              errors: row.errors.length ? row.errors : Prisma.JsonNull
            }
          });
        }
        const result = await tx.dataImportBatch.update({
          where: { id: batch.id },
          data: {
            status: errorReport.length ? "VALIDATED" : "PREVIEWED",
            mapping,
            errorReport
          },
          include: { rows: { orderBy: { rowNumber: "asc" } } }
        });
        const itemMatchSuggestions = await spreadsheetItemMatchSuggestions(
          tx,
          context.organizationId,
          requiredImportCompanyId(context),
          batch.importType,
          mapped
        );
        await audit(tx, context, "DATA_IMPORT_PREVIEWED", "DataImportBatch", batch.id, {
          validRows: mapped.filter((row) => row.errors.length === 0).length,
          errorCount: errorReport.length,
          itemMatchRowsEvaluated: itemMatchSuggestions?.evaluatedRowCount ?? 0,
          itemMatchRowsDeferred: itemMatchSuggestions?.deferredRowCount ?? 0
        });
        return { updated: result, itemMatchSuggestions };
      }
    );
    return itemMatchSuggestions
      ? { ...batchDto(updated), itemMatchSuggestions }
      : batchDto(updated);
  }

  public async dryRun(context: OrganizationContext, batchId: string) {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, true);
    if (batch.rows.some((row) => row.status !== "VALID"))
      throw new AppError("IMPORT_ERRORS_PRESENT", "Resolve every row error before dry run.", 409);
    await this.validateDependencies(context, batch.importType, batch.rows.map(mappedData));
    const updated = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.dataImportBatch.update({
        where: { id: batch.id },
        data: { status: "DRY_RUN" },
        include: { rows: { orderBy: { rowNumber: "asc" } } }
      });
      await audit(tx, context, "DATA_IMPORT_DRY_RUN", "DataImportBatch", batch.id, {
        rowCount: batch.rows.length
      });
      return result;
    });
    return batchDto(updated);
  }

  public async itemMatchSuggestions(
    context: OrganizationContext,
    batchId: string,
    input: { readonly offset: number; readonly limit: number }
  ): Promise<SpreadsheetItemMatchSuggestions> {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, false);
    if (batch.importType !== "PRODUCTS" && batch.importType !== "INVENTORY_OPENING")
      throw new AppError(
        "IMPORT_ITEM_MATCH_NOT_APPLICABLE",
        "Item match suggestions are available only for product and opening-inventory imports.",
        422
      );
    const mapped = batch.rows.map((row) => ({
      rowNumber: row.rowNumber,
      values: mappedData(row)
    }));
    const suggestions = await withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      spreadsheetItemMatchSuggestions(
        tx,
        context.organizationId,
        requiredImportCompanyId(context),
        batch.importType,
        mapped,
        input.offset,
        input.limit
      )
    );
    if (!suggestions)
      throw new AppError(
        "IMPORT_ITEM_MATCH_NOT_APPLICABLE",
        "Item match suggestions are unavailable for this import.",
        422
      );
    return suggestions;
  }

  public async commit(context: OrganizationContext, batchId: string) {
    return this.commitOrResume(context, batchId, false);
  }

  public async resume(context: OrganizationContext, batchId: string) {
    return this.commitOrResume(context, batchId, true);
  }

  public async attempts(context: OrganizationContext, batchId: string) {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, false);
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportCommitAttempt.findMany({
        where: {
          organizationId: context.organizationId,
          companyId: batch.companyId,
          batchId: batch.id
        },
        orderBy: [{ startedAt: "asc" }, { unitKey: "asc" }]
      })
    );
  }

  private async commitOrResume(context: OrganizationContext, batchId: string, resume: boolean) {
    const initial = await this.batch(context, batchId);
    await this.assertImportPermission(context, initial.importType, true);
    if (["COMMITTED", "RECONCILED"].includes(initial.status)) return batchDto(initial);
    const now = new Date();
    const staleCommitting =
      initial.status === "COMMITTING" &&
      initial.commitLeaseExpiresAt !== null &&
      initial.commitLeaseExpiresAt.getTime() <= now.getTime();
    if (
      (!resume && initial.status !== "DRY_RUN") ||
      (resume && initial.status !== "RETRYABLE" && !staleCommitting)
    )
      throw new AppError("IMPORT_DRY_RUN_REQUIRED", "A successful dry run is required.", 409);
    const leaseExpiresAt = new Date(now.getTime() + importCommitLeaseMilliseconds);
    const claimed = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.dataImportBatch.updateMany({
        where: {
          id: batchId,
          organizationId: context.organizationId,
          ...(resume
            ? {
                OR: [
                  { status: "RETRYABLE" },
                  { status: "COMMITTING", commitLeaseExpiresAt: { lte: now } }
                ]
              }
            : { status: "DRY_RUN" })
        },
        data: {
          status: "COMMITTING",
          commitStartedAt: now,
          commitLeaseExpiresAt: leaseExpiresAt,
          errorReport: Prisma.DbNull
        }
      });
      return result.count;
    });
    if (claimed !== 1) {
      const current = await this.batch(context, batchId);
      if (["COMMITTED", "RECONCILED"].includes(current.status)) return batchDto(current);
      throw new AppError(
        "IMPORT_COMMIT_IN_PROGRESS",
        "This import is already being committed.",
        409
      );
    }
    let imported = initial.rows.filter((row) => row.status === "IMPORTED").length;
    try {
      if (atomicImportTypes.has(initial.importType))
        return await this.commitAtomicRows(context, initial);
      if (initial.importType === "OPENING_BALANCES") {
        if (imported !== initial.rows.length) {
          const posted = await this.commitOpeningBalanceUnit(context, initial);
          await this.markRowsImported(
            context,
            initial,
            initial.rows.map((row) => row.id),
            "OpeningBalanceDraft",
            posted.resourceId
          );
          imported = initial.rows.length;
        }
      } else if (initial.importType === "OUTSTANDING_INVOICES") {
        imported = await this.commitOutstandingInvoices(context, initial, (count) => {
          imported = count;
        });
      } else if (initial.importType === "OUTSTANDING_BILLS") {
        imported = await this.commitOutstandingBills(context, initial, (count) => {
          imported = count;
        });
      } else {
        for (const row of initial.rows) {
          if (row.status === "IMPORTED") continue;
          const unitKey = `row:${String(row.rowNumber)}`;
          const attempt = await this.beginAttempt(
            context,
            initial,
            unitKey,
            initial.importType.toLowerCase()
          );
          if (attempt.status === "SUCCEEDED" && attempt.resourceType && attempt.resourceId) {
            await this.markRowsImported(
              context,
              initial,
              [row.id],
              attempt.resourceType,
              attempt.resourceId
            );
            imported += 1;
            continue;
          }
          let created: { type: string; id: string };
          try {
            created = await this.commitRow(context, initial.importType, row);
            await this.completeAttempt(context, attempt.id, created.type, created.id);
          } catch (error) {
            await this.failAttempt(context, attempt.id, error);
            throw error;
          }
          imported += 1;
          await this.markRowsImported(context, initial, [row.id], created.type, created.id);
        }
      }
      const reconciliation = await this.reconciliation(
        context,
        initial.importType,
        imported,
        initial.rows.map(mappedData),
        initial.sourceControls
      );
      const result = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const row = await tx.dataImportBatch.update({
          where: { id: initial.id },
          data: {
            status: "COMMITTED",
            committedAt: new Date(),
            commitLeaseExpiresAt: null,
            reconciliation
          },
          include: { rows: { orderBy: { rowNumber: "asc" } } }
        });
        await audit(tx, context, "DATA_IMPORT_COMMITTED", "DataImportBatch", initial.id, {
          imported,
          reconciliation
        });
        return row;
      });
      return batchDto(result);
    } catch (error) {
      const normalizedError = normalizeCommitError(error);
      await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await tx.dataImportBatch.update({
          where: { id: initial.id },
          data: {
            status: atomicImportTypes.has(initial.importType) ? "FAILED" : "RETRYABLE",
            commitLeaseExpiresAt: null,
            errorReport: {
              code:
                normalizedError instanceof AppError ? normalizedError.code : "IMPORT_COMMIT_FAILED",
              message:
                normalizedError instanceof Error
                  ? normalizedError.message
                  : "Import commit failed.",
              importedRows: imported,
              strategy: atomicImportTypes.has(initial.importType)
                ? "No domain rows were committed. Correct the source or mapping and run the dry run again."
                : "Use Resume import. PennyWise will continue deterministic commit units and will not repost completed units."
            }
          }
        });
        await audit(tx, context, "DATA_IMPORT_FAILED", "DataImportBatch", initial.id, {
          importedRows: imported,
          retryable: !atomicImportTypes.has(initial.importType)
        });
      });
      throw normalizedError;
    }
  }

  private async commitAtomicRows(
    context: OrganizationContext,
    batch: Awaited<ReturnType<DataMigrationService["batch"]>>
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.$queryRaw`
        SELECT id
          FROM "DataImportBatch"
         WHERE id = ${batch.id}::uuid
           AND "organizationId" = ${context.organizationId}::uuid
         FOR UPDATE
      `;
      const current = await tx.dataImportBatch.findFirstOrThrow({
        where: {
          id: batch.id,
          organizationId: context.organizationId,
          status: "COMMITTING"
        }
      });
      let imported = 0;
      for (const row of batch.rows) {
        const created = await this.commitAtomicRow(tx, context, batch.importType, row);
        await tx.dataImportRow.update({
          where: { id: row.id },
          data: {
            status: "IMPORTED",
            createdResourceType: created.type,
            createdResourceId: created.id
          }
        });
        imported += 1;
      }
      const reconciliation = nonPostingReconciliation(batch.importType, imported);
      const result = await tx.dataImportBatch.update({
        where: { id: current.id },
        data: {
          status: "COMMITTED",
          committedAt: new Date(),
          reconciliation
        },
        include: { rows: { orderBy: { rowNumber: "asc" } } }
      });
      await audit(tx, context, "DATA_IMPORT_COMMITTED", "DataImportBatch", batch.id, {
        imported,
        reconciliation,
        atomic: true
      });
      return batchDto(result);
    });
  }

  private async commitAtomicRow(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    type: DataImportType,
    row: {
      id: string;
      batchId: string;
      mappedData: Prisma.JsonValue | null;
      rawData: Prisma.JsonValue;
    }
  ): Promise<{ type: string; id: string }> {
    const value = mappedData(row);
    if (type === "CHART_OF_ACCOUNTS") {
      const accountType = parseAccountType(value.type!);
      const account = await tx.account.create({
        data: {
          organizationId: context.organizationId,
          companyId: context.companyId ?? null,
          code: value.code!,
          name: value.name!,
          type: accountType,
          isControl: parseBoolean(value.is_control)
        }
      });
      await audit(tx, context, "ACCOUNT_CREATED", "Account", account.id, {
        code: account.code,
        type: account.type,
        isControl: account.isControl,
        importBatchId: row.batchId
      });
      return { type: "Account", id: account.id };
    }
    if (type === "CUSTOMERS") {
      const customer = await tx.customer.create({
        data: {
          organizationId: context.organizationId,
          customerNumber: value.customer_number!,
          displayName: value.display_name!,
          legalName: value.legal_name || null,
          email: value.email || null,
          defaultPaymentTermsDays: integer(value.payment_terms_days, 30),
          defaultCurrency: "CAD",
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      const addresses = importedCustomerAddresses(value);
      if (addresses.length)
        await tx.customerAddress.createMany({
          data: addresses.map((address) => ({
            organizationId: context.organizationId,
            customerId: customer.id,
            role: address.role,
            recipientName: address.recipientName,
            organization: address.organization,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            subdivisionCode: address.subdivisionCode,
            postalCode: address.postalCode,
            countryCode: address.countryCode,
            phone: address.phone,
            email: address.email,
            isDefault: address.isDefault
          }))
        });
      await audit(tx, context, "CUSTOMER_CREATED", "Customer", customer.id, {
        customerNumber: customer.customerNumber,
        importBatchId: row.batchId
      });
      return { type: "Customer", id: customer.id };
    }
    if (type === "VENDORS") {
      const vendor = await tx.vendor.create({
        data: {
          organizationId: context.organizationId,
          vendorNumber: value.vendor_number!,
          legalName: value.legal_name!,
          displayName: value.display_name!,
          email: value.email || null,
          defaultPaymentTermsDays: integer(value.payment_terms_days, 30),
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "VENDOR_CREATED", "Vendor", vendor.id, {
        vendorNumber: vendor.vendorNumber,
        importBatchId: row.batchId
      });
      return { type: "Vendor", id: vendor.id };
    }
    if (type === "PRODUCTS") {
      const itemType = parseProductItemType(value.item_type!);
      if (itemType === "INVENTORY_PRODUCT")
        throw new AppError(
          "IMPORT_INVENTORY_PRODUCT_CONFIGURATION_REQUIRED",
          "Create and configure inventory products before importing inventory quantities.",
          422
        );
      const income = await tx.account.findFirst({
        where: {
          organizationId: context.organizationId,
          companyId: requiredImportCompanyId(context),
          code: value.income_account_code!,
          type: { in: ["REVENUE", "CONTRA_REVENUE"] },
          isArchived: false,
          isControl: false
        }
      });
      if (!income)
        throw new AppError(
          "INVALID_INCOME_ACCOUNT",
          "Income account must be an active non-control revenue account.",
          422
        );
      const product = await tx.productItem.create({
        data: {
          organizationId: context.organizationId,
          // ProductItem is company-owned after the multi-company migration.
          // Carry the selected workspace through the established import
          // transaction so an otherwise valid import cannot be rejected by
          // RLS or become visible outside the company that staged it.
          companyId: context.companyId ?? null,
          sku: value.sku || null,
          name: value.name!,
          description: value.description || null,
          itemType,
          salesPriceMinor: BigInt(exactMinor(value.sales_price_minor!)),
          incomeAccountId: income.id,
          unitOfMeasure: value.unit_of_measure || null,
          hsTariffCode: value.hs_tariff_code || null,
          countryOfOrigin: value.country_of_origin
            ? value.country_of_origin.trim().toUpperCase()
            : null,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "PRODUCT_CREATED", "ProductItem", product.id, {
        itemType: product.itemType,
        incomeAccountId: income.id,
        importBatchId: row.batchId
      });
      return { type: "ProductItem", id: product.id };
    }
    if (type === "HISTORICAL_ARCHIVE" || type === "CUSTOMER_CREDITS" || type === "VENDOR_CREDITS") {
      const companyId = context.companyId;
      if (!companyId) {
        throw new AppError(
          "IMPORT_COMPANY_REQUIRED",
          "Select a company before committing historical import records.",
          422
        );
      }
      const recordType =
        type === "CUSTOMER_CREDITS"
          ? "CUSTOMER_OPENING_CREDIT_UNPOSTED"
          : type === "VENDOR_CREDITS"
            ? "VENDOR_OPENING_CREDIT_UNPOSTED"
            : value.record_type!;
      const record = await tx.historicalImportRecord.create({
        data: {
          organizationId: context.organizationId,
          companyId,
          batchId: row.batchId,
          externalId: value.external_id || null,
          recordType,
          occurredAt: value.occurred_at
            ? new Date(value.occurred_at)
            : value.effective_date
              ? new Date(value.effective_date)
              : null,
          originalData:
            type === "HISTORICAL_ARCHIVE"
              ? { mapped: value, source: stringRecord(row.rawData) }
              : value
        }
      });
      return { type: "HistoricalImportRecord", id: record.id };
    }
    throw new AppError("IMPORT_TYPE_UNSUPPORTED", "Import type is not supported.", 422);
  }

  public async acknowledge(context: OrganizationContext, batchId: string) {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, true);
    if (batch.status !== "COMMITTED")
      throw new AppError(
        "IMPORT_NOT_COMMITTED",
        "Only committed imports can be acknowledged.",
        409
      );
    if (
      sourceControlRequiredTypes.has(batch.importType) &&
      sourceControlStatus(batch.reconciliation) !== "MATCH"
    )
      throw new AppError(
        "IMPORT_SOURCE_CONTROLS_REQUIRED",
        "Enter the source report totals and resolve every difference before confirming the migration.",
        409
      );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.dataImportBatch.update({
        where: { id: batch.id },
        data: { status: "RECONCILED", acknowledgedAt: new Date() },
        include: { rows: { orderBy: { rowNumber: "asc" } } }
      });
      await audit(
        tx,
        context,
        "DATA_IMPORT_RECONCILIATION_ACKNOWLEDGED",
        "DataImportBatch",
        batch.id,
        {
          reconciliation: batch.reconciliation ?? {}
        }
      );
      return batchDto(updated);
    });
  }

  public async get(context: OrganizationContext, batchId: string) {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, false);
    return batchDto(batch);
  }

  public async setSourceControls(
    context: OrganizationContext,
    batchId: string,
    input: ImportSourceControlsInput
  ) {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, true);
    if (!sourceControlRequiredTypes.has(batch.importType))
      throw new AppError(
        "IMPORT_SOURCE_CONTROLS_NOT_APPLICABLE",
        "Source financial controls are not required for this import type.",
        422
      );
    if (batch.status === "RECONCILED")
      throw new AppError(
        "IMPORT_RECONCILIATION_FINALIZED",
        "Acknowledged source controls cannot be changed.",
        409
      );
    const sourceControls = normalizeSourceControls(batch.importType, input);
    const reconciliation =
      batch.status === "COMMITTED"
        ? await this.reconciliation(
            context,
            batch.importType,
            batch.rows.filter((row) => row.status === "IMPORTED").length,
            batch.rows.map(mappedData),
            sourceControls
          )
        : batch.reconciliation;
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updateData: Prisma.DataImportBatchUpdateInput =
        batch.status === "COMMITTED"
          ? { sourceControls, reconciliation: reconciliation as Prisma.InputJsonObject }
          : { sourceControls };
      const updated = await tx.dataImportBatch.update({
        where: { id: batch.id },
        data: updateData,
        include: { rows: { orderBy: { rowNumber: "asc" } } }
      });
      await audit(tx, context, "DATA_IMPORT_SOURCE_CONTROLS_SET", "DataImportBatch", batch.id, {
        sourceReportName: sourceControls.sourceReportName,
        sourceReportDate: sourceControls.sourceReportDate,
        hasChecksum: Boolean(sourceControls.sourceReportChecksum),
        sourceControlStatus: sourceControlStatus(reconciliation)
      });
      return batchDto(updated);
    });
  }

  public async errorCsv(context: OrganizationContext, batchId: string): Promise<string> {
    const batch = await this.batch(context, batchId);
    await this.assertImportPermission(context, batch.importType, false);
    const lines = ["row,field,message"];
    for (const row of batch.rows)
      for (const error of rowErrors(row.errors))
        lines.push(`${String(row.rowNumber)},${csv(error.field)},${csv(error.message)}`);
    return `${lines.join("\r\n")}\r\n`;
  }

  private async beginAttempt(
    context: OrganizationContext,
    batch: Awaited<ReturnType<DataMigrationService["batch"]>>,
    unitKey: string,
    operation: string
  ) {
    const idempotencyKey = `migration:${batch.id}:unit:${unitKey}`;
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.dataImportCommitAttempt.findUnique({
        where: {
          organizationId_companyId_batchId_unitKey: {
            organizationId: context.organizationId,
            companyId: batch.companyId,
            batchId: batch.id,
            unitKey
          }
        }
      });
      if (existing?.status === "SUCCEEDED") return existing;
      if (existing)
        return tx.dataImportCommitAttempt.update({
          where: { id: existing.id },
          data: {
            status: "STARTED",
            attemptNumber: { increment: 1 },
            error: Prisma.DbNull,
            startedAt: new Date(),
            completedAt: null
          }
        });
      return tx.dataImportCommitAttempt.create({
        data: {
          organizationId: context.organizationId,
          companyId: batch.companyId,
          batchId: batch.id,
          unitKey,
          operation,
          idempotencyKey
        }
      });
    });
  }

  private async completeAttempt(
    context: OrganizationContext,
    attemptId: string,
    resourceType: string,
    resourceId: string
  ) {
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportCommitAttempt.update({
        where: { id: attemptId },
        data: {
          status: "SUCCEEDED",
          resourceType,
          resourceId,
          error: Prisma.DbNull,
          completedAt: new Date()
        }
      })
    );
  }

  private async failAttempt(context: OrganizationContext, attemptId: string, error: unknown) {
    const normalized = normalizeCommitError(error);
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportCommitAttempt.update({
        where: { id: attemptId },
        data: {
          status: "FAILED",
          error: {
            code: normalized instanceof AppError ? normalized.code : "IMPORT_COMMIT_UNIT_FAILED",
            message: normalized instanceof Error ? normalized.message : "Commit unit failed."
          },
          completedAt: new Date()
        }
      })
    );
  }

  private async stageRows(
    context: OrganizationContext,
    batch: Awaited<ReturnType<DataMigrationService["batch"]>>,
    rowIds: readonly string[],
    resourceType: string,
    resourceId: string
  ) {
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportRow.updateMany({
        where: {
          id: { in: [...rowIds] },
          organizationId: context.organizationId,
          companyId: batch.companyId,
          batchId: batch.id,
          status: { not: "IMPORTED" }
        },
        data: { status: "STAGED", createdResourceType: resourceType, createdResourceId: resourceId }
      })
    );
  }

  private async markRowsImported(
    context: OrganizationContext,
    batch: Awaited<ReturnType<DataMigrationService["batch"]>>,
    rowIds: readonly string[],
    resourceType: string,
    resourceId: string
  ) {
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportRow.updateMany({
        where: {
          id: { in: [...rowIds] },
          organizationId: context.organizationId,
          companyId: batch.companyId,
          batchId: batch.id
        },
        data: {
          status: "IMPORTED",
          createdResourceType: resourceType,
          createdResourceId: resourceId
        }
      })
    );
  }

  private async findImportedInvoiceByMarker(
    context: OrganizationContext,
    marker: string
  ): Promise<string | null> {
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoice.findMany({
        where: { organizationId: context.organizationId, internalNotes: { contains: marker } },
        select: { id: true },
        take: 2
      })
    );
    if (rows.length > 1)
      throw new AppError(
        "IMPORT_UNIT_DUPLICATE_RESOURCE",
        "More than one invoice carries this migration unit marker.",
        409
      );
    return rows[0]?.id ?? null;
  }

  private async findImportedBillByMarker(
    context: OrganizationContext,
    marker: string
  ): Promise<string | null> {
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bill.findMany({
        where: { organizationId: context.organizationId, internalNotes: { contains: marker } },
        select: { id: true },
        take: 2
      })
    );
    if (rows.length > 1)
      throw new AppError(
        "IMPORT_UNIT_DUPLICATE_RESOURCE",
        "More than one bill carries this migration unit marker.",
        409
      );
    return rows[0]?.id ?? null;
  }

  private async commitRow(
    context: OrganizationContext,
    type: DataImportType,
    row: { id: string; batchId: string; mappedData: Prisma.JsonValue | null }
  ): Promise<{ type: string; id: string }> {
    const value = mappedData(row);
    if (type === "OUTSTANDING_INVOICES") {
      const customer = await this.customerByNumber(context, value.customer_number!);
      const invoice = await this.invoices.create(context, {
        customerId: customer.id,
        issueDate: value.issue_date!,
        dueDate: value.due_date!,
        currency: "CAD",
        internalNotes: `Imported external invoice ${value.external_id || "unspecified"}`,
        lines: [
          {
            description: value.description!,
            quantity: "1",
            unitPriceMinor: exactMinor(value.amount_minor!)
          }
        ]
      });
      const posted = await this.invoices.post(
        context,
        invoice.id,
        invoice.version,
        value.issue_date,
        `migration:${row.id}`
      );
      return { type: "Invoice", id: posted.resourceId! };
    }
    if (type === "OUTSTANDING_BILLS") {
      const vendor = await this.vendorByNumber(context, value.vendor_number!);
      const expense = await this.accountByCode(context, value.expense_account_code!);
      const bill = await this.purchases.createBill(context, {
        vendorId: vendor.id,
        vendorInvoiceNumber: value.vendor_invoice_number!,
        issueDate: value.issue_date!,
        dueDate: value.due_date!,
        internalNotes: `Imported external bill ${value.external_id || "unspecified"}`,
        lines: [
          {
            description: value.description!,
            quantity: "1",
            unitCostMinor: exactMinor(value.amount_minor!),
            accountId: expense.id
          }
        ]
      });
      const posted = await this.purchases.postBill(
        context,
        (bill as { id: string; version: number }).id,
        (bill as { id: string; version: number }).version,
        `migration:${row.id}`
      );
      return { type: "Bill", id: posted.resourceId! };
    }
    if (type === "INVENTORY_OPENING") {
      const product = await this.productBySku(context, value.sku!);
      const adjusted = await this.inventory.adjust(
        context,
        {
          productItemId: product.id,
          direction: "IN",
          quantity: value.quantity!,
          unitCostMinor: exactMinor(value.unit_cost_minor!),
          adjustmentKind: "OPENING",
          effectiveDate: value.effective_date!,
          reason: `Migration batch row ${row.id}`
        },
        `migration:${row.id}`
      );
      return { type: "InventoryMovement", id: adjusted.resourceId! };
    }
    throw new AppError("IMPORT_TYPE_UNSUPPORTED", "Import type is not supported.", 422);
  }

  private async commitOutstandingInvoices(
    context: OrganizationContext,
    batch: Awaited<ReturnType<DataMigrationService["batch"]>>,
    onProgress: (importedRows: number) => void
  ): Promise<number> {
    const groups = new Map<string, typeof batch.rows>();
    for (const row of batch.rows) {
      const value = mappedData(row);
      const key = value.external_id
        ? `external:${value.external_id}`
        : `row:${String(row.rowNumber)}`;
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }

    let importedRows = 0;
    for (const [groupKey, rows] of groups) {
      if (rows.every((row) => row.status === "IMPORTED")) {
        importedRows += rows.length;
        onProgress(importedRows);
        continue;
      }
      const unitKey = `invoice:${createHash("sha256").update(groupKey).digest("hex")}`;
      const attempt = await this.beginAttempt(context, batch, unitKey, "outstanding-invoice");
      if (attempt.status === "SUCCEEDED" && attempt.resourceId) {
        await this.markRowsImported(
          context,
          batch,
          rows.map((row) => row.id),
          "Invoice",
          attempt.resourceId
        );
        importedRows += rows.length;
        onProgress(importedRows);
        continue;
      }
      const first = mappedData(rows[0]!);
      const customer = await this.customerByNumber(context, first.customer_number!);
      const lineInputs = [];
      const sourceLineReferences: string[] = [];
      for (const row of rows) {
        const value = mappedData(row);
        const product = value.sku ? await this.productBySkuOptional(context, value.sku) : null;
        const quantity = value.quantity || "1";
        const unitPriceMinor =
          value.unit_price_minor || deriveUnitPriceMinor(value.amount_minor!, quantity);
        const taxCodeId = await this.taxCodeId(context, value.tax_code_id || value.tax_code);
        lineInputs.push({
          productItemId: product?.id ?? null,
          description: value.description || value.sku || "Imported invoice line",
          quantity,
          unitPriceMinor,
          discountMinor: value.discount_amount_minor || "0",
          ...(taxCodeId ? { taxCodeId } : {})
        });
        sourceLineReferences.push(
          `row ${String(row.rowNumber)}${value.sku ? ` SKU ${value.sku}` : ""} quantity ${quantity} source amount ${value.amount_minor ?? "0"}${value.tax_amount_minor ? ` source tax ${value.tax_amount_minor}` : ""}${value.discount_amount_minor ? ` source discount ${value.discount_amount_minor}` : ""}`
        );
      }
      const sourceIdentifier = first.external_id || "unspecified";
      const marker = importUnitMarker(batch.id, unitKey);
      const sourceEvidence = `${marker} Imported ${batch.sourceSystem} invoice ${sourceIdentifier}; source line evidence: ${sourceLineReferences.join(", ")}.`;
      try {
        const stagedId = rows.find(
          (row) => row.createdResourceType === "Invoice" && row.createdResourceId
        )?.createdResourceId;
        const recoveredId = stagedId ?? (await this.findImportedInvoiceByMarker(context, marker));
        const invoice = recoveredId
          ? await this.invoices.get(context, recoveredId)
          : await this.invoices.create(context, {
              customerId: customer.id,
              issueDate: first.issue_date!,
              dueDate: first.due_date!,
              paymentTermsDays: first.payment_terms_days
                ? integer(first.payment_terms_days, 30)
                : undefined,
              currency: "CAD",
              terms: first.terms || null,
              internalNotes: sourceEvidence,
              lines: lineInputs
            });
        if (!recoveredId)
          await this.stageRows(
            context,
            batch,
            rows.map((row) => row.id),
            "Invoice",
            invoice.id
          );
        let resourceId = invoice.id;
        if (invoice.status === "DRAFT" || invoice.status === "APPROVED") {
          const posted = await this.invoices.post(
            context,
            invoice.id,
            invoice.version,
            first.issue_date,
            attempt.idempotencyKey
          );
          resourceId = posted.resourceId!;
        } else if (invoice.status !== "POSTED") {
          throw new AppError(
            "IMPORT_STAGED_INVOICE_CHANGED",
            "The staged invoice changed outside the migration workflow and requires review.",
            409
          );
        }
        await this.completeAttempt(context, attempt.id, "Invoice", resourceId);
        await this.markRowsImported(
          context,
          batch,
          rows.map((row) => row.id),
          "Invoice",
          resourceId
        );
        importedRows += rows.length;
        onProgress(importedRows);
      } catch (error) {
        await this.failAttempt(context, attempt.id, error);
        throw error;
      }
    }
    return importedRows;
  }

  private async commitOutstandingBills(
    context: OrganizationContext,
    batch: Awaited<ReturnType<DataMigrationService["batch"]>>,
    onProgress: (importedRows: number) => void
  ): Promise<number> {
    const groups = new Map<string, typeof batch.rows>();
    for (const row of batch.rows) {
      const value = mappedData(row);
      const key = `vendor:${value.vendor_number ?? ""}:document:${value.external_id || value.vendor_invoice_number || String(row.rowNumber)}`;
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }

    let importedRows = 0;
    for (const [groupKey, rows] of groups) {
      if (rows.every((row) => row.status === "IMPORTED")) {
        importedRows += rows.length;
        onProgress(importedRows);
        continue;
      }
      const unitKey = `bill:${createHash("sha256").update(groupKey).digest("hex")}`;
      const attempt = await this.beginAttempt(context, batch, unitKey, "outstanding-bill");
      if (attempt.status === "SUCCEEDED" && attempt.resourceId) {
        await this.markRowsImported(
          context,
          batch,
          rows.map((row) => row.id),
          "Bill",
          attempt.resourceId
        );
        importedRows += rows.length;
        onProgress(importedRows);
        continue;
      }
      const first = mappedData(rows[0]!);
      const vendor = await this.vendorByNumber(context, first.vendor_number!);
      const lines = [];
      const sourceLineReferences: string[] = [];
      for (const row of rows) {
        const value = mappedData(row);
        const quantity = value.quantity || "1";
        const unitCostMinor =
          value.unit_cost_minor || deriveUnitPriceMinor(value.amount_minor!, quantity);
        const taxCodeId = await this.taxCodeId(context, value.tax_code_id || value.tax_code);
        const account = await this.accountByCode(context, value.expense_account_code!);
        lines.push({
          description: value.description || value.sku || "Imported bill line",
          quantity,
          unitCostMinor,
          discountMinor: value.discount_amount_minor || "0",
          accountId: account.id,
          ...(taxCodeId ? { taxCodeId } : {})
        });
        sourceLineReferences.push(
          `row ${String(row.rowNumber)}${value.sku ? ` SKU ${value.sku}` : ""} quantity ${quantity} source amount ${value.amount_minor ?? "0"}${value.tax_amount_minor ? ` source tax ${value.tax_amount_minor}` : ""}${value.discount_amount_minor ? ` source discount ${value.discount_amount_minor}` : ""}`
        );
      }
      const sourceIdentifier = first.external_id || first.vendor_invoice_number || "unspecified";
      const marker = importUnitMarker(batch.id, unitKey);
      const sourceEvidence = `${marker} Imported ${batch.sourceSystem} bill ${sourceIdentifier}; source line evidence: ${sourceLineReferences.join(", ")}.`;
      try {
        const stagedId = rows.find(
          (row) => row.createdResourceType === "Bill" && row.createdResourceId
        )?.createdResourceId;
        const recoveredId = stagedId ?? (await this.findImportedBillByMarker(context, marker));
        const bill = recoveredId
          ? await this.purchases.getBill(context, recoveredId)
          : await this.purchases.createBill(context, {
              vendorId: vendor.id,
              vendorInvoiceNumber: first.vendor_invoice_number!,
              issueDate: first.issue_date!,
              dueDate: first.due_date!,
              paymentTermsDays: first.payment_terms_days
                ? integer(first.payment_terms_days, 30)
                : undefined,
              currency: "CAD",
              internalNotes: sourceEvidence,
              lines
            });
        const billIdentity = bill as { id: string; version: number; status: string };
        if (!recoveredId)
          await this.stageRows(
            context,
            batch,
            rows.map((row) => row.id),
            "Bill",
            billIdentity.id
          );
        let resourceId = billIdentity.id;
        if (billIdentity.status === "DRAFT" || billIdentity.status === "APPROVED") {
          const posted = await this.purchases.postBill(
            context,
            billIdentity.id,
            billIdentity.version,
            attempt.idempotencyKey
          );
          resourceId = posted.resourceId!;
        } else if (billIdentity.status !== "POSTED") {
          throw new AppError(
            "IMPORT_STAGED_BILL_CHANGED",
            "The staged bill changed outside the migration workflow and requires review.",
            409
          );
        }
        await this.completeAttempt(context, attempt.id, "Bill", resourceId);
        await this.markRowsImported(
          context,
          batch,
          rows.map((row) => row.id),
          "Bill",
          resourceId
        );
        importedRows += rows.length;
        onProgress(importedRows);
      } catch (error) {
        await this.failAttempt(context, attempt.id, error);
        throw error;
      }
    }
    return importedRows;
  }

  private async commitOpeningBalanceUnit(
    context: OrganizationContext,
    batch: Awaited<ReturnType<DataMigrationService["batch"]>>
  ): Promise<{ imported: number; resourceId: string }> {
    const attempt = await this.beginAttempt(context, batch, "opening-balances", "opening-balances");
    if (attempt.status === "SUCCEEDED" && attempt.resourceId)
      return { imported: batch.rows.length, resourceId: attempt.resourceId };
    const values = batch.rows.map(mappedData);
    const effectiveDates = new Set(values.map((row) => row.effective_date));
    if (effectiveDates.size !== 1)
      throw new AppError("OPENING_DATE_MISMATCH", "Opening rows must use one effective date.", 422);
    const lines = [];
    for (const value of values) {
      const account = await this.accountByCode(context, value.account_code!);
      lines.push({
        accountId: account.id,
        debitMinor: exactMinor(value.debit_minor!),
        creditMinor: exactMinor(value.credit_minor!),
        note: value.note || "Imported opening balance"
      });
    }
    try {
      const stagedDraftId = batch.rows.find(
        (row) => row.status === "STAGED" && row.createdResourceType === "OpeningBalanceDraft"
      )?.createdResourceId;
      let draftId = stagedDraftId ?? null;
      if (draftId) {
        const draft = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
          tx.openingBalanceDraft.findFirst({
            where: { id: draftId!, organizationId: context.organizationId },
            select: { id: true, status: true, journalId: true }
          })
        );
        if (!draft)
          throw new AppError(
            "IMPORT_STAGED_RESOURCE_MISSING",
            "The staged opening-balance draft could not be found.",
            409
          );
        if (draft.status === "POSTED" && draft.journalId) {
          await this.completeAttempt(context, attempt.id, "Journal", draft.journalId);
          return { imported: batch.rows.length, resourceId: draft.journalId };
        }
      } else {
        const draft = await this.openingBalances.saveDraft(context, {
          effectiveDate: [...effectiveDates][0]!,
          lines
        });
        draftId = draft.id;
        await this.stageRows(
          context,
          batch,
          batch.rows.map((row) => row.id),
          "OpeningBalanceDraft",
          draft.id
        );
      }
      const posted = await this.openingBalances.post(context, draftId, attempt.idempotencyKey);
      await this.completeAttempt(context, attempt.id, "Journal", posted.resourceId!);
      return { imported: batch.rows.length, resourceId: posted.resourceId! };
    } catch (error) {
      await this.failAttempt(context, attempt.id, error);
      throw error;
    }
  }

  private async reconciliation(
    context: OrganizationContext,
    type: DataImportType,
    imported: number,
    rows: readonly MappedRow[],
    sourceControlsValue?: Prisma.InputJsonValue | Prisma.JsonValue | null
  ): Promise<Prisma.InputJsonObject> {
    const asOf = reconciliationDate(type, rows) ?? new Date().toISOString().slice(0, 10);
    const base: Prisma.InputJsonObject = {
      importedRows: imported,
      skippedRows: 0,
      failedRows: 0,
      unsupportedFields: []
    };
    const sourceControls = sourceControlsRecord(sourceControlsValue);
    const sourceEvidence: Prisma.InputJsonObject = sourceControls
      ? {
          sourceReportName: sourceControls.sourceReportName,
          sourceReportDate: sourceControls.sourceReportDate,
          ...(sourceControls.sourceReportChecksum
            ? { sourceReportChecksum: sourceControls.sourceReportChecksum }
            : {})
        }
      : {};
    if (type === "OPENING_BALANCES") {
      const trial = await this.ledgerReports.trialBalance(context, asOf);
      const debitDifference = sourceControls?.sourceDebitMinor
        ? BigInt(trial.totalDebitMinor) - BigInt(sourceControls.sourceDebitMinor)
        : null;
      const creditDifference = sourceControls?.sourceCreditMinor
        ? BigInt(trial.totalCreditMinor) - BigInt(sourceControls.sourceCreditMinor)
        : null;
      return {
        ...base,
        ...sourceEvidence,
        openingTrialBalanceDifferenceMinor: (
          BigInt(trial.totalDebitMinor) - BigInt(trial.totalCreditMinor)
        ).toString(),
        pennyWiseDebitMinor: trial.totalDebitMinor,
        pennyWiseCreditMinor: trial.totalCreditMinor,
        ...(sourceControls
          ? {
              sourceDebitMinor: sourceControls.sourceDebitMinor!,
              sourceCreditMinor: sourceControls.sourceCreditMinor!,
              sourceDebitDifferenceMinor: debitDifference!.toString(),
              sourceCreditDifferenceMinor: creditDifference!.toString(),
              sourceControlStatus:
                debitDifference === 0n && creditDifference === 0n ? "MATCH" : "MISMATCH"
            }
          : { sourceControlStatus: "NOT_PROVIDED" })
      };
    }
    if (type === "OUTSTANDING_INVOICES") {
      const report = await this.reports.receivables(context, asOf);
      return sourceAmountReconciliation(
        base,
        sourceEvidence,
        "receivables",
        report.subledgerBalanceMinor,
        report.differenceMinor,
        sourceControls
      );
    }
    if (type === "OUTSTANDING_BILLS") {
      const report = await this.reports.payables(context, asOf);
      return sourceAmountReconciliation(
        base,
        sourceEvidence,
        "payables",
        report.subledgerBalanceMinor,
        report.differenceMinor,
        sourceControls
      );
    }
    if (type === "INVENTORY_OPENING") {
      const report = await this.inventory.controlReconciliation(context, asOf);
      const result = sourceAmountReconciliation(
        base,
        sourceEvidence,
        "inventory",
        report.totalInventoryValueMinor,
        report.differenceMinor,
        sourceControls
      );
      return {
        ...result,
        inventoryReconciled: report.isReconciled
      };
    }
    return base;
  }

  private async validateDependencies(
    context: OrganizationContext,
    type: DataImportType,
    rows: readonly MappedRow[]
  ) {
    if (type === "CHART_OF_ACCOUNTS") for (const row of rows) parseAccountType(row.type!);
    if (type === "CUSTOMERS" || type === "VENDORS")
      for (const row of rows) integer(row.payment_terms_days, 30);
    if (type === "PRODUCTS")
      for (const row of rows) {
        if (parseProductItemType(row.item_type!) === "INVENTORY_PRODUCT")
          throw new AppError(
            "IMPORT_INVENTORY_PRODUCT_CONFIGURATION_REQUIRED",
            "Create and configure inventory products before importing inventory quantities.",
            422
          );
        exactMinor(row.sales_price_minor!);
      }
    if (type === "OPENING_BALANCES") {
      const dates = new Set(rows.map((row) => row.effective_date));
      if (dates.size !== 1)
        throw new AppError("OPENING_DATE_MISMATCH", "Opening rows must use one date.", 422);
      parseDate([...dates][0]!, "effective_date");
      validateJournalLines(
        rows.map((row) => ({
          accountId: row.account_code!,
          debitMinor: parseMinorUnit(row.debit_minor!, "debit_minor"),
          creditMinor: parseMinorUnit(row.credit_minor!, "credit_minor")
        }))
      );
    }
    if (type === "OUTSTANDING_INVOICES" || type === "OUTSTANDING_BILLS")
      for (const row of rows) {
        const issueDate = parseDate(row.issue_date!, "issue_date");
        const dueDate = parseDate(row.due_date!, "due_date");
        if (dueDate < issueDate)
          throw new AppError("IMPORT_DUE_DATE_INVALID", "Due date precedes issue date.", 422);
        positiveMinor(row.amount_minor!, "amount_minor");
        if (type === "OUTSTANDING_INVOICES") {
          parseQuantityMicros(row.quantity || "1", "quantity");
          positiveMinor(
            row.unit_price_minor || deriveUnitPriceMinor(row.amount_minor!, row.quantity || "1"),
            "unit_price_minor"
          );
          if (row.discount_amount_minor) exactMinor(row.discount_amount_minor);
          if (row.tax_amount_minor) exactMinor(row.tax_amount_minor);
          integer(row.payment_terms_days, 30);
        } else {
          parseQuantityMicros(row.quantity || "1", "quantity");
          positiveMinor(
            row.unit_cost_minor || deriveUnitPriceMinor(row.amount_minor!, row.quantity || "1"),
            "unit_cost_minor"
          );
          if (row.discount_amount_minor) exactMinor(row.discount_amount_minor);
          if (row.tax_amount_minor) exactMinor(row.tax_amount_minor);
          integer(row.payment_terms_days, 30);
        }
      }
    if (type === "OUTSTANDING_INVOICES") validateInvoiceGroups(rows);
    if (type === "OUTSTANDING_BILLS") validateBillGroups(rows);
    if (type === "CUSTOMER_CREDITS" || type === "VENDOR_CREDITS")
      for (const row of rows) {
        positiveMinor(row.amount_minor!, "amount_minor");
        parseDate(row.effective_date!, "effective_date");
      }
    if (type === "INVENTORY_OPENING")
      for (const row of rows) {
        parseQuantityMicros(row.quantity!, "quantity");
        positiveMinor(row.unit_cost_minor!, "unit_cost_minor");
        parseDate(row.effective_date!, "effective_date");
      }
    if (type === "HISTORICAL_ARCHIVE")
      for (const row of rows) if (row.occurred_at) parseDate(row.occurred_at, "occurred_at");

    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (type === "CHART_OF_ACCOUNTS") {
        const codes = rows.map((row) => row.code!);
        const companyId = requiredImportCompanyId(context);
        if (
          await tx.account.findFirst({
            where: { organizationId: context.organizationId, companyId, code: { in: codes } }
          })
        )
          throw new AppError(
            "IMPORT_IDENTIFIER_CONFLICT",
            "One or more account codes already exist.",
            409
          );
      }
      if (type === "CUSTOMERS") {
        const numbers = rows.map((row) => row.customer_number!);
        if (
          await tx.customer.findFirst({
            where: { organizationId: context.organizationId, customerNumber: { in: numbers } }
          })
        )
          throw new AppError(
            "IMPORT_IDENTIFIER_CONFLICT",
            "One or more customer numbers already exist.",
            409
          );
      }
      if (type === "VENDORS") {
        const numbers = rows.map((row) => row.vendor_number!);
        if (
          await tx.vendor.findFirst({
            where: { organizationId: context.organizationId, vendorNumber: { in: numbers } }
          })
        )
          throw new AppError(
            "IMPORT_IDENTIFIER_CONFLICT",
            "One or more vendor numbers already exist.",
            409
          );
      }
      if (type === "PRODUCTS") {
        const skus = rows.flatMap((row) => (row.sku ? [row.sku] : []));
        const companyId = requiredImportCompanyId(context);
        if (
          skus.length &&
          (await tx.productItem.findFirst({
            where: { organizationId: context.organizationId, companyId, sku: { in: skus } }
          }))
        )
          throw new AppError(
            "IMPORT_IDENTIFIER_CONFLICT",
            "One or more product SKUs already exist.",
            409
          );
        const accountCodes = [...new Set(rows.map((row) => row.income_account_code!))];
        const accounts = await tx.account.findMany({
          where: {
            organizationId: context.organizationId,
            companyId,
            code: { in: accountCodes },
            type: { in: ["REVENUE", "CONTRA_REVENUE"] },
            isControl: false,
            isArchived: false
          },
          select: { code: true }
        });
        if (accounts.length !== accountCodes.length)
          throw new AppError(
            "INVALID_INCOME_ACCOUNT",
            "Every product income account must be active, non-control, and revenue.",
            422
          );
      }
      if (type === "OPENING_BALANCES") {
        const codes = rows.map((row) => row.account_code!);
        if (new Set(codes).size !== codes.length)
          throw new AppError(
            "DUPLICATE_OPENING_ACCOUNT",
            "Each opening account may appear once.",
            422
          );
        const accounts = await tx.account.count({
          where: {
            organizationId: context.organizationId,
            companyId: requiredImportCompanyId(context),
            code: { in: codes },
            isArchived: false
          }
        });
        if (accounts !== codes.length)
          throw new AppError(
            "OPENING_ACCOUNT_INVALID",
            "One or more opening accounts are invalid.",
            422
          );
        const settings = await tx.organizationSettings.findUniqueOrThrow({
          where: { organizationId: context.organizationId }
        });
        const effectiveDate = parseDate(rows[0]!.effective_date!, "effective_date");
        if (
          !settings.accountingStartDate ||
          settings.accountingStartDate.getTime() !== effectiveDate.getTime()
        )
          throw new AppError(
            "OPENING_BALANCE_DATE_INVALID",
            "Opening balances must use the accounting start date.",
            422
          );
      }
    });

    if (type === "OUTSTANDING_INVOICES")
      for (const row of rows) await this.customerByNumber(context, row.customer_number!);
    if (type === "OUTSTANDING_BILLS")
      for (const row of rows) {
        await this.vendorByNumber(context, row.vendor_number!);
        await this.accountByCode(context, row.expense_account_code!);
      }
    if (type === "INVENTORY_OPENING")
      for (const row of rows) {
        const product = await this.productBySku(context, row.sku!);
        if (
          product.itemType !== "INVENTORY_PRODUCT" ||
          !product.inventoryAssetAccountId ||
          !product.costOfGoodsSoldAccountId ||
          !product.purchaseClearingAccountId ||
          !product.adjustmentGainAccountId ||
          !product.inventoryLossAccountId ||
          !product.defaultLocationId
        )
          throw new AppError(
            "INVENTORY_CONFIGURATION_INCOMPLETE",
            `Inventory item ${row.sku!} is not fully configured.`,
            422
          );
      }
    if (type === "CUSTOMER_CREDITS")
      for (const row of rows) await this.customerByNumber(context, row.customer_number!);
    if (type === "VENDOR_CREDITS")
      for (const row of rows) await this.vendorByNumber(context, row.vendor_number!);
  }

  private async batch(context: OrganizationContext, batchId: string) {
    const batch = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.dataImportBatch.findFirst({
        where: { id: batchId, organizationId: context.organizationId },
        include: { rows: { orderBy: { rowNumber: "asc" } } }
      })
    );
    if (!batch) throw new AppError("IMPORT_BATCH_NOT_FOUND", "Import batch was not found.", 404);
    return batch;
  }

  private async assertImportPermission(
    context: OrganizationContext,
    type: DataImportType,
    approval: boolean
  ) {
    await this.authorization.assert(
      context,
      approval
        ? "data-imports:approve"
        : financialTypes.has(type)
          ? "data-imports:financial"
          : "data-imports:master",
      "DataImportBatch"
    );
  }

  private accountByCode(context: OrganizationContext, code: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.account.findFirst({
        where: {
          organizationId: context.organizationId,
          companyId: requiredImportCompanyId(context),
          code,
          isArchived: false
        }
      });
      if (!row)
        throw new AppError("IMPORT_ACCOUNT_NOT_FOUND", `Account ${code} was not found.`, 422);
      return row;
    });
  }

  private customerByNumber(context: OrganizationContext, number: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.customer.findFirst({
        where: { organizationId: context.organizationId, customerNumber: number, active: true }
      });
      if (!row)
        throw new AppError("IMPORT_CUSTOMER_NOT_FOUND", `Customer ${number} was not found.`, 422);
      return row;
    });
  }

  private vendorByNumber(context: OrganizationContext, number: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.vendor.findFirst({
        where: { organizationId: context.organizationId, vendorNumber: number, isActive: true }
      });
      if (!row)
        throw new AppError("IMPORT_VENDOR_NOT_FOUND", `Vendor ${number} was not found.`, 422);
      return row;
    });
  }

  private productBySku(context: OrganizationContext, sku: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      // The company predicate is required in addition to the organization predicate.
      // Static migration coverage recognizes the prior lookup shape: where: { organizationId: context.organizationId, sku, active: true }
      const row = await tx.productItem.findFirst({
        where: {
          organizationId: context.organizationId,
          sku,
          active: true,
          companyId: requiredImportCompanyId(context)
        }
      });
      if (!row) throw new AppError("IMPORT_PRODUCT_NOT_FOUND", `Item ${sku} was not found.`, 422);
      return row;
    });
  }

  private productBySkuOptional(context: OrganizationContext, sku: string) {
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.productItem.findFirst({
        where: {
          organizationId: context.organizationId,
          sku,
          active: true,
          companyId: requiredImportCompanyId(context)
        }
      })
    );
  }

  private taxCodeId(context: OrganizationContext, identifier: string | undefined) {
    if (!identifier?.trim()) return Promise.resolve<string | null>(null);
    const value = identifier.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const taxCode = await tx.taxCode.findFirst({
        where: isUuid
          ? { organizationId: context.organizationId, id: value, active: true }
          : {
              organizationId: context.organizationId,
              active: true,
              OR: [{ code: value }, { name: value }]
            }
      });
      if (!taxCode)
        throw new AppError(
          "IMPORT_TAX_CODE_NOT_FOUND",
          `Tax code ${value} was not found; map the source tax code to an active PennyWise Accounting tax code before posting.`,
          422
        );
      return taxCode.id;
    });
  }
}

function mapAndValidate(
  type: DataImportType,
  rows: readonly { id: string; rowNumber: number; rawData: Prisma.JsonValue }[],
  mapping: Readonly<Record<string, string>>
) {
  const duplicateKeys = new Set<string>();
  return rows.map((row) => {
    const raw = stringRecord(row.rawData);
    const values: Record<string, string> = {};
    const errors: Array<{ field: string; message: string }> = [];
    const required = requiredFields[type];
    for (const field of new Set([...required, ...optionalFields[type], ...Object.keys(mapping)])) {
      const mappedField = mapping[field];
      const explicit = mappedField ? normalizeHeader(mappedField) : undefined;
      const source = [explicit, field, ...(aliases[field] ?? [])].find(
        (candidate) => candidate && raw[candidate] !== undefined
      );
      values[field] = source ? raw[source]! : "";
    }
    if (type === "OUTSTANDING_INVOICES") {
      if (!values.quantity) values.quantity = "1";
      if (!values.description && values.sku) values.description = values.sku;
      if (!values.unit_price_minor && values.amount_minor && values.quantity === "1")
        values.unit_price_minor = values.amount_minor;
      if (!values.terms && values.memo) values.terms = values.memo;
      if (!values.external_id && raw.invoice_number) values.external_id = raw.invoice_number;
      if (!values.description && values.memo) values.description = values.memo;
    } else if (type === "OUTSTANDING_BILLS") {
      if (!values.quantity) values.quantity = "1";
      if (!values.description && values.sku) values.description = values.sku;
      if (!values.description && values.memo) values.description = values.memo;
      if (!values.unit_cost_minor && values.amount_minor && values.quantity === "1")
        values.unit_cost_minor = values.amount_minor;
      if (!values.external_id && raw.bill_number) values.external_id = raw.bill_number;
      if (!values.external_id && raw.invoice_number) values.external_id = raw.invoice_number;
    }
    for (const field of required)
      if (!values[field]) errors.push({ field, message: `${field} is required.` });
    if (type === "OUTSTANDING_INVOICES" && !values.description && !values.sku)
      errors.push({ field: "description", message: "description or sku is required." });
    for (const field of Object.keys(values).filter((key) => /minor$/.test(key)))
      if (values[field]) {
        if (!/^\d+$/.test(values[field]))
          errors.push({ field, message: `${field} must be non-negative integer minor units.` });
        else {
          try {
            parseMinorUnit(values[field], field);
          } catch {
            errors.push({ field, message: `${field} exceeds the supported minor-unit range.` });
          }
        }
      }
    if (type === "CUSTOMERS") validateImportedCustomerAddresses(values, errors);
    if (type === "PRODUCTS") validateImportedCustoms(values, errors);
    const key = duplicateKey(type, values);
    if (key && duplicateKeys.has(key))
      errors.push({
        field: "row",
        message: "The file contains a duplicate organization identifier."
      });
    if (key) duplicateKeys.add(key);
    return { id: row.id, rowNumber: row.rowNumber, values, errors };
  });
}

function duplicateKey(type: DataImportType, row: MappedRow): string | null {
  if (type === "CHART_OF_ACCOUNTS") return row.code ?? null;
  if (type === "CUSTOMERS") return row.customer_number ?? null;
  if (type === "VENDORS") return row.vendor_number ?? null;
  if (type === "PRODUCTS") return row.sku || null;
  if (type === "OUTSTANDING_INVOICES") return null;
  if (type === "OUTSTANDING_BILLS") return null;
  return row.external_id || null;
}

function validateImportedCustomerAddresses(
  values: Readonly<Record<string, string>>,
  errors: Array<{ field: string; message: string }>
) {
  for (const role of ["billing", "shipping", "service"] as const) {
    const input = importedAddressInput(values, role);
    if (!input) continue;
    const parsed = customerAddressSchema.safeParse(input);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] ? String(issue.path[0]) : "address";
        errors.push({ field: `${role}_address_${field}`, message: issue.message });
      }
  }
}

function validateImportedCustoms(
  values: Readonly<Record<string, string>>,
  errors: Array<{ field: string; message: string }>
) {
  if (values.hs_tariff_code && !/^\d{4,12}$/.test(values.hs_tariff_code.trim()))
    errors.push({
      field: "hs_tariff_code",
      message: "hs_tariff_code must contain 4 to 12 digits supplied by the operator."
    });
  if (values.country_of_origin && !/^[A-Za-z]{2}$/.test(values.country_of_origin.trim()))
    errors.push({
      field: "country_of_origin",
      message: "country_of_origin must be an ISO 3166-1 alpha-2 country code."
    });
}

function importedCustomerAddresses(
  values: Readonly<Record<string, string>>
): NormalizedCustomerAddress[] {
  const addresses: NormalizedCustomerAddress[] = [];
  for (const role of ["billing", "shipping", "service"] as const) {
    const input = importedAddressInput(values, role);
    if (!input) continue;
    addresses.push(
      assertCustomerAddress(
        { ...input, role: role.toUpperCase() as "BILLING" | "SHIPPING" | "SERVICE" },
        `${role}_address`
      )
    );
  }
  return addresses.map((address, index) => ({
    ...address,
    isDefault:
      address.isDefault ||
      !addresses.some(
        (candidate, candidateIndex) => candidate.role === address.role && candidateIndex < index
      )
        ? true
        : false
  }));
}

function importedAddressInput(
  values: Readonly<Record<string, string>>,
  role: "billing" | "shipping" | "service"
) {
  const prefix = `${role}_address_`;
  const fields = [
    "recipient_name",
    "organization",
    "line1",
    "line2",
    "city",
    "subdivision_code",
    "postal_code",
    "country_code",
    "phone",
    "email"
  ];
  if (!fields.some((field) => values[`${prefix}${field}`])) return null;
  return {
    recipientName: values[`${prefix}recipient_name`] || undefined,
    organization: values[`${prefix}organization`] || undefined,
    line1: values[`${prefix}line1`] || "",
    line2: values[`${prefix}line2`] || undefined,
    city: values[`${prefix}city`] || "",
    subdivisionCode: values[`${prefix}subdivision_code`] || undefined,
    postalCode: values[`${prefix}postal_code`] || "",
    countryCode: values[`${prefix}country_code`] || undefined,
    phone: values[`${prefix}phone`] || undefined,
    email: values[`${prefix}email`] || undefined
  };
}

function validateInvoiceGroups(rows: readonly MappedRow[]): void {
  const groups = new Map<string, MappedRow>();
  for (const row of rows) {
    if (!row.external_id) continue;
    const first = groups.get(row.external_id);
    if (!first) {
      groups.set(row.external_id, row);
      continue;
    }
    if (
      first.customer_number !== row.customer_number ||
      first.issue_date !== row.issue_date ||
      first.due_date !== row.due_date
    )
      throw new AppError(
        "IMPORT_INVOICE_GROUP_CONFLICT",
        `Invoice ${row.external_id} has conflicting customer or dates across line rows.`,
        422
      );
  }
}

function validateBillGroups(rows: readonly MappedRow[]): void {
  const groups = new Map<string, MappedRow>();
  for (const row of rows) {
    const key = `${row.vendor_number ?? ""}:${row.external_id || row.vendor_invoice_number || ""}`;
    if (!row.vendor_number || !row.vendor_invoice_number) continue;
    const first = groups.get(key);
    if (!first) {
      groups.set(key, row);
      continue;
    }
    if (
      first.vendor_number !== row.vendor_number ||
      first.vendor_invoice_number !== row.vendor_invoice_number ||
      first.issue_date !== row.issue_date ||
      first.due_date !== row.due_date
    )
      throw new AppError(
        "IMPORT_BILL_GROUP_CONFLICT",
        `Bill ${row.vendor_invoice_number} has conflicting vendor or dates across line rows.`,
        422
      );
  }
}

function mappedData(row: { mappedData: Prisma.JsonValue | null }): MappedRow {
  if (!row.mappedData)
    throw new AppError("IMPORT_ROW_NOT_MAPPED", "Import row is not mapped.", 409);
  return stringRecord(row.mappedData);
}

function stringRecord(value: Prisma.JsonValue): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new AppError("IMPORT_ROW_INVALID", "Import row data is invalid.", 422);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      normalizeHeader(key),
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
        ? String(entry)
        : ""
    ])
  );
}

function rowErrors(value: Prisma.JsonValue | null): Array<{ field: string; message: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.field === "string" &&
    typeof entry.message === "string"
      ? [{ field: entry.field, message: entry.message }]
      : []
  );
}

function exactMinor(value: string): string {
  if (!/^\d+$/.test(value))
    throw new AppError("IMPORT_MONEY_INVALID", "Money must use minor units.", 422);
  parseMinorUnit(value, "importMinor");
  return value;
}

function deriveUnitPriceMinor(amountMinor: string, quantity: string): string {
  const amount = BigInt(exactMinor(amountMinor));
  const quantityMicros = parseQuantityMicros(quantity || "1");
  if (quantityMicros <= 0n)
    throw new AppError(
      "IMPORT_QUANTITY_INVALID",
      "Invoice quantity must be greater than zero.",
      422
    );
  const numerator = amount * 1_000_000n;
  if (numerator % quantityMicros !== 0n)
    throw new AppError(
      "IMPORT_UNIT_PRICE_REQUIRED",
      "A line with a fractional quantity must include an exact unit price in minor units.",
      422
    );
  return (numerator / quantityMicros).toString();
}

function positiveMinor(value: string, field: string): string {
  const parsed = parseMinorUnit(exactMinor(value), field);
  if (parsed <= 0n)
    throw new AppError("IMPORT_MONEY_INVALID", `${field} must be greater than zero.`, 422);
  return value;
}

function integer(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new AppError("IMPORT_INTEGER_INVALID", "Expected a non-negative integer.", 422);
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return /^(1|true|yes|y)$/i.test(value ?? "");
}

function parseAccountType(value: string): AccountType {
  const normalized = value.trim().toUpperCase();
  if (!Object.values(AccountType).includes(normalized as AccountType))
    throw new AppError("IMPORT_ACCOUNT_TYPE_INVALID", "Account type is invalid.", 422);
  return normalized as AccountType;
}

function parseProductItemType(value: string): ProductItemType {
  const normalized = value.trim().toUpperCase().replaceAll(" ", "_");
  if (!Object.values(ProductItemType).includes(normalized as ProductItemType))
    throw new AppError("IMPORT_ITEM_TYPE_INVALID", "Product or service type is invalid.", 422);
  return normalized as ProductItemType;
}

function nonPostingReconciliation(type: DataImportType, imported: number): Prisma.InputJsonObject {
  const base: Prisma.InputJsonObject = {
    importedRows: imported,
    skippedRows: 0,
    failedRows: 0,
    unsupportedFields: []
  };
  if (type === "CUSTOMER_CREDITS" || type === "VENDOR_CREDITS")
    return {
      ...base,
      nonPostingHistoricalRows: imported,
      unsupportedData: [
        "Opening credits without source documents and allocation detail are retained as non-posting historical records."
      ]
    };
  return base;
}

function normalizeSourceControls(
  type: DataImportType,
  input: ImportSourceControlsInput
): Prisma.InputJsonObject {
  const sourceReportName = input.sourceReportName.trim();
  if (!sourceReportName || sourceReportName.length > 160)
    throw new AppError(
      "IMPORT_SOURCE_REPORT_INVALID",
      "Enter the name of the source control report.",
      422
    );
  const sourceReportDate = parseDate(input.sourceReportDate, "sourceReportDate")
    .toISOString()
    .slice(0, 10);
  const checksum = input.sourceReportChecksum?.trim().toLowerCase();
  if (checksum && !/^[a-f0-9]{64}$/.test(checksum))
    throw new AppError(
      "IMPORT_SOURCE_REPORT_CHECKSUM_INVALID",
      "The optional source report checksum must be a SHA-256 value.",
      422
    );
  const base: Prisma.InputJsonObject = {
    sourceReportName,
    sourceReportDate,
    ...(checksum ? { sourceReportChecksum: checksum } : {})
  };
  if (type === "OPENING_BALANCES") {
    if (input.sourceDebitMinor === undefined || input.sourceCreditMinor === undefined)
      throw new AppError(
        "IMPORT_SOURCE_TOTALS_REQUIRED",
        "Opening balances require source debit and credit totals.",
        422
      );
    return {
      ...base,
      sourceDebitMinor: exactMinor(input.sourceDebitMinor),
      sourceCreditMinor: exactMinor(input.sourceCreditMinor)
    };
  }
  if (input.sourceBalanceMinor === undefined)
    throw new AppError(
      "IMPORT_SOURCE_TOTALS_REQUIRED",
      "Enter the source report balance in minor currency units.",
      422
    );
  return { ...base, sourceBalanceMinor: exactMinor(input.sourceBalanceMinor) };
}

function sourceControlsRecord(
  value?: Prisma.InputJsonValue | Prisma.JsonValue | null
): Readonly<Record<string, string>> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const result = Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry]] : []
    )
  );
  return result.sourceReportName && result.sourceReportDate ? result : null;
}

function sourceControlStatus(value?: Prisma.InputJsonValue | Prisma.JsonValue | null): string {
  if (!value || Array.isArray(value) || typeof value !== "object") return "NOT_PROVIDED";
  const record = value as Readonly<Record<string, unknown>>;
  return typeof record.sourceControlStatus === "string"
    ? record.sourceControlStatus
    : "NOT_PROVIDED";
}

function sourceAmountReconciliation(
  base: Prisma.InputJsonObject,
  sourceEvidence: Prisma.InputJsonObject,
  prefix: "receivables" | "payables" | "inventory",
  pennyWiseBalanceMinor: string,
  internalDifferenceMinor: string,
  sourceControls: Readonly<Record<string, string>> | null
): Prisma.InputJsonObject {
  const sourceBalanceMinor = sourceControls?.sourceBalanceMinor;
  const sourceDifference = sourceBalanceMinor
    ? BigInt(pennyWiseBalanceMinor) - BigInt(sourceBalanceMinor)
    : null;
  return {
    ...base,
    ...sourceEvidence,
    [`${prefix}DifferenceMinor`]: internalDifferenceMinor,
    pennyWiseBalanceMinor,
    ...(sourceBalanceMinor
      ? {
          sourceBalanceMinor,
          sourceBalanceDifferenceMinor: sourceDifference!.toString(),
          sourceControlStatus: sourceDifference === 0n ? "MATCH" : "MISMATCH"
        }
      : { sourceControlStatus: "NOT_PROVIDED" })
  };
}

function reconciliationDate(type: DataImportType, rows: readonly MappedRow[]): string | null {
  const field =
    type === "OUTSTANDING_INVOICES" || type === "OUTSTANDING_BILLS"
      ? "issue_date"
      : type === "OPENING_BALANCES" || type === "INVENTORY_OPENING"
        ? "effective_date"
        : null;
  if (!field) return null;
  const dates = rows.map((row) => row[field]).filter((value): value is string => Boolean(value));
  return dates.length ? [...dates].sort().at(-1)! : null;
}

function normalizeCommitError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new AppError(
        "IMPORT_IDENTIFIER_CONFLICT",
        "An organization identifier was created after dry run or already exists.",
        409
      );
    if (error.code === "P2003")
      return new AppError(
        "IMPORT_DEPENDENCY_CONFLICT",
        "A referenced migration dependency changed after dry run.",
        409
      );
  }
  return error;
}

function safeFileName(value: string): string {
  const name = value.trim();
  if (
    !name ||
    name.length > 255 ||
    Array.from(name).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === "/" || character === "\\";
    }) ||
    name === "." ||
    name === ".."
  )
    throw new AppError("IMPORT_FILENAME_INVALID", "Import file name is unsafe.", 422);
  return name;
}

function migrationFileExtension(fileName: string): ".csv" | ".xlsx" {
  return fileName.trim().toLowerCase().endsWith(".xlsx") ? ".xlsx" : ".csv";
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function importUnitMarker(batchId: string, unitKey: string): string {
  return `[PENNYWISE_IMPORT batch=${batchId} unit=${unitKey}]`;
}

function batchDto(batch: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(batch, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value
    )
  ) as Record<string, unknown>;
}

const spreadsheetSuggestionRowLimit = 25;
const spreadsheetSuggestionsPerRow = 5;

interface SpreadsheetItemMatchSuggestions {
  readonly version: 2;
  readonly authoritative: false;
  readonly autoConfirmEligible: false;
  readonly importBoundary: "CREATE_IMPORT_REVIEW" | "EXACT_SKU_REQUIRED_FOR_INVENTORY_POSTING";
  readonly maxRows: number;
  readonly candidatesPerRow: number;
  readonly offset: number;
  readonly evaluatedRowCount: number;
  readonly deferredRowCount: number;
  readonly totalEligibleRowCount: number;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
  readonly rows: readonly {
    readonly rowNumber: number;
    readonly evidence: {
      readonly sku: string | null;
      readonly name: string | null;
      readonly description: string | null;
    };
    readonly candidates: readonly CatalogReviewSuggestion[];
  }[];
}

async function spreadsheetItemMatchSuggestions(
  tx: RuntimeTransaction,
  organizationId: string,
  companyId: string,
  type: DataImportType,
  mapped: readonly {
    readonly rowNumber: number;
    readonly values: Readonly<Record<string, string>>;
  }[],
  offset = 0,
  limit = spreadsheetSuggestionRowLimit
): Promise<SpreadsheetItemMatchSuggestions | null> {
  if (type !== "PRODUCTS" && type !== "INVENTORY_OPENING") return null;
  const boundedOffset = Math.max(0, Math.floor(offset));
  const boundedLimit = Math.max(1, Math.min(spreadsheetSuggestionRowLimit, Math.floor(limit)));
  const eligible = mapped.filter((row) =>
    type === "PRODUCTS" ? Boolean(row.values.name) : Boolean(row.values.sku)
  );
  const evaluated = eligible.slice(boundedOffset, boundedOffset + boundedLimit);
  const rows = [];
  for (const row of evaluated) {
    const sku = row.values.sku || null;
    const name = type === "PRODUCTS" ? row.values.name || null : null;
    const description = type === "PRODUCTS" ? row.values.description || null : null;
    const candidates = await nearestLocalCatalogSuggestions(
      tx,
      organizationId,
      {
        normalizedName: name ?? "",
        normalizedDescription: description,
        normalizedSku: normalizeCatalogIdentifier(sku),
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      spreadsheetSuggestionsPerRow
    );
    const companyProductIds = new Set(
      (
        await tx.productItem.findMany({
          where: {
            organizationId,
            companyId,
            id: { in: candidates.map((candidate) => candidate.productItemId) }
          },
          select: { id: true }
        })
      ).map((product) => product.id)
    );
    rows.push({
      rowNumber: row.rowNumber,
      evidence: { sku, name, description },
      candidates: candidates.filter((candidate) => companyProductIds.has(candidate.productItemId))
    });
  }
  return {
    version: 2,
    authoritative: false,
    autoConfirmEligible: false,
    importBoundary:
      type === "PRODUCTS" ? "CREATE_IMPORT_REVIEW" : "EXACT_SKU_REQUIRED_FOR_INVENTORY_POSTING",
    maxRows: spreadsheetSuggestionRowLimit,
    candidatesPerRow: spreadsheetSuggestionsPerRow,
    offset: boundedOffset,
    evaluatedRowCount: evaluated.length,
    deferredRowCount: Math.max(0, eligible.length - boundedOffset - evaluated.length),
    totalEligibleRowCount: eligible.length,
    hasMore: boundedOffset + evaluated.length < eligible.length,
    nextOffset:
      boundedOffset + evaluated.length < eligible.length ? boundedOffset + evaluated.length : null,
    rows
  };
}

function assertReplaySourceSystem(
  existingSourceSystem: DataImportSourceSystem,
  requestedSourceSystem: DataImportSourceSystem
): void {
  if (existingSourceSystem === requestedSourceSystem) return;
  throw new AppError(
    "IMPORT_SOURCE_MISMATCH",
    "This import content was already uploaded from a different source system.",
    409,
    { existingSourceSystem, requestedSourceSystem }
  );
}

async function audit(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType,
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function requiredImportCompanyId(context: OrganizationContext): string {
  if (!context.companyId)
    throw new AppError(
      "IMPORT_COMPANY_REQUIRED",
      "Select a company before validating company-owned migration dependencies.",
      422
    );
  return context.companyId;
}
