// Switching centre: imports, exports, and closure (`portability-workspace`).

import { formatMinor } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { downloadBlob, preferredScrollBehavior } from "../lib/browser.js";
import {
  definitionDescription,
  definitionTerm,
  escapeHtml,
  formatFileSize,
  headerRow,
  option,
  row
} from "../lib/dom.js";
import { showError, showNotice } from "../lib/notices.js";
import { trackProductEvent } from "../lib/product-analytics.js";
import { formatRole } from "../lib/roles.js";
import {
  formatConnectorTime,
  loadInventory,
  loadPurchases,
  loadReports,
  loadSales
} from "../lib/workspace-calls.js";
import { elements, identity, multiCurrencyState } from "../state.js";

const importSourceGuides = {
  QUICKBOOKS_ONLINE: {
    name: "QuickBooks Online",
    summary:
      "Export reports and lists, then preserve your trial balance and aging reports as cutover proof.",
    steps: [
      "Export the Account List, customers, suppliers, and products and services.",
      "Save the trial balance, balance sheet, profit and loss, receivables aging, payables aging, and sales-tax reports for the cutover date.",
      "Download attachments and a transaction archive separately; the list export is not a complete company backup.",
      "Keep QuickBooks read-only until PennyWise Accounting opening balances and aging agree with the source reports."
    ],
    helpUrl:
      "https://quickbooks.intuit.com/learn-support/en-ca/help-article/list-management/export-data-reports-lists-quickbooks-online/L1xleDrLp_CA_en_CA"
  },
  QUICKBOOKS_DESKTOP: {
    name: "QuickBooks Desktop",
    summary:
      "Export Desktop reports to CSV, keep the invoice number on every line, and retain the Desktop company file or reports for cutover reconciliation.",
    steps: [
      "Create and verify a QuickBooks .QBB backup, then keep the original company file read-only. PennyWise Accounting imports reviewed CSV or XLSX exports; it does not open QBW, QBB, QBM, or IIF files.",
      "Export the chart of accounts, customer, vendor, item, open invoice, open bill, customer credit, and vendor credit reports using the same cutover date.",
      "Include Invoice Number, Customer, Invoice Date, Due Date, Item, Qty, Rate, Amount, and tax or discount columns when the report provides them.",
      "If an invoice has several lines, repeat its Invoice Number on every line; PennyWise Accounting will combine those rows into one posted invoice.",
      "Save the trial balance, balance sheet, profit and loss, receivables aging, payables aging, sales-tax liability, inventory valuation, and bank-reconciliation reports as control evidence.",
      "Retain the audit trail, attachments, payroll history/forms, jobs/classes, fixed assets, memorized transactions, and bank-feed history separately; the first import does not recreate those features from a report export."
    ],
    helpUrl:
      "https://quickbooks.intuit.com/learn-support/en-us/help-article/export-reports/export-reports-quickbooks-desktop/L8q1oV7ZJ_US_en_US"
  },
  XERO: {
    name: "Xero",
    summary:
      "Export operational lists and open documents together with reports that preserve your cutover and foreign-currency evidence.",
    steps: [
      "Export the chart of accounts, contacts, items, invoices, bills, credit notes, and fixed-asset register where used.",
      "Save the trial balance, balance sheet, profit and loss, receivable invoice detail, and payable invoice detail at cutover.",
      "Retain GST or sales-tax reports, bank reconciliation reports, and every source-currency and base-currency column.",
      "Keep a read-only Xero organization until balances, aging, tax, bank, and currency totals reconcile in PennyWise Accounting."
    ],
    helpUrl: "https://central.xero.com/s/article/Export-data-out-of-Xero"
  },
  WAVE: {
    name: "Wave",
    summary:
      "Use Wave's data export and retain the reports needed to prove your accounting and base-currency balances.",
    steps: [
      "Download the accounting data export, customers, vendors, bills, and receipt images.",
      "Save the trial balance, balance sheet, profit and loss, receivables, payables, and sales-tax reports at cutover.",
      "Export transactions, invoices, and products separately when the data export does not contain the detail you need.",
      "Confirm the Wave business base currency before building PennyWise Accounting opening balances."
    ],
    helpUrl: "https://support.waveapps.com/hc/en-us/articles/4411360860692-Export-your-data"
  },
  FRESHBOOKS: {
    name: "FreshBooks",
    summary:
      "Export both reports and operational records, and preserve document evidence that may not be represented in report CSV files.",
    steps: [
      "Export clients, services or items, invoices, payments, expenses, vendors, and bills where available.",
      "Save the general ledger, trial balance, profit and loss, balance sheet, and receivables or payables aging reports at cutover.",
      "Retain invoice PDFs, expense receipts, tax reports, and any project or time-tracking history you need to reference.",
      "Confirm whether each source report uses cash or accrual accounting before comparing it with PennyWise Accounting."
    ],
    helpUrl: "https://support.freshbooks.com/hc/en-us/articles/227478548-How-do-I-export-my-reports"
  },
  SAGE: {
    name: "Sage",
    summary:
      "Create a recoverable Sage backup and export the lists, open documents, and accounting reports needed for a controlled cutover.",
    steps: [
      "Back up the source company, then export the chart of accounts, customers, vendors, products, invoices, and bills.",
      "Save the trial balance, balance sheet, profit and loss, aging, tax, inventory, and bank reconciliation reports at cutover.",
      "Retain transaction detail, attachments, payroll history, and fixed-asset schedules outside the first CSV import.",
      "Keep the Sage backup and a read-only source available until every control total agrees."
    ],
    helpUrl:
      "https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=2&q=&solutionid=210129222721353"
  },
  ZOHO_BOOKS: {
    name: "Zoho Books",
    summary:
      "Create an organization backup or full export, then retain source reports that verify the imported balances.",
    steps: [
      "Export the chart of accounts, customers, vendors, items, invoices, bills, credit notes, and payments.",
      "Save opening balances, trial balance, balance sheet, profit and loss, aging, tax, inventory, and bank reports at cutover.",
      "Retain attachments, audit history, projects, timesheets, and integrations as a separate source archive.",
      "Compare every control total before completing the import and making Zoho Books read-only."
    ],
    helpUrl: "https://www.zoho.com/ca/books/migration.html"
  },
  OTHER: {
    name: "a CSV or spreadsheet export",
    summary:
      "Create one unchanged source copy per record type and preserve reports that prove the balances you intend to move.",
    steps: [
      "Export one CSV for each list or transaction type and keep an untouched copy before cleaning column names.",
      "Save the trial balance, balance sheet, profit and loss, receivables aging, payables aging, tax, inventory, and bank reconciliation reports.",
      "Record the source base currency, cutover date, accounting method, tax treatment, and any unsupported fields.",
      "Test first, reconcile every control total, and retain the old system or a complete archive as read-only evidence."
    ],
    helpUrl: null
  }
};
const dataImportTemplates = {
  CHART_OF_ACCOUNTS: {
    slug: "chart-of-accounts",
    headers: ["code", "name", "type", "subtype", "is_control", "external_id"],
    example: ["1000", "Operating bank", "ASSET", "BANK", "false", "source-account-1000"]
  },
  CUSTOMERS: {
    slug: "customers",
    headers: [
      "customer_number",
      "display_name",
      "legal_name",
      "email",
      "payment_terms_days",
      "external_id"
    ],
    example: ["C-100", "Example Customer", "Example Customer Ltd", "", "30", "source-customer-100"]
  },
  VENDORS: {
    slug: "vendors",
    headers: [
      "vendor_number",
      "legal_name",
      "display_name",
      "email",
      "payment_terms_days",
      "external_id"
    ],
    example: ["V-100", "Example Supplier Ltd", "Example Supplier", "", "30", "source-vendor-100"]
  },
  PRODUCTS: {
    slug: "products-and-services",
    headers: [
      "name",
      "item_type",
      "sales_price_minor",
      "income_account_code",
      "sku",
      "description",
      "unit_of_measure",
      "external_id"
    ],
    example: [
      "Example service",
      "SERVICE",
      "12500",
      "4000",
      "SERVICE-100",
      "Example only - 12500 means 125.00",
      "hour",
      "source-item-100"
    ]
  },
  OPENING_BALANCES: {
    slug: "opening-balances",
    headers: [
      "account_code",
      "debit_minor",
      "credit_minor",
      "effective_date",
      "note",
      "external_id"
    ],
    example: ["1000", "100000", "0", "2026-01-01", "Example only", "source-opening-1000"]
  },
  OUTSTANDING_INVOICES: {
    slug: "outstanding-invoices",
    headers: [
      "customer_number",
      "issue_date",
      "due_date",
      "amount_minor",
      "external_id",
      "description",
      "sku",
      "quantity",
      "unit_price_minor",
      "tax_amount_minor",
      "discount_amount_minor",
      "tax_code",
      "payment_terms_days",
      "terms"
    ],
    example: [
      "C-100",
      "2026-01-15",
      "2026-02-14",
      "25000",
      "INV-100",
      "Example open invoice line",
      "SERVICE-100",
      "1",
      "25000",
      "0",
      "0",
      "",
      "30",
      "Net 30"
    ]
  },
  OUTSTANDING_BILLS: {
    slug: "outstanding-bills",
    headers: [
      "vendor_number",
      "vendor_invoice_number",
      "issue_date",
      "due_date",
      "amount_minor",
      "expense_account_code",
      "description",
      "external_id",
      "sku",
      "quantity",
      "unit_cost_minor",
      "discount_amount_minor",
      "tax_amount_minor",
      "tax_code",
      "payment_terms_days",
      "terms"
    ],
    example: [
      "V-100",
      "BILL-100",
      "2026-01-15",
      "2026-02-14",
      "15000",
      "5000",
      "Example open bill line",
      "source-bill-100",
      "",
      "1",
      "15000",
      "0",
      "0",
      "",
      "30",
      "Net 30"
    ]
  },
  CUSTOMER_CREDITS: {
    slug: "customer-opening-credits",
    headers: ["customer_number", "amount_minor", "effective_date", "external_id"],
    example: ["C-100", "5000", "2026-01-01", "source-customer-credit-100"]
  },
  VENDOR_CREDITS: {
    slug: "vendor-opening-credits",
    headers: ["vendor_number", "amount_minor", "effective_date", "external_id"],
    example: ["V-100", "5000", "2026-01-01", "source-vendor-credit-100"]
  },
  INVENTORY_OPENING: {
    slug: "inventory-opening",
    headers: ["sku", "quantity", "unit_cost_minor", "effective_date", "external_id"],
    example: ["SKU-100", "10", "2500", "2026-01-01", "source-inventory-100"]
  },
  HISTORICAL_ARCHIVE: {
    slug: "historical-archive",
    headers: ["record_type", "external_id", "occurred_at"],
    example: ["SOURCE_TRANSACTION", "source-transaction-100", "2025-12-31"]
  }
};
const foreignMigrationWarningTypes = new Set([
  "CUSTOMERS",
  "VENDORS",
  "OPENING_BALANCES",
  "OUTSTANDING_INVOICES",
  "OUTSTANDING_BILLS",
  "CUSTOMER_CREDITS",
  "VENDOR_CREDITS",
  "INVENTORY_OPENING"
]);
const sourceControlRequiredImportTypes = new Set([
  "OPENING_BALANCES",
  "OUTSTANDING_INVOICES",
  "OUTSTANDING_BILLS",
  "INVENTORY_OPENING"
]);
const importFieldAliases = {
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
  record_type: ["record_type", "transaction_type", "type"]
};
const importFieldLabels = {
  code: "Account code",
  name: "Name",
  type: "Account type",
  subtype: "Account subtype",
  is_control: "Control account",
  customer_number: "Customer number",
  vendor_number: "Vendor number",
  display_name: "Display name",
  legal_name: "Legal name",
  item_type: "Product or service type",
  sales_price_minor: "Sales price (minor units)",
  income_account_code: "Income account code",
  expense_account_code: "Expense account code",
  account_code: "Account code",
  debit_minor: "Debit (minor units)",
  credit_minor: "Credit (minor units)",
  effective_date: "Effective date",
  issue_date: "Issue date",
  due_date: "Due date",
  amount_minor: "Amount (minor units)",
  vendor_invoice_number: "Vendor invoice number",
  external_id: "Source identifier",
  record_type: "Record type",
  sku: "SKU",
  description: "Description",
  unit_of_measure: "Unit of measure",
  payment_terms_days: "Payment terms (days)",
  email: "Email",
  note: "Note",
  quantity: "Quantity",
  unit_cost_minor: "Unit cost (minor units)",
  occurred_at: "Occurred at"
};
let currentImportBatch = null;
let importFilePreview = null;
let importColumnMapping = {};
let currentImportItemMatches = null;
let importOutcomePage = 0;
const importOutcomePageSize = 50;
let recentImportBatches = [];
let currentOrganizationExport = null;
let currentClosureRequest = null;
const requiredImportFieldCount = {
  CHART_OF_ACCOUNTS: 3,
  CUSTOMERS: 2,
  VENDORS: 3,
  PRODUCTS: 4,
  OPENING_BALANCES: 4,
  OUTSTANDING_INVOICES: 4,
  OUTSTANDING_BILLS: 7,
  CUSTOMER_CREDITS: 3,
  VENDOR_CREDITS: 3,
  INVENTORY_OPENING: 4,
  HISTORICAL_ARCHIVE: 2
};

export function initPortability() {
  elements["data-import-form"].addEventListener("submit", uploadDataImport);
  elements["data-import-form"].elements.sourceSystem.addEventListener("change", () => {
    renderImportSourceGuide();
    resetImportWizard(true);
    setMigrationStep(0);
  });
  elements["data-import-form"].elements.importType.addEventListener("change", () => {
    renderImportTemplateGuidance();
    resetImportWizard(false);
    if (importFilePreview) seedImportColumnMapping();
    void loadRecentImportBatches();
  });
  elements["data-import-form"].elements.file.addEventListener("change", inspectDataImportFile);
  elements["import-preview-tab"].addEventListener("click", () => setImportMappingTab("preview"));
  elements["import-mapper-tab"].addEventListener("click", () => setImportMappingTab("mapper"));
  elements["download-import-template"].addEventListener("click", downloadImportTemplate);
  elements["dry-run-data-import"].addEventListener("click", dryRunDataImport);
  elements["commit-data-import"].addEventListener("click", commitDataImport);
  elements["import-source-controls-form"].addEventListener("submit", saveImportSourceControls);
  elements["acknowledge-data-import"].addEventListener("click", acknowledgeDataImport);
  elements["download-import-errors"].addEventListener("click", downloadDataImportErrors);
  elements["refresh-import-history"].addEventListener("click", loadRecentImportBatches);
  elements["recent-import-batches"].addEventListener("click", handleRecentImportAction);
  elements["previous-import-outcome-page"].addEventListener("click", () => {
    importOutcomePage = Math.max(0, importOutcomePage - 1);
    renderImportOutcomeReview(currentImportBatch);
  });
  elements["next-import-outcome-page"].addEventListener("click", () => {
    importOutcomePage += 1;
    renderImportOutcomeReview(currentImportBatch);
  });
  elements["previous-import-item-matches"].addEventListener("click", () => {
    void loadImportItemMatchPage(Math.max(0, Number(currentImportItemMatches?.offset ?? 0) - 25));
  });
  elements["next-import-item-matches"].addEventListener("click", () => {
    if (currentImportItemMatches?.nextOffset != null)
      void loadImportItemMatchPage(currentImportItemMatches.nextOffset);
  });
  elements["organization-export-form"].addEventListener("submit", requestOrganizationExport);
  elements["refresh-organization-export"].addEventListener("click", refreshOrganizationExport);
  elements["download-organization-export"].addEventListener("click", downloadOrganizationExport);
  elements["organization-closure-form"].addEventListener("submit", requestOrganizationClosure);
  elements["finalize-organization-closure"].addEventListener("click", finalizeOrganizationClosure);
}

export async function loadPortability() {
  elements["portability-workspace"].hidden = !identity?.activeOrganizationId;
  if (identity?.activeOrganizationId) await loadRecentImportBatches();
}

async function loadRecentImportBatches() {
  if (!identity?.activeOrganizationId || !identity?.activeCompanyId) return;
  const importType = elements["data-import-form"].elements.importType.value;
  elements["import-history-status"].textContent = "Loading recent imports...";
  const response = await api(`/v1/imports?importType=${encodeURIComponent(importType)}&limit=10`);
  if (!response.ok) {
    recentImportBatches = [];
    renderRecentImportBatches();
    elements["import-history-status"].textContent =
      response.status === 403
        ? "Your role cannot review import history for this data type."
        : "Recent import history is temporarily unavailable.";
    return;
  }
  recentImportBatches = (await response.json()).batches ?? [];
  renderRecentImportBatches();
  elements["import-history-status"].textContent = recentImportBatches.length
    ? `${recentImportBatches.length} recent batch${recentImportBatches.length === 1 ? "" : "es"} available.`
    : "No prior imports for this data type.";
}

function renderRecentImportBatches() {
  elements["recent-import-batches"].replaceChildren(
    ...recentImportBatches.map((batch) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary-command";
      action.dataset.importBatchId = batch.id;
      action.textContent = currentImportBatch?.id === batch.id ? "Open" : "Resume";
      action.setAttribute(
        "aria-label",
        `Resume ${batch.sourceFilename ?? "import batch"} in the Switching centre`
      );
      return row([
        batch.sourceFilename ?? "Uploaded source",
        formatImportSource(batch.sourceSystem),
        String(batch.rowCount ?? 0),
        formatImportStatus(batch.status),
        formatConnectorTime(batch.updatedAt),
        action
      ]);
    })
  );
}

async function handleRecentImportAction(event) {
  const button = event.target.closest("[data-import-batch-id]");
  if (!button) return;
  button.disabled = true;
  const response = await api(`/v1/imports/${encodeURIComponent(button.dataset.importBatchId)}`);
  button.disabled = false;
  if (!response.ok) return showError(response);
  currentImportBatch = (await response.json()).batch;
  importOutcomePage = 0;
  const form = elements["data-import-form"];
  form.elements.importType.value = currentImportBatch.importType;
  form.elements.sourceSystem.value = currentImportBatch.sourceSystem;
  form.elements.file.value = "";
  renderImportSourceGuide();
  renderImportTemplateGuidance();
  hydrateImportPreviewFromBatch(currentImportBatch);
  renderDataImport();
  renderRecentImportBatches();
  elements["data-import-status"].scrollIntoView({
    behavior: preferredScrollBehavior(),
    block: "center"
  });
  showNotice("Import batch reopened at its saved stage. No records were changed.");
}

async function uploadDataImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const file = data.get("file");
  if (!(file instanceof globalThis.File) || !file.size)
    return showNotice("Select a CSV or XLSX file.");
  const mediaType = importMediaType(file);
  if (!mediaType)
    return showNotice(
      "Choose a .csv file or an .xlsx workbook. Excel 97-2003 and macro-enabled workbooks are not accepted."
    );
  let mapping;
  try {
    mapping = JSON.parse(data.get("mapping") || "{}");
    if (!mapping || Array.isArray(mapping) || typeof mapping !== "object")
      throw new Error("Mapping must be an object.");
  } catch {
    return showNotice("Column mapping must be a JSON object.");
  }
  const upload = await api(
    `/v1/imports/upload?importType=${encodeURIComponent(data.get("importType"))}&sourceSystem=${encodeURIComponent(data.get("sourceSystem"))}`,
    {
      method: "POST",
      headers: { "content-type": mediaType, "x-file-name": file.name },
      body: await file.arrayBuffer()
    }
  );
  if (!upload.ok) return showError(upload);
  importOutcomePage = 0;
  currentImportBatch = (await upload.json()).batch;
  const preview = await api(
    `/v1/imports/${currentImportBatch.id}/preview`,
    jsonRequest({ mapping })
  );
  if (!preview.ok) return showError(preview);
  currentImportBatch = (await preview.json()).batch;
  hydrateImportPreviewFromBatch(currentImportBatch);
  renderDataImport();
  await loadRecentImportBatches();
  trackProductEvent("MIGRATION_PREVIEW_COMPLETED");
}

function importMediaType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return null;
}

async function inspectDataImportFile() {
  const file = elements["data-import-form"].elements.file.files?.[0];
  resetImportItemMatchReview();
  if (!file?.size) return;
  if (!importMediaType(file)) {
    importFilePreview = null;
    elements["import-mapping-workspace"].hidden = true;
    elements["data-import-file-summary"].textContent =
      "Choose a .csv file or an .xlsx workbook; .xls and macro-enabled files cannot be reviewed.";
    return;
  }
  setMigrationStep(1);
  elements["data-import-file-summary"].textContent =
    `Inspecting ${file.name} without uploading it…`;
  try {
    importFilePreview = file.name.toLowerCase().endsWith(".csv")
      ? parseLocalImportCsv(await file.text(), file)
      : workbookSelectionPreview(file);
    seedImportColumnMapping();
    elements["import-mapping-workspace"].hidden = false;
    setImportMappingTab("preview");
  } catch (error) {
    importFilePreview = null;
    elements["import-mapping-workspace"].hidden = true;
    elements["data-import-file-summary"].textContent =
      error instanceof Error ? error.message : "The selected file could not be inspected.";
  }
}

function parseLocalImportCsv(text, file) {
  const records = parseImportCsvRecords(text.replace(/^\uFEFF/, ""));
  if (records.length < 2)
    throw new Error("CSV needs one header row and at least one representative data row.");
  const headers = records[0].map(normalizeImportHeader);
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length)
    throw new Error("CSV headings must be non-empty and unique before they can be mapped.");
  return {
    format: "CSV",
    fileName: file.name,
    byteSize: file.size,
    sheet: "Not applicable",
    headers,
    rows: records.slice(1, 6).map((record) => headers.map((_, index) => record[index] ?? "")),
    warnings: [],
    sourceHint: detectImportSource(headers)
  };
}

function workbookSelectionPreview(file) {
  return {
    format: "XLSX",
    fileName: file.name,
    byteSize: file.size,
    sheet: "Selected safely during upload review",
    headers: [],
    rows: [],
    warnings: [
      "The workbook sheet and values are inspected by PennyWise Accounting after upload; no workbook contents are read in this browser preview.",
      "Only an .xlsx workbook is accepted. Macro, external-link, and unsafe archive content will be rejected before mapping."
    ],
    sourceHint: null
  };
}

function detectImportSource(headers) {
  const sourceHeaders = new Set(headers);
  const signals = [
    {
      source: "QUICKBOOKS_DESKTOP",
      name: "QuickBooks Desktop",
      fields: ["invoice_number", "item", "qty", "rate", "line_amount"]
    },
    {
      source: "QUICKBOOKS_ONLINE",
      name: "QuickBooks Online",
      fields: ["customer", "transaction_date", "amount", "tax_amount", "balance"]
    }
  ]
    .map((candidate) => ({
      ...candidate,
      matched: candidate.fields.filter((field) => sourceHeaders.has(field)).length
    }))
    .filter((candidate) => candidate.matched >= 2)
    .sort((left, right) => right.matched - left.matched);
  if (!signals.length) return null;
  const [best, runnerUp] = signals;
  if (runnerUp && runnerUp.matched === best.matched) return null;
  return {
    source: best.source,
    name: best.name,
    matched: best.matched
  };
}

function parseImportCsvRecords(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = "";
    } else if (character !== "\r") field += character;
  }
  if (quoted) throw new Error("CSV has an unfinished quoted value.");
  record.push(field);
  if (record.some((value) => value.trim())) records.push(record);
  return records;
}

function normalizeImportHeader(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function seedImportColumnMapping() {
  const fields = importFieldsForType(elements["data-import-form"].elements.importType.value);
  const headers = importFilePreview?.headers ?? [];
  importColumnMapping = Object.fromEntries(
    fields.map((field) => {
      const match = [field.name, ...(importFieldAliases[field.name] ?? [])].find((candidate) =>
        headers.includes(candidate)
      );
      return [field.name, match ?? ""];
    })
  );
  syncImportMappingJson();
  renderImportFileReview();
}

function importFieldsForType(type) {
  const template = dataImportTemplates[type];
  if (!template) return [];
  const requiredCount = requiredImportFieldCount[type] ?? template.headers.length;
  return template.headers.map((name, index) => ({ name, required: index < requiredCount }));
}

function renderImportFileReview() {
  if (!importFilePreview) return;
  const preview = importFilePreview;
  elements["data-import-file-summary"].textContent =
    `${preview.fileName} · ${preview.format} · ${formatFileSize(preview.byteSize)} · ${preview.headers.length ? `${preview.headers.length} columns ready to map` : "workbook ready for secure sheet review"}`;
  elements["import-workbook-metadata"].replaceChildren(
    ...[
      ["File", preview.fileName],
      ["Format", preview.format],
      ["Size", formatFileSize(preview.byteSize)],
      ["Sheet", preview.sheet],
      [
        "Preview",
        preview.rows.length
          ? `${preview.rows.length} representative rows; leading zeroes are displayed as text.`
          : "Available after secure upload review"
      ]
    ].flatMap(([term, description]) => [definitionTerm(term), definitionDescription(description)])
  );
  const warnings = elements["import-workbook-warnings"];
  warnings.hidden = !preview.warnings.length;
  warnings.replaceChildren(...preview.warnings.map((warning) => importWarningItem(warning)));
  renderImportPreviewTable(preview);
  renderImportColumnMapper();
  renderImportSourceDetection();
}

function renderImportPreviewTable(preview) {
  const table = elements["import-preview-table"];
  const hasRows = preview.headers.length && preview.rows.length;
  table.closest(".table-wrap").hidden = !hasRows;
  if (!hasRows) return;
  table
    .querySelector("thead")
    .replaceChildren(headerRow(preview.headers.map((header) => header.replaceAll("_", " "))));
  table
    .querySelector("tbody")
    .replaceChildren(...preview.rows.map((values) => row(values.map((value) => value || "—"))));
}

function renderImportColumnMapper() {
  const fields = importFieldsForType(elements["data-import-form"].elements.importType.value);
  const headers = importFilePreview?.headers ?? [];
  const mapped = Object.entries(importColumnMapping).filter(([, source]) => source);
  const sourceCounts = mapped.reduce((counts, [, source]) => {
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});
  const missing = fields.filter((field) => field.required && !importColumnMapping[field.name]);
  const duplicates = Object.entries(sourceCounts).filter(([, count]) => count > 1);
  const mappedCount = mapped.length;
  elements["import-mapping-completeness"].textContent = missing.length
    ? `${mappedCount} of ${fields.length} fields mapped; ${missing.length} required field${missing.length === 1 ? "" : "s"} still need attention.`
    : `${mappedCount} of ${fields.length} fields mapped; required fields are complete. Review duplicate mappings before testing.`;
  elements["import-mapping-issues"].textContent = [
    missing.length
      ? `Required: ${missing.map((field) => importFieldLabel(field.name)).join(", ")}.`
      : "Required fields are mapped.",
    duplicates.length
      ? `Duplicate source column: ${duplicates.map(([source]) => source).join(", ")}. Choose each source column once unless it intentionally supplies both fields.`
      : "No duplicate source columns."
  ].join(" ");
  elements["import-column-mapper"].replaceChildren(
    ...fields.map((field) => {
      const wrapper = document.createElement("label");
      wrapper.className = `import-mapping-row${field.required && !importColumnMapping[field.name] ? " has-error" : ""}`;
      const confidence = importMappingConfidence(field.name, importColumnMapping[field.name]);
      wrapper.innerHTML = `<span class="import-target-field"><strong>${escapeHtml(importFieldLabel(field.name))}</strong><small>${field.required ? "Required" : "Optional"}${minorUnitGuidance(field.name)}</small></span>`;
      const select = document.createElement("select");
      select.name = `mapping-${field.name}`;
      select.setAttribute("aria-label", `Map ${importFieldLabel(field.name)} to a source column`);
      select.append(
        option("", "Choose source column"),
        ...headers.map((header) => option(header, header))
      );
      select.value = importColumnMapping[field.name] ?? "";
      select.addEventListener("change", () => {
        importColumnMapping[field.name] = select.value;
        syncImportMappingJson();
        renderImportColumnMapper();
      });
      const reasoning = document.createElement("span");
      reasoning.className = `mapping-confidence ${confidence.kind}`;
      reasoning.textContent = confidence.text;
      wrapper.append(select, reasoning);
      return wrapper;
    })
  );
  const ignored = headers.filter((header) => !Object.values(importColumnMapping).includes(header));
  elements["ignored-import-columns"].textContent = ignored.length
    ? ignored.join(", ")
    : headers.length
      ? "None. Every source column is currently mapped."
      : "Workbook headings will be available after secure upload review.";
}

function importMappingConfidence(field, source) {
  if (!source) return { kind: "needs-attention", text: "Needs a source column" };
  if (source === field) return { kind: "high", text: "High confidence: exact heading" };
  if ((importFieldAliases[field] ?? []).includes(source))
    return { kind: "medium", text: "Suggested: recognized source heading" };
  return { kind: "review", text: "Manual choice: review values" };
}

function minorUnitGuidance(field) {
  return /(?:_minor|debit_minor|credit_minor)$/.test(field)
    ? " · API value is minor units: 12500 represents $125.00"
    : "";
}

function importFieldLabel(field) {
  return importFieldLabels[field] ?? field.replaceAll("_", " ");
}

function syncImportMappingJson() {
  elements["data-import-form"].elements.mapping.value = JSON.stringify(
    Object.fromEntries(Object.entries(importColumnMapping).filter(([, source]) => source)),
    null,
    2
  );
}

function setImportMappingTab(tab) {
  const preview = tab === "preview";
  elements["import-preview-tab"].setAttribute("aria-selected", String(preview));
  elements["import-preview-tab"].tabIndex = preview ? 0 : -1;
  elements["import-preview-panel"].hidden = !preview;
  elements["import-mapper-tab"].setAttribute("aria-selected", String(!preview));
  elements["import-mapper-tab"].tabIndex = preview ? -1 : 0;
  elements["import-mapper-panel"].hidden = preview;
}

function resetImportWizard(clearFile) {
  currentImportBatch = null;
  resetImportItemMatchReview();
  if (clearFile) {
    const fileInput = elements["data-import-form"].elements.file;
    fileInput.value = "";
    importFilePreview = null;
    importColumnMapping = {};
    elements["import-mapping-workspace"].hidden = true;
    elements["data-import-file-summary"].textContent =
      "Choose an unchanged source export to inspect columns before upload.";
  }
  renderDataImport();
}

function hydrateImportPreviewFromBatch(batch) {
  currentImportItemMatches = batch?.itemMatchSuggestions ?? null;
  if (!batch?.rows?.length) return;
  const headers = Object.keys(batch.rows[0].rawData ?? {});
  if (!headers.length) return;
  importFilePreview = {
    format: batch.sourceFilename?.toLowerCase().endsWith(".xlsx") ? "XLSX" : "CSV",
    fileName: batch.sourceFilename ?? "Uploaded import",
    byteSize: Number(batch.byteSize ?? 0),
    sheet:
      batch.sourceMetadata?.sheet?.name ??
      (batch.sourceFilename?.toLowerCase().endsWith(".xlsx")
        ? "Selected safely during upload review"
        : "Not applicable"),
    headers,
    rows: batch.rows
      .slice(0, 5)
      .map((source) => headers.map((header) => String(source.rawData?.[header] ?? ""))),
    warnings: Array.isArray(batch.sourceMetadata?.warnings) ? batch.sourceMetadata.warnings : []
  };
  importColumnMapping = batch.mapping ?? importColumnMapping;
  elements["import-mapping-workspace"].hidden = false;
  renderImportFileReview();
}

function importWarningItem(value) {
  const item = document.createElement("li");
  item.textContent = value;
  return item;
}

async function dryRunDataImport() {
  if (!currentImportBatch) return;
  const response = await api(`/v1/imports/${currentImportBatch.id}/dry-run`, jsonRequest({}));
  if (!response.ok) return showError(response);
  currentImportBatch = (await response.json()).batch;
  renderDataImport();
  await loadRecentImportBatches();
  trackProductEvent("MIGRATION_DRY_RUN_COMPLETED");
  trackProductEvent("MIGRATION_REVIEW_COMPLETED");
}

async function commitDataImport() {
  const resuming = currentImportBatch?.status === "RETRYABLE";
  if (
    !currentImportBatch ||
    !window.confirm(
      resuming
        ? "Resume this import? PennyWise will continue only unfinished commit units and reuse the original idempotency keys."
        : "Complete this tested import? PennyWise Accounting will add the reviewed records to this business."
    )
  )
    return;
  const response = await api(
    `/v1/imports/${currentImportBatch.id}/${resuming ? "resume" : "commit"}`,
    jsonRequest({})
  );
  if (!response.ok) return showError(response);
  currentImportBatch = (await response.json()).batch;
  renderDataImport();
  await Promise.all([
    loadSales(),
    loadPurchases(),
    loadInventory(),
    loadReports(),
    loadRecentImportBatches()
  ]);
}

async function acknowledgeDataImport() {
  if (!currentImportBatch) return;
  const response = await api(`/v1/imports/${currentImportBatch.id}/acknowledge`, jsonRequest({}));
  if (!response.ok) return showError(response);
  currentImportBatch = (await response.json()).batch;
  renderDataImport();
  await loadRecentImportBatches();
  trackProductEvent("MIGRATION_RECONCILIATION_ACKNOWLEDGED");
}

async function saveImportSourceControls(event) {
  event.preventDefault();
  if (!currentImportBatch) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const openingBalances = currentImportBatch.importType === "OPENING_BALANCES";
  const body = {
    sourceReportName: String(data.get("sourceReportName") ?? "").trim(),
    sourceReportDate: String(data.get("sourceReportDate") ?? "").trim(),
    sourceReportChecksum: String(data.get("sourceReportChecksum") ?? "").trim() || undefined,
    sourceDebitMinor: openingBalances
      ? String(data.get("sourceDebitMinor") ?? "").trim()
      : undefined,
    sourceCreditMinor: openingBalances
      ? String(data.get("sourceCreditMinor") ?? "").trim()
      : undefined,
    sourceBalanceMinor: openingBalances
      ? undefined
      : String(data.get("sourceBalanceMinor") ?? "").trim()
  };
  elements["save-import-source-controls"].disabled = true;
  elements["import-source-controls-status"].textContent = "Comparing source totals...";
  const response = await api(
    `/v1/imports/${currentImportBatch.id}/source-controls`,
    jsonRequest(body, "PUT")
  );
  elements["save-import-source-controls"].disabled = false;
  if (!response.ok) {
    elements["import-source-controls-status"].textContent =
      "The source totals could not be saved. Review the highlighted values and try again.";
    return showError(response);
  }
  currentImportBatch = (await response.json()).batch;
  const status = currentImportBatch.reconciliation?.sourceControlStatus;
  elements["import-source-controls-status"].textContent =
    status === "MATCH"
      ? "Source and PennyWise totals agree. The migration can now be confirmed."
      : currentImportBatch.status === "COMMITTED"
        ? "A difference remains. Keep the source system read-only and investigate before confirming."
        : "Source totals saved. PennyWise will compare them after the import is committed.";
  renderDataImport();
  await loadRecentImportBatches();
}

function renderDataImport() {
  if (!currentImportBatch) {
    elements["data-import-status"].textContent = importFilePreview
      ? "File inspected locally. Review the suggested mapping, then upload to create an immutable import batch."
      : "No import uploaded yet. Choose a source and file to begin the guided migration.";
    renderImportOutcomeReview(null);
    elements["dry-run-data-import"].disabled = true;
    elements["commit-data-import"].disabled = true;
    elements["acknowledge-data-import"].disabled = true;
    elements["download-import-errors"].disabled = true;
    setMigrationStep(importFilePreview ? 1 : 0);
    return;
  }
  const rows = currentImportBatch?.rows ?? [];
  const valid = rows.filter((row) => row.status === "VALID").length;
  const invalid = rows.filter((row) => row.status === "INVALID").length;
  const skipped = rows.filter((row) => row.status === "SKIPPED").length;
  elements["data-import-status"].textContent = [
    `Source: ${formatImportSource(currentImportBatch.sourceSystem)}`,
    `File: ${currentImportBatch.sourceFilename ?? "uploaded source"}`,
    currentImportBatch.checksum ? `Source SHA-256: ${currentImportBatch.checksum}` : "",
    `Batch ${currentImportBatch.id} | ${formatImportStatus(currentImportBatch.status)}`,
    `${valid} ready | ${invalid} need attention | ${skipped} skipped`
  ]
    .filter(Boolean)
    .join("\n");
  renderImportOutcomeReview(currentImportBatch);
  elements["dry-run-data-import"].disabled =
    currentImportBatch.status !== "PREVIEWED" || invalid > 0;
  elements["commit-data-import"].disabled = !["DRY_RUN", "RETRYABLE"].includes(
    currentImportBatch.status
  );
  elements["commit-data-import"].textContent =
    currentImportBatch.status === "RETRYABLE" ? "Resume import" : "Complete import";
  elements["acknowledge-data-import"].disabled =
    currentImportBatch.status !== "COMMITTED" ||
    (sourceControlRequiredImportTypes.has(currentImportBatch.importType) &&
      currentImportBatch.reconciliation?.sourceControlStatus !== "MATCH");
  elements["download-import-errors"].disabled = invalid === 0 && !currentImportBatch.errorReport;
  renderImportItemMatchReview();
  setMigrationStep(
    {
      PREVIEWED: 2,
      DRY_RUN: 3,
      RETRYABLE: 4,
      COMMITTED: 4,
      RECONCILED: 5
    }[currentImportBatch.status] ?? 1
  );
}

function renderImportOutcomeReview(batch) {
  const panel = elements["import-outcome-review"];
  if (!panel) return;
  if (!batch) {
    panel.hidden = true;
    elements["import-outcome-metrics"].replaceChildren();
    elements["import-outcome-table"].querySelector("tbody").replaceChildren();
    elements["import-outcome-page-status"].textContent = "";
    elements["previous-import-outcome-page"].disabled = true;
    elements["next-import-outcome-page"].disabled = true;
    elements["import-reconciliation-card"].hidden = true;
    return;
  }
  panel.hidden = false;
  const rows = Array.isArray(batch.rows) ? batch.rows : [];
  const counts = {
    total: rows.length,
    ready: rows.filter((row) => row.status === "VALID").length,
    imported: rows.filter((row) => row.status === "IMPORTED").length,
    staged: rows.filter((row) => row.status === "STAGED").length,
    flagged: rows.filter((row) => row.status === "INVALID" || row.status === "FAILED").length,
    skipped: rows.filter((row) => row.status === "SKIPPED").length
  };
  const tested = ["DRY_RUN", "COMMITTING", "RETRYABLE", "COMMITTED", "RECONCILED"].includes(
    batch.status
  );
  const reconciled = ["COMMITTED", "RECONCILED"].includes(batch.status);
  elements["import-outcome-boundary"].textContent = reconciled
    ? batch.status === "RECONCILED"
      ? "Acknowledged"
      : "Reconciliation required"
    : batch.status === "RETRYABLE"
      ? "Safe resume available"
      : tested
        ? "Dry run passed"
        : counts.flagged
          ? "Needs attention"
          : "Review first";
  elements["import-outcome-summary"].textContent = reconciled
    ? "The committed records are shown with their source identifiers. Compare the control totals below before acknowledging the migration."
    : batch.status === "RETRYABLE"
      ? "A commit unit failed. Completed units are preserved; use Resume import to continue only unfinished units with the original idempotency keys."
      : tested
        ? "The non-posting test passed. PennyWise Accounting will only create records after the explicit commit action."
        : counts.flagged
          ? "Rows with errors cannot be tested or committed. Fix the mapping or source data, then upload and preview again."
          : "Review each source row and mapping before running the non-posting test.";
  const metricValues = [
    ["Source rows", counts.total],
    ["Ready", counts.ready],
    ["Imported", counts.imported],
    ["Staged", counts.staged],
    ["Flagged", counts.flagged],
    ["Skipped", counts.skipped]
  ];
  elements["import-outcome-metrics"].replaceChildren(
    ...metricValues.flatMap(([term, value]) => [definitionTerm(term), definitionDescription(value)])
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / importOutcomePageSize));
  const page = Math.min(Math.max(importOutcomePage, 0), pageCount - 1);
  importOutcomePage = page;
  const pageStart = page * importOutcomePageSize;
  const reviewedRows = rows.slice(pageStart, pageStart + importOutcomePageSize);
  const body = elements["import-outcome-table"].querySelector("tbody");
  body.replaceChildren(
    ...reviewedRows.map((rowValue) => {
      const errors = Array.isArray(rowValue.errors)
        ? rowValue.errors
            .map((error) => (error && typeof error.message === "string" ? error.message : ""))
            .filter(Boolean)
        : [];
      const sourceIdentifier = importOutcomeIdentifier(rowValue);
      const note = errors.length
        ? errors.join("; ")
        : rowValue.status === "IMPORTED"
          ? "Created through the existing accounting service."
          : rowValue.status === "STAGED"
            ? "A recoverable commit unit is staged. Resume the import; do not recreate it manually."
            : rowValue.status === "SKIPPED"
              ? "Skipped by the importer; review before acknowledging."
              : rowValue.status === "VALID"
                ? "Ready for the non-posting test."
                : "Awaiting preview.";
      return row([
        String(rowValue.rowNumber ?? "—"),
        formatImportRowStatus(rowValue.status),
        sourceIdentifier,
        note
      ]);
    })
  );
  const firstReviewed = reviewedRows.length ? pageStart + 1 : 0;
  const lastReviewed = pageStart + reviewedRows.length;
  elements["import-outcome-page-status"].textContent = reviewedRows.length
    ? `Reviewing ${reviewedRows.length} ${reviewedRows.length === 1 ? "row" : "rows"} (${firstReviewed}-${lastReviewed} of ${rows.length} total).`
    : "No rows are available to review.";
  elements["previous-import-outcome-page"].disabled = page === 0;
  elements["next-import-outcome-page"].disabled = page >= pageCount - 1;
  const reconciliation = batch.reconciliation;
  const reconciliationCard = elements["import-reconciliation-card"];
  reconciliationCard.hidden = !reconciliation;
  if (!reconciliation) {
    elements["import-reconciliation-values"].replaceChildren();
    return;
  }
  renderImportSourceControls(batch);
  const displayed = importReconciliationEntries(reconciliation);
  elements["import-reconciliation-values"].replaceChildren(
    ...displayed.flatMap(([term, value]) => [definitionTerm(term), definitionDescription(value)])
  );
}

function renderImportSourceControls(batch) {
  const form = elements["import-source-controls-form"];
  const required = sourceControlRequiredImportTypes.has(batch.importType);
  form.hidden = !required;
  if (!required) return;
  const openingBalances = batch.importType === "OPENING_BALANCES";
  elements["import-source-debit-field"].hidden = !openingBalances;
  elements["import-source-credit-field"].hidden = !openingBalances;
  elements["import-source-balance-field"].hidden = openingBalances;
  form.elements.sourceDebitMinor.required = openingBalances;
  form.elements.sourceCreditMinor.required = openingBalances;
  form.elements.sourceBalanceMinor.required = !openingBalances;
  const controls = batch.sourceControls ?? {};
  form.elements.sourceReportName.value = controls.sourceReportName ?? "";
  form.elements.sourceReportDate.value = controls.sourceReportDate ?? "";
  form.elements.sourceReportChecksum.value = controls.sourceReportChecksum ?? "";
  form.elements.sourceDebitMinor.value = controls.sourceDebitMinor ?? "";
  form.elements.sourceCreditMinor.value = controls.sourceCreditMinor ?? "";
  form.elements.sourceBalanceMinor.value = controls.sourceBalanceMinor ?? "";
  const status = batch.reconciliation?.sourceControlStatus;
  elements["import-source-controls-status"].textContent =
    status === "MATCH"
      ? "Source and PennyWise totals agree."
      : status === "MISMATCH"
        ? "Source and PennyWise totals differ. Do not confirm the migration yet."
        : "Enter the source report totals before confirming this financial migration.";
}

function importOutcomeIdentifier(rowValue) {
  const mapped =
    rowValue.mappedData && typeof rowValue.mappedData === "object" ? rowValue.mappedData : {};
  const raw = rowValue.rawData && typeof rowValue.rawData === "object" ? rowValue.rawData : {};
  return (
    rowValue.externalId ||
    mapped.external_id ||
    mapped.customer_number ||
    mapped.vendor_number ||
    mapped.sku ||
    mapped.code ||
    raw.external_id ||
    raw.customer_number ||
    raw.customer_no ||
    raw.vendor_number ||
    raw.vendor_no ||
    raw.sku ||
    raw.code ||
    "—"
  );
}

function formatImportRowStatus(status) {
  return (
    {
      PENDING: "Awaiting preview",
      VALID: "Ready",
      INVALID: "Flagged",
      STAGED: "Staged for safe resume",
      IMPORTED: "Imported",
      SKIPPED: "Skipped",
      FAILED: "Failed"
    }[status] ?? "Review"
  );
}

function importReconciliationEntries(reconciliation) {
  const currency = multiCurrencyState?.baseCurrency ?? "CAD";
  const labels = {
    importedRows: "Imported rows",
    skippedRows: "Skipped rows",
    failedRows: "Failed rows",
    openingTrialBalanceDifferenceMinor: "Opening balance difference",
    receivablesDifferenceMinor: "Receivables difference",
    payablesDifferenceMinor: "Payables difference",
    inventoryDifferenceMinor: "Inventory difference",
    inventoryReconciled: "Inventory control reconciled",
    nonPostingHistoricalRows: "Non-posting history rows",
    unsupportedFields: "Unsupported fields",
    unsupportedData: "Unsupported data"
  };
  const moneyKeys = new Set([
    "openingTrialBalanceDifferenceMinor",
    "receivablesDifferenceMinor",
    "payablesDifferenceMinor",
    "inventoryDifferenceMinor"
  ]);
  return Object.entries(reconciliation)
    .filter(([key, value]) => Object.hasOwn(labels, key) && value !== undefined && value !== null)
    .map(([key, value]) => [
      labels[key],
      moneyKeys.has(key)
        ? formatMinor(String(value), currency)
        : Array.isArray(value)
          ? value.join(", ") || "None"
          : String(value)
    ]);
}

function resetImportItemMatchReview() {
  currentImportItemMatches = null;
  elements["import-item-match-review"].hidden = true;
  elements["import-item-match-rows"].replaceChildren();
  elements["import-item-match-load-status"].textContent = "";
}

function renderImportItemMatchReview() {
  const panel = elements["import-item-match-review"];
  const suggestions = currentImportItemMatches;
  panel.hidden = !suggestions;
  if (!suggestions) return;
  const suggestionsRows = Array.isArray(suggestions.rows) ? suggestions.rows : [];
  const offset = Number(suggestions.offset ?? 0);
  const total = Number(suggestions.totalEligibleRowCount ?? suggestionsRows.length);
  const first = suggestionsRows.length ? offset + 1 : 0;
  const last = offset + suggestionsRows.length;
  elements["import-item-match-summary"].textContent = suggestionsRows.length
    ? `Rows ${first}-${last} of ${total}. Compare up to ${suggestions.candidatesPerRow ?? 5} possible existing items for each source row.`
    : "No mapped item rows are available on this page.";
  elements["import-item-match-boundary"].textContent =
    suggestions.importBoundary === "EXACT_SKU_REQUIRED_FOR_INVENTORY_POSTING"
      ? "Review aid only. Opening inventory still posts only to an active local item with the exact mapped SKU; a similar suggestion is never selected automatically."
      : "Review aid only. A similar item is not merged, skipped, linked, or imported automatically. Resolve likely duplicates before completing the product import.";
  elements["import-item-match-rows"].replaceChildren(...suggestionsRows.map(importItemMatchRow));
  elements["previous-import-item-matches"].disabled = offset <= 0;
  elements["next-import-item-matches"].disabled = !suggestions.hasMore;
  elements["import-item-match-page-status"].textContent = suggestionsRows.length
    ? `${first}-${last} of ${total}`
    : `0 of ${total}`;
}

function importItemMatchRow(suggestion) {
  const article = document.createElement("article");
  article.className = "import-item-match-row";
  article.dataset.sourceRow = String(suggestion.rowNumber ?? "");
  const heading = document.createElement("div");
  heading.className = "import-item-match-row-heading";
  const title = document.createElement("div");
  const titleText = document.createElement("h5");
  titleText.textContent = `Source row ${suggestion.rowNumber}`;
  const titleHelp = document.createElement("p");
  titleHelp.textContent = "Imported evidence";
  title.append(titleText, titleHelp);
  const sourceEvidence = document.createElement("div");
  sourceEvidence.className = "import-item-source-evidence";
  sourceEvidence.append(
    importItemEvidencePill("SKU", suggestion.evidence?.sku),
    importItemEvidencePill("Name", suggestion.evidence?.name),
    importItemEvidencePill("Description", suggestion.evidence?.description)
  );
  heading.append(title, sourceEvidence);
  article.append(heading);
  const candidates = Array.isArray(suggestion.candidates) ? suggestion.candidates : [];
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "import-item-match-empty";
    empty.textContent =
      "No likely existing local item was found. This is not an approval to import.";
    article.append(empty);
    return article;
  }
  const candidateGrid = document.createElement("div");
  candidateGrid.className = "import-item-match-candidates";
  candidateGrid.append(...candidates.map(importItemMatchCandidate));
  article.append(candidateGrid);
  return article;
}

function importItemMatchCandidate(candidate) {
  const card = document.createElement("section");
  card.className = "import-item-match-candidate";
  const heading = document.createElement("div");
  heading.className = "import-item-match-candidate-heading";
  const name = document.createElement("strong");
  name.textContent = candidate.productItem?.name || "Unnamed local item";
  const sku = document.createElement("span");
  sku.textContent = candidate.productItem?.sku
    ? `SKU ${candidate.productItem.sku}`
    : "No local SKU";
  heading.append(name, sku);
  card.append(heading);
  if (candidate.productItem?.description) {
    const description = document.createElement("p");
    description.textContent = candidate.productItem.description;
    card.append(description);
  }
  const evidence = document.createElement("div");
  evidence.className = "import-item-field-evidence";
  evidence.setAttribute("aria-label", "Nearest-field evidence");
  const reason = candidate.reason ?? {};
  const matches = Array.isArray(reason.matches) ? reason.matches : [];
  evidence.append(
    importItemEvidencePill(
      "SKU",
      matches.includes("NORMALIZED_SKU")
        ? "exact normalized match"
        : importSimilarity(reason.skuSimilarityBasisPoints)
    ),
    importItemEvidencePill("Name", importSimilarity(reason.nameSimilarityBasisPoints)),
    importItemEvidencePill("Description", importSimilarity(reason.descriptionSimilarityBasisPoints))
  );
  card.append(evidence);
  return card;
}

function importItemEvidencePill(label, value) {
  const pill = document.createElement("span");
  const display = value == null || value === "" ? "not available" : String(value);
  pill.textContent = `${label}: ${display.length > 120 ? `${display.slice(0, 117)}...` : display}`;
  return pill;
}

function importSimilarity(value) {
  if (!Number.isFinite(value)) return "not available";
  const percent = value / 100;
  return `${percent.toFixed(Number.isInteger(percent) ? 0 : 1)}% similar`;
}

async function loadImportItemMatchPage(offset) {
  if (!currentImportBatch?.id) return;
  const previousButton = elements["previous-import-item-matches"];
  const nextButton = elements["next-import-item-matches"];
  previousButton.disabled = true;
  nextButton.disabled = true;
  elements["import-item-match-review"].setAttribute("aria-busy", "true");
  elements["import-item-match-load-status"].textContent = "Loading item suggestions...";
  const response = await api(
    `/v1/imports/${currentImportBatch.id}/item-match-suggestions?offset=${encodeURIComponent(offset)}&limit=25`
  );
  elements["import-item-match-review"].removeAttribute("aria-busy");
  if (!response.ok) {
    renderImportItemMatchReview();
    return showError(response);
  }
  currentImportItemMatches = (await response.json()).itemMatchSuggestions;
  currentImportBatch.itemMatchSuggestions = currentImportItemMatches;
  elements["import-item-match-load-status"].textContent = "Item suggestions updated.";
  renderImportItemMatchReview();
}

function formatImportSource(sourceSystem) {
  return (
    {
      QUICKBOOKS_ONLINE: "QuickBooks Online",
      QUICKBOOKS_DESKTOP: "QuickBooks Desktop",
      XERO: "Xero",
      WAVE: "Wave",
      FRESHBOOKS: "FreshBooks",
      SAGE: "Sage",
      ZOHO_BOOKS: "Zoho Books",
      OTHER: "CSV or spreadsheet (other source)"
    }[sourceSystem] ?? "Other or spreadsheet"
  );
}

export function renderImportSourceGuide() {
  const sourceSystem = elements["data-import-form"].elements.sourceSystem.value;
  const guide = importSourceGuides[sourceSystem] ?? importSourceGuides.OTHER;
  elements["data-import-source-guide-heading"].textContent = `Before you export from ${guide.name}`;
  elements["data-import-source-summary"].textContent = guide.summary;
  elements["data-import-source-checklist"].replaceChildren(
    ...guide.steps.map((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    })
  );
  const help = elements["data-import-source-help"];
  help.hidden = !guide.helpUrl;
  if (guide.helpUrl) {
    help.href = guide.helpUrl;
    help.textContent = `${guide.name} export help`;
  } else {
    help.removeAttribute("href");
    help.textContent = "";
  }
  renderImportSourceDetection();
}

function renderImportSourceDetection() {
  const detection = elements["data-import-source-detection"];
  if (!detection) return;
  const hint = importFilePreview?.sourceHint;
  if (!hint) {
    detection.hidden = true;
    detection.textContent = "";
    return;
  }
  const selected = elements["data-import-form"].elements.sourceSystem.value;
  const selectedName = formatImportSource(selected);
  detection.hidden = false;
  detection.textContent =
    hint.source === selected
      ? `File signal: this resembles ${hint.name} (${hint.matched} recognizable headings). The selected source label will remain immutable when uploaded.`
      : `File signal: this resembles ${hint.name} (${hint.matched} recognizable headings), but the selected source is ${selectedName}. Confirm the previous system before uploading; PennyWise Accounting will not change the source label automatically.`;
}

export function renderImportTemplateGuidance() {
  const importType = elements["data-import-form"].elements.importType.value;
  elements["data-import-currency-warning"].hidden = !foreignMigrationWarningTypes.has(importType);
}

function downloadImportTemplate() {
  const form = elements["data-import-form"];
  const importType = form.elements.importType.value;
  const template = dataImportTemplates[importType];
  if (!template) return;
  const source = formatImportSource(form.elements.sourceSystem.value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const content = `${[template.headers, template.example]
    .map((record) => record.map(csvTemplateCell).join(","))
    .join("\r\n")}\r\n`;
  downloadBlob(
    new globalThis.Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }),
    `pennywise-${source}-${template.slug}-template.csv`
  );
  showNotice(
    "CSV template downloaded. Replace the example row and keep an unchanged source export."
  );
}

function csvTemplateCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function setMigrationStep(activeIndex) {
  const steps = [...document.querySelectorAll(".migration-steps li")];
  const summaries = [
    "Choose the system you are leaving, then upload an unchanged CSV or XLSX export.",
    "Map each PennyWise Accounting field to a source column. Suggested aliases are visible and remain reviewable.",
    "Review representative rows, warnings, skipped fields, and the immutable source provenance before testing.",
    "Run the non-posting dry run. PennyWise Accounting validates dependencies and reports every row that needs attention.",
    "Commit only after the dry run passes. Every created invoice, bill, or master record remains traceable to its source rows.",
    "Review reconciliation totals and acknowledge the completed migration. Keep the source system read-only until controls agree."
  ];
  const boundedIndex = Math.max(0, Math.min(activeIndex, Math.max(steps.length - 1, 0)));
  steps.forEach((step, index) => {
    step.classList.toggle("is-current", index === boundedIndex);
    step.classList.toggle("is-complete", index < boundedIndex);
    if (index === boundedIndex) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
  const summary = elements["migration-step-summary"];
  if (summary) summary.textContent = summaries[boundedIndex] ?? summaries[0];
}

function formatImportStatus(status) {
  return (
    {
      UPLOADED: "File uploaded; review mapping",
      VALIDATED: "Validated; preview is ready",
      PREVIEWED: "Ready to test",
      DRY_RUN: "Test passed",
      COMMITTING: "Commit in progress",
      RETRYABLE: "Interrupted safely; resume available",
      COMMITTED: "Import committed; reconcile controls",
      FAILED: "Import failed before posting",
      COMPENSATION_REQUIRED: "Manual recovery required",
      RECONCILED: "Reconciliation confirmed"
    }[status] ?? formatRole(status)
  );
}

async function downloadDataImportErrors() {
  if (!currentImportBatch) return;
  const response = await api(`/v1/imports/${currentImportBatch.id}/errors.csv`);
  if (!response.ok) return showError(response);
  downloadBlob(await response.blob(), "pennywise-import-errors.csv");
}

async function requestOrganizationExport(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/exports",
    jsonRequest({ includeAttachments: data.get("includeAttachments") === "on" })
  );
  if (!response.ok) return showError(response);
  currentOrganizationExport = await response.json();
  renderOrganizationExport();
  globalThis.setTimeout(() => void refreshOrganizationExport(), 250);
}

async function refreshOrganizationExport() {
  if (!currentOrganizationExport) return;
  const response = await api(`/v1/exports/${currentOrganizationExport.job.id}`);
  if (!response.ok) return showError(response);
  currentOrganizationExport.job = (await response.json()).job;
  renderOrganizationExport();
  if (["PENDING", "PROCESSING"].includes(currentOrganizationExport.job.status))
    globalThis.setTimeout(() => void refreshOrganizationExport(), 500);
}

function renderOrganizationExport() {
  const job = currentOrganizationExport.job;
  elements["organization-export-status"].textContent = [
    formatRole(job.status),
    job.checksum ? `SHA-256 ${job.checksum}` : "",
    job.byteSize == null ? "" : `${job.byteSize} bytes`,
    `Expires ${job.expiresAt}`
  ]
    .filter(Boolean)
    .join("\n");
  elements["refresh-organization-export"].disabled = false;
  elements["download-organization-export"].disabled = job.status !== "READY";
}

async function downloadOrganizationExport() {
  if (!currentOrganizationExport) return;
  const response = await api(`/v1/exports/${currentOrganizationExport.job.id}/download`, {
    headers: { "x-export-token": currentOrganizationExport.downloadToken }
  });
  if (!response.ok) return showError(response);
  downloadBlob(await response.blob(), `pennywise-${identity.activeOrganizationId}-export-v1.json`);
}

async function requestOrganizationClosure(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/organization-closure",
    jsonRequest({
      reason: data.get("reason"),
      legalHold: data.get("legalHold") === "on",
      ...(currentOrganizationExport?.job?.id
        ? { exportJobId: currentOrganizationExport.job.id }
        : {})
    })
  );
  if (!response.ok) return showError(response);
  currentClosureRequest = (await response.json()).closure;
  elements["organization-closure-status"].textContent = formatRole(currentClosureRequest.status);
  elements["finalize-organization-closure"].disabled = currentClosureRequest.status !== "REQUESTED";
}

async function finalizeOrganizationClosure() {
  if (
    !currentClosureRequest ||
    !window.confirm("Schedule organization retention and revoke active access?")
  )
    return;
  const response = await api(
    `/v1/organization-closure/${currentClosureRequest.id}/finalize`,
    jsonRequest({})
  );
  if (!response.ok) return showError(response);
  currentClosureRequest = (await response.json()).closure;
  elements["organization-closure-status"].textContent =
    `${formatRole(currentClosureRequest.status)} | ${currentClosureRequest.retentionUntil}`;
  elements["finalize-organization-closure"].disabled = true;
}
