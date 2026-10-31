import { createHash } from "node:crypto";
import {
  Prisma,
  withRuntimeTransaction,
  withTenantTransaction,
  type PrismaClient,
  type SetupStep
} from "@clearledger/db";
import type { AuditOrigin, AuthenticatedIdentity, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { withAuditOrigin } from "../utils/audit.js";
import { AccountPresetService } from "./account-presets.js";
import { BankingService } from "./banking-service.js";
import { CompanySetupService } from "./company-setup-service.js";
import { CustomerService } from "./customer-service.js";
import { InvoiceService } from "./invoice-service.js";
import { MultiCurrencyService } from "./multi-currency-service.js";
import { OrganizationService } from "./organization-service.js";
import { ProductService } from "./product-service.js";
import { PurchaseService } from "./purchase-service.js";
import { PaymentService } from "./payment-service.js";
import { ProjectService } from "./project-service.js";
import { PayrollService } from "./payroll-service.js";
import { PayrollStatutoryCalculator } from "./payroll-statutory-service.js";

export const demoCompanyTemplateKey = "canadian-service" as const;
export const demoCompanyFixtureVersion = 1;

export function demoCompanyAvailableForEnvironment(nodeEnvironment: string | undefined): boolean {
  return nodeEnvironment?.trim().toLowerCase() !== "production";
}

const organizationName = "Maple & Moss Demo Studio — Fictional";
const legalName = "Maple & Moss Demo Studio Inc. — FICTIONAL DEMO";
const invoiceMarker = "CLEARLEDGER_DEMO_FIXTURE_V1_POSTED_INVOICE";
const draftInvoiceMarker = "CLEARLEDGER_DEMO_FIXTURE_V1_DRAFT_INVOICE";
const demoCustomerNumber = "DEMO-CUST-001";
const demoVendorNumber = "DEMO-VEND-001";
const demoProductSku = "DEMO-SVC-001";
const demoVendorInvoiceNumber = "DEMO-BILL-001";
const expandedDemoMarker = "CLEARLEDGER_DEMO_FIXTURE_V2_EXPANDED";

export interface DemoCompanyCreateInput {
  readonly templateKey: string;
}

export interface DemoCompanyResult {
  readonly organizationId: string;
  readonly displayName: string;
  readonly created: boolean;
  readonly reused: boolean;
  readonly fictional: true;
  readonly templateKey: typeof demoCompanyTemplateKey;
  readonly fixtureVersion: number;
  readonly setupComplete: boolean;
  readonly enabledCurrencies: readonly string[];
  readonly counts: {
    readonly accounts: number;
    readonly customers: number;
    readonly vendors: number;
    readonly products: number;
    readonly bankAccounts: number;
    readonly postedInvoices: number;
    readonly draftInvoices: number;
    readonly totalInvoices: number;
    readonly paidInvoices: number;
    readonly partialInvoices: number;
    readonly postedBills: number;
    readonly totalBills: number;
    readonly paidBills: number;
    readonly customerContacts: number;
    readonly customerActivities: number;
    readonly timeEntries: number;
    readonly postedJournals: number;
    readonly payments: number;
    readonly billPayments: number;
    readonly payrollWorkers: number;
    readonly payrollRuns: number;
    readonly projects: number;
  };
  readonly journalsBalanced: boolean;
}

interface DemoSetupState {
  readonly organization: { readonly displayName: string };
  readonly settings: {
    readonly version: number;
    readonly businessType: string | null;
    readonly accountingStartDate: string | null;
    readonly setupCompletedAt: string | null;
  };
  readonly defaults: {
    readonly version: number;
    readonly customerNotes: string | null;
    readonly paymentInstructions: string | null;
  };
  readonly steps: readonly {
    readonly step: SetupStep;
    readonly status: string;
    readonly version: number;
  }[];
}

/**
 * Builds one deterministic, fictional tenant per user through normal domain
 * services. Stable fixture identifiers make an interrupted run safely resumable.
 */
export class DemoCompanyService {
  private readonly organizations: OrganizationService;
  private readonly setup: CompanySetupService;
  private readonly presets: AccountPresetService;
  private readonly currencies: MultiCurrencyService;
  private readonly customers: CustomerService;
  private readonly products: ProductService;
  private readonly invoices: InvoiceService;
  private readonly purchases: PurchaseService;
  private readonly banking: BankingService;
  private readonly payments: PaymentService;
  private readonly projects: ProjectService;
  private readonly payroll: PayrollService;
  public constructor(private readonly prisma: PrismaClient) {
    this.organizations = new OrganizationService(prisma);
    this.setup = new CompanySetupService(prisma);
    this.presets = new AccountPresetService(prisma);
    this.currencies = new MultiCurrencyService(prisma);
    this.customers = new CustomerService(prisma);
    this.products = new ProductService(prisma);
    this.invoices = new InvoiceService(prisma);
    this.purchases = new PurchaseService(prisma);
    this.banking = new BankingService(prisma);
    this.payments = new PaymentService(prisma);
    this.projects = new ProjectService(prisma);
    this.payroll = new PayrollService(prisma);
  }

  public async create(
    actor: AuthenticatedIdentity,
    input: DemoCompanyCreateInput,
    idempotencyKey: string,
    requestId: string,
    auditOrigin: AuditOrigin
  ): Promise<DemoCompanyResult> {
    if (!["DEVELOPMENT", "OIDC"].includes(actor.authenticationMethod))
      throw new AppError(
        "DEMO_COMPANY_INTERACTIVE_IDENTITY_REQUIRED",
        "A signed-in interactive user is required to create a demo company.",
        403
      );
    if (idempotencyKey.trim().length < 8)
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.", 400);
    if (input.templateKey !== demoCompanyTemplateKey)
      throw new AppError("DEMO_COMPANY_TEMPLATE_NOT_FOUND", "Demo template was not found.", 404);

    const operationKey = `${actor.id}:${input.templateKey}:${String(demoCompanyFixtureVersion)}`;
    return withRuntimeTransaction(
      this.prisma,
      actor.id,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(operationKey)})`;
        const seeded = await this.seed(actor, requestId, auditOrigin);
        assertCompleteDemo(seeded);
        return this.recordIdempotentResponse(
          actor,
          seeded,
          idempotencyKey.trim(),
          requestId,
          auditOrigin
        );
      },
      { maxWait: 10_000, timeout: 60_000 }
    );
  }

  private async seed(
    actor: AuthenticatedIdentity,
    requestId: string,
    auditOrigin: AuditOrigin
  ): Promise<DemoCompanyResult> {
    const organizationId = stableUuid(
      `clearledger:${String(demoCompanyFixtureVersion)}:demo-company:${actor.id}`
    );
    const membershipId = stableUuid(`clearledger:demo-membership:${organizationId}:${actor.id}`);
    const ensured = await this.organizations.ensureOrganization(
      actor,
      {
        legalName,
        displayName: organizationName,
        currency: "CAD",
        timezone: "America/Edmonton"
      },
      requestId,
      auditOrigin,
      { organizationId, membershipId }
    );
    const companyId = await withTenantTransaction(
      this.prisma,
      { organizationId, actorUserId: actor.id },
      (tx) =>
        tx.company
          .findFirst({
            where: { organizationId, isDefault: true, status: "ACTIVE" },
            select: { id: true }
          })
          .then((company) => company?.id)
    );
    const context = demoContext(
      actor,
      organizationId,
      membershipId,
      requestId,
      auditOrigin,
      companyId
    );

    await this.ensureCompanySetup(context);
    const accounts = await this.accountMap(context);
    const taxCodeId = await this.ensureTaxConfiguration(context, accounts);
    await this.ensureBusinessRecords(context, accounts, taxCodeId);
    await this.recordCompletion(context);
    return this.summary(context, ensured.created);
  }

  private async ensureCompanySetup(context: OrganizationContext): Promise<void> {
    let state = await this.setupState(context);
    if (!state.settings.setupCompletedAt) {
      const accountingStartDate = state.settings.accountingStartDate;
      if (
        accountingStartDate !== "2026-01-01" ||
        state.settings.businessType !== "Corporation" ||
        state.organization.displayName !== organizationName
      ) {
        await this.setup.updateProfile(context, {
          version: state.settings.version,
          legalName,
          displayName: organizationName,
          businessType: "Corporation",
          businessNumber: "DEMO-ONLY-NOT-A-REAL-BUSINESS-NUMBER",
          businessAddress: {
            line1: "100 Fictional Avenue",
            city: "Calgary",
            province: "AB",
            postalCode: "T0T 0T0",
            country: "CA"
          },
          mailingAddress: {
            line1: "PO Box 42",
            city: "Calgary",
            province: "AB",
            postalCode: "T0T 0T0",
            country: "CA"
          },
          phone: "+1 403 555 0142",
          email: "hello@maple-moss-demo.example",
          website: "https://maple-moss-demo.example",
          locale: "en-CA",
          timeZone: "America/Edmonton",
          baseCurrency: "CAD",
          fiscalYearEndMonth: 12,
          fiscalYearEndDay: 31,
          accountingStartDate: "2026-01-01",
          primaryColor: "#17674f",
          accentColor: "#d9a72e"
        });
      }

      await this.presets.apply(
        context,
        "general-service",
        `demo:${String(demoCompanyFixtureVersion)}:preset`
      );
      await this.setup.initializeFiscalYear(context);

      const currencySettings = await this.currencies.getSettings(context);
      if (
        !currencySettings.enabled ||
        !currencySettings.currencies.some(
          (currency) => currency.currencyCode === "USD" && currency.enabled
        )
      )
        await this.currencies.updateSettings(context, {
          version: currencySettings.version,
          enabled: true,
          rateMode: "MANUAL",
          currencies: ["CAD", "USD"]
        });

      state = await this.setupState(context);
      await this.ensureDefaults(context, state.defaults);
    }
  }

  private async ensureTaxConfiguration(
    context: OrganizationContext,
    accounts: ReadonlyMap<string, { id: string }>
  ): Promise<string> {
    const existing = await this.tenantRead(context, (tx) =>
      tx.taxCode.findUnique({
        where: {
          organizationId_code: { organizationId: context.organizationId, code: "DEMO-GST" }
        }
      })
    );
    let taxCodeId = existing?.id;
    if (!taxCodeId) {
      const payable = requiredAccount(accounts, "tax-payable");
      const recoverable = requiredAccount(accounts, "tax-recoverable");
      const version = await this.setup.createTaxCodeVersion(context, {
        code: "DEMO-GST",
        name: "Demo GST 5% — fictional fixture",
        treatment: "STANDARD",
        calculationMode: "EXCLUSIVE",
        effectiveFrom: "2026-01-01",
        sourceName: "PennyWise Accounting fictional demonstration fixture — not tax advice",
        sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
        components: [
          {
            name: "Demo GST",
            jurisdiction: "CA",
            rate: "0.050000",
            recoverablePercent: "1.000000",
            payableAccountId: payable.id,
            recoverableAccountId: recoverable.id
          }
        ]
      });
      taxCodeId = version.taxCodeId;
    }

    const registration = await this.tenantRead(context, (tx) =>
      tx.taxRegistration.findUnique({
        where: {
          organizationId_registrationType_jurisdiction: {
            organizationId: context.organizationId,
            registrationType: "DEMO-GST",
            jurisdiction: "CA"
          }
        }
      })
    );
    if (!registration)
      await this.setup.saveRegistration(context, {
        registrationType: "DEMO-GST",
        jurisdiction: "CA",
        registrationNumber: "DEMO-ONLY-NOT-REAL",
        registered: true,
        effectiveFrom: "2026-01-01"
      });

    await this.completeSetup(context);
    return taxCodeId;
  }

  private async ensureDefaults(
    context: OrganizationContext,
    defaults: {
      version: number;
      customerNotes: string | null;
      paymentInstructions: string | null;
    }
  ): Promise<void> {
    if (
      defaults.customerNotes === "Thank you for supporting this fictional demo company." &&
      defaults.paymentInstructions === "Demo only — no payment is due."
    )
      return;
    await this.setup.updateDefaults(context, {
      version: defaults.version,
      paymentTermsDays: 30,
      invoicePrefix: "DEMO-INV",
      invoiceNextPlaceholder: "0001",
      estimatePrefix: "DEMO-EST",
      estimateNextPlaceholder: "0001",
      taxCalculationMode: "EXCLUSIVE",
      customerNotes: "Thank you for supporting this fictional demo company.",
      paymentInstructions: "Demo only — no payment is due.",
      dateFormat: "yyyy-MM-dd",
      numberFormat: "en-CA",
      showLogo: false,
      showBusinessNumber: true
    });
  }

  private async completeSetup(context: OrganizationContext): Promise<void> {
    let state = await this.setupState(context);
    if (state.settings.setupCompletedAt) return;
    const desired = new Map<SetupStep, "COMPLETED" | "SKIPPED">([
      ["BUSINESS_PROFILE", "COMPLETED"],
      ["FISCAL_CURRENCY", "COMPLETED"],
      ["TAX_REGISTRATION", "COMPLETED"],
      ["INDUSTRY_PRESET", "COMPLETED"],
      ["CHART_REVIEW", "COMPLETED"],
      ["OPENING_BALANCES", "SKIPPED"],
      ["BRANDING_DEFAULTS", "COMPLETED"]
    ]);
    for (const step of state.steps) {
      const status = desired.get(step.step);
      if (status && step.status !== status)
        await this.setup.setStep(context, step.step, status, step.version);
    }
    state = await this.setupState(context);
    await this.setup.complete(context, state.settings.version);
  }

  private async ensureBusinessRecords(
    context: OrganizationContext,
    accounts: ReadonlyMap<string, { id: string }>,
    taxCodeId: string
  ): Promise<void> {
    const income = requiredAccount(accounts, "professional-services");
    const expense = requiredAccount(accounts, "general-expense");
    const cash = requiredAccount(accounts, "cash");

    let customerId = await this.tenantRead(context, (tx) =>
      tx.customer.findUnique({
        where: {
          organizationId_customerNumber: {
            organizationId: context.organizationId,
            customerNumber: demoCustomerNumber
          }
        },
        select: { id: true }
      })
    );
    if (!customerId) {
      const created = await this.customers.create(context, {
        customerNumber: demoCustomerNumber,
        legalName: "Aurora Trail Design Co. — Fictional",
        displayName: "Aurora Trail Design — Demo customer",
        primaryContact: "Alex Sample",
        billingAddress: {
          line1: "200 Example Street",
          city: "Edmonton",
          province: "AB",
          postalCode: "T0T 0T0",
          country: "CA"
        },
        email: "accounts@aurora-trail-demo.example",
        telephone: "+1 780 555 0123",
        defaultPaymentTermsDays: 30,
        defaultTaxCodeId: taxCodeId,
        defaultCurrency: "CAD",
        internalNotes: "Fictional PennyWise Accounting demonstration customer."
      });
      customerId = { id: created.id };
    }

    let productId = await this.tenantRead(context, (tx) =>
      tx.productItem.findUnique({
        where: {
          organizationId_sku: { organizationId: context.organizationId, sku: demoProductSku }
        },
        select: { id: true }
      })
    );
    if (!productId) {
      const created = await this.products.create(context, {
        sku: demoProductSku,
        name: "Monthly bookkeeping support — Demo",
        description: "Fictional recurring service used to demonstrate invoicing.",
        itemType: "SERVICE",
        salesPriceMinor: "87500",
        incomeAccountId: income.id,
        defaultTaxCodeId: taxCodeId,
        unitOfMeasure: "month"
      });
      productId = { id: created.id };
    }

    let vendorId = await this.tenantRead(context, (tx) =>
      tx.vendor.findUnique({
        where: {
          organizationId_vendorNumber: {
            organizationId: context.organizationId,
            vendorNumber: demoVendorNumber
          }
        },
        select: { id: true }
      })
    );
    if (!vendorId) {
      const created = await this.purchases.createVendor(context, {
        vendorNumber: demoVendorNumber,
        legalName: "Rocky Mountain Paper Co. — Fictional",
        displayName: "Rocky Mountain Paper — Demo vendor",
        email: "billing@rocky-paper-demo.example",
        telephone: "+1 403 555 0168",
        remittanceAddress: {
          line1: "300 Sample Road",
          city: "Calgary",
          province: "AB",
          postalCode: "T0T 0T0",
          country: "CA"
        },
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD",
        defaultExpenseAccountId: expense.id,
        defaultTaxCodeId: taxCodeId,
        preferredPaymentMethod: "ELECTRONIC_TRANSFER",
        internalNotes: "Fictional PennyWise Accounting demonstration vendor."
      });
      vendorId = { id: requireJsonId(created, "vendor") };
    }

    const bank = await this.tenantRead(context, (tx) =>
      tx.bankAccount.findFirst({
        where: { organizationId: context.organizationId, linkedLedgerAccountId: cash.id }
      })
    );
    if (!bank)
      await this.banking.createAccount(context, {
        displayName: "Demo operating account",
        accountKind: "BANK",
        maskedAccountReference: "****4242",
        financialInstitutionName: "Fictional Community Bank",
        currency: "CAD",
        linkedLedgerAccountId: cash.id,
        openingDate: "2026-01-01"
      });

    const postedInvoice = await this.tenantRead(context, (tx) =>
      tx.invoice.findFirst({
        where: { organizationId: context.organizationId, internalNotes: invoiceMarker },
        select: { id: true }
      })
    );
    if (!postedInvoice) {
      const draft = await this.invoices.create(context, {
        customerId: customerId.id,
        issueDate: "2026-05-15",
        dueDate: "2026-06-14",
        currency: "CAD",
        lines: [
          {
            productItemId: productId.id,
            description: "Monthly bookkeeping support — April 2026 (demo)",
            quantity: "2",
            unitPriceMinor: "87500",
            discountMinor: "5000",
            taxCodeId
          }
        ],
        customerFacingNotes: "Fictional sample invoice. No payment is due.",
        internalNotes: invoiceMarker,
        terms: "Demo only — this is not a real receivable."
      });
      await this.invoices.post(
        context,
        draft.id,
        draft.version,
        undefined,
        `demo:${String(demoCompanyFixtureVersion)}:invoice-post`
      );
    }

    const draftInvoice = await this.tenantRead(context, (tx) =>
      tx.invoice.findFirst({
        where: { organizationId: context.organizationId, internalNotes: draftInvoiceMarker }
      })
    );
    if (!draftInvoice)
      await this.invoices.create(context, {
        customerId: customerId.id,
        issueDate: "2026-07-01",
        dueDate: "2026-07-31",
        currency: "CAD",
        lines: [
          {
            productItemId: productId.id,
            description: "Quarterly reporting package — draft demo",
            quantity: "1",
            unitPriceMinor: "42500",
            taxCodeId
          }
        ],
        customerFacingNotes: "Draft fictional invoice for workflow practice.",
        internalNotes: draftInvoiceMarker,
        terms: "Demo only — review, preview, or edit this draft safely."
      });

    const bill = await this.tenantRead(context, (tx) =>
      tx.bill.findFirst({
        where: {
          organizationId: context.organizationId,
          vendorId: vendorId.id,
          vendorInvoiceNumber: demoVendorInvoiceNumber
        },
        select: { id: true }
      })
    );
    if (!bill) {
      const draft = await this.purchases.createBill(context, {
        vendorId: vendorId.id,
        vendorInvoiceNumber: demoVendorInvoiceNumber,
        issueDate: "2026-05-20",
        dueDate: "2026-06-19",
        currency: "CAD",
        internalNotes: "Fictional office-supplies bill for PennyWise Accounting demonstration.",
        lines: [
          {
            description: "Office and shipping supplies — demo",
            quantity: "1",
            unitCostMinor: "32000",
            accountId: expense.id,
            taxCodeId
          }
        ]
      });
      await this.purchases.postBill(
        context,
        requireJsonId(draft, "bill"),
        requireJsonVersion(draft, "bill"),
        `demo:${String(demoCompanyFixtureVersion)}:bill-post`
      );
    }
    await this.ensureExpandedRecords(
      context,
      accounts,
      taxCodeId,
      customerId.id,
      vendorId.id,
      productId.id
    );
  }

  /**
   * Adds the richer demonstration surface without changing the original
   * fixture identifiers. Every row is found by a stable marker before it is
   * created, so an interrupted or repeated demo request remains safe.
   */
  private async ensureExpandedRecords(
    context: OrganizationContext,
    accounts: ReadonlyMap<string, { id: string }>,
    taxCodeId: string,
    primaryCustomerId: string,
    primaryVendorId: string,
    primaryProductId: string
  ): Promise<void> {
    const income = requiredAccount(accounts, "professional-services");
    const expense = requiredAccount(accounts, "general-expense");
    const cash = requiredAccount(accounts, "cash");

    const customerIds = [primaryCustomerId];
    for (let index = 2; index <= 10; index += 1) {
      const number = `DEMO-CUST-${String(index).padStart(3, "0")}`;
      let customer = await this.tenantRead(context, (tx) =>
        tx.customer.findUnique({
          where: {
            organizationId_customerNumber: {
              organizationId: context.organizationId,
              customerNumber: number
            }
          },
          select: { id: true }
        })
      );
      if (!customer) {
        const isUs = index % 3 === 0;
        customer = await this.customers.create(context, {
          customerNumber: number,
          legalName: `${isUs ? "Cedar Ridge" : "Northstar"} ${String(index)} Design Co. — Fictional`,
          displayName: `${isUs ? "Cedar Ridge" : "Northstar"} ${String(index)} — Demo customer`,
          primaryContact: `Sample Contact ${String(index)}`,
          billingAddress: {
            line1: `${String(100 + index)} Example Way`,
            city: isUs ? "Seattle" : "Calgary",
            province: isUs ? "WA" : "AB",
            postalCode: isUs ? "98101" : "T0T 0T0",
            country: isUs ? "US" : "CA"
          },
          email: `customer${String(index)}@maple-moss-demo.example`,
          telephone: `+1 555 010 ${String(index).padStart(2, "0")}`,
          defaultPaymentTermsDays: index % 2 === 0 ? 15 : 30,
          defaultTaxCodeId: taxCodeId,
          defaultCurrency: isUs ? "USD" : "CAD",
          internalNotes: `${expandedDemoMarker} customer ${String(index)}`
        });
      }
      customerIds.push(customer.id);
      const contact = await this.customerContact(context, customer.id, index);
      await this.ensureCustomerActivity(context, customer.id, contact, index);
    }

    const vendorIds = [primaryVendorId];
    for (let index = 2; index <= 6; index += 1) {
      const number = `DEMO-VEND-${String(index).padStart(3, "0")}`;
      let vendor = await this.tenantRead(context, (tx) =>
        tx.vendor.findUnique({
          where: {
            organizationId_vendorNumber: {
              organizationId: context.organizationId,
              vendorNumber: number
            }
          },
          select: { id: true }
        })
      );
      if (!vendor) {
        const created = await this.purchases.createVendor(context, {
          vendorNumber: number,
          legalName: `Fictional Supplier ${String(index)} Ltd.`,
          displayName: `Fictional Supplier ${String(index)}`,
          email: `vendor${String(index)}@maple-moss-demo.example`,
          telephone: `+1 555 020 ${String(index).padStart(2, "0")}`,
          remittanceAddress: {
            line1: `${String(400 + index)} Sample Road`,
            city: "Calgary",
            province: "AB",
            postalCode: "T0T 0T0",
            country: "CA"
          },
          defaultPaymentTermsDays: index % 2 === 0 ? 30 : 45,
          defaultCurrency: "CAD",
          defaultExpenseAccountId: expense.id,
          defaultTaxCodeId: taxCodeId,
          preferredPaymentMethod: "ELECTRONIC_TRANSFER",
          internalNotes: `${expandedDemoMarker} vendor ${String(index)}`
        });
        vendor = { id: requireJsonId(created, "vendor") };
      }
      vendorIds.push(vendor.id);
    }

    const productIds = [primaryProductId];
    const inventory = accounts.get("inventory")?.id;
    const cogs = accounts.get("cost-of-goods")?.id;
    for (let index = 2; index <= 20; index += 1) {
      const sku = `DEMO-SKU-${String(index).padStart(3, "0")}`;
      let product = await this.tenantRead(context, (tx) =>
        tx.productItem.findUnique({
          where: { organizationId_sku: { organizationId: context.organizationId, sku } },
          select: { id: true }
        })
      );
      if (!product) {
        const itemType =
          index <= 5 && inventory && cogs
            ? "INVENTORY_PRODUCT"
            : index % 4 === 0
              ? "NON_INVENTORY_PRODUCT"
              : "SERVICE";
        const created = await this.products.create(context, {
          sku,
          name: `Demo offering ${String(index)}`,
          description: `${expandedDemoMarker} product ${String(index)}`,
          itemType,
          salesPriceMinor: String(12500 + index * 1750),
          purchaseCostMinor:
            itemType === "INVENTORY_PRODUCT" ? String(4500 + index * 500) : undefined,
          incomeAccountId: income.id,
          expenseAccountId: itemType === "INVENTORY_PRODUCT" ? expense.id : undefined,
          inventoryAssetAccountId: itemType === "INVENTORY_PRODUCT" ? inventory : undefined,
          costOfGoodsSoldAccountId: itemType === "INVENTORY_PRODUCT" ? cogs : undefined,
          defaultTaxCodeId: taxCodeId,
          unitOfMeasure: itemType === "SERVICE" ? "hour" : "each",
          reorderPointMicros: itemType === "INVENTORY_PRODUCT" ? "5000000" : undefined,
          preferredStockMicros: itemType === "INVENTORY_PRODUCT" ? "20000000" : undefined,
          leadTimeDays: itemType === "INVENTORY_PRODUCT" ? 7 : undefined,
          inventoryCostingMethod: itemType === "INVENTORY_PRODUCT" ? "WEIGHTED_AVERAGE" : undefined
        });
        product = { id: created.id };
      }
      productIds.push(product.id);
    }

    const invoiceIds = await this.ensureExpandedInvoices(
      context,
      customerIds,
      productIds,
      taxCodeId
    );
    await this.ensureExpandedPayments(context, customerIds, invoiceIds, cash.id);
    const billIds = await this.ensureExpandedBills(context, vendorIds, taxCodeId, expense.id);
    await this.ensureExpandedBillPayments(context, vendorIds, billIds, cash.id);
    await this.ensureExpandedProjects(context, customerIds);
    await this.ensureExpandedPayroll(context, accounts);
  }

  private async customerContact(context: OrganizationContext, customerId: string, index: number) {
    const existing = await this.tenantRead(context, (tx) =>
      tx.customerContact.findFirst({
        where: {
          organizationId: context.organizationId,
          customerId,
          email: `contact${String(index)}@maple-moss-demo.example`
        },
        select: { id: true }
      })
    );
    if (existing) return existing;
    return this.customers.createContact(context, customerId, {
      name: `Contact ${String(index)}`,
      role: index % 2 === 0 ? "Controller" : "Owner",
      email: `contact${String(index)}@maple-moss-demo.example`,
      telephone: `+1 555 030 ${String(index).padStart(2, "0")}`,
      preferredChannel: "EMAIL",
      notes: `${expandedDemoMarker} contact`
    });
  }

  private async ensureCustomerActivity(
    context: OrganizationContext,
    customerId: string,
    contact: { id: string },
    index: number
  ): Promise<void> {
    const marker = `${expandedDemoMarker} activity ${String(index)}`;
    const existing = await this.tenantRead(context, (tx) =>
      tx.customerActivity.findFirst({
        where: { organizationId: context.organizationId, customerId, body: marker },
        select: { id: true }
      })
    );
    if (!existing)
      await this.customers.createActivity(context, customerId, {
        activityType: "FOLLOW_UP",
        category: "DEMO",
        subject: `Quarterly check-in ${String(index)}`,
        body: marker,
        happenedAt: "2026-07-15T10:00:00.000Z",
        contactId: contact.id
      });
  }

  private async ensureExpandedInvoices(
    context: OrganizationContext,
    customerIds: readonly string[],
    productIds: readonly string[],
    taxCodeId: string
  ): Promise<{ id: string; customerId: string }[]> {
    const invoices: { id: string; customerId: string }[] = [];
    for (let index = 1; index <= 10; index += 1) {
      const marker = `${expandedDemoMarker} invoice ${String(index)}`;
      let invoice = await this.tenantRead(context, (tx) =>
        tx.invoice.findFirst({
          where: { organizationId: context.organizationId, internalNotes: marker },
          select: { id: true, customerId: true }
        })
      );
      if (!invoice) {
        const customerId = customerIds[(index - 1) % customerIds.length]!;
        const draft = await this.invoices.create(context, {
          customerId,
          issueDate: `2026-${String(Math.min(index + 1, 9)).padStart(2, "0")}-05`,
          dueDate: `2026-${String(Math.min(index + 2, 10)).padStart(2, "0")}-04`,
          currency: "CAD",
          lines: [
            {
              productItemId: productIds[index % productIds.length]!,
              description: `Professional services package ${String(index)} (fictional demo)`,
              quantity: String((index % 3) + 1),
              unitPriceMinor: String(18500 + index * 1250),
              discountMinor: index % 4 === 0 ? "1000" : "0",
              taxCodeId
            }
          ],
          customerFacingNotes: "Fictional demonstration invoice — no payment is due.",
          internalNotes: marker,
          terms: "Demo only — use this record to explore the workflow."
        });
        const posted = await this.invoices.post(
          context,
          draft.id,
          draft.version,
          undefined,
          `demo:${marker}:post`
        );
        const postedInvoice = posted.body.invoice as { id: string; customerId: string };
        invoice = { id: postedInvoice.id, customerId: postedInvoice.customerId };
      }
      invoices.push(invoice);
    }
    return invoices;
  }

  private async ensureExpandedPayments(
    context: OrganizationContext,
    customerIds: readonly string[],
    invoices: readonly { id: string; customerId: string }[],
    receivingAccountId: string
  ): Promise<void> {
    for (const [index, invoice] of invoices.slice(0, 4).entries()) {
      const reference = `${expandedDemoMarker}-receipt-${String(index + 1)}`;
      const already = await this.tenantRead(context, (tx) =>
        tx.payment.findFirst({
          where: { organizationId: context.organizationId, reference },
          select: { id: true }
        })
      );
      if (already) continue;
      const row = await this.tenantRead(context, (tx) =>
        tx.invoice.findUniqueOrThrow({
          where: { id: invoice.id },
          select: { grandTotalMinor: true }
        })
      );
      const amount = index === 1 ? row.grandTotalMinor / 2n : row.grandTotalMinor;
      await this.payments.recordManual(
        context,
        {
          customerId: customerIds.includes(invoice.customerId)
            ? invoice.customerId
            : customerIds[0]!,
          receivingAccountId,
          paymentDate: `2026-07-${String(10 + index).padStart(2, "0")}`,
          amountMinor: amount.toString(),
          currency: "CAD",
          methodCategory: index % 2 === 0 ? "ELECTRONIC_TRANSFER" : "CHEQUE",
          reference,
          allocations: [{ invoiceId: invoice.id, amountMinor: amount.toString() }]
        },
        `demo:${reference}`
      );
    }
  }

  private async ensureExpandedBills(
    context: OrganizationContext,
    vendorIds: readonly string[],
    taxCodeId: string,
    expenseAccountId: string
  ): Promise<{ id: string; vendorId: string }[]> {
    const bills: { id: string; vendorId: string }[] = [];
    for (let index = 1; index <= 8; index += 1) {
      const marker = `${expandedDemoMarker} bill ${String(index)}`;
      let bill = await this.tenantRead(context, (tx) =>
        tx.bill.findFirst({
          where: { organizationId: context.organizationId, internalNotes: marker },
          select: { id: true, vendorId: true }
        })
      );
      if (!bill) {
        const vendorId = vendorIds[(index - 1) % vendorIds.length]!;
        const draft = await this.purchases.createBill(context, {
          vendorId,
          vendorInvoiceNumber: `DEMO-BILL-${String(index + 1).padStart(3, "0")}`,
          issueDate: `2026-${String(Math.min(index + 1, 9)).padStart(2, "0")}-10`,
          dueDate: `2026-${String(Math.min(index + 2, 10)).padStart(2, "0")}-09`,
          currency: "CAD",
          internalNotes: marker,
          lines: [
            {
              description: `Operating expense ${String(index)} (fictional demo)`,
              quantity: "1",
              unitCostMinor: String(9500 + index * 875),
              accountId: expenseAccountId,
              taxCodeId
            }
          ]
        });
        const posted = await this.purchases.postBill(
          context,
          requireJsonId(draft, "bill"),
          requireJsonVersion(draft, "bill"),
          `demo:${marker}:post`
        );
        bill = {
          id: requireJsonId((posted as { body?: { bill?: unknown } }).body?.bill, "bill"),
          vendorId
        };
      }
      bills.push(bill);
    }
    return bills;
  }

  private async ensureExpandedBillPayments(
    context: OrganizationContext,
    vendorIds: readonly string[],
    bills: readonly { id: string; vendorId: string }[],
    payingAccountId: string
  ): Promise<void> {
    for (const [index, bill] of bills.slice(0, 3).entries()) {
      const reference = `${expandedDemoMarker}-bill-payment-${String(index + 1)}`;
      const already = await this.tenantRead(context, (tx) =>
        tx.billPayment.findFirst({
          where: { organizationId: context.organizationId, reference },
          select: { id: true }
        })
      );
      if (already) continue;
      const row = await this.tenantRead(context, (tx) =>
        tx.bill.findUniqueOrThrow({ where: { id: bill.id }, select: { grandTotalMinor: true } })
      );
      await this.purchases.recordBillPayment(
        context,
        {
          vendorId: vendorIds.includes(bill.vendorId) ? bill.vendorId : vendorIds[0]!,
          paymentDate: `2026-07-${String(20 + index).padStart(2, "0")}`,
          amountMinor: row.grandTotalMinor.toString(),
          currency: "CAD",
          method: "ELECTRONIC_TRANSFER",
          payingAccountId,
          reference,
          allocations: [{ billId: bill.id, amountMinor: row.grandTotalMinor.toString() }]
        },
        `demo:${reference}`
      );
    }
  }

  private async ensureExpandedProjects(
    context: OrganizationContext,
    customerIds: readonly string[]
  ): Promise<void> {
    for (let index = 1; index <= 3; index += 1) {
      const projectNumber = `DEMO-PROJ-${String(index).padStart(3, "0")}`;
      let project = await this.tenantRead(context, (tx) =>
        tx.project.findUnique({
          where: {
            organizationId_projectNumber: { organizationId: context.organizationId, projectNumber }
          },
          select: { id: true }
        })
      );
      if (!project)
        project = await this.projects.create(context, {
          customerId: customerIds[(index - 1) % customerIds.length]!,
          projectNumber,
          name: `Demo client engagement ${String(index)}`,
          description: `${expandedDemoMarker} project ${String(index)}`,
          billingMethod: index === 2 ? "TIME_AND_MATERIALS" : "FIXED",
          startDate: `2026-0${String(index + 1)}-01`,
          endDate: `2026-0${String(index + 3)}-28`,
          budgetMinor: String(125000 + index * 25000),
          tags: ["demo", index === 2 ? "time" : "fixed", "client-work"]
        });
      const timeEntry = await this.tenantRead(context, (tx) =>
        tx.projectTimeEntry.findFirst({
          where: { organizationId: context.organizationId, projectId: project.id },
          select: { id: true }
        })
      );
      if (!timeEntry)
        await this.projects.createTimeEntry(context, project.id, {
          entryDate: "2026-07-18",
          durationMicros: "14400000000",
          rateMinor: "12500",
          description: "Demo project delivery work",
          billable: true,
          startedAt: "2026-07-18T09:00:00.000Z",
          endedAt: "2026-07-18T13:00:00.000Z"
        });
    }
  }

  private async ensureExpandedPayroll(
    context: OrganizationContext,
    accounts: ReadonlyMap<string, { id: string }>
  ): Promise<void> {
    const expense = requiredAccount(accounts, "general-expense");
    const liability = requiredAccount(accounts, "tax-payable");
    const cash = requiredAccount(accounts, "accounts-payable");
    await this.payroll.configure(context, {
      defaultExpenseAccountId: expense.id,
      defaultLiabilityAccountId: liability.id,
      netPayClearingAccountId: cash.id,
      calculationRulePackId: "clearledger-payroll-ca-ab",
      calculationRulePackVersion: "2026.2"
    });
    const calculator = new PayrollStatutoryCalculator();
    const components = calculator.calculate({
      jurisdiction: "CA-AB",
      payDate: "2026-07-31",
      payFrequency: "BIWEEKLY",
      grossPayMinor: 200000n,
      canadianWithholding: { federalClaimCode: 1, provincialClaimCode: 1 }
    }).components;
    for (const component of components) {
      const exists = await this.tenantRead(context, (tx) =>
        tx.payrollCode.findFirst({
          where: { organizationId: context.organizationId, code: component.code },
          select: { id: true }
        })
      );
      if (!exists)
        await this.payroll.createCode(
          context,
          {
            code: component.code,
            name: component.code.replaceAll("_", " "),
            kind: component.category,
            statutoryAttributes: {
              jurisdiction: "CA-AB",
              statutory: component.category !== "EARNING"
            },
            expenseAccountId:
              component.category === "EARNING" || component.category === "EMPLOYER_CONTRIBUTION"
                ? expense.id
                : null,
            liabilityAccountId:
              component.category === "DEDUCTION" || component.category === "EMPLOYER_CONTRIBUTION"
                ? liability.id
                : null,
            remittanceAuthority: component.category === "EARNING" ? null : "CRA"
          },
          `demo:payroll-code:${component.code}`
        );
    }
    const workers = [] as { id: string }[];
    for (let index = 1; index <= 5; index += 1) {
      const workerNumber = `DEMO-EMP-${String(index).padStart(3, "0")}`;
      let worker = await this.tenantRead(context, (tx) =>
        tx.payrollWorker.findFirst({
          where: { organizationId: context.organizationId, workerNumber },
          select: { id: true }
        })
      );
      if (!worker) {
        const created = await this.payroll.createWorker(
          context,
          {
            workerNumber,
            kind: "EMPLOYEE",
            displayName: `Demo Employee ${String(index)}`,
            profile: {
              effectiveFrom: "2026-01-01",
              jurisdictionCode: "CA-AB",
              taxAttributes: { federalClaimCode: 1, provincialClaimCode: 1 }
            },
            compensation: {
              effectiveFrom: "2026-01-01",
              kind: "SALARY",
              rateMinor: String(4200000 + index * 250000)
            }
          },
          `demo:payroll-worker:${workerNumber}`
        );
        worker = { id: created.body.payrollWorker.id };
      }
      workers.push(worker);
    }
    let schedule = await this.tenantRead(context, (tx) =>
      tx.payrollSchedule.findFirst({
        where: { organizationId: context.organizationId, code: "DEMO-BIWEEKLY" },
        select: { id: true }
      })
    );
    if (!schedule) {
      const created = await this.payroll.createSchedule(
        context,
        {
          code: "DEMO-BIWEEKLY",
          name: "Demo biweekly payroll",
          frequency: "BIWEEKLY",
          anchorPayDate: "2026-07-31"
        },
        "demo:payroll-schedule"
      );
      schedule = { id: created.body.payrollSchedule.id };
    }
    let period = await this.tenantRead(context, (tx) =>
      tx.payrollPeriod.findFirst({
        where: { organizationId: context.organizationId, scheduleId: schedule.id, sequence: 14 },
        select: { id: true }
      })
    );
    if (!period)
      period = await this.payroll.createPeriod(context, {
        scheduleId: schedule.id,
        periodStart: "2026-07-18",
        periodEnd: "2026-07-31",
        payDate: "2026-07-31",
        sequence: 14
      });
    const posted = await this.tenantRead(context, (tx) =>
      tx.payrollRun.findFirst({
        where: {
          organizationId: context.organizationId,
          runNumber: "DEMO-PAY-2026-14",
          status: "POSTED"
        },
        select: { id: true }
      })
    );
    if (posted) return;
    const created = await this.payroll.createRun(
      context,
      {
        runNumber: "DEMO-PAY-2026-14",
        kind: "REGULAR",
        scheduleId: schedule.id,
        periodId: period.id,
        periodStart: "2026-07-18",
        periodEnd: "2026-07-31",
        payDate: "2026-07-31",
        workers: workers.slice(0, 3).map((worker, index) => ({
          workerId: worker.id,
          grossPayMinor: String(200000 + index * 25000),
          statutory: { canadianWithholding: { federalClaimCode: 1, provincialClaimCode: 1 } }
        }))
      },
      "demo:payroll-run:2026-14"
    );
    const calculated = await this.payroll.calculate(context, created.body.payrollRun!.id);
    const reviewed = await this.payroll.review(context, calculated!.id, calculated!.version);
    const approver = await this.ensurePayrollApprover(context);
    const approved = await this.payroll.approve(approver, reviewed!.id, reviewed!.version);
    await this.payroll.post(context, approved!.id, approved!.version, "demo:payroll-post:2026-14");
  }

  private async ensurePayrollApprover(context: OrganizationContext): Promise<OrganizationContext> {
    const email = "demo-payroll-approver@example.test";
    const member = await this.tenantRead(context, async (tx) => {
      const user = await tx.user.upsert({
        where: { email },
        create: { email, displayName: "Demo Payroll Approver", emailVerifiedAt: new Date() },
        update: {}
      });
      const membership = await tx.membership.upsert({
        where: {
          organizationId_userId: { organizationId: context.organizationId, userId: user.id }
        },
        create: {
          organizationId: context.organizationId,
          userId: user.id,
          role: "ADMIN",
          status: "ACTIVE"
        },
        update: { role: "ADMIN", status: "ACTIVE" }
      });
      const companyMembership = context.companyId
        ? await tx.companyMembership.upsert({
            where: { companyId_userId: { companyId: context.companyId, userId: user.id } },
            create: {
              organizationId: context.organizationId,
              companyId: context.companyId,
              userId: user.id,
              role: "ADMIN",
              status: "ACTIVE"
            },
            update: { role: "ADMIN", status: "ACTIVE" }
          })
        : null;
      return { user, membership, companyMembership };
    });
    return {
      ...context,
      user: member.user,
      membershipId: member.membership.id,
      role: "ADMIN",
      ...(member.companyMembership ? { companyMembershipId: member.companyMembership.id } : {})
    };
  }

  private async accountMap(context: OrganizationContext) {
    const accounts = await this.tenantRead(context, (tx) =>
      tx.account.findMany({
        where: { organizationId: context.organizationId, isArchived: false },
        select: { id: true, systemPurpose: true }
      })
    );
    return new Map(
      accounts
        .filter((account): account is { id: string; systemPurpose: string } =>
          Boolean(account.systemPurpose)
        )
        .map((account) => [account.systemPurpose, { id: account.id }])
    );
  }

  private async setupState(context: OrganizationContext): Promise<DemoSetupState> {
    return (await this.setup.getState(context)) as unknown as DemoSetupState;
  }

  private async recordCompletion(context: OrganizationContext): Promise<void> {
    await this.tenantRead(context, async (tx) => {
      const existing = await tx.auditEvent.findFirst({
        where: {
          organizationId: context.organizationId,
          action: "DEMO_COMPANY_SEEDED",
          targetType: "Organization",
          targetId: context.organizationId
        }
      });
      if (!existing)
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "DEMO_COMPANY_SEEDED",
            targetType: "Organization",
            targetId: context.organizationId,
            requestId: context.requestId,
            metadata: withAuditOrigin(context.auditOrigin, {
              fixtureVersion: demoCompanyFixtureVersion,
              fictional: true,
              templateKey: demoCompanyTemplateKey
            })
          }
        });
    });
  }

  private async recordIdempotentResponse(
    actor: AuthenticatedIdentity,
    seeded: DemoCompanyResult,
    idempotencyKey: string,
    requestId: string,
    auditOrigin: AuditOrigin
  ): Promise<DemoCompanyResult> {
    const context = demoContext(
      actor,
      seeded.organizationId,
      stableUuid(`clearledger:demo-membership:${seeded.organizationId}:${actor.id}`),
      requestId,
      auditOrigin
    );
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const requestHash = createHash("sha256")
      .update(`${demoCompanyTemplateKey}:${String(demoCompanyFixtureVersion)}`)
      .digest("hex");
    const originalCreated = await this.tenantRead(context, async (tx) => {
      const existing = await tx.idempotencyRecord.findUnique({
        where: {
          organizationId_operation_key: {
            organizationId: seeded.organizationId,
            operation: "demo-company.create",
            key: keyHash
          }
        }
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new AppError(
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency-Key was already used for a different request.",
            409
          );
        const response = existing.responseBody;
        return Boolean(
          response &&
            typeof response === "object" &&
            !Array.isArray(response) &&
            response.created === true
        );
      }
      await tx.idempotencyRecord.create({
        data: {
          organizationId: seeded.organizationId,
          operation: "demo-company.create",
          key: keyHash,
          requestHash,
          responseStatus: seeded.created ? 201 : 200,
          responseBody: {
            organizationId: seeded.organizationId,
            created: seeded.created,
            fixtureVersion: demoCompanyFixtureVersion
          },
          resourceId: seeded.organizationId
        }
      });
      return seeded.created;
    });
    return { ...seeded, created: originalCreated, reused: !originalCreated };
  }

  private async summary(
    context: OrganizationContext,
    created: boolean
  ): Promise<DemoCompanyResult> {
    const result = await this.tenantRead(context, async (tx) => {
      const [organization, settings, currencies, accounts, customers, vendors, products, banks] =
        await Promise.all([
          tx.organization.findUniqueOrThrow({ where: { id: context.organizationId } }),
          tx.organizationSettings.findUniqueOrThrow({
            where: { organizationId: context.organizationId }
          }),
          tx.organizationCurrency.findMany({
            where: { organizationId: context.organizationId, enabled: true },
            orderBy: { currencyCode: "asc" }
          }),
          tx.account.count({ where: { organizationId: context.organizationId } }),
          tx.customer.count({ where: { organizationId: context.organizationId } }),
          tx.vendor.count({ where: { organizationId: context.organizationId } }),
          tx.productItem.count({ where: { organizationId: context.organizationId } }),
          tx.bankAccount.count({ where: { organizationId: context.organizationId } })
        ]);
      const [
        postedInvoices,
        draftInvoices,
        totalInvoices,
        paidInvoices,
        partialInvoices,
        postedBills,
        totalBills,
        paidBills,
        customerContacts,
        customerActivities,
        timeEntries,
        journals,
        payments,
        billPayments,
        payrollWorkers,
        payrollRuns,
        projects
      ] = await Promise.all([
        tx.invoice.count({ where: { organizationId: context.organizationId, status: "POSTED" } }),
        tx.invoice.count({ where: { organizationId: context.organizationId, status: "DRAFT" } }),
        tx.invoice.count({ where: { organizationId: context.organizationId } }),
        tx.invoice.count({ where: { organizationId: context.organizationId, status: "PAID" } }),
        tx.invoice.count({
          where: { organizationId: context.organizationId, status: "PARTIALLY_PAID" }
        }),
        tx.bill.count({ where: { organizationId: context.organizationId, status: "POSTED" } }),
        tx.bill.count({ where: { organizationId: context.organizationId } }),
        tx.bill.count({ where: { organizationId: context.organizationId, status: "PAID" } }),
        tx.customerContact.count({ where: { organizationId: context.organizationId } }),
        tx.customerActivity.count({ where: { organizationId: context.organizationId } }),
        tx.projectTimeEntry.count({ where: { organizationId: context.organizationId } }),
        tx.journal.findMany({
          where: { organizationId: context.organizationId, status: "POSTED" },
          include: { lines: true }
        }),
        tx.payment.count({ where: { organizationId: context.organizationId } }),
        tx.billPayment.count({ where: { organizationId: context.organizationId } }),
        tx.payrollWorker.count({ where: { organizationId: context.organizationId } }),
        tx.payrollRun.count({ where: { organizationId: context.organizationId } }),
        tx.project.count({ where: { organizationId: context.organizationId } })
      ]);
      const journalsBalanced = journals.every(
        (journal) =>
          journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n) ===
          journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n)
      );
      return {
        organization,
        setupComplete: Boolean(settings.setupCompletedAt),
        enabledCurrencies: currencies.map((currency) => currency.currencyCode.trim()),
        counts: {
          accounts,
          customers,
          vendors,
          products,
          bankAccounts: banks,
          postedInvoices,
          draftInvoices,
          totalInvoices,
          paidInvoices,
          partialInvoices,
          postedBills,
          totalBills,
          paidBills,
          customerContacts,
          customerActivities,
          timeEntries,
          postedJournals: journals.length,
          payments,
          billPayments,
          payrollWorkers,
          payrollRuns,
          projects
        },
        journalsBalanced
      };
    });
    return {
      organizationId: result.organization.id,
      displayName: result.organization.displayName,
      created,
      reused: !created,
      fictional: true,
      templateKey: demoCompanyTemplateKey,
      fixtureVersion: demoCompanyFixtureVersion,
      setupComplete: result.setupComplete,
      enabledCurrencies: result.enabledCurrencies,
      counts: result.counts,
      journalsBalanced: result.journalsBalanced
    };
  }

  private tenantRead<T>(
    context: OrganizationContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId: context.companyId
      },
      work
    );
  }
}

function requiredAccount(
  accounts: ReadonlyMap<string, { id: string }>,
  purpose: string
): { id: string } {
  const account = accounts.get(purpose);
  if (!account)
    throw new AppError(
      "DEMO_COMPANY_ACCOUNT_MISSING",
      `The demo company is missing its ${purpose} account.`,
      500
    );
  return account;
}

function demoContext(
  actor: AuthenticatedIdentity,
  organizationId: string,
  membershipId: string,
  requestId: string,
  auditOrigin: AuditOrigin,
  companyId?: string
): OrganizationContext {
  return {
    requestId,
    user: actor,
    organizationId,
    membershipId,
    role: "OWNER",
    ...(companyId ? { companyId } : {}),
    sessionId: actor.sessionId,
    recentAuthAt: actor.recentAuthAt,
    mfaAuthenticated: actor.mfaAuthenticated,
    authenticationMethod: actor.authenticationMethod,
    auditOrigin
  };
}

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function advisoryLockKey(value: string): bigint {
  return createHash("sha256").update(value).digest().readBigInt64BE(0);
}

function assertCompleteDemo(result: DemoCompanyResult): void {
  const currencies = new Set(result.enabledCurrencies);
  if (
    !result.setupComplete ||
    !currencies.has("CAD") ||
    !currencies.has("USD") ||
    result.counts.postedJournals < 1 ||
    !result.journalsBalanced
  )
    throw new AppError(
      "DEMO_COMPANY_INCOMPLETE",
      "The fictional demo company did not pass its completion checks.",
      500,
      {
        setupComplete: result.setupComplete,
        enabledCurrencies: result.enabledCurrencies,
        postedJournals: result.counts.postedJournals,
        journalsBalanced: result.journalsBalanced
      }
    );
}

function requireJsonId(value: unknown, resource: string): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { id?: unknown }).id !== "string"
  )
    throw new AppError(
      "DEMO_COMPANY_RESOURCE_INVALID",
      `The demo ${resource} could not be created.`,
      500
    );
  return (value as { id: string }).id;
}

function requireJsonVersion(value: unknown, resource: string): number {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { version?: unknown }).version !== "number"
  )
    throw new AppError(
      "DEMO_COMPANY_RESOURCE_INVALID",
      `The demo ${resource} could not be created.`,
      500
    );
  return (value as { version: number }).version;
}
