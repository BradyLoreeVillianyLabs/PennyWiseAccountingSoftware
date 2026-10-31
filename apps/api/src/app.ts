import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@clearledger/db";
import { AppError } from "@clearledger/shared";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import { DevelopmentIdentityAdapter } from "./auth/dev-identity.js";
import { ApiCredentialIdentityAdapter } from "./auth/api-credential-identity-adapter.js";
import { OAuthIdentityAdapter } from "./auth/oauth-identity-adapter.js";
import type { IdentityAdapter } from "./auth/identity-adapter.js";
import { requestHeader } from "./auth/identity-adapter.js";
import { OidcAuthenticationService } from "./auth/oidc-authentication-service.js";
import {
  oidcConfigFromEnvironment,
  ProductionOidcProvider,
  type OidcProvider
} from "./auth/oidc-provider.js";
import {
  expiredSessionCookie,
  SessionIdentityAdapter,
  SessionService,
  sessionCookie
} from "./auth/session-service.js";
import {
  auditOriginFromRequest,
  requireIdentity,
  requireOrganizationContext
} from "./http/request-context.js";
import { AuthorizationService } from "./auth/permissions.js";
import {
  acceptInvitationSchema,
  businessDefaultsSchema,
  paymentInstructionUpdateSchema,
  calendarQuerySchema,
  changeRoleSchema,
  closePeriodSchema,
  completeSetupSchema,
  createAccountSchema,
  createCreditNoteSchema,
  createCustomerSchema,
  createCustomerContactSchema,
  updateCustomerContactSchema,
  createCustomerActivitySchema,
  createFiscalPeriodSchema,
  createInvitationSchema,
  createOrganizationSchema,
  createCompanySchema,
  updateCompanySchema,
  deleteCompanySchema,
  demoCompanyCreateSchema,
  createProductSchema,
  createInvoiceSchema,
  createEstimateSchema,
  updateEstimateSchema,
  estimateTransitionSchema,
  estimateConvertSchema,
  createRecurringScheduleSchema,
  patchRecurringScheduleSchema,
  createProjectSchema,
  updateProjectSchema,
  createProjectWorkItemSchema,
  updateProjectWorkItemSchema,
  projectWorkItemListSchema,
  projectWorkItemStatusCommandSchema,
  projectWorkItemDependencySchema,
  createTimeEntrySchema,
  createMileageSchema,
  createCaptureReviewSchema,
  reviewCaptureSchema,
  captureReviewConversionSchema,
  budgetPlanSchema,
  cashForecastAssumptionSchema,
  purchaseRequestSchema,
  purchaseRequestDecisionSchema,
  customerDepositRequestSchema,
  progressBillingPlanSchema,
  nonPostingWorkflowCommandSchema,
  fixedAssetClassSchema,
  fixedAssetCreateSchema,
  fixedAssetPatchSchema,
  versionSchema,
  migrationRunSchema,
  migrationRunTransitionSchema,
  manualCommercialSubscriptionSchema,
  commercialTransitionSchema,
  manualCommercialEventSchema,
  apiCredentialSchema,
  oauthAuthorizationSchema,
  oauthClientSchema,
  oauthTokenSchema,
  connectorDraftSchema,
  connectorConnectSchema,
  connectorMappingSchema,
  connectorSyncSchema,
  connectorCatalogIngestSchema,
  connectorCatalogPollSchema,
  catalogCandidateDecisionSchema,
  catalogSkuAliasApprovalSchema,
  catalogSkuPatternApprovalSchema,
  catalogCreateLocalProductSchema,
  catalogBulkCreateLocalProductsSchema,
  inventorySyncPolicySchema,
  inventorySyncObservationSchema,
  inventorySyncConflictResolutionSchema,
  catalogImageDecisionSchema,
  connectorWebhookRegistrationSchema,
  connectorWebhookSecretSchema,
  etsyOAuthStartSchema,
  etsyOAuthCompleteSchema,
  commerceInboxEventSchema,
  commerceInboxReviewSchema,
  commerceOrderBatchConversionSchema,
  commerceOrderConversionSchema,
  webhookEndpointSchema,
  webhookDisableSchema,
  creditNotePostSchema,
  createContractSchema,
  dateStringSchema,
  emailConnectionCallbackSchema,
  emailConnectionProviderSchema,
  idSchema,
  manualInvoiceDeliverySchema,
  reminderSettingsSchema,
  publicInvoiceLinkSchema,
  sendInvoiceSchema,
  statementRequestSchema,
  statementSendSchema,
  updateInvoiceTemplateSchema,
  invoicePostSchema,
  invoiceVoidSchema,
  listQuerySchema,
  manualJournalDraftCancelSchema,
  manualJournalDraftSchema,
  manualJournalDraftUpdateSchema,
  openingBalanceSchema,
  patchAccountSchema,
  postJournalSchema,
  presetKeySchema,
  productEventSchema,
  productAnalyticsConsentSchema,
  profileSchema,
  payrollAutomationRunSchema,
  payrollCodeSchema,
  payrollPaymentBatchSchema,
  payrollPaymentExportSchema,
  payrollPeriodSchema,
  payrollRunSchema,
  payrollScheduleAutomationSchema,
  payrollScheduleSchema,
  payrollScheduledDraftSchema,
  payrollSettingsSchema,
  payrollWorkerSchema,
  quantityStringSchema,
  reopenPeriodSchema,
  reverseJournalSchema,
  setupStepSchema,
  setupStepUpdateSchema,
  switchOrganizationSchema,
  switchCompanySchema,
  intercompanyTransactionSchema,
  intercompanyTransitionSchema,
  consolidationGroupSchema,
  taxCodeVersionSchema,
  taxRegistrationSchema,
  updateCustomerSchema,
  updateContractSchema,
  updateInvoiceSchema,
  updateProductSchema,
  inventoryBarcodeRegisterSchema,
  inventoryScanResolveSchema,
  inventoryLabelTemplateSchema,
  inventoryLabelPreviewSchema,
  workflowPreferencesSchema,
  readyContractSchema,
  multiCurrencySettingsSchema,
  fxRateSnapshotSchema,
  fxRevaluationSchema
} from "./http/schemas.js";
import { buildOpenApiDocument, publicApiVersion } from "./openapi.js";
import { isClearLedgerBetaRuntime, runtimeCapabilities } from "./beta-runtime-config.js";
import { AccountService } from "./services/account-service.js";
import { AccountPresetService } from "./services/account-presets.js";
import { CompanySetupService } from "./services/company-setup-service.js";
import { PaymentInstructionService } from "./services/payment-instruction-service.js";
import { FiscalPeriodService } from "./services/fiscal-period-service.js";
import { CustomerService } from "./services/customer-service.js";
import { JournalService } from "./services/journal-service.js";
import {
  DevelopmentLogoStorage,
  LogoService,
  NoopDevelopmentScanner,
  type LogoStorage,
  type MalwareScanner
} from "./services/logo-service.js";
import { MembershipService } from "./services/membership-service.js";
import { OrganizationService } from "./services/organization-service.js";
import { CompanyService } from "./services/company-service.js";
import { IntercompanyService } from "./services/intercompany-service.js";
import { OpeningBalanceService } from "./services/opening-balance-service.js";
import { ProductService } from "./services/product-service.js";
import { InventoryService } from "./services/inventory-service.js";
import { InventoryCatalogControlService } from "./services/inventory-catalog-control-service.js";
import { PosService } from "./services/pos-service.js";
import { InvoiceService } from "./services/invoice-service.js";
import {
  DevelopmentAttachmentScanner,
  DevelopmentDocumentStorage,
  DevelopmentEmailProvider,
  InvoiceDocumentService,
  type AttachmentScanner,
  type DocumentStorage,
  type EmailProvider
} from "./services/invoice-document-service.js";
import { InvoiceTemplateService } from "./services/invoice-template-service.js";
import { ContractService } from "./services/contract-service.js";
import {
  AesPaymentAccountProtector,
  type PaymentAccountProtector,
  type PaymentProviderAdapter
} from "./services/payment-provider.js";
import {
  ConnectedMailboxEmailProvider,
  type EmailDeliveryHttpClient
} from "./services/connected-mailbox-email-provider.js";
import { SmtpTransport } from "./services/smtp-email-provider.js";
import {
  EmailConnectionService,
  FetchEmailOAuthHttpClient,
  emailConnectionConfigFromEnvironment,
  emailDeliveryRuntimeFromEnvironment,
  type EmailDeliveryRuntime,
  type EmailConnectionRuntimeConfig,
  type EmailOAuthHttpClient
} from "./services/email-connection-service.js";
import { ReceivablesService } from "./services/receivables-service.js";
import { PaymentService } from "./services/payment-service.js";
import type { OwnAccountPaymentProviderFactory } from "./services/own-account-payment-provider.js";
import { PaymentCheckoutExpiryWorker } from "./services/payment-checkout-expiry-worker.js";
import { PaymentOutboxWorker } from "./services/payment-outbox-worker.js";
import { AutomationJobRunner } from "./jobs/automation-job-runner.js";
import { PurchaseService, type VendorInput } from "./services/purchase-service.js";
import { PurchaseAttachmentService } from "./services/purchase-attachment-service.js";
import {
  BankingService,
  type BankAccountInput,
  type BankRuleInput
} from "./services/banking-service.js";
import { BankFeedService } from "./services/bank-feed-service.js";
import type { BankFeedProviderAdapter } from "./services/bank-feed-provider.js";
import { bankFeedAdapterFromEnvironment } from "./services/bank-feed-adapter-config.js";
import { parseDate } from "./utils/dates.js";
import {
  DevelopmentWebhookRateLimiter,
  type WebhookRateLimiter
} from "./services/webhook-rate-limiter.js";
import {
  DevelopmentRequestRateLimiter,
  type RequestRateLimiter
} from "./services/request-rate-limiter.js";
import { ReportService } from "./services/report-service.js";
import { Phase10ReportService } from "./services/phase10-report-service.js";
import { ReportViewService } from "./services/report-view-service.js";
import { BooksHealthService } from "./services/books-health-service.js";
import { AccountantService } from "./services/accountant-service.js";
import { DataMigrationService } from "./services/data-migration-service.js";
import { OrganizationPortabilityService } from "./services/organization-portability-service.js";
import { ProductAnalyticsService } from "./services/product-analytics-service.js";
import { PayrollService } from "./services/payroll-service.js";
import { RecurringInvoiceService } from "./services/recurring-invoice-service.js";
import { ReminderService } from "./services/reminder-service.js";
import { StatementDocumentService } from "./services/statement-document-service.js";
import { EstimateService } from "./services/estimate-service.js";
import { EstimateEmailService } from "./services/estimate-email-service.js";
import { ProjectService } from "./services/project-service.js";
import { LocalCaptureExtractionService } from "./services/local-capture-extraction-service.js";
import { ProjectWorkItemService } from "./services/project-work-item-service.js";
import { PlanningService } from "./services/planning-service.js";
import { CalendarService } from "./services/calendar-service.js";
import { PurchaseRequestService } from "./services/purchase-request-service.js";
import { WorkflowPreferencesService } from "./services/workflow-preferences-service.js";
import { CustomerDepositService } from "./services/customer-deposit-service.js";
import { ProgressBillingService } from "./services/progress-billing-service.js";
import { FixedAssetService } from "./services/fixed-asset-service.js";
import { MigrationRunService } from "./services/migration-run-service.js";
import { CommercialService } from "./services/commercial-service.js";
import { MultiCurrencyService } from "./services/multi-currency-service.js";
import { BankOfCanadaRateService } from "./services/bank-of-canada-rate-service.js";
import { FxRevaluationService } from "./services/fx-revaluation-service.js";
import { ApiCredentialService } from "./services/api-credential-service.js";
import { OAuthService } from "./services/oauth-service.js";
import {
  ConnectorRuntimeService,
  type ConnectorAdapter
} from "./services/connector-runtime-service.js";
import { CommerceInboxService } from "./services/commerce-inbox-service.js";
import { CommerceOrderConversionService } from "./services/commerce-order-conversion-service.js";
import { CommerceDemoService } from "./services/commerce-demo-service.js";
import {
  DemoCompanyService,
  demoCompanyAvailableForEnvironment,
  demoCompanyFixtureVersion,
  demoCompanyTemplateKey
} from "./services/demo-company-service.js";
import { CommerceSyncService } from "./services/connectors/commerce-sync-service.js";
import { WooCommerceConnector } from "./services/connectors/woocommerce-connector.js";
import { EtsyConnector } from "./services/connectors/etsy-connector.js";
import { CatalogMappingService } from "./services/catalog-mapping-service.js";
import { CatalogAutomationService } from "./services/catalog-automation-service.js";
import { ProductImageService } from "./services/product-image-service.js";
import { PickingSlipService } from "./services/picking-slip-service.js";
import {
  CanadaPostAdapter,
  FixtureCarrier,
  type CarrierAdapter
} from "./services/shipping/carrier-adapter.js";
import { ShippingService } from "./services/shipping/shipping-service.js";
import { registerShippingRoutes } from "./http/shipping-routes.js";
import {
  FetchWebhookHttpClient,
  type WebhookHttpClient,
  type WebhookSecretProtector,
  WebhookService
} from "./services/webhook-service.js";
import { environmentValueOrDefault } from "./environment.js";

export interface BuildAppOptions {
  readonly prisma?: PrismaClient;
  readonly identityAdapter?: IdentityAdapter;
  readonly oidcProvider?: OidcProvider;
  readonly logoStorage?: LogoStorage;
  readonly malwareScanner?: MalwareScanner;
  readonly documentStorage?: DocumentStorage;
  readonly emailProvider?: EmailProvider;
  readonly attachmentScanner?: AttachmentScanner;
  readonly captureExtractionService?: LocalCaptureExtractionService;
  readonly paymentProvider?: PaymentProviderAdapter;
  readonly paymentProviderKind?: "STRIPE" | "PAYPAL" | "SQUARE";
  readonly paymentAccountProtector?: PaymentAccountProtector;
  readonly ownAccountPaymentProviderFactory?: OwnAccountPaymentProviderFactory;
  readonly webhookRateLimiter?: WebhookRateLimiter;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly webhookSecretProtector?: WebhookSecretProtector;
  readonly webhookHttpClient?: WebhookHttpClient;
  readonly connectorAdapters?: readonly ConnectorAdapter[];
  readonly connectorCredentialProtector?: PaymentAccountProtector;
  readonly emailConnectionConfig?: EmailConnectionRuntimeConfig;
  readonly emailConnectionCredentialProtector?: PaymentAccountProtector;
  readonly emailOAuthHttpClient?: EmailOAuthHttpClient;
  readonly emailDeliveryHttpClient?: EmailDeliveryHttpClient;
  readonly emailDeliveryRuntime?: EmailDeliveryRuntime;
  /** Test seam for the native SMTP transport; production uses the verified default transport. */
  readonly smtpTransport?: SmtpTransport;
  readonly bankFeedAdapter?: BankFeedProviderAdapter;
  readonly bankFeedCredentialProtector?: PaymentAccountProtector;
  readonly bankFeedBetaSandboxApproved?: boolean;
  readonly bankFeedProductionApproved?: boolean;
  readonly bankOfCanadaRateService?: BankOfCanadaRateService;
  readonly shippingAdapters?: readonly CarrierAdapter[];
  readonly shippingCredentialProtector?: PaymentAccountProtector;
}

export const productionLogRedactionPaths: string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-export-token",
  "req.headers.stripe-signature",
  "req.headers.x-wc-webhook-signature",
  "req.headers.webhook-signature",
  "req.query.code",
  "req.query.state",
  "req.body",
  "res.headers.set-cookie"
];

const idParamSchema = z.object({
  accountId: idSchema.optional(),
  contractId: idSchema.optional(),
  connectionId: idSchema.optional(),
  companyId: idSchema.optional(),
  userId: idSchema.optional(),
  transactionId: idSchema.optional(),
  invitationId: idSchema.optional(),
  journalId: idSchema.optional(),
  membershipId: idSchema.optional(),
  periodId: idSchema.optional(),
  sessionId: idSchema.optional(),
  logoId: idSchema.optional(),
  draftId: idSchema.optional(),
  customerId: idSchema.optional(),
  contactId: idSchema.optional(),
  productId: idSchema.optional(),
  invoiceId: idSchema.optional(),
  attachmentId: idSchema.optional(),
  creditNoteId: idSchema.optional(),
  linkId: idSchema.optional(),
  paymentId: idSchema.optional(),
  disputeId: idSchema.optional(),
  vendorId: idSchema.optional(),
  billId: idSchema.optional(),
  billPaymentId: idSchema.optional(),
  vendorCreditId: idSchema.optional(),
  immediateExpenseId: idSchema.optional(),
  immediateExpenseDraftId: idSchema.optional(),
  bankAccountId: idSchema.optional(),
  bankFeedItemId: idSchema.optional(),
  estimateId: idSchema.optional(),
  scheduleId: idSchema.optional(),
  projectId: idSchema.optional(),
  timeEntryId: idSchema.optional(),
  captureReviewId: idSchema.optional(),
  budgetPlanId: idSchema.optional(),
  assumptionId: idSchema.optional(),
  purchaseRequestId: idSchema.optional(),
  depositRequestId: idSchema.optional(),
  progressBillingPlanId: idSchema.optional(),
  fixedAssetClassId: idSchema.optional(),
  fixedAssetId: idSchema.optional(),
  migrationRunId: idSchema.optional(),
  bankImportBatchId: idSchema.optional(),
  bankTransactionId: idSchema.optional(),
  bankRuleId: idSchema.optional(),
  reconciliationId: idSchema.optional(),
  inventoryLocationId: idSchema.optional(),
  inventoryBinId: idSchema.optional(),
  inventoryStatusId: idSchema.optional(),
  inventoryLotId: idSchema.optional(),
  inventorySerialId: idSchema.optional(),
  inventoryReservationId: idSchema.optional(),
  inventoryTransferId: idSchema.optional(),
  inventoryCountId: idSchema.optional(),
  inventoryCountLineId: idSchema.optional(),
  pickingSlipId: idSchema.optional(),
  registerId: idSchema.optional(),
  deviceId: idSchema.optional(),
  shiftId: idSchema.optional(),
  saleId: idSchema.optional(),
  importBatchId: idSchema.optional(),
  exportJobId: idSchema.optional(),
  closureRequestId: idSchema.optional(),
  apiCredentialId: idSchema.optional(),
  oauthClientId: idSchema.optional(),
  connectorInstallationId: idSchema.optional(),
  connectorConflictId: idSchema.optional(),
  webhookEndpointId: idSchema.optional(),
  webhookDeliveryId: idSchema.optional(),
  workItemId: idSchema.optional(),
  dependsOnItemId: idSchema.optional(),
  payrollWorkerId: idSchema.optional(),
  payrollScheduleId: idSchema.optional(),
  payrollPeriodId: idSchema.optional(),
  payrollRunId: idSchema.optional(),
  payrollPaymentBatchId: idSchema.optional()
});
const authenticationQuerySchema = z.object({
  returnTo: z.string().optional(),
  loginHint: z.string().email().optional()
});
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(32) });
const bankOfCanadaRateSuggestionQuerySchema = z
  .object({
    date: dateStringSchema,
    transactionCurrency: z.literal("USD")
  })
  .strict();
const reportsQuerySchema = z.object({
  accountId: idSchema.optional(),
  asOf: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100)
});
const phase10RangeQuerySchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema
  })
  .strict();
const phase10AsOfQuerySchema = z.object({ asOf: dateStringSchema }).strict();
const phase10JournalQuerySchema = phase10RangeQuerySchema.extend({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});
const smtpConnectionRequestSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    tlsMode: z.enum(["STARTTLS", "IMPLICIT_TLS"]),
    username: z.string().min(1).max(320),
    password: z.string().min(1).max(4_096),
    fromAddress: z.string().trim().min(3).max(320),
    testRecipient: z.string().trim().min(3).max(320)
  })
  .strict();

export function buildApp(options: BuildAppOptions = {}) {
  const prisma = options.prisma ?? new PrismaClient();
  const sessions = new SessionService(prisma);
  const production = process.env.NODE_ENV === "production";
  const betaRuntime = isClearLedgerBetaRuntime(process.env);
  const emailConnectionConfig =
    options.emailConnectionConfig ?? emailConnectionConfigFromEnvironment();
  const emailConnectionSecret = process.env.EMAIL_CONNECTION_ENCRYPTION_SECRET?.trim() ?? "";
  const emailConnectionProtector =
    options.emailConnectionCredentialProtector ??
    (emailConnectionSecret.length >= 24
      ? new AesPaymentAccountProtector(emailConnectionSecret)
      : undefined);
  const mailboxDeliveryRuntime =
    options.emailDeliveryRuntime ??
    emailDeliveryRuntimeFromEnvironment(process.env, {
      providerConfigured: Object.keys(emailConnectionConfig.providers).length > 0,
      credentialEncryptionAvailable: Boolean(emailConnectionProtector)
    });
  const effectiveEmailProvider =
    options.emailProvider ??
    (mailboxDeliveryRuntime.enabled && emailConnectionProtector
      ? new ConnectedMailboxEmailProvider(
          prisma,
          emailConnectionConfig,
          emailConnectionProtector,
          options.emailDeliveryHttpClient,
          options.smtpTransport
        )
      : undefined);
  // The packaged beta deliberately retains its bounded local/share identity and
  // local storage adapters, but HTTP-facing behavior must fail and log like a
  // production service rather than inherit development diagnostics.
  const securityMode = production || betaRuntime;
  const capabilities = runtimeCapabilities(process.env, {
    emailProvider: Boolean(effectiveEmailProvider),
    betaEmailDeliveryApproved: mailboxDeliveryRuntime.enabled,
    paymentProvider: Boolean(options.paymentProvider)
  });
  const baseIdentityAdapter =
    options.identityAdapter ??
    (production ? new SessionIdentityAdapter(sessions) : new DevelopmentIdentityAdapter(prisma));
  const apiCredentialService = new ApiCredentialService(prisma);
  const oauthService = new OAuthService(prisma);
  const effectiveConnectorAdapters = options.connectorAdapters ?? [
    new WooCommerceConnector(),
    new EtsyConnector()
  ];
  const connectorRuntime = new ConnectorRuntimeService(
    prisma,
    effectiveConnectorAdapters,
    options.connectorCredentialProtector
  );
  const commerceInbox = new CommerceInboxService(prisma);
  const paymentInstructionService = new PaymentInstructionService(prisma);
  const invoiceService = new InvoiceService(prisma, paymentInstructionService);
  const commerceOrderConversion = new CommerceOrderConversionService(prisma, invoiceService);
  const commerceSync = new CommerceSyncService(connectorRuntime, commerceInbox);
  const documentStorage = options.documentStorage ?? new DevelopmentDocumentStorage();
  const productImageService = new ProductImageService(prisma, documentStorage);
  const catalogMapping = new CatalogMappingService(prisma, undefined, productImageService);
  const commerceDemo = new CommerceDemoService(connectorRuntime, commerceInbox, catalogMapping);
  const catalogAutomation = new CatalogAutomationService(prisma, connectorRuntime, catalogMapping);
  const connectorWebhookBaseUrl = configuredConnectorWebhookBaseUrl();
  const identityAdapter = new OAuthIdentityAdapter(
    new ApiCredentialIdentityAdapter(baseIdentityAdapter, apiCredentialService),
    oauthService
  );
  if (production && baseIdentityAdapter.kind === "DEVELOPMENT") {
    throw new Error("The development identity adapter cannot run in production.");
  }
  const origins = resolveSecurityOrigins(production);
  const oidcProvider =
    options.oidcProvider ??
    (production ? new ProductionOidcProvider(oidcConfigFromEnvironment()) : undefined);
  const oidc = oidcProvider ? new OidcAuthenticationService(prisma, oidcProvider) : undefined;
  const app = Fastify({
    disableRequestLogging: true,
    logger: securityMode
      ? {
          level: process.env.LOG_LEVEL?.trim() || "info",
          redact: {
            paths: productionLogRedactionPaths,
            censor: "[REDACTED]"
          }
        }
      : false,
    genReqId: (request) => {
      const header = request.headers["x-request-id"];
      const value = Array.isArray(header) ? header[0] : header;
      return value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : randomUUID();
    }
  });
  const secureJsonParser = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    if (isSignedWebhookPath(request.url))
      setExactRawRequestBody(request, Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"));
    return secureJsonParser(request, body.toString("utf8"), done);
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 16_384 },
    (request, body, done) => {
      const bodyText = typeof body === "string" ? body : body.toString("utf8");
      if (isSignedWebhookPath(request.url))
        setExactRawRequestBody(request, Buffer.from(bodyText, "utf8"));
      done(null, Object.fromEntries(new URLSearchParams(bodyText)));
    }
  );
  for (const mediaType of [
    "application/octet-stream",
    "application/pdf",
    "application/stripe-test-webhook",
    "application/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    "image/png",
    "image/jpeg",
    "image/webp"
  ]) {
    app.addContentTypeParser(
      mediaType,
      {
        parseAs: "buffer",
        bodyLimit: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/plain",
          "text/csv",
          "application/csv"
        ].includes(mediaType)
          ? 10_485_760
          : ["image/png", "image/jpeg", "image/webp"].includes(mediaType)
            ? 5_242_880
            : 2_097_152
      },
      (_request, body, done) => done(null, body)
    );
  }

  const organizationService = new OrganizationService(prisma);
  const companyService = new CompanyService(prisma);
  const intercompanyService = new IntercompanyService(prisma);
  const demoCompanyService = new DemoCompanyService(prisma);
  const demoCompanyRateLimiter = options.requestRateLimiter ?? new DevelopmentRequestRateLimiter();
  const membershipService = new MembershipService(prisma);
  const accountService = new AccountService(prisma);
  const fiscalPeriodService = new FiscalPeriodService(prisma);
  const journalService = new JournalService(prisma);
  const reportService = new ReportService(prisma);
  const phase10ReportService = new Phase10ReportService(prisma);
  const reportViewService = new ReportViewService(prisma);
  const booksHealthService = new BooksHealthService(prisma);
  const accountantService = new AccountantService(prisma);
  const setupService = new CompanySetupService(prisma);
  const multiCurrencyService = new MultiCurrencyService(prisma);
  const bankOfCanadaRateService = options.bankOfCanadaRateService ?? new BankOfCanadaRateService();
  const fxRevaluationService = new FxRevaluationService(prisma);
  const presetService = new AccountPresetService(prisma);
  const workflowPreferencesService = new WorkflowPreferencesService(prisma);
  const openingBalanceService = new OpeningBalanceService(prisma);
  if (production && (!options.logoStorage || !options.malwareScanner))
    throw new Error("Production logo storage and malware scanner adapters are required.");
  if (production && !options.documentStorage)
    throw new Error("Production document storage adapter is required.");
  if (production && !options.emailProvider)
    throw new Error("Production email provider adapter is required.");
  if (production && !options.attachmentScanner)
    throw new Error("Production attachment scanner adapter is required.");
  if (production && (!options.paymentProvider || !options.paymentAccountProtector))
    throw new Error("Production payment provider and account protector adapters are required.");
  if (production && !options.webhookRateLimiter)
    throw new Error("Production webhook rate limiter adapter is required.");
  if (securityMode && !options.requestRateLimiter)
    throw new Error("Hardened runtime request rate limiter adapter is required.");
  if (production && !options.webhookSecretProtector)
    throw new Error("Production webhook secret protector adapter is required.");
  if (
    production &&
    effectiveConnectorAdapters.length &&
    !options.connectorCredentialProtector &&
    (process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET?.trim().length ?? 0) < 32
  )
    throw new Error(
      "Production connector adapters require a credential protector or a high-entropy CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET of at least 32 characters."
    );
  const logoStorage = options.logoStorage ?? new DevelopmentLogoStorage();
  const logoService = new LogoService(
    prisma,
    logoStorage,
    options.malwareScanner ?? new NoopDevelopmentScanner()
  );
  const customerService = new CustomerService(prisma);
  const productService = new ProductService(prisma);
  const pickingSlipService = new PickingSlipService(prisma, documentStorage);
  const inventoryService = new InventoryService(prisma);
  const inventoryCatalogControlService = new InventoryCatalogControlService(prisma);
  const posService = new PosService(prisma);
  const estimateService = new EstimateService(prisma);
  const estimateEmailService = new EstimateEmailService(
    prisma,
    effectiveEmailProvider ?? new DevelopmentEmailProvider(),
    betaRuntime,
    capabilities.emailDelivery
  );
  const migrationRunService = new MigrationRunService(prisma);
  const commercialService = new CommercialService(prisma);
  const receivablesService = new ReceivablesService(prisma);
  const paymentService = new PaymentService(
    prisma,
    options.paymentProvider,
    options.paymentAccountProtector,
    betaRuntime,
    options.paymentProviderKind,
    options.ownAccountPaymentProviderFactory
  );
  const webhookSecretProtector =
    options.webhookSecretProtector ??
    new AesPaymentAccountProtector(
      environmentValueOrDefault(
        process.env.WEBHOOK_SECRET_ENCRYPTION_SECRET,
        "development-webhook-secret-encryption-key"
      )
    );
  const webhookService = new WebhookService(
    prisma,
    webhookSecretProtector,
    options.webhookHttpClient ?? new FetchWebhookHttpClient()
  );
  const purchaseService = new PurchaseService(prisma);
  const shippingSecret = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET?.trim();
  const shippingCredentialProtector =
    options.shippingCredentialProtector ??
    new AesPaymentAccountProtector(
      shippingSecret && shippingSecret.length >= 24
        ? shippingSecret
        : "development-shipping-credential-secret"
    );
  if (production && !options.shippingCredentialProtector && (shippingSecret?.length ?? 0) < 32)
    throw new Error(
      "Production shipping adapters require a credential protector or a high-entropy CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET of at least 32 characters."
    );
  const shippingAdapters =
    options.shippingAdapters ??
    (production ? [new CanadaPostAdapter()] : [new FixtureCarrier(), new CanadaPostAdapter()]);
  const shippingService = new ShippingService(
    prisma,
    documentStorage,
    purchaseService,
    shippingAdapters,
    shippingCredentialProtector
  );
  const bankingService = new BankingService(prisma, paymentService);
  const configuredBankFeedAdapter =
    options.bankFeedAdapter ?? bankFeedAdapterFromEnvironment(process.env);
  if (production && configuredBankFeedAdapter?.testOnly)
    throw new Error(
      "A test-only bank-feed adapter cannot run in production. Configure an approved live provider instead."
    );
  const bankFeedEncryptionSecret = process.env.BANK_FEED_CREDENTIAL_ENCRYPTION_SECRET?.trim();
  if (
    configuredBankFeedAdapter &&
    !options.bankFeedCredentialProtector &&
    (bankFeedEncryptionSecret?.length ?? 0) < 32
  )
    throw new Error(
      "Connected bank feeds require BANK_FEED_CREDENTIAL_ENCRYPTION_SECRET with at least 32 characters."
    );
  const bankFeedService = new BankFeedService(prisma, {
    ...(configuredBankFeedAdapter ? { adapter: configuredBankFeedAdapter } : {}),
    ...(options.bankFeedCredentialProtector
      ? { credentialProtector: options.bankFeedCredentialProtector }
      : bankFeedEncryptionSecret
        ? { credentialProtector: new AesPaymentAccountProtector(bankFeedEncryptionSecret) }
        : {}),
    betaRuntime,
    betaSandboxApproved:
      options.bankFeedBetaSandboxApproved ??
      process.env.PENNYWISE_BETA_BANK_FEEDS_SANDBOX_APPROVED === "true",
    productionApproved:
      options.bankFeedProductionApproved ?? process.env.BANK_FEED_PRODUCTION_APPROVED === "true"
  });
  const payrollService = new PayrollService(prisma);
  const webhookRateLimiter = options.webhookRateLimiter ?? new DevelopmentWebhookRateLimiter();
  // Hardened runtimes require an explicitly selected limiter; ordinary development
  // remains deterministic across test scenarios.
  const requestRateLimiter = options.requestRateLimiter;
  const invoiceTemplateService = new InvoiceTemplateService(prisma);
  const contractService = new ContractService(prisma);
  const emailConnectionService = new EmailConnectionService(
    prisma,
    emailConnectionConfig,
    emailConnectionProtector,
    options.emailOAuthHttpClient ?? new FetchEmailOAuthHttpClient(),
    mailboxDeliveryRuntime,
    options.smtpTransport
  );
  const attachmentScanner = options.attachmentScanner ?? new DevelopmentAttachmentScanner();
  const projectService = new ProjectService(
    prisma,
    documentStorage,
    attachmentScanner,
    options.captureExtractionService ?? new LocalCaptureExtractionService()
  );
  const projectWorkItemService = new ProjectWorkItemService(prisma);
  const planningService = new PlanningService(prisma);
  const calendarService = new CalendarService(prisma);
  const purchaseRequestService = new PurchaseRequestService(prisma);
  const customerDepositService = new CustomerDepositService(prisma);
  const progressBillingService = new ProgressBillingService(prisma);
  const fixedAssetService = new FixedAssetService(prisma);
  const invoiceDocumentService = new InvoiceDocumentService(
    prisma,
    documentStorage,
    effectiveEmailProvider,
    undefined,
    attachmentScanner,
    logoStorage,
    betaRuntime,
    capabilities.emailDelivery
  );
  const reminderService = new ReminderService(
    prisma,
    invoiceDocumentService,
    Boolean(effectiveEmailProvider && capabilities.emailDelivery)
  );
  const statementDocumentService = new StatementDocumentService(
    prisma,
    phase10ReportService,
    effectiveEmailProvider ?? new DevelopmentEmailProvider(),
    Boolean(effectiveEmailProvider && capabilities.emailDelivery)
  );
  const recurringInvoiceService = new RecurringInvoiceService(
    prisma,
    invoiceService,
    invoiceDocumentService,
    Boolean(effectiveEmailProvider && capabilities.emailDelivery)
  );
  const purchaseAttachmentService = new PurchaseAttachmentService(
    prisma,
    documentStorage,
    attachmentScanner
  );
  const dataMigrationService = new DataMigrationService(prisma, documentStorage, attachmentScanner);
  const portabilityService = new OrganizationPortabilityService(prisma, documentStorage);
  const productAnalyticsService = new ProductAnalyticsService(prisma);
  const paymentOutboxWorker = new PaymentOutboxWorker(prisma, paymentService);
  const paymentCheckoutExpiryWorker =
    options.paymentProvider && options.paymentAccountProtector && options.paymentProviderKind
      ? new PaymentCheckoutExpiryWorker(
          prisma,
          options.paymentProvider,
          options.paymentProviderKind,
          options.paymentAccountProtector
        )
      : undefined;
  const automationRunner = new AutomationJobRunner(
    prisma,
    paymentOutboxWorker,
    webhookService,
    invoiceDocumentService,
    estimateEmailService,
    payrollService,
    recurringInvoiceService,
    reminderService,
    paymentCheckoutExpiryWorker,
    paymentService,
    Boolean(effectiveEmailProvider && capabilities.emailDelivery)
  );
  const automationAuthorization = new AuthorizationService(prisma);

  app.addHook("onRequest", async (request, reply) => {
    applySecurityHeaders(request, reply, securityMode);
    applyCors(request, reply, origins.appOrigin);
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
    if (requestRateLimiter) await enforceRequestRateLimit(request, requestRateLimiter);
    enforceBrowserRequestOrigin(request, origins);
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!securityMode || reply.statusCode < 400) return;
    request.log.warn(
      {
        event: "http.security_outcome",
        requestId: request.id,
        route: request.routeOptions.url ?? "unmatched",
        method: request.method,
        statusCode: reply.statusCode,
        classification: securityClassification(reply.statusCode)
      },
      "Request completed with a security-relevant outcome"
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    if (statusCode === 413) {
      sendError(
        reply,
        request,
        new AppError(
          request.url.includes("/products/") ? "PRODUCT_IMAGE_SIZE_INVALID" : "LOGO_SIZE_INVALID",
          request.url.includes("/products/")
            ? "Product images may not exceed 5 MiB."
            : "Logo may not exceed 2 MB.",
          413
        )
      );
      return;
    }
    if (error instanceof ZodError) {
      sendError(
        reply,
        request,
        new AppError("VALIDATION_ERROR", "Request validation failed.", 400, {
          issues: error.issues
        })
      );
      return;
    }
    if (error instanceof AppError) {
      sendError(reply, request, error);
      return;
    }
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    request.log.error(
      { event: "http.unhandled_error", requestId: request.id, errorName },
      "Unhandled request error"
    );
    sendError(
      reply,
      request,
      new AppError(
        "INTERNAL_SERVER_ERROR",
        "An unexpected error occurred.",
        500,
        securityMode ? undefined : { errorName, message: errorMessage }
      )
    );
  });

  app.get("/health", () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const automation = automationRunner.currentStatus();
      if (!automation.recoveryComplete)
        return await reply.code(503).send({
          status: "not_ready",
          checks: { database: "ok", automation: automation.state }
        });
      return { status: "ready", checks: { database: "ok", automation: automation.state } };
    } catch {
      return reply.code(503).send({ status: "not_ready", checks: { database: "failed" } });
    }
  });
  app.decorate("automationRunner", automationRunner);
  app.get("/v1/organizations/current/automations", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    await automationAuthorization.assert(context, "automations:manage", "AutomationJob");
    return await automationRunner.list(context);
  });
  app.post("/v1/organizations/current/automations/:jobName/run", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    await automationAuthorization.assert(context, "automations:manage", "AutomationJob");
    const jobName = z
      .string()
      .min(1)
      .max(120)
      .parse((request.params as { jobName?: unknown }).jobName);
    const result = await automationRunner.runNow(context, jobName);
    return reply.code(result.status === "unavailable" ? 409 : 202).send({ automation: result });
  });
  app.patch("/v1/organizations/current/automations/:jobName", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    await automationAuthorization.assert(context, "automations:manage", "AutomationJob");
    const jobName = z
      .string()
      .min(1)
      .max(120)
      .parse((request.params as { jobName?: unknown }).jobName);
    const body = z.object({ paused: z.boolean() }).strict().parse(request.body);
    return { automations: await automationRunner.setPaused(context, jobName, body.paused) };
  });
  app.get("/openapi.json", () => buildOpenApiDocument());

  app.get("/v1/auth/sign-in", async (request, reply) => {
    const provider = requireOidc(oidc);
    const query = authenticationQuerySchema.parse(request.query);
    const location = await provider.begin({ purpose: "SIGN_IN", ...query });
    return reply.redirect(location);
  });

  app.get("/v1/auth/recover", async (request, reply) => {
    const provider = requireOidc(oidc);
    const query = authenticationQuerySchema.parse(request.query);
    const location = await provider.begin({ purpose: "RECOVERY", ...query });
    return reply.redirect(location);
  });

  app.get("/v1/auth/reauthenticate", async (request, reply) => {
    const provider = requireOidc(oidc);
    const identity = await requireIdentity(request, identityAdapter);
    assertSessionIdentity(identity);
    const query = authenticationQuerySchema.parse(request.query);
    const location = await provider.begin({ purpose: "REAUTHENTICATE", identity, ...query });
    return reply.redirect(location);
  });

  app.get("/v1/auth/callback", async (request, reply) => {
    const provider = requireOidc(oidc);
    const query = callbackQuerySchema.parse(request.query);
    const result = await provider.complete(query.code, query.state, {
      requestId: request.id,
      auditOrigin: auditOriginFromRequest(request)
    });
    reply.header(
      "set-cookie",
      sessionCookie(result.session.token, result.session.absoluteExpiresAt)
    );
    return reply.redirect(result.returnTo);
  });

  app.get("/v1/auth/session", async (request) => {
    const identity = await requireIdentity(request, identityAdapter);
    return { identity: publicIdentity(identity), runtimeCapabilities: capabilities };
  });

  app.post("/v1/auth/session/renew", async (request, reply) => {
    const identity = await requireIdentity(request, identityAdapter);
    assertSessionIdentity(identity);
    const renewed = await sessions.renew(identity);
    reply.header("set-cookie", sessionCookie(renewed.token, renewed.absoluteExpiresAt));
    return { session: { expiresAt: renewed.absoluteExpiresAt.toISOString() } };
  });

  app.get("/v1/auth/sessions", async (request) => {
    const identity = await requireIdentity(request, identityAdapter);
    assertSessionIdentity(identity);
    return { sessions: await sessions.list(identity) };
  });

  app.post("/v1/auth/sessions/:sessionId/revoke", async (request, reply) => {
    const identity = await requireIdentity(request, identityAdapter);
    assertSessionIdentity(identity);
    const params = idParamSchema.parse(request.params);
    await sessions.revokeById(identity, params.sessionId!, {
      requestId: request.id,
      auditOrigin: auditOriginFromRequest(request)
    });
    if (params.sessionId === identity.sessionId) {
      reply.header("set-cookie", expiredSessionCookie());
    }
    return { revoked: true };
  });

  app.post("/v1/auth/sign-out", async (request, reply) => {
    const identity = await requireIdentity(request, identityAdapter);
    assertSessionIdentity(identity);
    await sessions.revoke(identity, {
      requestId: request.id,
      auditOrigin: auditOriginFromRequest(request)
    });
    reply.header("set-cookie", expiredSessionCookie());
    const returnTo = environmentValueOrDefault(process.env.APP_BASE_URL, "http://localhost:3000");
    const providerLogout = oidcProvider ? await oidcProvider.endSessionUrl(returnTo) : null;
    return { signedOut: true, providerLogoutUrl: providerLogout };
  });

  app.post("/v1/organizations", async (request, reply) => {
    const actor = await requireIdentity(request, identityAdapter);
    if (actor.authenticationMethod === "API_KEY") {
      throw new AppError(
        "API_KEY_ORGANIZATION_CREATE_UNSUPPORTED",
        "API credentials cannot create organizations.",
        403
      );
    }
    const body = createOrganizationSchema.parse(request.body);
    const organization = await organizationService.createOrganization(
      actor,
      body,
      request.id,
      auditOriginFromRequest(request)
    );
    if (actor.sessionId) {
      await organizationService.switchOrganization(
        actor,
        organization.id,
        request.id,
        auditOriginFromRequest(request)
      );
    }
    return reply.code(201).send({ organization });
  });

  const demoCompanyAvailable = demoCompanyAvailableForEnvironment(process.env.NODE_ENV);
  app.get("/v1/demo-company/capabilities", () => ({
    demoCompany: {
      available: demoCompanyAvailable,
      templateKey: demoCompanyTemplateKey,
      fixtureVersion: demoCompanyFixtureVersion,
      onePerUser: true,
      requiresIdempotencyKey: true,
      fictionalDataOnly: true
    }
  }));
  if (demoCompanyAvailable)
    app.post("/v1/demo-company", async (request, reply) => {
      await demoCompanyRateLimiter.check({
        scope: "demo-company.create",
        key: request.ip,
        limit: 10,
        windowMilliseconds: 600_000
      });
      const actor = await requireIdentity(request, identityAdapter);
      const body = demoCompanyCreateSchema.parse(request.body ?? {});
      const demoCompany = await demoCompanyService.create(
        actor,
        body,
        requestHeader(request, "idempotency-key") ?? "",
        request.id,
        auditOriginFromRequest(request)
      );
      return reply.code(demoCompany.created ? 201 : 200).send({ demoCompany });
    });

  app.get("/v1/organizations", async (request) => {
    const identity = await requireIdentity(request, identityAdapter);
    return { organizations: await organizationService.listOrganizations(identity) };
  });

  app.post("/v1/organizations/switch", async (request) => {
    const identity = await requireIdentity(request, identityAdapter);
    const body = switchOrganizationSchema.parse(request.body);
    const selection = await organizationService.switchOrganization(
      identity,
      body.organizationId,
      request.id,
      auditOriginFromRequest(request)
    );
    return { selection };
  });

  app.get("/v1/organizations/current", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      organization: await organizationService.getCurrentOrganization(context),
      company: await companyService.current(context)
    };
  });

  app.get("/v1/organizations/current/companies", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { companies: await companyService.list(context) };
  });

  app.post("/v1/organizations/current/companies", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = createCompanySchema.parse(request.body);
    const company = await companyService.create(
      context,
      body,
      request.id,
      auditOriginFromRequest(request)
    );
    return reply.code(201).send({ company });
  });

  app.post("/v1/organizations/current/companies/switch", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = switchCompanySchema.parse(request.body);
    const company = await companyService.switch(
      context,
      body.companyId,
      request.id,
      auditOriginFromRequest(request)
    );
    return { company };
  });

  app.patch("/v1/organizations/current/companies/:companyId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = updateCompanySchema.parse(request.body);
    return {
      company: await companyService.update(
        context,
        params.companyId!,
        body,
        request.id,
        auditOriginFromRequest(request)
      )
    };
  });

  app.delete("/v1/organizations/current/companies/:companyId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = deleteCompanySchema.parse(request.body);
    return {
      result: await companyService.delete(
        context,
        params.companyId!,
        body.confirmation,
        request.id,
        auditOriginFromRequest(request)
      )
    };
  });

  app.get("/v1/organizations/current/companies/:companyId/members", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { members: await companyService.listMembers(context, params.companyId!) };
  });

  app.patch("/v1/organizations/current/companies/:companyId/members/:userId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = changeRoleSchema.parse(request.body);
    return {
      membership: await companyService.setMemberRole(
        context,
        params.companyId!,
        params.userId!,
        body.role,
        request.id,
        auditOriginFromRequest(request)
      )
    };
  });

  app.get("/v1/organizations/current/api-credentials", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { credentials: await apiCredentialService.list(context) };
  });

  app.post("/v1/organizations/current/api-credentials", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = apiCredentialSchema.parse(request.body);
    const result = await apiCredentialService.create(
      context,
      {
        name: input.name,
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined
      },
      requestHeader(request, "idempotency-key") ?? ""
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/organizations/current/api-credentials/:apiCredentialId/revoke", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return apiCredentialService.revoke(context, params.apiCredentialId!);
  });

  app.post(
    "/v1/organizations/current/api-credentials/:apiCredentialId/rotate",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const result = await apiCredentialService.rotate(
        context,
        params.apiCredentialId!,
        requestHeader(request, "idempotency-key") ?? ""
      );
      return reply.code(result.statusCode).send(result.body);
    }
  );

  app.get("/v1/organizations/current/oauth-clients", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { clients: await oauthService.listClients(context) };
  });

  app.post("/v1/organizations/current/oauth-clients", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = oauthClientSchema.parse(request.body);
    const result = await oauthService.createClient(
      context,
      input,
      requestHeader(request, "idempotency-key") ?? ""
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/organizations/current/oauth-clients/:oauthClientId/revoke", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return oauthService.revokeClient(context, params.oauthClientId!);
  });

  app.post(
    "/v1/organizations/current/oauth-clients/:oauthClientId/rotate",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const result = await oauthService.rotateClient(
        context,
        params.oauthClientId!,
        requestHeader(request, "idempotency-key") ?? ""
      );
      return reply.code(result.statusCode).send(result.body);
    }
  );

  app.get("/v1/organizations/current/connectors", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { connectors: await connectorRuntime.list(context) };
  });

  app.get("/v1/organizations/current/connectors/providers", async (request) => {
    await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      providers: commerceSync.providerCatalog().map((provider) => ({
        ...provider,
        webhookBaseUrl: connectorWebhookBaseUrl,
        demoAvailable: !production
      }))
    };
  });

  if (!production)
    app.post("/v1/organizations/current/commerce/demo", async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      return reply.code(201).send({ demo: await commerceDemo.stage(context) });
    });

  app.patch(
    "/v1/organizations/current/connectors/:connectorInstallationId/mapping",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = connectorMappingSchema.parse(request.body);
      return {
        connector: await connectorRuntime.updateMapping(
          context,
          params.connectorInstallationId!,
          body.version,
          body.mapping
        )
      };
    }
  );

  app.get("/v1/organizations/current/intercompany/transactions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { transactions: await intercompanyService.listTransactions(context) };
  });

  app.post("/v1/organizations/current/intercompany/transactions", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = intercompanyTransactionSchema.parse(request.body);
    const transaction = await intercompanyService.createTransaction(
      context,
      body,
      request.id,
      auditOriginFromRequest(request)
    );
    return reply.code(201).send({ transaction });
  });

  app.post(
    "/v1/organizations/current/intercompany/transactions/:transactionId/transition",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = intercompanyTransitionSchema.parse(request.body);
      return {
        transaction: await intercompanyService.transition(
          context,
          params.transactionId!,
          body.status,
          request.id,
          auditOriginFromRequest(request)
        )
      };
    }
  );

  app.get("/v1/organizations/current/consolidation-groups", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { groups: await intercompanyService.listConsolidationGroups(context) };
  });

  app.post("/v1/organizations/current/consolidation-groups", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = consolidationGroupSchema.parse(request.body);
    const group = await intercompanyService.createConsolidationGroup(
      context,
      body,
      request.id,
      auditOriginFromRequest(request)
    );
    return reply.code(201).send({ group });
  });

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/sync",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = connectorSyncSchema.parse(request.body ?? {});
      return {
        sync: await commerceSync.sync(context, params.connectorInstallationId!, {
          ...(body.from ? { from: new Date(body.from) } : {}),
          ...(body.to ? { to: new Date(body.to) } : {}),
          maxPages: body.maxPages,
          ...(body.pageSize ? { pageSize: body.pageSize } : {}),
          ...(body.scope ? { scope: body.scope } : {}),
          ...(body.continuationToken ? { continuationToken: body.continuationToken } : {})
        })
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/catalog/poll",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        catalogSync: await catalogAutomation.poll(
          context,
          params.connectorInstallationId!,
          connectorCatalogPollSchema.parse(request.body ?? {})
        )
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/catalog/ingest",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = connectorCatalogIngestSchema.parse(request.body);
      const result = await catalogMapping.upsertObservedCatalog(
        context,
        params.connectorInstallationId!,
        {
          externalProductId: body.externalProductId,
          name: body.name,
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.sourceStatus !== undefined ? { sourceStatus: body.sourceStatus } : {}),
          ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
          providerUpdatedAt: body.providerUpdatedAt ? new Date(body.providerUpdatedAt) : null,
          ...(body.images !== undefined ? { images: body.images } : {}),
          variants: body.variants.map((variant) => ({
            externalVariantId: variant.externalVariantId,
            ...(variant.externalReferenceAliases !== undefined
              ? { externalReferenceAliases: variant.externalReferenceAliases }
              : {}),
            name: variant.name,
            ...(variant.sku !== undefined ? { sku: variant.sku } : {}),
            ...(variant.gtin !== undefined ? { gtin: variant.gtin } : {}),
            ...(variant.manufacturer !== undefined ? { manufacturer: variant.manufacturer } : {}),
            ...(variant.manufacturerPartNumber !== undefined
              ? { manufacturerPartNumber: variant.manufacturerPartNumber }
              : {}),
            ...(variant.variantSignature !== undefined
              ? { variantSignature: variant.variantSignature }
              : {}),
            ...(variant.sourceStatus !== undefined ? { sourceStatus: variant.sourceStatus } : {}),
            providerUpdatedAt: variant.providerUpdatedAt
              ? new Date(variant.providerUpdatedAt)
              : null,
            ...(variant.images !== undefined ? { images: variant.images } : {})
          }))
        }
      );
      for (const [index, variantInput] of body.variants.entries()) {
        if (variantInput.observedQuantityMicros == null) continue;
        const variant = result.variants[index];
        if (!variant) continue;
        const observationHash = createHash("sha256")
          .update(
            JSON.stringify({
              installationId: params.connectorInstallationId,
              externalProductId: body.externalProductId,
              externalVariantId: variantInput.externalVariantId,
              observedQuantityMicros: variantInput.observedQuantityMicros,
              providerUpdatedAt: variantInput.providerUpdatedAt ?? null
            })
          )
          .digest("hex");
        await catalogMapping.recordVariantProviderObservation(
          context,
          variant.id,
          `ingest:${observationHash}`,
          variantInput.observedQuantityMicros,
          variantInput.providerUpdatedAt ? new Date(variantInput.providerUpdatedAt) : null,
          variantInput.safeMetadata ?? {}
        );
      }
      const candidateSuggestions = await catalogMapping.suggestCandidatesBatch(
        context,
        result.variants.map((variant) => variant.id)
      );
      return reply.code(201).send({
        catalog: result,
        candidateSuggestions,
        accountingEntriesCreated: 0
      });
    }
  );

  app.get("/v1/organizations/current/catalog", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        installationId: idSchema.optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100)
      })
      .strict()
      .parse(request.query);
    return {
      products: await catalogMapping.listCatalog(context, {
        limit: query.limit,
        ...(query.installationId ? { installationId: query.installationId } : {})
      }),
      accountingEntriesCreated: 0
    };
  });

  app.post(
    "/v1/organizations/current/catalog/variants/:catalogVariantId/candidates",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ catalogVariantId: idSchema }).parse(request.params);
      const body = z
        .object({ limit: z.number().int().min(1).max(100).default(25) })
        .strict()
        .parse(request.body ?? {});
      return {
        candidates: await catalogMapping.suggestCandidates(context, params.catalogVariantId, {
          limit: body.limit,
          useDatabaseSimilarity: true
        }),
        accountingEntriesCreated: 0
      };
    }
  );

  app.get(
    "/v1/organizations/current/catalog/variants/:catalogVariantId/candidates",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ catalogVariantId: idSchema }).parse(request.params);
      return {
        candidates: await catalogMapping.listCandidates(context, params.catalogVariantId),
        accountingEntriesCreated: 0
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/catalog/sku-aliases",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ connectorInstallationId: idSchema }).parse(request.params);
      const body = catalogSkuAliasApprovalSchema.parse(request.body);
      return {
        alias: await catalogMapping.approveSkuAlias(context, {
          installationId: params.connectorInstallationId,
          ...body
        }),
        accountingEntriesCreated: 0
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/catalog/sku-patterns",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ connectorInstallationId: idSchema }).parse(request.params);
      const body = catalogSkuPatternApprovalSchema.parse(request.body);
      return {
        pattern: await catalogMapping.approveSkuPattern(context, {
          installationId: params.connectorInstallationId,
          ...body
        }),
        accountingEntriesCreated: 0
      };
    }
  );

  for (const action of ["confirm", "reject"] as const)
    app.post(
      `/v1/organizations/current/catalog/candidates/:candidateId/${action}`,
      async (request) => {
        const context = await requireOrganizationContext(request, prisma, identityAdapter);
        const params = z.object({ candidateId: idSchema }).parse(request.params);
        const body = catalogCandidateDecisionSchema.parse(request.body);
        return {
          candidate:
            action === "confirm"
              ? await catalogMapping.confirmCandidate(
                  context,
                  params.candidateId,
                  body.version,
                  body.reason
                )
              : await catalogMapping.rejectCandidate(
                  context,
                  params.candidateId,
                  body.version,
                  body.reason
                ),
          accountingEntriesCreated: 0
        };
      }
    );

  app.post(
    "/v1/organizations/current/catalog/variants/:catalogVariantId/create-local-product",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ catalogVariantId: idSchema }).parse(request.params);
      const product = await catalogMapping.createLocalProductFromObserved(
        context,
        params.catalogVariantId,
        (() => {
          const input = catalogCreateLocalProductSchema.parse(request.body);
          const { name, sku, ...required } = input;
          return {
            ...required,
            ...(name !== undefined ? { name } : {}),
            ...(sku !== undefined ? { sku } : {})
          };
        })()
      );
      return reply.code(201).send({ product, accountingEntriesCreated: 0 });
    }
  );

  app.post("/v1/organizations/current/catalog/bulk-create-local-products", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = catalogBulkCreateLocalProductsSchema.parse(request.body);
    return {
      bulkCreate: await catalogMapping.bulkCreateLocalProductsFromObserved(context, input),
      accountingEntriesCreated: 0
    };
  });

  app.put("/v1/organizations/current/inventory-sync/policies", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      policy: await catalogMapping.configureInventorySyncPolicy(
        context,
        (() => {
          const input = inventorySyncPolicySchema.parse(request.body);
          return {
            installationId: input.installationId,
            catalogVariantId: input.catalogVariantId,
            productItemId: input.productItemId,
            locationId: input.locationId,
            sourceOfTruth: input.sourceOfTruth,
            enabled: input.enabled,
            ...(input.desiredQuantityMicros !== undefined
              ? { desiredQuantityMicros: input.desiredQuantityMicros }
              : {}),
            ...(input.version !== undefined ? { version: input.version } : {})
          };
        })()
      ),
      accountingEntriesCreated: 0
    };
  });

  app.get("/v1/organizations/current/inventory-sync", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        installationId: idSchema.optional(),
        status: z.enum(["OPEN", "RESOLVED", "IGNORED"]).optional()
      })
      .strict()
      .parse(request.query);
    return catalogMapping.listInventoryState(context, {
      ...(query.installationId ? { installationId: query.installationId } : {}),
      ...(query.status ? { status: query.status } : {})
    });
  });

  app.post(
    "/v1/organizations/current/inventory-sync/policies/:policyId/observations",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ policyId: idSchema }).parse(request.params);
      const body = inventorySyncObservationSchema.parse(request.body);
      const result = await catalogMapping.recordInventoryObservation(context, params.policyId, {
        externalObservationId: body.externalObservationId,
        observedQuantityMicros: body.observedQuantityMicros,
        ...(body.desiredQuantityMicros !== undefined
          ? { desiredQuantityMicros: body.desiredQuantityMicros }
          : {}),
        providerObservedAt: body.providerObservedAt ? new Date(body.providerObservedAt) : null,
        ...(body.safeMetadata !== undefined ? { safeMetadata: body.safeMetadata } : {})
      });
      return reply.code(result.replayed ? 200 : 201).send(result);
    }
  );

  app.post(
    "/v1/organizations/current/inventory-sync/conflicts/:conflictId/resolve",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ conflictId: idSchema }).parse(request.params);
      const body = inventorySyncConflictResolutionSchema.parse(request.body);
      if (body.action === "IGNORE")
        return {
          conflict: await catalogMapping.ignoreInventoryConflict(
            context,
            params.conflictId,
            body.version,
            body.reason
          )
        };
      if (body.action === "PUSH_LOCAL_TO_CHANNEL")
        return catalogMapping.enqueueLocalInventoryPush(context, params.conflictId, body.version);
      return catalogMapping.adoptChannelInventory(context, params.conflictId, body.version, {
        effectiveDate: body.effectiveDate,
        reason: body.reason,
        ...(body.unitCostMinor ? { unitCostMinor: body.unitCostMinor } : {}),
        ...(requestHeader(request, "idempotency-key")
          ? { idempotencyKey: requestHeader(request, "idempotency-key")! }
          : {})
      });
    }
  );

  app.post(
    "/v1/organizations/current/inventory-sync/operations/:operationId/retry",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ operationId: idSchema }).parse(request.params);
      return {
        operation: await catalogMapping.retryInventoryOperation(context, params.operationId)
      };
    }
  );

  app.post("/v1/organizations/current/inventory-sync/operations/process", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({ limit: z.number().int().min(1).max(25).default(10) })
      .strict()
      .parse(request.body ?? {});
    return catalogAutomation.processInventoryOperations(context, body.limit);
  });

  for (const action of ["approve", "reject", "ingest"] as const)
    app.post(`/v1/organizations/current/catalog/images/:imageId/${action}`, async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ imageId: idSchema }).parse(request.params);
      const body = catalogImageDecisionSchema.parse(request.body);
      if (action === "approve")
        return {
          image: await catalogMapping.approveImage(context, params.imageId, body.version),
          matchingAuthority: false,
          accountingEntriesCreated: 0
        };
      if (action === "reject")
        return {
          image: await catalogMapping.rejectImage(
            context,
            params.imageId,
            body.version,
            body.reason
          ),
          matchingAuthority: false,
          accountingEntriesCreated: 0
        };
      const result = await catalogMapping.ingestApprovedImage(
        context,
        params.imageId,
        body.version
      );
      return {
        image: result.image,
        assets: result.assets,
        matchingAuthority: false,
        accountingEntriesCreated: 0
      };
    });

  for (const [path, action] of [
    ["pause", "PAUSE"],
    ["resume", "RESUME"],
    ["disconnect", "DISCONNECT"]
  ] as const) {
    app.post(
      `/v1/organizations/current/connectors/:connectorInstallationId/${path}`,
      async (request) => {
        const context = await requireOrganizationContext(request, prisma, identityAdapter);
        const params = idParamSchema.parse(request.params);
        return {
          connector: await connectorRuntime.changeStatus(
            context,
            params.connectorInstallationId!,
            action
          )
        };
      }
    );
  }

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/webhooks/register",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = connectorWebhookRegistrationSchema.parse(request.body);
      return {
        webhook: await commerceSync.registerWebhooks(
          context,
          params.connectorInstallationId!,
          body.deliveryUrl
        )
      };
    }
  );

  app.put(
    "/v1/organizations/current/connectors/:connectorInstallationId/webhook-secret",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = connectorWebhookSecretSchema.parse(request.body);
      return {
        connector: await connectorRuntime.updateWebhookSecret(
          context,
          params.connectorInstallationId!,
          body.signingSecret
        )
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/etsy/oauth/start",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        authorization: await commerceSync.beginEtsyOAuth(
          context,
          params.connectorInstallationId!,
          (() => {
            const body = etsyOAuthStartSchema.parse(request.body);
            return {
              apiKey: body.apiKey,
              sharedSecret: body.sharedSecret,
              redirectUri: body.redirectUri,
              ...(body.shopId ? { shopId: body.shopId } : {})
            };
          })()
        )
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/etsy/oauth/complete",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        connector: await commerceSync.completeEtsyOAuth(
          context,
          params.connectorInstallationId!,
          etsyOAuthCompleteSchema.parse(request.body)
        )
      };
    }
  );

  app.post(
    "/v1/webhooks/commerce/:providerKey/:connectorInstallationId",
    { config: { rawBody: true } },
    async (request, reply) => {
      await webhookRateLimiter.check(`commerce:${request.ip}`);
      const params = z
        .object({
          providerKey: z.enum(["woocommerce", "etsy"]),
          connectorInstallationId: idSchema
        })
        .parse(request.params);
      const rawBody = exactRawRequestBody(getExactRawRequestBody(request), request.body);
      if (!rawBody)
        throw new AppError("COMMERCE_WEBHOOK_INVALID", "Webhook verification failed.", 400);
      const result = await commerceSync.webhook(
        params.providerKey.toUpperCase(),
        params.connectorInstallationId,
        rawBody,
        commerceWebhookHeaders(request)
      );
      return reply.code(200).send(result);
    }
  );

  app.post("/v1/organizations/current/commerce/inbox", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await commerceInbox.ingest(
      context,
      commerceInboxEventSchema.parse(request.body)
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/organizations/current/commerce/inbox", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        status: z.enum(["RECEIVED", "REVIEW_REQUIRED", "NORMALIZED", "DEAD_LETTER"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100)
      })
      .strict()
      .parse(request.query);
    return { events: await commerceInbox.list(context, query.status, query.limit) };
  });

  app.post("/v1/organizations/current/commerce/inbox/:eventId/review", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ eventId: idSchema }).parse(request.params);
    const body = commerceInboxReviewSchema
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(request.body);
    const { version, ...input } = body;
    return {
      event: await commerceInbox.review(context, params.eventId, version, input)
    };
  });

  app.get(
    "/v1/organizations/current/commerce/inbox/:eventId/conversion-preflight",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = z.object({ eventId: idSchema }).parse(request.params);
      const query = z
        .object({ customerId: idSchema.optional(), fxRateSnapshotId: idSchema.optional() })
        .strict()
        .parse(request.query);
      return {
        conversion: await commerceOrderConversion.preflight(context, params.eventId, query)
      };
    }
  );

  app.post("/v1/organizations/current/commerce/inbox/:eventId/convert", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ eventId: idSchema }).parse(request.params);
    const result = await commerceOrderConversion.convert(
      context,
      params.eventId,
      commerceOrderConversionSchema.parse(request.body)
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/organizations/current/commerce/inbox/batch-convert", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return commerceOrderConversion.convertBatch(
      context,
      commerceOrderBatchConversionSchema.parse(request.body)
    );
  });

  app.post("/v1/organizations/current/connectors", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      connector: await connectorRuntime.createDraft(
        context,
        connectorDraftSchema.parse(request.body)
      )
    });
  });

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/connect",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = connectorConnectSchema.parse(request.body);
      return {
        connector: await connectorRuntime.connect(
          context,
          params.connectorInstallationId!,
          body.credentials,
          body.backfillStartAt ? new Date(body.backfillStartAt) : undefined,
          body.backfillEndAt ? new Date(body.backfillEndAt) : undefined
        )
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/health",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        connector: await connectorRuntime.checkHealth(context, params.connectorInstallationId!)
      };
    }
  );

  app.get(
    "/v1/organizations/current/connectors/:connectorInstallationId/conflicts",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        conflicts: await connectorRuntime.listConflicts(context, params.connectorInstallationId!)
      };
    }
  );

  app.post(
    "/v1/organizations/current/connectors/:connectorInstallationId/conflicts/:connectorConflictId/resolve",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        conflict: await connectorRuntime.resolveConflict(
          context,
          params.connectorInstallationId!,
          params.connectorConflictId!
        )
      };
    }
  );

  app.get("/v1/organizations/current/connectors/:connectorInstallationId/logs", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(100) })
      .parse(request.query);
    return {
      logs: await connectorRuntime.listLogs(context, params.connectorInstallationId!, query.limit)
    };
  });

  app.post("/v1/oauth/authorize", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      authorization: await oauthService.authorize(
        context,
        oauthAuthorizationSchema.parse(request.body)
      )
    };
  });

  app.post("/v1/oauth/token", async (request) => {
    const input = oauthTokenSchema.parse(request.body);
    return oauthService.issueToken(
      {
        grantType: input.grant_type,
        clientId: input.client_id,
        clientSecret: input.client_secret,
        code: input.code,
        redirectUri: input.redirect_uri,
        codeVerifier: input.code_verifier,
        refreshToken: input.refresh_token
      },
      { requestId: request.id, auditOrigin: auditOriginFromRequest(request) }
    );
  });

  app.get("/v1/organizations/current/webhooks", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { endpoints: await webhookService.listEndpoints(context) };
  });

  app.post("/v1/organizations/current/webhooks", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = webhookEndpointSchema.parse(request.body);
    const result = await webhookService.createEndpoint(
      context,
      input,
      requestHeader(request, "idempotency-key") ?? ""
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/organizations/current/webhooks/dispatch", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(request.query);
    const fannedOut = await webhookService.fanOutPendingOutbox(context, query.limit);
    const delivered = await webhookService.processPendingDeliveries(context, query.limit);
    return { fannedOut, attempted: delivered };
  });

  app.post(
    "/v1/organizations/current/webhooks/:webhookEndpointId/rotate",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const result = await webhookService.rotateEndpoint(
        context,
        params.webhookEndpointId!,
        requestHeader(request, "idempotency-key") ?? ""
      );
      return reply.code(result.statusCode).send(result.body);
    }
  );

  app.post("/v1/organizations/current/webhooks/:webhookEndpointId/disable", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const input = webhookDisableSchema.parse(request.body ?? {});
    return {
      endpoint: await webhookService.disableEndpoint(
        context,
        params.webhookEndpointId!,
        input.reason
      )
    };
  });

  app.post("/v1/organizations/current/webhooks/:webhookEndpointId/enable", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { endpoint: await webhookService.enableEndpoint(context, params.webhookEndpointId!) };
  });

  app.get("/v1/organizations/current/webhooks/:webhookEndpointId/deliveries", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(100) })
      .parse(request.query);
    return {
      deliveries: await webhookService.listDeliveries(
        context,
        params.webhookEndpointId!,
        query.limit
      )
    };
  });

  app.post(
    "/v1/organizations/current/webhooks/:webhookEndpointId/deliveries/:webhookDeliveryId/replay",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        delivery: await webhookService.replayDelivery(
          context,
          params.webhookEndpointId!,
          params.webhookDeliveryId!
        )
      };
    }
  );

  app.get("/v1/organizations/current/members", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { members: await membershipService.listMembers(context) };
  });

  app.post("/v1/organizations/current/invitations", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = createInvitationSchema.parse(request.body);
    const result = await membershipService.createInvitation(context, body);
    return reply.code(201).send(result);
  });

  app.post("/v1/invitations/accept", async (request) => {
    const identity = await requireIdentity(request, identityAdapter);
    if (identity.authenticationMethod === "API_KEY") {
      throw new AppError(
        "API_KEY_INVITATION_UNSUPPORTED",
        "API credentials cannot accept invitations.",
        403
      );
    }
    const body = acceptInvitationSchema.parse(request.body);
    const membership = await membershipService.acceptInvitation(
      identity,
      body.token,
      request.id,
      auditOriginFromRequest(request)
    );
    return { membership };
  });

  app.post("/v1/organizations/current/invitations/:invitationId/revoke", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      invitation: await membershipService.revokeInvitation(context, params.invitationId!)
    };
  });

  app.patch("/v1/organizations/current/members/:membershipId/role", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = changeRoleSchema.parse(request.body);
    return {
      membership: await membershipService.changeRole(context, params.membershipId!, body.role)
    };
  });

  app.post("/v1/organizations/current/members/:membershipId/revoke", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { membership: await membershipService.revokeMembership(context, params.membershipId!) };
  });

  registerLedgerRoutes(app, prisma, identityAdapter, {
    accountService,
    fiscalPeriodService,
    journalService,
    reportService
  });
  registerSetupRoutes(app, prisma, identityAdapter, {
    setupService,
    presetService,
    openingBalanceService,
    logoService
  });
  registerMultiCurrencyRoutes(
    app,
    prisma,
    identityAdapter,
    multiCurrencyService,
    bankOfCanadaRateService
  );
  registerFxRevaluationRoutes(app, prisma, identityAdapter, fxRevaluationService);
  registerWorkflowPreferencesRoutes(app, prisma, identityAdapter, workflowPreferencesService);
  app.get("/v1/payment-instructions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { paymentInstructions: await paymentInstructionService.get(context) };
  });
  app.put("/v1/payment-instructions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      paymentInstructions: await paymentInstructionService.update(
        context,
        paymentInstructionUpdateSchema.parse(request.body)
      )
    };
  });
  registerSalesRoutes(app, prisma, identityAdapter, {
    customerService,
    productService,
    productImageService,
    pickingSlipService,
    invoiceService,
    receivablesService,
    paymentService,
    invoiceTemplateService,
    invoiceDocumentService,
    estimateService,
    estimateEmailService,
    projectService,
    recurringInvoiceService,
    reminderService,
    statementDocumentService
  });
  registerContractRoutes(app, prisma, identityAdapter, contractService);
  registerEmailConnectionRoutes(app, prisma, identityAdapter, emailConnectionService);
  registerPurchaseRoutes(app, prisma, identityAdapter, purchaseService, purchaseAttachmentService);
  registerShippingRoutes(app, prisma, identityAdapter, shippingService);
  registerPlanningRoutes(
    app,
    prisma,
    identityAdapter,
    planningService,
    calendarService,
    projectWorkItemService
  );
  registerPurchaseRequestRoutes(app, prisma, identityAdapter, purchaseRequestService);
  registerDepositAndProgressBillingRoutes(
    app,
    prisma,
    identityAdapter,
    customerDepositService,
    progressBillingService
  );
  registerFixedAssetRoutes(app, prisma, identityAdapter, fixedAssetService);
  registerBankingRoutes(app, prisma, identityAdapter, bankingService, bankFeedService);
  registerPayrollRoutes(app, prisma, identityAdapter, payrollService);
  registerInventoryRoutes(app, prisma, identityAdapter, inventoryService);
  registerInventoryCatalogControlRoutes(
    app,
    prisma,
    identityAdapter,
    inventoryCatalogControlService
  );
  registerPosRoutes(app, prisma, identityAdapter, posService, pickingSlipService);
  registerPhase10ReportRoutes(
    app,
    prisma,
    identityAdapter,
    phase10ReportService,
    statementDocumentService,
    reportViewService
  );
  registerBooksHealthRoutes(app, prisma, identityAdapter, booksHealthService);
  registerAccountantRoutes(app, prisma, identityAdapter, accountantService, fiscalPeriodService);
  registerPortabilityRoutes(app, prisma, identityAdapter, dataMigrationService, portabilityService);
  registerProductAnalyticsRoutes(app, prisma, identityAdapter, productAnalyticsService);
  registerFuturePhaseRoutes(app, prisma, identityAdapter, migrationRunService, commercialService);

  app.get("/public/invoices/:token", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const result = await invoiceDocumentService.publicView(token);
    const payment = await paymentService.publicCheckoutEligibility(token);
    const query = z
      .object({
        payment: z.enum(["success", "cancelled"]).optional(),
        checkout: idSchema.optional(),
        capture: z.enum(["requested"]).optional()
      })
      .passthrough()
      .parse(request.query);
    const paymentStatuses = query.payment ? await paymentService.publicPaymentStatus(token) : [];
    return reply
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow, noarchive")
      .header("x-content-type-options", "nosniff")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type("text/html; charset=utf-8")
      .send(
        renderPublicInvoicePaymentAction(
          result.html,
          token,
          payment,
          query.payment,
          paymentStatuses,
          query.checkout,
          query.capture
        )
      );
  });

  app.get("/public/estimates/:token", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const result = await estimateService.publicView(token);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow, noarchive")
      .header("x-content-type-options", "nosniff")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type("text/html; charset=utf-8")
      .send(result.html);
  });

  for (const [action, label] of [
    ["accept", "accepted"],
    ["decline", "declined"]
  ] as const) {
    app.post(`/public/estimates/:token/${action}`, async (request, reply) => {
      const token = z
        .string()
        .min(32)
        .max(128)
        .parse((request.params as { token?: unknown }).token);
      await estimateService.publicRespond(token, action === "accept" ? "ACCEPTED" : "DECLINED");
      return reply
        .header("cache-control", "private, no-store")
        .header("x-robots-tag", "noindex, nofollow, noarchive")
        .header("x-content-type-options", "nosniff")
        .header(
          "content-security-policy",
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"
        )
        .type("text/html; charset=utf-8")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Estimate response recorded</title><style>body{font-family:system-ui,sans-serif;background:#f4f6f8;padding:32px;color:#18212b}.card{max-width:620px;margin:10vh auto;background:#fff;border-radius:16px;padding:36px;box-shadow:0 8px 30px #18212b18}a{color:#166534}</style></head><body><main class="card"><h1>Response recorded</h1><p>Your estimate has been ${label}. You can close this page.</p><p><a href="/public/estimates/${encodeURIComponent(token)}">Return to estimate</a></p></main></body></html>`
        );
    });
  }

  app.get("/public/invoices/:token/pdf", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const result = await invoiceDocumentService.publicPdf(token);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow, noarchive")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", 'inline; filename="invoice.pdf"')
      .type("application/pdf")
      .send(result.data);
  });

  app.get("/public/invoices/:token/attachments/:attachmentId", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const attachmentId = idSchema.parse(
      (request.params as { attachmentId?: unknown }).attachmentId
    );
    const result = await invoiceDocumentService.publicAttachment(token, attachmentId);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow, noarchive")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="${result.attachment.fileName}"`)
      .type(result.attachment.mediaType)
      .send(result.data);
  });

  app.post("/public/invoices/:token/checkout-sessions", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const input = z
      .object({ partialAmountMinor: z.string().regex(/^\d+$/).optional() })
      .strict()
      .parse(request.body ?? {});
    const session = await paymentService.createPublicCheckout(
      token,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(201).send({ checkoutSession: session });
  });
  app.post("/public/invoices/:token/pay", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const form = z
      .object({
        partialAmountMinor: z.preprocess(
          (value) => (value === "" ? undefined : value),
          z.string().regex(/^\d+$/).optional()
        )
      })
      .strict()
      .parse(request.body ?? {});
    const amountKey = form.partialAmountMinor ?? "full";
    const timeWindow = Math.floor(Date.now() / (30 * 60_000)).toString();
    const idempotencyKey = createHash("sha256")
      .update(`public-checkout:${token}:${amountKey}:${timeWindow}`)
      .digest("hex");
    const session = await paymentService.createPublicCheckout(token, form, idempotencyKey);
    return reply.redirect(session.checkoutUrl, 303);
  });
  app.post(
    "/public/invoices/:token/checkout-sessions/:checkoutSessionId/capture",
    async (request, reply) => {
      const token = z
        .string()
        .min(32)
        .max(128)
        .parse((request.params as { token?: unknown }).token);
      const checkoutSessionId = idSchema.parse(
        (request.params as { checkoutSessionId?: unknown }).checkoutSessionId
      );
      const capture = await paymentService.capturePublicCheckout(token, checkoutSessionId);
      if (requestHeader(request, "accept")?.includes("text/html")) {
        const returnUrl = `/public/invoices/${encodeURIComponent(token)}?payment=success&checkout=${encodeURIComponent(checkoutSessionId)}&capture=requested`;
        return reply.redirect(returnUrl, 303);
      }
      return reply.code(202).send({ capture });
    }
  );
  app.get("/public/invoices/:token/payment-status", async (request) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    return { payments: await paymentService.publicPaymentStatus(token) };
  });
  app.get("/public/invoices/:token/receipts/:receiptNumber", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const receiptNumber = z
      .string()
      .regex(/^RCT-\d{12}$/)
      .parse((request.params as { receiptNumber?: unknown }).receiptNumber);
    const receipt = await paymentService.publicReceipt(token, receiptNumber);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow, noarchive")
      .header("x-content-type-options", "nosniff")
      .send({ receipt });
  });
  app.get("/public/invoices/:token/receipts/:receiptNumber/print", async (request, reply) => {
    const token = z
      .string()
      .min(32)
      .max(128)
      .parse((request.params as { token?: unknown }).token);
    const receiptNumber = z
      .string()
      .regex(/^RCT-\d{12}$/)
      .parse((request.params as { receiptNumber?: unknown }).receiptNumber);
    const receipt = await paymentService.publicReceipt(token, receiptNumber);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow, noarchive")
      .header("x-content-type-options", "nosniff")
      .type("text/html; charset=utf-8")
      .send(renderPublicReceiptHtml(receipt));
  });

  app.post(
    "/v1/webhooks/payments/stripe",
    { config: { rawBody: true } },
    async (request, reply) => {
      await webhookRateLimiter.check(request.ip);
      const rawBody = exactRawRequestBody(getExactRawRequestBody(request), request.body);
      if (!rawBody) throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook body is invalid.", 400);
      const result = await paymentService.processStripeWebhook(
        rawBody,
        requestHeader(request, "stripe-signature")
      );
      return reply.code("accepted" in result && result.accepted ? 202 : 200).send(result);
    }
  );
  app.post(
    "/v1/webhooks/payments/paypal",
    { config: { rawBody: true } },
    async (request, reply) => {
      await webhookRateLimiter.check(request.ip);
      const rawBody = exactRawRequestBody(getExactRawRequestBody(request), request.body);
      if (!rawBody) throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook body is invalid.", 400);
      const result = await paymentService.processPaymentWebhook(rawBody, {
        "paypal-transmission-id": requestHeader(request, "paypal-transmission-id"),
        "paypal-transmission-time": requestHeader(request, "paypal-transmission-time"),
        "paypal-cert-url": requestHeader(request, "paypal-cert-url"),
        "paypal-transmission-sig": requestHeader(request, "paypal-transmission-sig"),
        "paypal-auth-algo": requestHeader(request, "paypal-auth-algo")
      });
      return reply.code("accepted" in result && result.accepted ? 202 : 200).send(result);
    }
  );

  return app;
}

function commerceWebhookHeaders(
  request: FastifyRequest
): Readonly<Record<string, string | undefined>> {
  return {
    "x-wc-webhook-signature": requestHeader(request, "x-wc-webhook-signature"),
    "x-wc-webhook-topic": requestHeader(request, "x-wc-webhook-topic"),
    "x-wc-webhook-id": requestHeader(request, "x-wc-webhook-id"),
    "x-wc-webhook-delivery-id": requestHeader(request, "x-wc-webhook-delivery-id"),
    "x-wc-webhook-source": requestHeader(request, "x-wc-webhook-source"),
    "webhook-id": requestHeader(request, "webhook-id"),
    "webhook-timestamp": requestHeader(request, "webhook-timestamp"),
    "webhook-signature": requestHeader(request, "webhook-signature")
  };
}

function registerSetupRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  services: {
    setupService: CompanySetupService;
    presetService: AccountPresetService;
    openingBalanceService: OpeningBalanceService;
    logoService: LogoService;
  }
): void {
  app.get("/v1/setup", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { setup: await services.setupService.getState(context) };
  });
  app.patch("/v1/setup/profile", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      settings: await services.setupService.updateProfile(
        context,
        profileSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/setup/fiscal-year/initialize", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { period: await services.setupService.initializeFiscalYear(context) };
  });
  app.get("/v1/setup/presets/:presetKey", async (request) => {
    await requireOrganizationContext(request, prisma, identityAdapter);
    const key = presetKeySchema.parse((request.params as { presetKey?: unknown }).presetKey);
    return { preset: services.presetService.preview(key) };
  });
  app.post("/v1/setup/presets/:presetKey/apply", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const key = presetKeySchema.parse((request.params as { presetKey?: unknown }).presetKey);
    const result = await services.presetService.apply(
      context,
      key,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.put("/v1/setup/tax-registrations", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      registration: await services.setupService.saveRegistration(
        context,
        taxRegistrationSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/setup/tax-codes/versions", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      taxCodeVersion: await services.setupService.createTaxCodeVersion(
        context,
        taxCodeVersionSchema.parse(request.body)
      )
    });
  });
  app.get("/v1/setup/opening-balances", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { openingBalance: await services.openingBalanceService.getDraft(context) };
  });
  app.put("/v1/setup/opening-balances", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      openingBalance: await services.openingBalanceService.saveDraft(
        context,
        openingBalanceSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/setup/opening-balances/:draftId/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.openingBalanceService.post(
      context,
      params.draftId!,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/setup/opening-balances/:draftId/mark-reversed", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      openingBalance: await services.openingBalanceService.markReversed(context, params.draftId!)
    };
  });
  app.put("/v1/setup/defaults", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      defaults: await services.setupService.updateDefaults(
        context,
        businessDefaultsSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/setup/logo", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    if (!Buffer.isBuffer(request.body))
      throw new AppError("LOGO_CONTENT_INVALID", "A binary logo body is required.", 422);
    return reply
      .code(201)
      .send({ logo: await services.logoService.replace(context, request.body) });
  });
  app.post("/v1/setup/invoice-background", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    if (!Buffer.isBuffer(request.body))
      throw new AppError(
        "INVOICE_BACKGROUND_CONTENT_INVALID",
        "A binary invoice background image is required.",
        422
      );
    return reply
      .code(201)
      .send({ asset: await services.logoService.uploadInvoiceBackground(context, request.body) });
  });
  app.get("/v1/setup/logo/:logoId/content", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.logoService.read(context, params.logoId!);
    return reply.type(result.asset.mediaType).send(result.data);
  });
  app.patch("/v1/setup/steps/:step", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const step = setupStepSchema.parse((request.params as { step?: unknown }).step);
    const body = setupStepUpdateSchema.parse(request.body);
    return { step: await services.setupService.setStep(context, step, body.status, body.version) };
  });
  app.post("/v1/setup/complete", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      settings: await services.setupService.complete(
        context,
        completeSetupSchema.parse(request.body).version
      )
    };
  });
}

function registerWorkflowPreferencesRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  service: WorkflowPreferencesService
): void {
  app.get("/v1/settings/workflow-preferences", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return service.get(context);
  });
  app.put("/v1/settings/workflow-preferences", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return service.update(context, workflowPreferencesSchema.parse(request.body));
  });
}

function registerMultiCurrencyRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  service: MultiCurrencyService,
  bankOfCanadaRateService: BankOfCanadaRateService
): void {
  app.get("/v1/settings/multi-currency", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { multiCurrency: await service.getSettings(context) };
  });
  app.put("/v1/settings/multi-currency", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      multiCurrency: await service.updateSettings(
        context,
        multiCurrencySettingsSchema.parse(request.body)
      )
    };
  });
  app.get("/v1/settings/multi-currency/rate-suggestion", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = bankOfCanadaRateSuggestionQuerySchema.parse(request.query);
    const settings = await service.getSettings(context);
    if (!settings.enabled) {
      throw new AppError(
        "MULTI_CURRENCY_NOT_ENABLED",
        "Enable CAD and USD accounting before requesting a rate suggestion.",
        409
      );
    }
    if (settings.baseCurrency !== "CAD") {
      throw new AppError(
        "FX_RATE_SUGGESTION_PAIR_UNAVAILABLE",
        "The no-key Bank of Canada suggestion currently supports USD transactions in a CAD-base company. Enter other currency orientations manually.",
        422,
        { baseCurrency: settings.baseCurrency, transactionCurrency: query.transactionCurrency }
      );
    }
    return { suggestion: await bankOfCanadaRateService.suggestUsdCad(query.date) };
  });
  app.post("/v1/settings/multi-currency/rates", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      rate: await service.createRate(context, fxRateSnapshotSchema.parse(request.body))
    });
  });
}

function registerLedgerRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  services: {
    accountService: AccountService;
    fiscalPeriodService: FiscalPeriodService;
    journalService: JournalService;
    reportService: ReportService;
  }
): void {
  app.get("/v1/accounts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { accounts: await services.accountService.listAccounts(context) };
  });
  app.post("/v1/accounts", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const account = await services.accountService.createAccount(
      context,
      createAccountSchema.parse(request.body)
    );
    return reply.code(201).send({ account });
  });
  app.patch("/v1/accounts/:accountId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      account: await services.accountService.patchAccount(
        context,
        params.accountId!,
        patchAccountSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/accounts/:accountId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { account: await services.accountService.archiveAccount(context, params.accountId!) };
  });
  app.get("/v1/fiscal-periods", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { periods: await services.fiscalPeriodService.listPeriods(context) };
  });
  app.post("/v1/fiscal-periods", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const period = await services.fiscalPeriodService.createPeriod(
      context,
      createFiscalPeriodSchema.parse(request.body)
    );
    return reply.code(201).send({ period });
  });
  app.post("/v1/fiscal-periods/:periodId/close", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = closePeriodSchema.parse(request.body);
    return {
      period: await services.fiscalPeriodService.closePeriod(
        context,
        params.periodId!,
        body.reason,
        body.acknowledgeWarnings
      )
    };
  });
  app.post("/v1/fiscal-periods/:periodId/reopen", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = reopenPeriodSchema.parse(request.body);
    return {
      period: await services.fiscalPeriodService.reopenPeriod(
        context,
        params.periodId!,
        body.reason
      )
    };
  });
  app.get("/v1/journals", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { journals: await services.journalService.listJournals(context) };
  });
  app.get("/v1/journals/:journalId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { journal: await services.journalService.getJournal(context, params.journalId!) };
  });
  app.post("/v1/journals", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await services.journalService.postJournal(
      context,
      postJournalSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/journals/:journalId/reverse", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.journalService.reverseJournal(
      context,
      params.journalId!,
      reverseJournalSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/reports/trial-balance", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = reportsQuerySchema.parse(request.query);
    return { trialBalance: await services.reportService.trialBalance(context, query.asOf) };
  });
  app.get("/v1/reports/general-ledger", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = reportsQuerySchema.parse(request.query);
    return { generalLedger: await services.reportService.generalLedger(context, query) };
  });
}

function registerFxRevaluationRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  service: FxRevaluationService
): void {
  app.get("/v1/accounting/fx-overview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { fx: await service.overview(context) };
  });
  app.post("/v1/accounting/fx-revaluation/preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { preview: await service.preview(context, fxRevaluationSchema.parse(request.body)) };
  });
  app.post("/v1/accounting/fx-revaluation/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = fxRevaluationSchema.parse(request.body);
    return reply.code(201).send(await service.post(context, { ...input, post: true }));
  });
}

function registerPhase10ReportRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  reports: Phase10ReportService,
  statementDocuments: StatementDocumentService,
  reportViews: ReportViewService
): void {
  app.get("/v1/report-views", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ reportName: z.string().min(1).max(64) })
      .strict()
      .parse(request.query);
    return reportViews.list(context, query.reportName);
  });
  app.post("/v1/report-views", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        reportName: z.string().min(1).max(64),
        name: z.string().trim().min(1).max(120),
        configuration: z.record(z.string(), z.unknown()),
        shared: z.boolean().optional(),
        isDefault: z.boolean().optional()
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send(await reportViews.create(context, body));
  });
  app.patch("/v1/report-views/:viewId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ viewId: idSchema }).parse(request.params);
    const body = z
      .object({
        reportName: z.string().min(1).max(64).optional(),
        name: z.string().trim().min(1).max(120),
        configuration: z.record(z.string(), z.unknown()),
        shared: z.boolean().optional(),
        isDefault: z.boolean().optional()
      })
      .strict()
      .parse(request.body);
    return reportViews.update(context, params.viewId, body);
  });
  app.delete("/v1/report-views/:viewId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ viewId: idSchema }).parse(request.params);
    return reportViews.remove(context, params.viewId);
  });

  app.get("/v1/reports/profit-and-loss", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10RangeQuerySchema
      .extend({ basis: z.enum(["ACCRUAL", "CASH"]).default("ACCRUAL") })
      .parse(request.query);
    return { report: await reports.profitAndLoss(context, query) };
  });
  app.get("/v1/reports/balance-sheet", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10AsOfQuerySchema.parse(request.query);
    return { report: await reports.balanceSheet(context, query.asOf) };
  });
  app.get("/v1/reports/journals", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10JournalQuerySchema.parse(request.query);
    return { report: await reports.journalReport(context, query) };
  });
  app.get("/v1/reports/cash-flow", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      report: await reports.cashFlow(context, phase10RangeQuerySchema.parse(request.query))
    };
  });
  app.get("/v1/reports/receivables", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10AsOfQuerySchema.parse(request.query);
    return { report: await reports.receivables(context, query.asOf) };
  });
  app.get("/v1/reports/receivables/customers/:customerId/statement", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      report: await reports.customerStatement(
        context,
        params.customerId!,
        statementRequestSchema.parse(request.query)
      )
    };
  });
  app.get("/v1/reports/receivables/customers/:customerId/statement.pdf", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const input = statementRequestSchema.parse(request.query);
    const result = await statementDocuments.generate(context, params.customerId!, input);
    return reply
      .header("cache-control", "private, no-store")
      .header("content-disposition", `attachment; filename="${result.fileName}"`)
      .type("application/pdf")
      .send(result.data);
  });
  app.post("/v1/reports/receivables/customers/:customerId/statement/send", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      delivery: await statementDocuments.send(
        context,
        params.customerId!,
        statementSendSchema.parse(request.body)
      )
    };
  });
  app.post(
    "/v1/reports/receivables/customers/:customerId/statement/manual-delivery",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const input = statementSendSchema.parse(request.body);
      const delivery = await statementDocuments.recordManualDelivery(
        context,
        params.customerId!,
        input
      );
      return reply.code(201).send({
        delivery: {
          status: delivery.status,
          recipientEmail: delivery.recipientEmail,
          fileName: delivery.fileName
        }
      });
    }
  );
  app.get("/v1/reports/payables", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10AsOfQuerySchema.parse(request.query);
    return { report: await reports.payables(context, query.asOf) };
  });
  app.get("/v1/reports/payables/vendors/:vendorId/statement", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      report: await reports.vendorStatement(
        context,
        params.vendorId!,
        phase10RangeQuerySchema.parse(request.query)
      )
    };
  });
  app.get("/v1/reports/tax", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      report: await reports.taxReport(context, phase10RangeQuerySchema.parse(request.query))
    };
  });
  app.get("/v1/reports/banking", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10RangeQuerySchema.extend({ asOf: dateStringSchema }).parse(request.query);
    return { report: await reports.bankingReport(context, query) };
  });
  app.get("/v1/reports/sales", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      report: await reports.salesReport(context, phase10RangeQuerySchema.parse(request.query))
    };
  });
  app.get("/v1/reports/expenses", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      report: await reports.expenseReport(context, phase10RangeQuerySchema.parse(request.query))
    };
  });
  app.get("/v1/dashboard", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10AsOfQuerySchema.parse(request.query);
    return { dashboard: await reports.dashboard(context, query.asOf) };
  });
  app.get("/v1/reports/exports/:reportName.csv", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const reportName = z
      .enum([
        "profit-and-loss",
        "balance-sheet",
        "journals",
        "receivables",
        "payables",
        "tax",
        "tax-by-authority",
        "banking",
        "sales",
        "expenses"
      ])
      .parse((request.params as { reportName?: unknown }).reportName);
    const query = phase10RangeQuerySchema
      .extend({
        asOf: dateStringSchema,
        basis: z.enum(["ACCRUAL", "CASH"]).default("ACCRUAL")
      })
      .parse(request.query);
    const result = await reports.exportCsv(context, reportName, query);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${result.filename}"`)
      .header("cache-control", "private, no-store")
      .send(result.content);
  });
}

function registerBooksHealthRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  booksHealth: BooksHealthService
): void {
  app.get("/v1/books-health", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10AsOfQuerySchema.parse(request.query);
    return { booksHealth: await booksHealth.get(context, query.asOf) };
  });
}

function registerAccountantRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  accountant: AccountantService,
  periods: FiscalPeriodService
): void {
  const auditQuery = z
    .object({
      actorUserId: idSchema.optional(),
      action: z.string().trim().max(100).optional(),
      targetType: z.string().trim().max(100).optional(),
      targetId: z.string().trim().max(160).optional(),
      from: dateStringSchema.optional(),
      to: dateStringSchema.optional(),
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50)
    })
    .strict();
  app.get("/v1/accountant/manual-journals", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { drafts: await accountant.listManualDrafts(context) };
  });
  app.post("/v1/accountant/manual-journals", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const draft = await accountant.createManualDraft(
      context,
      manualJournalDraftSchema.parse(request.body)
    );
    return reply.code(201).send({ draft });
  });
  const updateManualJournalDraft = async (request: FastifyRequest) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      draft: await accountant.updateManualDraft(
        context,
        params.draftId!,
        manualJournalDraftUpdateSchema.parse(request.body)
      )
    };
  };
  app.patch("/v1/accountant/manual-journals/:draftId", updateManualJournalDraft);
  app.put("/v1/accountant/manual-journals/:draftId", updateManualJournalDraft);
  app.post("/v1/accountant/manual-journals/:draftId/cancel", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = manualJournalDraftCancelSchema.parse(request.body);
    return { draft: await accountant.cancelManualDraft(context, params.draftId!, body.version) };
  });
  app.post("/v1/accountant/manual-journals/:draftId/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    const result = await accountant.postManualDraft(
      context,
      params.draftId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/accountant/review-queue", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10AsOfQuerySchema.parse(request.query);
    return { queue: await accountant.reviewQueue(context, query.asOf) };
  });
  app.post("/v1/accountant/review-queue/dismiss", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        category: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(1).max(500),
        asOf: dateStringSchema
      })
      .strict()
      .parse(request.body);
    return { dismissal: await accountant.dismissReviewItem(context, body) };
  });
  app.get("/v1/accountant/audit-events", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { audit: await accountant.auditEvents(context, auditQuery.parse(request.query)) };
  });
  app.get("/v1/accountant/audit-events.csv", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await accountant.exportAudit(context, auditQuery.parse(request.query));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${result.filename}"`)
      .header("cache-control", "private, no-store")
      .send(result.content);
  });
  app.get("/v1/accountant/journals/:journalId/trace", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { trace: await accountant.traceJournal(context, params.journalId!) };
  });
  app.get("/v1/accountant/journals/:journalId/correction-guide", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { guidance: await accountant.correctionGuide(context, params.journalId!) };
  });
  app.get("/v1/fiscal-periods/:periodId/close-preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { checklist: await periods.previewClose(context, params.periodId!) };
  });
  app.post("/v1/fiscal-periods/:periodId/next-year", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const period = await accountant.createNextFiscalYear(context, params.periodId!);
    return reply.code(201).send({ period });
  });
}

function registerPortabilityRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  imports: DataMigrationService,
  portability: OrganizationPortabilityService
): void {
  const importType = z.enum([
    "CHART_OF_ACCOUNTS",
    "CUSTOMERS",
    "VENDORS",
    "PRODUCTS",
    "OPENING_BALANCES",
    "OUTSTANDING_INVOICES",
    "OUTSTANDING_BILLS",
    "CUSTOMER_CREDITS",
    "VENDOR_CREDITS",
    "INVENTORY_OPENING",
    "HISTORICAL_ARCHIVE"
  ]);
  const sourceSystem = z.enum([
    "QUICKBOOKS_ONLINE",
    "QUICKBOOKS_DESKTOP",
    "XERO",
    "WAVE",
    "FRESHBOOKS",
    "SAGE",
    "ZOHO_BOOKS",
    "OTHER"
  ]);
  app.get("/v1/imports", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        importType,
        limit: z.coerce.number().int().min(1).max(25).default(10)
      })
      .strict()
      .parse(request.query);
    return { batches: await imports.list(context, query.importType, query.limit) };
  });
  app.post("/v1/imports/upload", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ importType, sourceSystem: sourceSystem.default("OTHER") })
      .strict()
      .parse(request.query);
    const fileName = z.string().trim().min(1).max(255).parse(requestHeader(request, "x-file-name"));
    const data = z.instanceof(Buffer).parse(request.body);
    const batch = await imports.upload(context, {
      importType: query.importType,
      sourceSystem: query.sourceSystem,
      fileName,
      mediaType: request.headers["content-type"]?.split(";")[0] ?? "text/csv",
      data
    });
    return reply.code(201).send({ batch });
  });
  app.post("/v1/imports/:importBatchId/preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({ mapping: z.record(z.string().trim().min(1).max(100)).default({}) })
      .strict()
      .parse(request.body);
    return {
      batch: await imports.preview(context, params.importBatchId!, body.mapping)
    };
  });
  app.get("/v1/imports/:importBatchId/item-match-suggestions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const query = z
      .object({
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        limit: z.coerce.number().int().min(1).max(25).default(25)
      })
      .strict()
      .parse(request.query);
    return {
      itemMatchSuggestions: await imports.itemMatchSuggestions(
        context,
        params.importBatchId!,
        query
      )
    };
  });
  app.post("/v1/imports/:importBatchId/dry-run", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { batch: await imports.dryRun(context, params.importBatchId!) };
  });
  app.post("/v1/imports/:importBatchId/commit", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { batch: await imports.commit(context, params.importBatchId!) };
  });
  app.post("/v1/imports/:importBatchId/resume", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { batch: await imports.resume(context, params.importBatchId!) };
  });
  app.get("/v1/imports/:importBatchId/attempts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { attempts: await imports.attempts(context, params.importBatchId!) };
  });
  app.put("/v1/imports/:importBatchId/source-controls", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        sourceReportName: z.string().trim().min(1).max(160),
        sourceReportDate: z.string().date(),
        sourceReportChecksum: z
          .string()
          .trim()
          .regex(/^[a-fA-F0-9]{64}$/)
          .optional(),
        sourceDebitMinor: z.string().regex(/^\d+$/).optional(),
        sourceCreditMinor: z.string().regex(/^\d+$/).optional(),
        sourceBalanceMinor: z.string().regex(/^\d+$/).optional()
      })
      .strict()
      .parse(request.body);
    return {
      batch: await imports.setSourceControls(context, params.importBatchId!, body)
    };
  });
  app.post("/v1/imports/:importBatchId/acknowledge", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { batch: await imports.acknowledge(context, params.importBatchId!) };
  });
  app.get("/v1/imports/:importBatchId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { batch: await imports.get(context, params.importBatchId!) };
  });
  app.get("/v1/imports/:importBatchId/errors.csv", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const content = await imports.errorCsv(context, params.importBatchId!);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="pennywise-import-errors.csv"')
      .header("cache-control", "private, no-store")
      .send(content);
  });
  app.post("/v1/exports", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({ includeAttachments: z.boolean().default(false) })
      .strict()
      .parse(request.body);
    const result = await portability.requestExport(context, body.includeAttachments);
    setImmediate(() => {
      void portability.processExport(context, result.job.id).catch(() => undefined);
    });
    return reply.code(202).send(result);
  });
  app.get("/v1/exports/:exportJobId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { job: await portability.exportStatus(context, params.exportJobId!) };
  });
  app.get("/v1/exports/:exportJobId/download", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const token = z.string().min(32).max(128).parse(requestHeader(request, "x-export-token"));
    const result = await portability.download(context, params.exportJobId!, token);
    return reply
      .header("content-type", "application/json")
      .header("content-disposition", `attachment; filename="${result.fileName}"`)
      .header("x-content-sha256", result.checksum)
      .header("cache-control", "private, no-store")
      .send(result.data);
  });
  app.post("/v1/organization-closure", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        reason: z.string().trim().min(1).max(500),
        exportJobId: idSchema.optional(),
        legalHold: z.boolean().default(false)
      })
      .strict()
      .parse(request.body);
    const closure = await portability.requestClosure(context, body);
    return reply.code(201).send({ closure });
  });
  app.post("/v1/organization-closure/:closureRequestId/finalize", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      closure: await portability.finalizeClosure(context, params.closureRequestId!)
    };
  });
}

function registerFuturePhaseRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  migrationRuns: MigrationRunService,
  commercial: CommercialService
): void {
  app.get("/v1/migration-runs", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { runs: await migrationRuns.list(context) };
  });
  app.post("/v1/migration-runs", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = migrationRunSchema.parse(request.body);
    return reply.code(201).send({
      run: await migrationRuns.create(context, {
        ...input,
        entries: input.entries.map((entry) => ({
          ...entry,
          unsupportedReason: entry.unsupportedReason ?? undefined
        }))
      })
    });
  });
  app.get("/v1/migration-runs/:migrationRunId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { run: await migrationRuns.get(context, params.migrationRunId!) };
  });
  app.post("/v1/migration-runs/:migrationRunId/transition", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = migrationRunTransitionSchema.parse(request.body);
    return {
      run: await migrationRuns.transition(
        context,
        params.migrationRunId!,
        body.status,
        body.version,
        body.errorMessage
      )
    };
  });
  app.get("/v1/commercial/subscription", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { subscription: await commercial.get(context) };
  });
  app.post("/v1/commercial/subscription", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = manualCommercialSubscriptionSchema.parse(request.body);
    return {
      subscription: await commercial.provision(context, {
        ...input,
        provider: "MANUAL"
      })
    };
  });
  app.post("/v1/commercial/subscription/transition", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = commercialTransitionSchema.parse(request.body);
    return { subscription: await commercial.transition(context, body.status, body.version) };
  });
  app.post("/v1/commercial/events", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = manualCommercialEventSchema.parse(request.body);
    return {
      event: await commercial.recordEvent(context, {
        ...input,
        provider: "MANUAL",
        payload: input.payload as Prisma.InputJsonObject
      })
    };
  });
}

function registerSalesRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  services: {
    customerService: CustomerService;
    productService: ProductService;
    productImageService: ProductImageService;
    pickingSlipService: PickingSlipService;
    invoiceService: InvoiceService;
    receivablesService: ReceivablesService;
    paymentService: PaymentService;
    invoiceTemplateService: InvoiceTemplateService;
    invoiceDocumentService: InvoiceDocumentService;
    estimateService: EstimateService;
    estimateEmailService: EstimateEmailService;
    projectService: ProjectService;
    recurringInvoiceService: RecurringInvoiceService;
    reminderService: ReminderService;
    statementDocumentService: StatementDocumentService;
  }
): void {
  app.get("/v1/invoice-templates", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return services.invoiceTemplateService.list(context);
  });
  app.put("/v1/organizations/current/invoice-template", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      template: await services.invoiceTemplateService.update(
        context,
        updateInvoiceTemplateSchema.parse(request.body)
      )
    };
  });

  app.get("/v1/customers", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = listQuerySchema.parse(request.query);
    return {
      customers: await services.customerService.list(
        context,
        query.active === undefined ? undefined : query.active === "true"
      )
    };
  });
  app.get("/v1/reminder-settings", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { reminderSettings: await services.reminderService.settings(context) };
  });
  app.put("/v1/reminder-settings", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      reminderSettings: await services.reminderService.updateSettings(
        context,
        reminderSettingsSchema.parse(request.body)
      )
    };
  });
  app.get("/v1/receivables/follow-up", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = phase10AsOfQuerySchema.partial().parse(request.query);
    return { invoices: await services.reminderService.overdue(context, query.asOf) };
  });
  app.get("/v1/customers/reports/address-review", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return services.customerService.addressReview(context);
  });
  app.post("/v1/customers", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      customer: await services.customerService.create(
        context,
        createCustomerSchema.parse(request.body)
      )
    });
  });
  app.get("/v1/customers/:customerId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { customer: await services.customerService.get(context, params.customerId!) };
  });
  app.patch("/v1/customers/:customerId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      customer: await services.customerService.update(
        context,
        params.customerId!,
        updateCustomerSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/customers/:customerId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).parse(request.body);
    return {
      customer: await services.customerService.archive(context, params.customerId!, body.version)
    };
  });
  app.get("/v1/customers/:customerId/contacts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      contacts: await services.customerService.listContacts(context, params.customerId!)
    };
  });
  app.post("/v1/customers/:customerId/contacts", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return reply.code(201).send({
      contact: await services.customerService.createContact(
        context,
        params.customerId!,
        createCustomerContactSchema.parse(request.body)
      )
    });
  });
  app.patch("/v1/customer-contacts/:contactId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      contact: await services.customerService.updateContact(
        context,
        params.contactId!,
        updateCustomerContactSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/customer-contacts/:contactId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    return {
      contact: await services.customerService.archiveContact(
        context,
        params.contactId!,
        body.version
      )
    };
  });
  app.get("/v1/customers/:customerId/timeline", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return services.customerService.listTimeline(context, params.customerId!);
  });
  app.post("/v1/customers/:customerId/activities", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return reply.code(201).send({
      activity: await services.customerService.createActivity(
        context,
        params.customerId!,
        createCustomerActivitySchema.parse(request.body)
      )
    });
  });

  app.get("/v1/products", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = listQuerySchema.parse(request.query);
    return {
      products: await services.productService.list(
        context,
        query.active === undefined ? undefined : query.active === "true"
      )
    };
  });
  app.get("/v1/inventory/reports/customs-readiness", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return services.productService.customsReadiness(context);
  });
  app.post("/v1/products", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      product: await services.productService.create(
        context,
        createProductSchema.parse(request.body)
      )
    });
  });
  app.get("/v1/products/:productId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { product: await services.productService.get(context, params.productId!) };
  });
  app.post("/v1/products/:productId/image", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    if (!Buffer.isBuffer(request.body))
      throw new AppError(
        "PRODUCT_IMAGE_CONTENT_INVALID",
        "A binary product image is required.",
        422
      );
    const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.toLowerCase() ?? "";
    return reply.code(201).send({
      ...(await services.productImageService.uploadManual(
        context,
        params.productId!,
        request.body,
        mediaType
      ))
    });
  });
  app.get("/v1/products/:productId/image", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.productImageService.read(context, params.productId!);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .type(result.asset.mediaType)
      .send(result.data);
  });
  app.patch("/v1/products/:productId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      product: await services.productService.update(
        context,
        params.productId!,
        updateProductSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/products/:productId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).parse(request.body);
    return {
      product: await services.productService.archive(context, params.productId!, body.version)
    };
  });

  app.get("/v1/estimates", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = listQuerySchema.parse(request.query);
    return { estimates: await services.estimateService.list(context, query.status) };
  });
  app.post("/v1/estimates", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      estimate: await services.estimateService.create(
        context,
        createEstimateSchema.parse(request.body),
        requestHeader(request, "idempotency-key")
      )
    });
  });
  app.get("/v1/estimates/:estimateId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { estimate: await services.estimateService.get(context, params.estimateId!) };
  });
  app.get("/v1/estimates/:estimateId/preview", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.estimateService.preview(context, params.estimateId!);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .type("application/json")
      .send(result);
  });
  app.patch("/v1/estimates/:estimateId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      estimate: await services.estimateService.update(
        context,
        params.estimateId!,
        updateEstimateSchema.parse(request.body)
      )
    };
  });
  for (const [action, status] of [
    ["send", "SENT"],
    ["accept", "ACCEPTED"],
    ["decline", "DECLINED"],
    ["cancel", "CANCELLED"]
  ] as const) {
    app.post(`/v1/estimates/:estimateId/${action}`, async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = estimateTransitionSchema.parse(request.body);
      return {
        estimate: await services.estimateService.transition(
          context,
          params.estimateId!,
          status,
          body.version,
          body.reason
        )
      };
    });
  }
  app.post("/v1/estimates/:estimateId/convert", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = estimateConvertSchema.parse(request.body);
    const result = await services.estimateService.convert(
      context,
      params.estimateId!,
      body.version,
      body.issueDate
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/estimates/:estimateId/public-link", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const input = publicInvoiceLinkSchema.parse(request.body ?? {});
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
    return reply.code(201).send({
      link: await services.estimateService.issuePublicLink(context, params.estimateId!, expiresAt)
    });
  });
  app.post("/v1/estimates/:estimateId/email", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.estimateEmailService.queueSend(
      context,
      params.estimateId!,
      sendInvoiceSchema.parse(request.body),
      requestHeader(request, "idempotency-key") ?? ""
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/estimates/:estimateId/delivery-history", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      deliveries: await services.estimateEmailService.deliveryHistory(context, params.estimateId!)
    };
  });
  app.post("/v1/estimates/:estimateId/public-links/:linkId/revoke", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return services.estimateService.revokePublicLink(context, params.estimateId!, params.linkId!);
  });

  app.get("/v1/recurring-schedules", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { schedules: await services.recurringInvoiceService.list(context) };
  });
  app.post("/v1/recurring-schedules", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      schedule: await services.estimateService.createSchedule(
        context,
        createRecurringScheduleSchema.parse(request.body)
      )
    });
  });
  app.patch("/v1/recurring-schedules/:scheduleId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      schedule: await services.estimateService.patchSchedule(
        context,
        params.scheduleId!,
        patchRecurringScheduleSchema.parse(request.body)
      )
    };
  });
  for (const [action, status] of [
    ["pause", "PAUSED"],
    ["resume", "ACTIVE"],
    ["end", "ENDED"]
  ] as const) {
    app.post(`/v1/recurring-schedules/:scheduleId/${action}`, async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
      return {
        schedule: await services.estimateService.setScheduleStatus(
          context,
          params.scheduleId!,
          status,
          body.version
        )
      };
    });
  }

  app.get("/v1/projects", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { projects: await services.projectService.list(context) };
  });
  app.post("/v1/projects", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      project: await services.projectService.create(
        context,
        createProjectSchema.parse(request.body)
      )
    });
  });
  app.get("/v1/projects/:projectId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { project: await services.projectService.get(context, params.projectId!) };
  });
  app.patch("/v1/projects/:projectId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      project: await services.projectService.update(
        context,
        params.projectId!,
        updateProjectSchema.parse(request.body)
      )
    };
  });
  for (const [action, status] of [
    ["hold", "ON_HOLD"],
    ["resume", "ACTIVE"],
    ["complete", "COMPLETED"],
    ["archive", "ARCHIVED"]
  ] as const) {
    app.post(`/v1/projects/:projectId/${action}`, async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
      return {
        project: await services.projectService.setStatus(
          context,
          params.projectId!,
          status,
          body.version
        )
      };
    });
  }
  app.get("/v1/time-entries", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ projectId: idSchema.optional() }).strict().parse(request.query);
    return { timeEntries: await services.projectService.listTimeEntries(context, query.projectId) };
  });
  app.get("/v1/capture-reviews", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        projectId: idSchema.optional(),
        status: z.enum(["RECEIVED", "REVIEW_REQUIRED", "APPROVED", "REJECTED"]).optional(),
        kind: z.enum(["RECEIPT", "BILL"]).optional(),
        conversion: z.enum(["LINKED", "UNLINKED"]).optional()
      })
      .strict()
      .parse(request.query);
    return { captures: await services.projectService.listCaptures(context, query) };
  });
  app.get("/v1/capture-reviews/:captureReviewId/content", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const content = await services.projectService.getCaptureContent(
      context,
      params.captureReviewId!
    );
    return reply
      .header("content-type", content.capture.mediaType)
      .header("content-disposition", `inline; filename="${content.fileName.replaceAll('"', "")}"`)
      .send(content.data);
  });
  app.post("/v1/capture-reviews/upload", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    if (!Buffer.isBuffer(request.body))
      throw new AppError("CAPTURE_CONTENT_INVALID", "A binary capture file is required.", 422);
    const query = z
      .object({
        projectId: idSchema.optional(),
        kind: z.enum(["RECEIPT", "BILL"]).default("RECEIPT")
      })
      .strict()
      .parse(request.query);
    const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.toLowerCase() ?? "";
    const fileName = requestHeader(request, "x-file-name") ?? "capture";
    return reply.code(201).send({
      capture: await services.projectService.uploadCapture(context, {
        projectId: query.projectId,
        kind: query.kind,
        fileName,
        mediaType,
        data: request.body
      })
    });
  });
  app.post("/v1/projects/:projectId/time-entries", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return reply.code(201).send({
      timeEntry: await services.projectService.createTimeEntry(
        context,
        params.projectId!,
        createTimeEntrySchema.parse(request.body)
      )
    });
  });
  app.post("/v1/time-entries/:timeEntryId/approve", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    return {
      timeEntry: await services.projectService.approveTimeEntry(
        context,
        params.timeEntryId!,
        body.version
      )
    };
  });
  app.post("/v1/mileage", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      mileage: await services.projectService.createMileage(
        context,
        createMileageSchema.parse(request.body)
      )
    });
  });
  app.post("/v1/capture-reviews", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      capture: await services.projectService.createCapture(
        context,
        createCaptureReviewSchema.parse(request.body)
      )
    });
  });
  app.post("/v1/capture-reviews/:captureReviewId/review", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = reviewCaptureSchema.parse(request.body);
    return {
      capture: await services.projectService.reviewCapture(
        context,
        params.captureReviewId!,
        body.status,
        body.reviewNotes,
        body.version
      )
    };
  });
  app.post("/v1/capture-reviews/:captureReviewId/process", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({ version: z.number().int().positive().optional() })
      .strict()
      .parse(request.body ?? {});
    return {
      capture: await services.projectService.processCapture(
        context,
        params.captureReviewId!,
        body.version
      )
    };
  });

  app.get("/v1/invoices", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = listQuerySchema.parse(request.query);
    return { invoices: await services.invoiceService.list(context, query.status) };
  });
  app.post("/v1/invoices", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      invoice: await services.invoiceService.create(
        context,
        createInvoiceSchema.parse(request.body)
      )
    });
  });
  app.get("/v1/invoices/:invoiceId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { invoice: await services.invoiceService.get(context, params.invoiceId!) };
  });
  app.patch("/v1/invoices/:invoiceId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      invoice: await services.invoiceService.update(
        context,
        params.invoiceId!,
        updateInvoiceSchema.parse(request.body)
      )
    };
  });
  app.get("/v1/invoices/:invoiceId/validate", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return services.invoiceService.validate(context, params.invoiceId!);
  });
  app.get("/v1/invoices/:invoiceId/books-impact", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { impact: await services.invoiceService.booksImpact(context, params.invoiceId!) };
  });
  app.post("/v1/invoices/:invoiceId/approve", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).parse(request.body);
    return {
      invoice: await services.invoiceService.approve(context, params.invoiceId!, body.version)
    };
  });
  app.post("/v1/invoices/:invoiceId/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = invoicePostSchema.parse(request.body);
    const result = await services.invoiceService.post(
      context,
      params.invoiceId!,
      body.version,
      body.effectiveDate,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/invoices/:invoiceId/finalize", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = invoicePostSchema.parse(request.body);
    const result = await services.invoiceService.finalize(
      context,
      params.invoiceId!,
      body.version,
      body.effectiveDate,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/invoices/:invoiceId/void", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = invoiceVoidSchema.parse(request.body);
    const result = await services.invoiceService.void(
      context,
      params.invoiceId!,
      body.version,
      body,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/invoices/:invoiceId/credit-notes", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = createCreditNoteSchema.parse({
      ...(request.body as object),
      invoiceId: params.invoiceId
    });
    return reply
      .code(201)
      .send({ creditNote: await services.invoiceService.createCreditNote(context, body) });
  });

  app.get("/v1/invoices/:invoiceId/preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return services.invoiceDocumentService.preview(context, params.invoiceId!);
  });
  app.post("/v1/invoices/:invoiceId/pdf", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const result = await services.invoiceDocumentService.generatePdf(
      context,
      params.invoiceId!,
      requestHeader(request, "idempotency-key") ?? ""
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/invoices/:invoiceId/pdf", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.invoiceDocumentService.readPdf(context, params.invoiceId!);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", 'inline; filename="invoice.pdf"')
      .type("application/pdf")
      .send(result.data);
  });
  app.post("/v1/invoices/:invoiceId/picking-slip", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const result = await services.pickingSlipService.createForInvoice(context, params.invoiceId!);
    return reply.code(result.statusCode).send(result);
  });
  app.get("/v1/invoices/:invoiceId/picking-slip", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { slip: await services.pickingSlipService.getForInvoice(context, params.invoiceId!) };
  });
  app.get("/v1/picking-slips/:pickingSlipId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { slip: await services.pickingSlipService.get(context, params.pickingSlipId!) };
  });
  app.post("/v1/picking-slips/:pickingSlipId/reprint", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    return reply
      .code(201)
      .send(await services.pickingSlipService.reprint(context, params.pickingSlipId!));
  });
  app.get("/v1/picking-slips/:pickingSlipId/pdf", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.pickingSlipService.readPdf(context, params.pickingSlipId!);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", 'inline; filename="picking-slip.pdf"')
      .type("application/pdf")
      .send(result.data);
  });
  app.post("/v1/picking-slips/:pickingSlipId/short-pick", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        lines: z
          .array(
            z
              .object({ lineId: idSchema, pickedQuantity: z.string().trim().min(1).max(40) })
              .strict()
          )
          .min(1)
          .max(500)
      })
      .strict()
      .parse(request.body);
    return reply
      .code(201)
      .send(
        await services.pickingSlipService.recordShortPick(
          context,
          params.pickingSlipId!,
          body.lines
        )
      );
  });
  app.post("/v1/invoices/:invoiceId/attachments", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    if (!Buffer.isBuffer(request.body))
      throw new AppError(
        "INVOICE_ATTACHMENT_CONTENT_INVALID",
        "A binary attachment is required.",
        422
      );
    const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.toLowerCase() ?? "";
    const fileName = requestHeader(request, "x-file-name") ?? "attachment";
    return reply.code(201).send({
      ...(await services.invoiceDocumentService.addAttachment(context, params.invoiceId!, {
        fileName,
        mediaType,
        data: request.body
      }))
    });
  });
  app.get("/v1/invoices/:invoiceId/attachments", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      attachments: await services.invoiceDocumentService.listAttachments(context, params.invoiceId!)
    };
  });
  app.get("/v1/invoices/:invoiceId/attachments/:attachmentId", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.invoiceDocumentService.readAttachment(
      context,
      params.invoiceId!,
      params.attachmentId!
    );
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="${result.attachment.fileName}"`)
      .type(result.attachment.mediaType)
      .send(result.data);
  });
  app.post("/v1/invoices/:invoiceId/send", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.invoiceDocumentService.queueSend(
      context,
      params.invoiceId!,
      sendInvoiceSchema.parse(request.body),
      requestHeader(request, "idempotency-key") ?? ""
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/invoices/:invoiceId/manual-delivery", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.invoiceDocumentService.recordManualDelivery(
      context,
      params.invoiceId!,
      manualInvoiceDeliverySchema.parse(request.body),
      requestHeader(request, "idempotency-key") ?? ""
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/invoices/:invoiceId/reminder", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.reminderService.sendManual(
      context,
      params.invoiceId!,
      sendInvoiceSchema.parse(request.body),
      false
    );
    return reply.code(result.reminder.manualFallback ? 201 : 202).send(result);
  });
  app.post("/v1/invoices/:invoiceId/manual-reminder", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.reminderService.sendManual(
      context,
      params.invoiceId!,
      sendInvoiceSchema.parse(request.body),
      true
    );
    return reply.code(201).send(result);
  });
  app.post("/v1/invoices/:invoiceId/resend", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await services.invoiceDocumentService.queueSend(
      context,
      params.invoiceId!,
      sendInvoiceSchema.parse(request.body),
      requestHeader(request, "idempotency-key") ?? "",
      "invoices:resend"
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/invoices/:invoiceId/delivery-history", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      deliveries: await services.invoiceDocumentService.deliveryHistory(context, params.invoiceId!)
    };
  });
  app.post("/v1/invoices/:invoiceId/public-link", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const input = publicInvoiceLinkSchema.parse(request.body ?? {});
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
    if (expiresAt && expiresAt <= new Date())
      throw new AppError(
        "PUBLIC_INVOICE_EXPIRY_INVALID",
        "Public link expiry must be in the future.",
        422
      );
    return reply.code(201).send({
      link: await services.invoiceDocumentService.issuePublicLink(
        context,
        params.invoiceId!,
        expiresAt
      )
    });
  });
  app.post("/v1/invoices/:invoiceId/public-links/:linkId/revoke", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return services.invoiceDocumentService.revokePublicLink(
      context,
      params.invoiceId!,
      params.linkId!
    );
  });
  app.post("/v1/credit-notes/:creditNoteId/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = creditNotePostSchema.parse(request.body);
    const result = await services.invoiceService.postCreditNote(
      context,
      params.creditNoteId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/customers/:customerId/balance", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      balance: await services.receivablesService.customerBalance(context, params.customerId!)
    };
  });
  app.get("/v1/receivables/aging", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ asOf: dateStringSchema.optional() }).parse(request.query);
    return { aging: await services.receivablesService.aging(context, query.asOf) };
  });
  app.get("/v1/receivables/reconciliation", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { reconciliation: await services.receivablesService.reconcile(context) };
  });
  app.get("/v1/payments", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { payments: await services.paymentService.list(context) };
  });
  app.get("/v1/payments/:paymentId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { payment: await services.paymentService.get(context, params.paymentId!) };
  });
  app.get("/v1/payment-disputes", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { disputes: await services.paymentService.listDisputes(context) };
  });
  app.patch("/v1/payment-disputes/:disputeId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({ status: z.enum(["UNDER_REVIEW", "WON", "LOST", "CLOSED"]) })
      .strict()
      .parse(request.body);
    return {
      dispute: await services.paymentService.updateDisputeStatus(
        context,
        params.disputeId!,
        body.status
      )
    };
  });
  app.get("/v1/payments/:paymentId/receipt", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { receipt: await services.paymentService.receipt(context, params.paymentId!) };
  });
  app.post("/v1/payments/:paymentId/receipt/resend", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const result = await services.paymentService.resendReceipt(
      context,
      params.paymentId!,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/payments/:paymentId/refunds", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const input = z
      .object({
        amountMinor: z.string().regex(/^\d+$/),
        reason: z.string().trim().min(1).max(1000),
        treatment: z.enum(["CUSTOMER_CREDIT", "CREDIT_NOTE_AND_REFUND", "UNAPPLIED_PAYMENT"]),
        creditNoteId: idSchema.optional()
      })
      .strict()
      .parse(request.body);
    const result = await services.paymentService.refund(
      context,
      params.paymentId!,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/payment-account", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { paymentAccount: await services.paymentService.paymentAccount(context) };
  });
  app.get("/v1/payment-accounts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { paymentAccounts: await services.paymentService.paymentAccounts(context) };
  });
  app.post("/v1/payment-accounts/own", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        provider: z.enum(["STRIPE", "SQUARE"]),
        credential: z.string().trim().min(1).max(4096),
        mode: z.enum(["test", "live"]),
        locationId: z.string().trim().min(1).max(200).optional()
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send(await services.paymentService.saveOwnAccount(context, input));
  });
  app.post("/v1/payment-links/poll", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({ limit: z.number().int().min(1).max(50).optional() })
      .strict()
      .parse(request.body ?? {});
    return {
      result: await services.paymentService.pollDurablePaymentLinks(context, input.limit ?? 20)
    };
  });
  app.get("/v1/invoices/:invoiceId/payment-links", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      paymentLinks: await services.paymentService.listDurablePaymentLinks(context, params.invoiceId)
    };
  });
  app.post("/v1/invoices/:invoiceId/payment-links", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const input = z
      .object({ provider: z.enum(["STRIPE", "SQUARE"]) })
      .strict()
      .parse(request.body);
    const result = await services.paymentService.createDurablePaymentLink(
      context,
      params.invoiceId!,
      input.provider,
      requestHeader(request, "idempotency-key")
    );
    const pdf = await services.invoiceDocumentService.generatePdf(
      context,
      params.invoiceId!,
      `pdf-for-payment-link:${result.paymentLink.id}`
    );
    return reply.code(201).send({ ...result, pdf: pdf.body.artifact });
  });
  app.post("/v1/payment-account/connect", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({ returnUrl: z.string().url().max(2000) })
      .strict()
      .parse(request.body);
    return reply
      .code(201)
      .send(await services.paymentService.connectAccount(context, input.returnUrl));
  });
  app.post("/v1/payment-account/disconnect", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { paymentAccount: await services.paymentService.disconnectAccount(context) };
  });
  app.get("/v1/payment-settings", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { paymentSettings: await services.paymentService.settings(context) };
  });
  app.put("/v1/payment-settings", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        clearingAccountId: idSchema,
        feeExpenseAccountId: idSchema,
        allowPartialPayments: z.boolean(),
        minimumPartialMinor: z.string().regex(/^\d+$/),
        version: z.number().int().positive().optional()
      })
      .strict()
      .parse(request.body);
    return { paymentSettings: await services.paymentService.configureSettings(context, input) };
  });
  app.post("/v1/payments/manual", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        customerId: idSchema,
        receivingAccountId: idSchema,
        paymentDate: dateStringSchema,
        amountMinor: z.string().regex(/^\d+$/),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
        fxRateSnapshotId: idSchema.optional(),
        methodCategory: z.enum(["CASH", "CHEQUE", "ELECTRONIC_TRANSFER", "EXTERNAL_CARD", "OTHER"]),
        reference: z.string().trim().max(300).optional(),
        allocations: z
          .array(z.object({ invoiceId: idSchema, amountMinor: z.string().regex(/^\d+$/) }).strict())
          .min(1)
      })
      .strict()
      .parse(request.body);
    const result = await services.paymentService.recordManual(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
}

const purchasePaymentMethodSchema = z.enum([
  "CASH",
  "CHEQUE",
  "ELECTRONIC_TRANSFER",
  "CREDIT_CARD",
  "OWNER_PAID",
  "OTHER"
]);
const jsonInputSchema: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(jsonInputSchema),
    z.record(jsonInputSchema)
  ])
);
const purchaseLineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: z.string().min(1).max(64),
    unitCostMinor: z.string().regex(/^\d+$/),
    discountMinor: z.string().regex(/^\d+$/).optional(),
    accountId: idSchema,
    productItemId: idSchema.nullable().optional(),
    taxCodeId: idSchema.nullable().optional()
  })
  .strict();
const vendorSchema = z
  .object({
    vendorNumber: z.string().trim().min(1).max(64),
    legalName: z.string().trim().min(1).max(250),
    displayName: z.string().trim().min(1).max(250),
    primaryContact: jsonInputSchema.optional(),
    additionalContacts: jsonInputSchema.optional(),
    remittanceAddress: jsonInputSchema.optional(),
    serviceAddress: jsonInputSchema.optional(),
    email: z.string().email().max(320).nullable().optional(),
    telephone: z.string().max(64).nullable().optional(),
    website: z.string().url().max(2048).nullable().optional(),
    businessIdentifier: z.string().max(128).nullable().optional(),
    defaultPaymentTermsDays: z.number().int().min(0).max(3650).optional(),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("CAD"),
    defaultExpenseAccountId: idSchema.nullable().optional(),
    defaultTaxCodeId: idSchema.nullable().optional(),
    preferredPaymentMethod: purchasePaymentMethodSchema.nullable().optional(),
    internalNotes: z.string().max(10_000).nullable().optional()
  })
  .strict();
const billSchema = z
  .object({
    vendorId: idSchema,
    vendorInvoiceNumber: z.string().trim().min(1).max(128),
    issueDate: dateStringSchema,
    dueDate: dateStringSchema.optional(),
    paymentTermsDays: z.number().int().min(0).max(3650).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("CAD"),
    fxRateSnapshotId: idSchema.optional(),
    internalNotes: z.string().max(10_000).nullable().optional(),
    lines: z.array(purchaseLineSchema).min(1).max(500)
  })
  .strict();
const immediateExpenseSchema = z
  .object({
    vendorId: idSchema.nullable().optional(),
    reference: z.string().trim().max(128).nullable().optional(),
    expenseDate: dateStringSchema,
    method: purchasePaymentMethodSchema,
    payingAccountId: idSchema,
    internalNotes: z.string().max(10_000).nullable().optional(),
    lines: z.array(purchaseLineSchema).min(1).max(500)
  })
  .strict();

const inventoryLocationSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9._-]+$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    address: jsonInputSchema.optional(),
    isDefault: z.boolean().optional()
  })
  .strict();
const inventoryBinSchema = z
  .object({
    locationId: idSchema,
    code: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/),
    name: z.string().trim().min(1).max(200),
    pickPriority: z.number().int().min(-1000).max(1000).optional(),
    capacityMicros: quantityStringSchema.nullable().optional()
  })
  .strict();
const inventoryStatusSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9._-]+$/),
    name: z.string().trim().min(1).max(200),
    sellable: z.boolean().optional(),
    allocatable: z.boolean().optional()
  })
  .strict();

function registerPosRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  pos: PosService,
  pickingSlip: PickingSlipService
): void {
  const registerInput = z
    .object({
      companyId: idSchema,
      inventoryLocationId: idSchema,
      cashAccountId: idSchema,
      code: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(200),
      receiptPrefix: z.string().trim().min(1).max(12).optional()
    })
    .strict();
  const lineInput = z
    .object({
      productItemId: idSchema.nullable().optional(),
      description: z.string().trim().max(500).optional(),
      quantity: quantityStringSchema,
      unitPriceMinor: z
        .string()
        .regex(/^-?\d+$/)
        .optional(),
      discountMinor: z.string().regex(/^\d+$/).optional(),
      taxCodeId: idSchema.nullable().optional()
    })
    .strict();
  const tenderInput = z
    .object({
      type: z.enum(["CASH", "MANUAL"]),
      amountReceivedMinor: z.string().regex(/^\d+$/),
      reference: z.string().trim().max(200).optional()
    })
    .strict();
  app.get("/v1/pos/registers", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { registers: await pos.listRegisters(context) };
  });
  app.get("/v1/pos/capabilities", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { capabilities: await pos.capabilities(context) };
  });
  app.get("/v1/pos/products/resolve", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ identifier: z.string().trim().min(1).max(200) })
      .strict()
      .parse(request.query);
    return pos.resolveProductIdentifier(context, query.identifier);
  });
  app.post("/v1/pos/registers", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply
      .code(201)
      .send({ register: await pos.createRegister(context, registerInput.parse(request.body)) });
  });
  app.get("/v1/pos/devices", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ registerId: idSchema.optional() }).strict().parse(request.query);
    return { devices: await pos.listDevices(context, query.registerId) };
  });
  app.post("/v1/pos/devices", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      device: await pos.enrollDevice(
        context,
        z
          .object({
            registerId: idSchema,
            deviceCode: z.string().trim().min(1).max(100),
            deviceKey: z.string().min(16).max(500).optional()
          })
          .strict()
          .parse(request.body)
      )
    });
  });
  app.post("/v1/pos/shifts/open", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        registerId: idSchema,
        deviceId: idSchema.nullable().optional(),
        businessDate: dateStringSchema,
        openingFloatMinor: z.string().regex(/^\d+$/)
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send({ shift: await pos.openShift(context, body) });
  });
  app.post("/v1/pos/shifts/:shiftId/close", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ shiftId: idSchema }).parse(request.params);
    const body = z
      .object({ countedCashMinor: z.string().regex(/^\d+$/) })
      .strict()
      .parse(request.body);
    return { shift: await pos.closeShift(context, params.shiftId, body.countedCashMinor) };
  });
  app.post("/v1/pos/shifts/:shiftId/approve-variance", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ shiftId: idSchema }).parse(request.params);
    const body = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .strict()
      .parse(request.body);
    return { shift: await pos.approveShiftVariance(context, params.shiftId, body.reason) };
  });
  app.post("/v1/pos/shifts/:shiftId/cash-events", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ shiftId: idSchema }).parse(request.params);
    const body = z
      .object({
        eventType: z.enum(["PAID_IN", "PAID_OUT", "DROP", "SAFE_TRANSFER"]),
        amountMinor: z.string().regex(/^\d+$/),
        reason: z.string().trim().min(1).max(500)
      })
      .strict()
      .parse(request.body);
    const result = await pos.addCashEvent(
      context,
      params.shiftId,
      body,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/pos/preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        registerId: idSchema,
        shiftId: idSchema,
        businessDate: dateStringSchema,
        lines: z.array(lineInput).min(1).max(100)
      })
      .strict()
      .parse(request.body);
    return pos.preview(context, body);
  });
  app.get("/v1/pos/sales", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ shiftId: idSchema.optional() }).strict().parse(request.query);
    return { sales: await pos.listSales(context, query.shiftId) };
  });
  app.post("/v1/pos/sales", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        registerId: idSchema,
        shiftId: idSchema,
        deviceId: idSchema.nullable().optional(),
        customerId: idSchema.nullable().optional(),
        businessDate: dateStringSchema,
        currency: z
          .string()
          .length(3)
          .regex(/^[A-Za-z]{3}$/)
          .optional(),
        lines: z.array(lineInput).min(1).max(100),
        tenders: z.array(tenderInput).min(1).max(10)
      })
      .strict()
      .parse(request.body);
    const result = await pos.completeSale(context, body, requestHeader(request, "idempotency-key"));
    return reply.code(201).send({ sale: result });
  });
  app.get("/v1/pos/sales/:saleId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ saleId: idSchema }).parse(request.params);
    return { sale: await pos.getSale(context, params.saleId) };
  });
  app.post("/v1/pos/sales/:saleId/picking-slip", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ saleId: idSchema }).parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const result = await pickingSlip.createForSale(context, params.saleId);
    return reply.code(result.statusCode).send(result);
  });
  app.post("/v1/pos/sales/:saleId/returns", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ saleId: idSchema }).parse(request.params);
    const body = z
      .object({
        returnDate: dateStringSchema,
        reason: z.string().trim().min(1).max(500),
        refund: z.boolean().default(true),
        refundShiftId: idSchema.nullable().optional(),
        lines: z
          .array(
            z
              .object({
                saleLineId: idSchema,
                quantity: quantityStringSchema.optional(),
                disposition: z.enum(["RESTOCK", "WRITE_OFF"]).optional()
              })
              .strict()
          )
          .min(1)
      })
      .strict()
      .parse(request.body);
    const result = await pos.returnSale(
      context,
      { ...body, saleId: params.saleId },
      requestHeader(request, "idempotency-key")
    );
    return reply.code(201).send({ return: result });
  });
  app.get("/v1/pos/shifts/:shiftId/reconciliation", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ shiftId: idSchema }).parse(request.params);
    return pos.reconcileShift(context, params.shiftId);
  });
}

function registerInventoryCatalogControlRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  controls: InventoryCatalogControlService
): void {
  app.get("/v1/inventory/capabilities", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { capabilities: controls.capabilities(context) };
  });
  app.get("/v1/inventory/barcodes", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ productItemId: idSchema.optional() }).strict().parse(request.query);
    return { barcodes: await controls.listBarcodes(context, query.productItemId) };
  });
  app.post("/v1/inventory/barcodes", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const barcode = await controls.registerBarcode(
      context,
      inventoryBarcodeRegisterSchema.parse(request.body)
    );
    return reply.code(201).send({ barcode });
  });
  app.post("/v1/inventory/barcodes/:barcodeId/deactivate", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ barcodeId: idSchema }).strict().parse(request.params);
    return { barcode: await controls.deactivateBarcode(context, params.barcodeId) };
  });
  app.post("/v1/inventory/scans/resolve", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      scan: await controls.resolveScan(context, inventoryScanResolveSchema.parse(request.body))
    };
  });
  app.get("/v1/inventory/label-templates", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { templates: await controls.listLabelTemplates(context) };
  });
  app.post("/v1/inventory/label-templates", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const template = await controls.createLabelTemplate(
      context,
      inventoryLabelTemplateSchema.parse(request.body)
    );
    return reply.code(201).send({ template });
  });
  app.post("/v1/inventory/label-templates/:templateId/preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ templateId: idSchema }).strict().parse(request.params);
    return {
      preview: await controls.previewLabel(
        context,
        params.templateId,
        inventoryLabelPreviewSchema.parse(request.body)
      )
    };
  });
}

function registerInventoryRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  inventory: InventoryService
): void {
  app.get("/v1/inventory/locations", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ active: z.enum(["true", "false"]).optional() }).parse(request.query);
    return {
      locations: await inventory.listLocations(
        context,
        query.active === undefined ? undefined : query.active === "true"
      )
    };
  });
  app.post("/v1/inventory/locations", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      location: await inventory.createLocation(context, inventoryLocationSchema.parse(request.body))
    });
  });
  app.patch("/v1/inventory/locations/:inventoryLocationId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = inventoryLocationSchema
      .partial()
      .extend({ version: z.number().int().positive() })
      .parse(request.body);
    const { version, ...input } = body;
    return {
      location: await inventory.updateLocation(context, params.inventoryLocationId!, version, input)
    };
  });
  app.post("/v1/inventory/locations/:inventoryLocationId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).parse(request.body);
    return {
      location: await inventory.archiveLocation(context, params.inventoryLocationId!, body.version)
    };
  });
  app.get("/v1/inventory/bins", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ locationId: idSchema.optional() }).parse(request.query);
    return { bins: await inventory.listBins(context, query.locationId) };
  });
  app.post("/v1/inventory/bins", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply
      .code(201)
      .send({ bin: await inventory.createBin(context, inventoryBinSchema.parse(request.body)) });
  });
  app.get("/v1/inventory/statuses", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { statuses: await inventory.listStatuses(context) };
  });
  app.post("/v1/inventory/statuses", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      status: await inventory.createStatus(context, inventoryStatusSchema.parse(request.body))
    });
  });
  app.get("/v1/inventory/lots", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ productItemId: idSchema.optional() }).parse(request.query);
    return { lots: await inventory.listLots(context, query.productItemId) };
  });
  app.post("/v1/inventory/lots", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        productItemId: idSchema,
        lotNumber: z.string().trim().min(1).max(100),
        receivedAt: dateStringSchema.optional(),
        expiryDate: dateStringSchema.nullable().optional(),
        supplierId: idSchema.nullable().optional()
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send({ lot: await inventory.createLot(context, input) });
  });
  app.post("/v1/inventory/serials", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        productItemId: idSchema,
        serialNumbers: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
        lotId: idSchema.nullable().optional(),
        locationId: idSchema.nullable().optional(),
        binId: idSchema.nullable().optional(),
        statusId: idSchema.nullable().optional()
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send({ serials: await inventory.registerSerials(context, input) });
  });
  app.post("/v1/inventory/reservations", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        productItemId: idSchema,
        locationId: idSchema,
        quantity: quantityStringSchema,
        sourceType: z.string().trim().min(1).max(100),
        sourceId: idSchema,
        sourceLineId: idSchema.nullable().optional(),
        binId: idSchema.nullable().optional(),
        lotId: idSchema.nullable().optional(),
        statusId: idSchema.nullable().optional(),
        expiresAt: z.string().datetime({ offset: true }).nullable().optional()
      })
      .strict()
      .parse(request.body);
    const result = await inventory.reserve(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/inventory/reservations", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        productItemId: idSchema.optional(),
        locationId: idSchema.optional(),
        status: z.string().trim().max(40).optional()
      })
      .parse(request.query);
    return { reservations: await inventory.listReservations(context, query) };
  });
  app.post("/v1/inventory/reservations/:inventoryReservationId/release", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      reservation: await inventory.releaseReservation(context, params.inventoryReservationId!)
    };
  });
  app.post("/v1/inventory/reservations/:inventoryReservationId/fulfill", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ effectiveDate: dateStringSchema }).strict().parse(request.body);
    const result = await inventory.fulfillReservation(
      context,
      params.inventoryReservationId!,
      body.effectiveDate,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/inventory/purchase-receipts", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        billLineId: idSchema,
        quantity: quantityStringSchema,
        locationId: idSchema.optional(),
        receivedDate: dateStringSchema,
        reason: z.string().trim().min(1).max(500).optional()
      })
      .strict()
      .parse(request.body);
    const result = await inventory.receivePurchase(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/inventory/adjustments", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        productItemId: idSchema,
        locationId: idSchema.optional(),
        direction: z.enum(["IN", "OUT"]),
        quantity: quantityStringSchema,
        unitCostMinor: z.string().regex(/^\d+$/).optional(),
        adjustmentKind: z.enum([
          "OPENING",
          "COUNT_CORRECTION",
          "DAMAGE",
          "THEFT_LOSS",
          "SPOILAGE",
          "FOUND_STOCK"
        ]),
        effectiveDate: dateStringSchema,
        reason: z.string().trim().min(1).max(500)
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.direction === "IN" && value.unitCostMinor === undefined)
          ctx.addIssue({ code: "custom", message: "Inbound adjustments require unitCostMinor." });
      })
      .parse(request.body);
    const result = await inventory.adjust(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/inventory/transfers", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        productItemId: idSchema,
        fromLocationId: idSchema,
        toLocationId: idSchema,
        quantity: quantityStringSchema,
        effectiveDate: dateStringSchema,
        reason: z.string().trim().min(1).max(500).optional()
      })
      .strict()
      .parse(request.body);
    const result = await inventory.transfer(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/inventory/transfer-orders", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        fromLocationId: idSchema,
        toLocationId: idSchema,
        lines: z
          .array(z.object({ productItemId: idSchema, quantity: quantityStringSchema }).strict())
          .min(1)
          .max(500),
        reason: z.string().trim().max(500).optional()
      })
      .strict()
      .parse(request.body);
    const result = await inventory.createTransfer(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/inventory/transfer-orders", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ status: z.string().trim().max(40).optional() }).parse(request.query);
    return { transfers: await inventory.listTransfers(context, query.status) };
  });
  app.post("/v1/inventory/transfer-orders/:inventoryTransferId/:action", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema
      .extend({ action: z.enum(["approve", "ship", "receive", "cancel"]) })
      .parse(request.params);
    const body = z
      .object({
        effectiveDate: dateStringSchema,
        quantities: z
          .array(z.object({ lineId: idSchema, quantity: quantityStringSchema }).strict())
          .max(500)
          .optional()
      })
      .strict()
      .parse(request.body);
    const result = await inventory.advanceTransfer(
      context,
      params.inventoryTransferId!,
      params.action,
      body.effectiveDate,
      requestHeader(request, "idempotency-key"),
      body.quantities
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/inventory/counts", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({ locationId: idSchema, blind: z.boolean().optional() })
      .strict()
      .parse(request.body);
    const result = await inventory.createCount(
      context,
      body,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/inventory/counts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ status: z.string().trim().max(40).optional() }).parse(request.query);
    return { counts: await inventory.listCounts(context, query.status) };
  });
  app.patch("/v1/inventory/count-lines/:inventoryCountLineId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ counted: quantityStringSchema }).strict().parse(request.body);
    return {
      line: await inventory.recordCountLine(context, params.inventoryCountLineId!, body.counted)
    };
  });
  app.post("/v1/inventory/counts/:inventoryCountId/approve", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ effectiveDate: dateStringSchema }).strict().parse(request.body);
    const result = await inventory.approveCount(
      context,
      params.inventoryCountId!,
      body.effectiveDate,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/inventory/customer-returns", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        creditNoteLineId: idSchema,
        quantity: quantityStringSchema,
        locationId: idSchema.optional(),
        disposition: z.enum(["RESTOCK", "WRITE_OFF"]),
        returnDate: dateStringSchema,
        reason: z.string().trim().min(1).max(500)
      })
      .strict()
      .parse(request.body);
    const result = await inventory.customerReturn(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/inventory/vendor-returns", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const input = z
      .object({
        vendorCreditLineId: idSchema,
        quantity: quantityStringSchema,
        locationId: idSchema.optional(),
        returnDate: dateStringSchema,
        reason: z.string().trim().min(1).max(500)
      })
      .strict()
      .parse(request.body);
    const result = await inventory.vendorReturn(
      context,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/inventory/quantities", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ locationId: idSchema.optional() }).parse(request.query);
    return { quantities: await inventory.quantities(context, query.locationId) };
  });
  app.get("/v1/inventory/movements", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        productItemId: idSchema.optional(),
        locationId: idSchema.optional(),
        from: dateStringSchema.optional(),
        to: dateStringSchema.optional()
      })
      .parse(request.query);
    return { movements: await inventory.movements(context, query) };
  });
  app.get("/v1/inventory/reports/valuation", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ asOf: dateStringSchema.optional() }).parse(request.query);
    return { valuation: await inventory.valuation(context, query.asOf) };
  });
  app.get("/v1/inventory/reports/cost-of-goods", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ from: dateStringSchema.optional(), to: dateStringSchema.optional() })
      .parse(request.query);
    return { costOfGoods: await inventory.costOfGoods(context, query) };
  });
  app.get("/v1/inventory/reports/control-reconciliation", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ asOf: dateStringSchema.optional() }).parse(request.query);
    return {
      reconciliation: await inventory.controlReconciliation(context, query.asOf)
    };
  });
  app.get("/v1/inventory/reports/low-stock", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { products: await inventory.lowStock(context) };
  });
  app.get("/v1/inventory/reports/reorder-suggestions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { products: await inventory.reorderSuggestions(context) };
  });
}

function registerPlanningRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  planning: PlanningService,
  calendar: CalendarService,
  workItems: ProjectWorkItemService
) {
  app.get("/v1/calendar/events", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = calendarQuerySchema.parse(request.query);
    return { calendar: await calendar.list(context, query) };
  });
  app.get("/v1/project-work-items", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      workItems: await workItems.list(context, projectWorkItemListSchema.parse(request.query))
    };
  });
  app.post("/v1/project-work-items", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      workItem: await workItems.create(context, createProjectWorkItemSchema.parse(request.body))
    });
  });
  app.get("/v1/project-work-items/:workItemId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { workItem: await workItems.get(context, params.workItemId!) };
  });
  app.patch("/v1/project-work-items/:workItemId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      workItem: await workItems.update(
        context,
        params.workItemId!,
        updateProjectWorkItemSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/project-work-items/:workItemId/status", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = projectWorkItemStatusCommandSchema.parse(request.body);
    return {
      workItem: await workItems.setStatus(context, params.workItemId!, body.status, body.version)
    };
  });
  app.post("/v1/project-work-items/:workItemId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = versionSchema.parse(request.body);
    return {
      workItem: await workItems.archive(context, params.workItemId!, body.version)
    };
  });
  app.post("/v1/project-work-items/:workItemId/dependencies", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = projectWorkItemDependencySchema.parse(request.body);
    return {
      workItem: await workItems.addDependency(
        context,
        params.workItemId!,
        body.dependsOnItemId,
        body.version
      )
    };
  });
  app.delete(
    "/v1/project-work-items/:workItemId/dependencies/:dependsOnItemId",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = versionSchema.parse(request.body);
      return {
        workItem: await workItems.removeDependency(
          context,
          params.workItemId!,
          params.dependsOnItemId!,
          body.version
        )
      };
    }
  );
  app.get("/v1/budgets", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { budgets: await planning.listBudgets(context) };
  });
  app.post("/v1/budgets", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply
      .code(201)
      .send({ budget: await planning.createBudget(context, budgetPlanSchema.parse(request.body)) });
  });
  app.get("/v1/budgets/:budgetPlanId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { budget: await planning.getBudget(context, params.budgetPlanId!) };
  });
  app.put("/v1/budgets/:budgetPlanId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = budgetPlanSchema
      .extend({ version: z.number().int().positive() })
      .parse(request.body);
    const { version, ...input } = body;
    return { budget: await planning.replaceBudget(context, params.budgetPlanId!, version, input) };
  });
  for (const status of ["activate", "archive"] as const) {
    app.post(`/v1/budgets/:budgetPlanId/${status}`, async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = versionSchema.parse(request.body);
      return {
        budget: await planning.setBudgetStatus(
          context,
          params.budgetPlanId!,
          body.version,
          status === "activate" ? "ACTIVE" : "ARCHIVED"
        )
      };
    });
  }
  app.get("/v1/cash-forecast", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ from: dateStringSchema.optional() }).strict().parse(request.query);
    return { forecast: await planning.cashForecast(context, query.from) };
  });
  app.get("/v1/cash-forecast/assumptions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ from: dateStringSchema.optional() }).strict().parse(request.query);
    return { assumptions: await planning.listAssumptions(context, query.from) };
  });
  app.post("/v1/cash-forecast/assumptions", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      assumption: await planning.createAssumption(
        context,
        cashForecastAssumptionSchema.parse(request.body)
      )
    });
  });
  app.delete("/v1/cash-forecast/assumptions/:assumptionId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = versionSchema.parse(request.body);
    return planning.deleteAssumption(context, params.assumptionId!, body.version);
  });
}

function registerPurchaseRequestRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  requests: PurchaseRequestService
) {
  app.get("/v1/purchase-requests", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"]).optional()
      })
      .strict()
      .parse(request.query);
    return { purchaseRequests: await requests.list(context, query.status) };
  });
  app.post("/v1/purchase-requests", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      purchaseRequest: await requests.create(context, purchaseRequestSchema.parse(request.body))
    });
  });
  app.get("/v1/purchase-requests/:purchaseRequestId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { purchaseRequest: await requests.get(context, params.purchaseRequestId!) };
  });
  app.put("/v1/purchase-requests/:purchaseRequestId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = purchaseRequestSchema
      .extend({ version: z.number().int().positive() })
      .parse(request.body);
    const { version, ...input } = body;
    return {
      purchaseRequest: await requests.update(context, params.purchaseRequestId!, version, input)
    };
  });
  for (const action of ["submit", "approve", "reject", "cancel"] as const) {
    app.post(`/v1/purchase-requests/:purchaseRequestId/${action}`, async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      let version: number;
      let decisionNote: string | null = null;
      if (action !== "submit") {
        const body = purchaseRequestDecisionSchema.parse(request.body);
        version = body.version;
        decisionNote = body.decisionNote ?? null;
        if ((action === "reject" || action === "cancel") && !decisionNote)
          throw new AppError(
            "PURCHASE_REQUEST_DECISION_NOTE_REQUIRED",
            `${action === "reject" ? "A rejection reason" : "A cancellation reason"} is required.`,
            422
          );
      } else {
        version = versionSchema.parse(request.body).version;
      }
      return {
        purchaseRequest: await requests.transition(
          context,
          params.purchaseRequestId!,
          version,
          action,
          decisionNote
        )
      };
    });
  }
}

function registerDepositAndProgressBillingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  deposits: CustomerDepositService,
  progressBilling: ProgressBillingService
): void {
  const depositStatusSchema = z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"]);
  const progressStatusSchema = depositStatusSchema;

  app.get("/v1/customer-deposit-requests", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ status: depositStatusSchema.optional() })
      .strict()
      .parse(request.query);
    return {
      depositRequests: await deposits.list(context, query.status)
    };
  });
  app.post("/v1/customer-deposit-requests", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await deposits.create(
      context,
      customerDepositRequestSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/customer-deposit-requests/:depositRequestId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { depositRequest: await deposits.get(context, params.depositRequestId!) };
  });
  app.put("/v1/customer-deposit-requests/:depositRequestId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = customerDepositRequestSchema
      .extend({ version: z.number().int().positive() })
      .parse(request.body);
    const { version, ...input } = body;
    return {
      depositRequest: await deposits.update(context, params.depositRequestId!, version, input)
    };
  });
  for (const action of ["submit", "approve", "reject", "revise", "cancel"] as const) {
    app.post(
      `/v1/customer-deposit-requests/:depositRequestId/${action}`,
      async (request, reply) => {
        const context = await requireOrganizationContext(request, prisma, identityAdapter);
        const params = idParamSchema.parse(request.params);
        const body = nonPostingWorkflowCommandSchema.parse(request.body);
        const result = await deposits.transition(
          context,
          params.depositRequestId!,
          body.version,
          action,
          body.reason ?? null,
          requestHeader(request, "idempotency-key")
        );
        return reply.code(result.statusCode).send(result.body);
      }
    );
  }

  app.get("/v1/progress-billing-plans", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        status: progressStatusSchema.optional(),
        estimateId: idSchema.optional(),
        projectId: idSchema.optional()
      })
      .strict()
      .parse(request.query);
    return {
      progressBillingPlans: await progressBilling.list(context, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.estimateId ? { estimateId: query.estimateId } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {})
      })
    };
  });
  app.post("/v1/estimates/:estimateId/progress-billing-plans", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await progressBilling.create(
      context,
      params.estimateId!,
      progressBillingPlanSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/progress-billing-plans/:progressBillingPlanId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      progressBillingPlan: await progressBilling.get(context, params.progressBillingPlanId!)
    };
  });
  app.put("/v1/progress-billing-plans/:progressBillingPlanId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = progressBillingPlanSchema
      .extend({ version: z.number().int().positive() })
      .parse(request.body);
    const { version, ...input } = body;
    return {
      progressBillingPlan: await progressBilling.update(
        context,
        params.progressBillingPlanId!,
        version,
        input
      )
    };
  });
  for (const action of ["submit", "approve", "reject", "revise", "cancel"] as const) {
    app.post(
      `/v1/progress-billing-plans/:progressBillingPlanId/${action}`,
      async (request, reply) => {
        const context = await requireOrganizationContext(request, prisma, identityAdapter);
        const params = idParamSchema.parse(request.params);
        const body = nonPostingWorkflowCommandSchema.parse(request.body);
        const result = await progressBilling.transition(
          context,
          params.progressBillingPlanId!,
          body.version,
          action,
          body.reason ?? null,
          requestHeader(request, "idempotency-key")
        );
        return reply.code(result.statusCode).send(result.body);
      }
    );
  }
}

function registerFixedAssetRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  fixedAssets: FixedAssetService
): void {
  const fixedAssetStatusSchema = z.enum([
    "DRAFT",
    "SUBMITTED",
    "REGISTERED",
    "REJECTED",
    "CANCELLED"
  ]);

  app.get("/v1/fixed-asset-classes", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ includeArchived: z.enum(["true", "false"]).optional() })
      .strict()
      .parse(request.query);
    return {
      fixedAssetClasses: await fixedAssets.listClasses(context, query.includeArchived === "true")
    };
  });
  app.post("/v1/fixed-asset-classes", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await fixedAssets.createClass(
      context,
      fixedAssetClassSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/fixed-asset-classes/:fixedAssetClassId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      fixedAssetClass: await fixedAssets.getClass(context, params.fixedAssetClassId!)
    };
  });
  app.put("/v1/fixed-asset-classes/:fixedAssetClassId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = fixedAssetClassSchema
      .extend({ version: z.number().int().positive() })
      .parse(request.body);
    const { version, ...input } = body;
    return {
      fixedAssetClass: await fixedAssets.updateClass(
        context,
        params.fixedAssetClassId!,
        version,
        input
      )
    };
  });
  app.post("/v1/fixed-asset-classes/:fixedAssetClassId/archive", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = versionSchema.parse(request.body);
    const result = await fixedAssets.archiveClass(
      context,
      params.fixedAssetClassId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/fixed-assets", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        status: fixedAssetStatusSchema.optional(),
        fixedAssetClassId: idSchema.optional()
      })
      .strict()
      .parse(request.query);
    return {
      fixedAssets: await fixedAssets.list(context, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.fixedAssetClassId ? { fixedAssetClassId: query.fixedAssetClassId } : {})
      })
    };
  });
  app.post("/v1/fixed-assets", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await fixedAssets.create(
      context,
      fixedAssetCreateSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/fixed-assets/:fixedAssetId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { fixedAsset: await fixedAssets.get(context, params.fixedAssetId!) };
  });
  app.patch("/v1/fixed-assets/:fixedAssetId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = fixedAssetPatchSchema.parse(request.body);
    const { version, ...input } = body;
    return {
      fixedAsset: await fixedAssets.update(context, params.fixedAssetId!, version, input)
    };
  });
  app.get("/v1/fixed-assets/:fixedAssetId/depreciation-preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      depreciationPreview: await fixedAssets.preview(context, params.fixedAssetId!)
    };
  });
  for (const action of ["submit", "register", "reject", "revise", "cancel"] as const) {
    app.post(`/v1/fixed-assets/:fixedAssetId/${action}`, async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = nonPostingWorkflowCommandSchema.parse(request.body);
      const result = await fixedAssets.transition(
        context,
        params.fixedAssetId!,
        body.version,
        action,
        body.reason ?? null,
        requestHeader(request, "idempotency-key")
      );
      return reply.code(result.statusCode).send(result.body);
    });
  }
}

function registerContractRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  contractService: ContractService
): void {
  app.get("/v1/contracts/templates", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return contractService.listTemplates(context);
  });
  app.get("/v1/contracts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return contractService.list(context);
  });
  app.post("/v1/contracts", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      contract: await contractService.create(context, createContractSchema.parse(request.body))
    });
  });
  app.get("/v1/contracts/:contractId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { contract: await contractService.get(context, params.contractId!) };
  });
  app.patch("/v1/contracts/:contractId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      contract: await contractService.update(
        context,
        params.contractId!,
        updateContractSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/contracts/:contractId/ready", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      contract: await contractService.markReady(
        context,
        params.contractId!,
        readyContractSchema.parse(request.body)
      )
    };
  });
}

function registerEmailConnectionRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  emailConnectionService: EmailConnectionService
): void {
  app.get("/v1/email-connections", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return emailConnectionService.list(context);
  });
  app.post("/v1/email-connections/smtp", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await emailConnectionService.configureSmtp(
      context,
      smtpConnectionRequestSchema.parse(request.body)
    );
    return reply.code(201).send(result);
  });
  app.post("/v1/email-connections/:provider/authorize", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = z.object({ provider: emailConnectionProviderSchema }).parse(request.params);
    return emailConnectionService.beginAuthorization(context, params.provider);
  });
  app.get("/v1/email-connections/callback", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = emailConnectionCallbackSchema.parse(request.query);
    try {
      const result = await emailConnectionService.completeAuthorization(context, query);
      const returnTo = emailConnectionService.callbackReturnUrl(query.provider, "connected");
      if (returnTo) return await reply.redirect(returnTo, 303);
      return result;
    } catch (error) {
      const returnTo = emailConnectionService.callbackReturnUrl(query.provider, "error");
      if (returnTo) return await reply.redirect(returnTo, 303);
      throw error;
    }
  });
  app.post("/v1/email-connections/:connectionId/disconnect", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { connection: await emailConnectionService.disconnect(context, params.connectionId!) };
  });
  app.post("/v1/email-connections/:connectionId/default", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      connection: await emailConnectionService.setDefaultSender(context, params.connectionId!)
    };
  });
}

function registerPurchaseRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  purchases: PurchaseService,
  attachments: PurchaseAttachmentService
): void {
  app.get("/v1/vendors", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = listQuerySchema.parse(request.query);
    return {
      vendors: await purchases.listVendors(
        context,
        query.active === undefined ? undefined : query.active === "true"
      )
    };
  });
  app.post("/v1/vendors", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply
      .code(201)
      .send({ vendor: await purchases.createVendor(context, vendorSchema.parse(request.body)) });
  });
  app.patch("/v1/vendors/:vendorId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = vendorSchema
      .partial()
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(request.body);
    const { version, ...changes } = body;
    return {
      vendor: await purchases.updateVendor(
        context,
        params.vendorId!,
        version,
        changes as Partial<VendorInput>
      )
    };
  });
  app.post("/v1/vendors/:vendorId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    return { vendor: await purchases.archiveVendor(context, params.vendorId!, body.version) };
  });

  app.get("/v1/bills", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ status: z.string().optional(), vendorId: idSchema.optional() })
      .strict()
      .parse(request.query);
    return { bills: await purchases.listBills(context, query.status, query.vendorId) };
  });
  app.post("/v1/bills", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      bill: await purchases.createBill(
        context,
        billSchema.parse(request.body),
        requestHeader(request, "idempotency-key")
      )
    });
  });
  app.get("/v1/bills/:billId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { bill: await purchases.getBill(context, params.billId!) };
  });
  app.post("/v1/capture-reviews/:captureReviewId/convert", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await purchases.convertApprovedCaptureReview(
      context,
      params.captureReviewId!,
      captureReviewConversionSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/immediate-expense-drafts/:immediateExpenseDraftId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      immediateExpenseDraft: await purchases.getImmediateExpenseDraft(
        context,
        params.immediateExpenseDraftId!
      )
    };
  });
  app.put("/v1/bills/:billId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = billSchema
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(request.body);
    const { version, ...input } = body;
    return { bill: await purchases.updateBill(context, params.billId!, version, input) };
  });
  app.post("/v1/bills/:billId/approve", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    return { bill: await purchases.approveBill(context, params.billId!, body.version) };
  });
  app.post("/v1/bills/:billId/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    const result = await purchases.postBill(
      context,
      params.billId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/immediate-expenses", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await purchases.recordImmediateExpense(
      context,
      immediateExpenseSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/immediate-expenses/:immediateExpenseId/reverse", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({ effectiveDate: dateStringSchema, reason: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(request.body);
    const result = await purchases.reverseImmediateExpense(
      context,
      params.immediateExpenseId!,
      body.effectiveDate,
      body.reason,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/bill-payments", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        vendorId: idSchema,
        paymentDate: dateStringSchema,
        amountMinor: z.string().regex(/^\d+$/),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
        fxRateSnapshotId: idSchema.optional(),
        method: purchasePaymentMethodSchema,
        payingAccountId: idSchema,
        reference: z.string().trim().max(128).nullable().optional(),
        allocations: z
          .array(z.object({ billId: idSchema, amountMinor: z.string().regex(/^\d+$/) }).strict())
          .min(1)
          .max(500)
      })
      .strict()
      .parse(request.body);
    const result = await purchases.recordBillPayment(
      context,
      body,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/bill-payments/:billPaymentId/reverse", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({ effectiveDate: dateStringSchema, reason: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(request.body);
    const result = await purchases.reverseBillPayment(
      context,
      params.billPaymentId!,
      body.effectiveDate,
      body.reason,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/vendor-credits", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        vendorId: idSchema,
        vendorCreditNumber: z.string().trim().min(1).max(128),
        issueDate: dateStringSchema,
        reason: z.string().trim().min(1).max(1000),
        lines: z
          .array(
            z
              .object({
                billLineId: idSchema,
                description: z.string().trim().min(1).max(500).optional(),
                amountMinor: z.string().regex(/^\d+$/).optional()
              })
              .strict()
          )
          .min(1)
          .max(500)
      })
      .strict()
      .parse(request.body);
    return reply
      .code(201)
      .send({ vendorCredit: await purchases.createVendorCredit(context, body) });
  });
  app.post("/v1/vendor-credits/:vendorCreditId/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    const result = await purchases.postVendorCredit(
      context,
      params.vendorCreditId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/vendor-credits/:vendorCreditId/apply", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        allocations: z
          .array(z.object({ billId: idSchema, amountMinor: z.string().regex(/^\d+$/) }).strict())
          .min(1)
          .max(500)
      })
      .strict()
      .parse(request.body);
    const result = await purchases.applyVendorCredit(
      context,
      params.vendorCreditId!,
      body.allocations,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/payables/aging", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z.object({ asOf: dateStringSchema.optional() }).strict().parse(request.query);
    return {
      payables: await purchases.payables(
        context,
        query.asOf ? parseDate(query.asOf, "asOf") : new Date()
      )
    };
  });
  const attachmentParents = [
    { path: "bills", param: "billId", type: "bill" },
    { path: "vendor-credits", param: "vendorCreditId", type: "vendor-credit" },
    { path: "immediate-expenses", param: "immediateExpenseId", type: "immediate-expense" }
  ] as const;
  for (const parent of attachmentParents) {
    app.post(`/v1/${parent.path}/:${parent.param}/attachments`, async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const parentId = params[parent.param]!;
      if (!Buffer.isBuffer(request.body))
        throw new AppError(
          "PURCHASE_ATTACHMENT_CONTENT_INVALID",
          "A binary attachment is required.",
          422
        );
      const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.toLowerCase() ?? "";
      const attachment = await attachments.add(
        context,
        { type: parent.type, id: parentId },
        {
          fileName: requestHeader(request, "x-file-name") ?? "attachment",
          mediaType,
          data: request.body
        }
      );
      return reply.code(201).send({ attachment });
    });
    app.get(`/v1/${parent.path}/:${parent.param}/attachments`, async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return {
        attachments: await attachments.list(context, {
          type: parent.type,
          id: params[parent.param]!
        })
      };
    });
  }
  app.get("/v1/purchase-attachments/:attachmentId", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await attachments.read(context, params.attachmentId!);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "sandbox")
      .header("content-disposition", `attachment; filename="${result.attachment.fileName}"`)
      .type(result.attachment.mediaType)
      .send(result.data);
  });
}

const bankAccountSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    accountKind: z.enum(["BANK", "CREDIT_CARD"]),
    maskedAccountReference: z.string().trim().min(4).max(64),
    financialInstitutionName: z.string().trim().max(200).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    linkedLedgerAccountId: idSchema,
    openingDate: dateStringSchema
  })
  .strict();
const csvMappingSchema = z
  .object({
    postingDate: z.string().trim().min(1).max(100),
    transactionDate: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(1).max(100),
    payee: z.string().trim().min(1).max(100).optional(),
    memo: z.string().trim().min(1).max(100).optional(),
    amount: z.string().trim().min(1).max(100).optional(),
    debit: z.string().trim().min(1).max(100).optional(),
    credit: z.string().trim().min(1).max(100).optional(),
    currency: z.string().trim().min(1).max(100).optional(),
    balance: z.string().trim().min(1).max(100).optional(),
    referenceNumber: z.string().trim().min(1).max(100).optional(),
    sourceRowIdentifier: z.string().trim().min(1).max(100).optional()
  })
  .strict();
const bankRuleSchema = z
  .object({
    bankAccountId: idSchema.nullable().optional(),
    name: z.string().trim().min(1).max(200),
    priority: z.number().int().positive().max(1_000_000),
    descriptionContains: z.string().trim().min(1).max(500).nullable().optional(),
    payeeContains: z.string().trim().min(1).max(500).nullable().optional(),
    minimumAmountMinor: z.string().regex(/^\d+$/).nullable().optional(),
    maximumAmountMinor: z.string().regex(/^\d+$/).nullable().optional(),
    direction: z.enum(["DEBIT", "CREDIT"]).nullable().optional(),
    suggestion: jsonInputSchema
  })
  .strict();
const bankMatchTargetSchema = z.enum([
  "INVOICE_PAYMENT",
  "PROCESSOR_SETTLEMENT",
  "BILL_PAYMENT",
  "IMMEDIATE_EXPENSE",
  "MANUAL_JOURNAL",
  "TRANSFER",
  "BANK_FEE",
  "INTEREST"
]);
const reconciliationBodySchema = z
  .object({
    bankAccountId: idSchema,
    statementStartDate: dateStringSchema,
    statementEndDate: dateStringSchema,
    openingStatementBalanceMinor: z.string().regex(/^-?\d+$/),
    closingStatementBalanceMinor: z.string().regex(/^-?\d+$/),
    importedTransactionIds: z.array(idSchema).max(20_000)
  })
  .strict();

function registerPayrollRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  payroll: PayrollService
): void {
  app.get("/v1/payroll/overview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { payroll: await payroll.overview(context) };
  });
  app.put("/v1/payroll/settings", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return {
      payrollSettings: await payroll.configure(context, payrollSettingsSchema.parse(request.body))
    };
  });
  app.post("/v1/payroll/codes", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await payroll.createCode(
      context,
      payrollCodeSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/payroll/ca-ab-base-codes", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    const result = await payroll.ensureCaAbBaseCodes(
      context,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/payroll/workers", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { payrollWorkers: await payroll.listWorkers(context) };
  });
  app.post("/v1/payroll/workers", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await payroll.createWorker(
      context,
      payrollWorkerSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/payroll/schedules", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await payroll.createSchedule(
      context,
      payrollScheduleSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.patch("/v1/payroll/schedules/:payrollScheduleId/automation", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      payrollSchedule: await payroll.updateScheduleAutomation(
        context,
        params.payrollScheduleId!,
        payrollScheduleAutomationSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/payroll/schedules/:payrollScheduleId/generate-draft", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await payroll.generateScheduledDraft(
      context,
      params.payrollScheduleId!,
      payrollScheduledDraftSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/payroll/periods", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return reply.code(201).send({
      payrollPeriod: await payroll.createPeriod(context, payrollPeriodSchema.parse(request.body))
    });
  });
  app.post("/v1/payroll/runs", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const result = await payroll.createRun(
      context,
      payrollRunSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/payroll/runs/:payrollRunId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { payrollRun: await payroll.getRun(context, params.payrollRunId!) };
  });
  app.post("/v1/payroll/runs/:payrollRunId/calculate", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { payrollRun: await payroll.calculate(context, params.payrollRunId!) };
  });
  app.post("/v1/payroll/runs/:payrollRunId/review", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = versionSchema.parse(request.body);
    return { payrollRun: await payroll.review(context, params.payrollRunId!, body.version) };
  });
  app.post("/v1/payroll/runs/:payrollRunId/approve", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = versionSchema.parse(request.body);
    return { payrollRun: await payroll.approve(context, params.payrollRunId!, body.version) };
  });
  app.post("/v1/payroll/runs/:payrollRunId/post", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = versionSchema.parse(request.body);
    const result = await payroll.post(
      context,
      params.payrollRunId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/payroll/runs/:payrollRunId/payment-batches", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const result = await payroll.createPaymentBatch(
      context,
      params.payrollRunId!,
      payrollPaymentBatchSchema.parse(request.body),
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/payroll/payment-batches/:payrollPaymentBatchId/exports", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      payrollPaymentExport: await payroll.recordPaymentExport(
        context,
        params.payrollPaymentBatchId!,
        payrollPaymentExportSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/payroll/automation/run", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = payrollAutomationRunSchema.parse(request.body);
    return { payrollAutomation: await payroll.generateDueScheduledDrafts(context, body.asOfDate) };
  });
}

function registerBankingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  banking: BankingService,
  bankFeeds: BankFeedService
): void {
  app.get("/v1/bank-feeds/status", async (request) => {
    await requireOrganizationContext(request, prisma, identityAdapter);
    return { bankFeeds: bankFeeds.providerStatus() };
  });
  app.get("/v1/bank-feeds", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { bankFeeds: await bankFeeds.list(context) };
  });
  app.post("/v1/bank-feeds/link-token", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z.object({ bankFeedItemId: idSchema.optional() }).strict().parse(request.body);
    return { bankFeedLink: await bankFeeds.createLinkToken(context, body.bankFeedItemId) };
  });
  app.post("/v1/bank-feeds/preview", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({ publicToken: z.string().trim().min(1).max(4_000) })
      .strict()
      .parse(request.body);
    return { bankFeedPreview: await bankFeeds.previewConnection(context, body.publicToken) };
  });
  app.post("/v1/bank-feeds/connect", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        publicToken: z.string().trim().min(1).max(4_000),
        bankFeedItemId: idSchema.optional(),
        mappings: z
          .array(
            z
              .object({
                bankAccountId: idSchema,
                providerAccountReference: z.string().trim().min(1).max(240)
              })
              .strict()
          )
          .min(1)
          .max(20)
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send({ bankFeed: await bankFeeds.connect(context, body) });
  });
  app.post("/v1/bank-feeds/:bankFeedItemId/sync", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const bankFeedSync = await bankFeeds.sync(context, params.bankFeedItemId!);
    const ruleProcessing = await banking.applyAutomaticFeedRules(context, bankFeedSync.sync.id);
    return { bankFeedSync: { ...bankFeedSync, ruleProcessing } };
  });
  app.post("/v1/bank-feeds/:bankFeedItemId/disconnect", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return { bankFeed: await bankFeeds.disconnect(context, params.bankFeedItemId!) };
  });
  app.get("/v1/bank-accounts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({ active: z.enum(["true", "false"]).optional() })
      .strict()
      .parse(request.query);
    return {
      bankAccounts: await banking.listAccounts(
        context,
        query.active === undefined ? undefined : query.active === "true"
      )
    };
  });
  app.post("/v1/bank-accounts", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = bankAccountSchema.parse(request.body) as BankAccountInput;
    return reply.code(201).send({ bankAccount: await banking.createAccount(context, body) });
  });
  app.patch("/v1/bank-accounts/:bankAccountId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        version: z.number().int().positive(),
        displayName: z.string().trim().min(1).max(200).optional(),
        maskedAccountReference: z.string().trim().min(4).max(64).optional(),
        financialInstitutionName: z.string().trim().max(200).nullable().optional()
      })
      .strict()
      .parse(request.body);
    const { version, ...input } = body;
    return {
      bankAccount: await banking.updateAccount(context, params.bankAccountId!, version, input)
    };
  });
  app.post("/v1/bank-accounts/:bankAccountId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    return {
      bankAccount: await banking.archiveAccount(context, params.bankAccountId!, body.version)
    };
  });
  app.post("/v1/bank-imports/preview", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        bankAccountId: idSchema,
        fileName: z.string().trim().min(1).max(255),
        format: z.enum(["CSV", "OFX", "QFX"]),
        contentBase64: z.string().min(1).max(7_100_000),
        mapping: csvMappingSchema.optional()
      })
      .strict()
      .parse(request.body);
    return reply.code(201).send(await banking.previewImport(context, body));
  });
  app.post("/v1/bank-imports/:bankImportBatchId/commit", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    const result = await banking.commitImport(
      context,
      params.bankImportBatchId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/bank-imports", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        bankAccountId: idSchema.optional(),
        cursor: idSchema.optional(),
        limit: z.coerce.number().int().positive().max(100).optional()
      })
      .strict()
      .parse(request.query);
    return {
      batches: await banking.listImportBatches(
        context,
        query.bankAccountId,
        query.cursor,
        query.limit
      )
    };
  });
  app.get("/v1/bank-imports/:bankImportBatchId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      batch: await banking.getImportBatch(context, params.bankImportBatchId!)
    };
  });
  app.get("/v1/bank-transactions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = z
      .object({
        bankAccountId: idSchema.optional(),
        status: z.enum(["UNMATCHED", "MATCHED", "CATEGORIZED"]).optional(),
        cursor: idSchema.optional(),
        limit: z.coerce.number().int().positive().max(100).optional()
      })
      .strict()
      .parse(request.query);
    return { transactions: await banking.listTransactions(context, query) };
  });
  app.post("/v1/bank-transactions/:bankTransactionId/duplicate-override", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        version: z.number().int().positive(),
        reason: z.string().trim().min(1).max(1000)
      })
      .strict()
      .parse(request.body);
    return {
      transaction: await banking.overrideDuplicate(
        context,
        params.bankTransactionId!,
        body.version,
        body.reason
      )
    };
  });
  app.get(
    "/v1/bank-transactions/:bankTransactionId/invoice-deposit-suggestions",
    async (request) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      return banking.suggestInvoiceDeposits(context, params.bankTransactionId!);
    }
  );
  app.post(
    "/v1/bank-transactions/:bankTransactionId/confirm-invoice-deposit",
    async (request, reply) => {
      const context = await requireOrganizationContext(request, prisma, identityAdapter);
      const params = idParamSchema.parse(request.params);
      const body = z
        .object({
          version: z.number().int().positive(),
          allocations: z
            .array(
              z.object({ invoiceId: idSchema, amountMinor: z.string().regex(/^\d+$/) }).strict()
            )
            .min(1)
            .max(10),
          rememberPayerAlias: z.boolean().optional(),
          payerAlias: z.string().trim().min(1).max(250).nullable().optional()
        })
        .strict()
        .parse(request.body);
      const result = await banking.confirmInvoiceDeposit(
        context,
        params.bankTransactionId!,
        body,
        requestHeader(request, "idempotency-key")
      );
      return reply.code(result.statusCode).send(result.body);
    }
  );
  app.get("/v1/bank-transactions/:bankTransactionId/match-suggestions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      suggestions: await banking.suggestMatches(context, params.bankTransactionId!)
    };
  });
  app.post("/v1/bank-transactions/:bankTransactionId/matches", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        version: z.number().int().positive(),
        matches: z
          .array(
            z
              .object({
                targetJournalId: idSchema,
                targetType: bankMatchTargetSchema,
                targetId: z.string().trim().min(1).max(200),
                amountMinor: z.string().regex(/^\d+$/),
                confidenceBasisPoints: z.number().int().min(0).max(10_000).optional(),
                reasons: z.array(z.string().trim().min(1).max(200)).max(20).optional()
              })
              .strict()
          )
          .min(1)
          .max(100)
      })
      .strict()
      .parse(request.body);
    const result = await banking.confirmMatches(
      context,
      params.bankTransactionId!,
      body.version,
      body.matches,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/bank-transactions/:bankTransactionId/matches/reverse", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        version: z.number().int().positive(),
        reason: z.string().trim().min(1).max(1000)
      })
      .strict()
      .parse(request.body);
    const result = await banking.reverseMatches(
      context,
      params.bankTransactionId!,
      body.version,
      body.reason,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/bank-transactions/:bankTransactionId/categorize", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        version: z.number().int().positive(),
        vendorId: idSchema.nullable().optional(),
        customerId: idSchema.nullable().optional(),
        memo: z.string().trim().max(1000).nullable().optional(),
        lines: z
          .array(
            z
              .object({
                accountId: idSchema,
                amountMinor: z.string().regex(/^\d+$/),
                taxCodeId: idSchema.nullable().optional(),
                memo: z.string().trim().max(500).nullable().optional()
              })
              .strict()
          )
          .min(1)
          .max(500)
      })
      .strict()
      .parse(request.body);
    const { version, ...input } = body;
    const result = await banking.categorize(
      context,
      params.bankTransactionId!,
      version,
      input,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/bank-transactions/:bankTransactionId/rule-suggestions", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    return {
      rules: await banking.ruleSuggestions(context, params.bankTransactionId!)
    };
  });
  app.get("/v1/bank-rules", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { rules: await banking.listRules(context) };
  });
  app.post("/v1/bank-rules", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = bankRuleSchema.parse(request.body) as BankRuleInput;
    return reply.code(201).send({ rule: await banking.createRule(context, body) });
  });
  app.put("/v1/bank-rules/:bankRuleId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = bankRuleSchema
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(request.body);
    const { version, ...input } = body;
    return {
      rule: await banking.updateRule(context, params.bankRuleId!, version, input)
    };
  });
  app.post("/v1/bank-rules/:bankRuleId/archive", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    return { rule: await banking.archiveRule(context, params.bankRuleId!, body.version) };
  });
  app.post("/v1/bank-transfers", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = z
      .object({
        sourceBankAccountId: idSchema,
        destinationBankAccountId: idSchema,
        transferDate: dateStringSchema,
        amountMinor: z.string().regex(/^\d+$/),
        reference: z.string().trim().max(200).nullable().optional(),
        importedTransactionIds: z.array(idSchema).max(2).optional()
      })
      .strict()
      .parse(request.body);
    const result = await banking.createTransfer(
      context,
      body,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/bank-reconciliations", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = reconciliationBodySchema.parse(request.body);
    return reply
      .code(201)
      .send({ reconciliation: await banking.createReconciliation(context, body) });
  });
  app.put("/v1/bank-reconciliations/:reconciliationId", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = reconciliationBodySchema
      .omit({ bankAccountId: true })
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(request.body);
    const { version, ...input } = body;
    return {
      reconciliation: await banking.updateReconciliation(
        context,
        params.reconciliationId!,
        version,
        input
      )
    };
  });
  app.post("/v1/bank-reconciliations/:reconciliationId/complete", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z.object({ version: z.number().int().positive() }).strict().parse(request.body);
    const result = await banking.completeReconciliation(
      context,
      params.reconciliationId!,
      body.version,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/v1/bank-reconciliations/:reconciliationId/reopen", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        version: z.number().int().positive(),
        reason: z.string().trim().min(1).max(1000)
      })
      .strict()
      .parse(request.body);
    const result = await banking.reopenReconciliation(
      context,
      params.reconciliationId!,
      body.version,
      body.reason,
      requestHeader(request, "idempotency-key")
    );
    return reply.code(result.statusCode).send(result.body);
  });
  app.get("/v1/bank-reconciliations/:reconciliationId/report", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = idParamSchema.parse(request.params);
    const query = z
      .object({ revision: z.coerce.number().int().positive().optional() })
      .strict()
      .parse(request.query);
    return {
      report: await banking.reconciliationReport(context, params.reconciliationId!, query.revision)
    };
  });
}

function registerProductAnalyticsRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  analytics: ProductAnalyticsService
): void {
  app.post("/v1/product-events", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = productEventSchema.parse(request.body);
    await analytics.record(context, body);
    return reply.code(202).send({ recorded: true });
  });

  app.get("/v1/product-analytics/consent", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { consent: await analytics.consent(context) };
  });

  app.put("/v1/product-analytics/consent", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const body = productAnalyticsConsentSchema.parse(request.body);
    return { consent: await analytics.setConsent(context, body.enabled) };
  });

  app.get("/v1/product-events/summary", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { summary: await analytics.summary(context) };
  });
}

function requireOidc(service: OidcAuthenticationService | undefined): OidcAuthenticationService {
  if (!service) {
    throw new AppError("OIDC_UNAVAILABLE", "Production sign-in is not configured.", 503);
  }
  return service;
}

function assertSessionIdentity(
  identity: Awaited<ReturnType<IdentityAdapter["authenticate"]>>
): void {
  if (identity.authenticationMethod === "API_KEY") {
    throw new AppError(
      "API_KEY_SESSION_UNSUPPORTED",
      "API credentials must be revoked or rotated through the organization credential controls.",
      403
    );
  }
}

function publicIdentity(identity: Awaited<ReturnType<IdentityAdapter["authenticate"]>>) {
  return {
    id: identity.id,
    email: identity.email,
    displayName: identity.displayName,
    emailVerified: Boolean(identity.emailVerifiedAt),
    activeOrganizationId: identity.activeOrganizationId,
    recentAuthenticationAt: identity.recentAuthAt.toISOString(),
    mfaAuthenticated: identity.mfaAuthenticated
  };
}

interface SecurityOrigins {
  readonly appOrigin: string;
  readonly apiOrigin: string;
}

function resolveSecurityOrigins(production: boolean): SecurityOrigins {
  return {
    appOrigin: configuredOrigin("APP_BASE_URL", "http://localhost:3000", production),
    apiOrigin: configuredOrigin("API_BASE_URL", "http://localhost:3001", production)
  };
}

function configuredOrigin(name: string, fallback: string, production: boolean): string {
  const configured = process.env[name]?.trim();
  if (production && !configured) throw new Error(`${name} is required in production.`);
  let url: URL;
  try {
    url = new URL(configured || fallback);
  } catch {
    throw new Error(`${name} must be an absolute origin.`);
  }
  if (url.username || url.password || (production && url.protocol !== "https:"))
    throw new Error(`${name} must be an HTTPS origin without embedded credentials in production.`);
  return url.origin;
}

function configuredConnectorWebhookBaseUrl(): string | null {
  const configured = process.env.CONNECTOR_WEBHOOK_BASE_URL?.trim();
  if (!configured) return null;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("CONNECTOR_WEBHOOK_BASE_URL must be an absolute HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "CONNECTOR_WEBHOOK_BASE_URL must be an HTTPS origin without credentials, path, query, or hash."
    );
  return url.origin;
}

function exactRawRequestBody(rawBody: unknown, parsedBody: unknown): Buffer | null {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  return Buffer.isBuffer(parsedBody) ? parsedBody : null;
}

function setExactRawRequestBody(request: FastifyRequest, body: Buffer): void {
  (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
}

function getExactRawRequestBody(request: FastifyRequest): Buffer | string | undefined {
  return (request as FastifyRequest & { rawBody?: Buffer | string }).rawBody;
}

function isSignedWebhookPath(requestUrl: string): boolean {
  const path = requestUrl.split("?", 1)[0] ?? requestUrl;
  return (
    path === "/v1/webhooks/payments/stripe" ||
    path === "/v1/webhooks/payments/paypal" ||
    path.startsWith("/v1/webhooks/commerce/")
  );
}

function enforceBrowserRequestOrigin(request: FastifyRequest, origins: SecurityOrigins): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    return;
  }
  const hasSessionCookie = requestHeader(request, "cookie")?.includes("clearledger_session=");
  const hasBearer = requestHeader(request, "authorization")?.startsWith("Bearer ");
  if (!hasSessionCookie || hasBearer) {
    return;
  }
  const origin = requestHeader(request, "origin");
  const allowed = new Set([origins.appOrigin, origins.apiOrigin]);
  if (!origin || !allowed.has(origin)) {
    throw new AppError("CSRF_ORIGIN_INVALID", "The request origin is not allowed.", 403);
  }
}

function applyCors(request: FastifyRequest, reply: FastifyReply, appOrigin: string): void {
  const origin = requestHeader(request, "origin");
  if (origin === appOrigin) {
    reply.header("access-control-allow-origin", origin);
    reply.header("access-control-allow-credentials", "true");
    reply.header("vary", "Origin");
    reply.header(
      "access-control-allow-headers",
      "authorization,content-type,idempotency-key,x-export-token,x-file-name,x-request-id"
    );
    reply.header("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  }
}

function applySecurityHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  production: boolean
): void {
  const publicInvoice = request.url.startsWith("/public/invoices/");
  reply.header("x-request-id", request.id);
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=()");
  reply.header("cross-origin-opener-policy", "same-origin");
  reply.header("cross-origin-resource-policy", "same-origin");
  if (request.url === "/openapi.json" || request.url.startsWith("/v1/"))
    reply.header("x-clearledger-api-version", publicApiVersion);
  reply.header(
    "content-security-policy",
    publicInvoice
      ? "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      : "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  if (request.url.startsWith("/v1/auth/") || request.url.startsWith("/v1/exports/"))
    reply.header("cache-control", "no-store");
  if (production)
    reply.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
}

async function enforceRequestRateLimit(
  request: FastifyRequest,
  limiter: RequestRateLimiter
): Promise<void> {
  const path = request.url.split("?", 1)[0] ?? request.url;
  const policy = rateLimitPolicy(path);
  if (!policy) return;
  const credential = rateLimitCredential(request);
  const subject = credential
    ? `credential:${createHash("sha256").update(credential).digest("hex")}`
    : `public:${createHash("sha256")
        .update(`${request.ip}:${policy.scope === "public" ? path : ""}`)
        .digest("hex")}`;
  await limiter.check({ ...policy, key: subject });
}

function rateLimitCredential(request: FastifyRequest): string | undefined {
  const authorization = requestHeader(request, "authorization");
  if (authorization?.startsWith("Bearer ")) return authorization;
  const cookie = requestHeader(request, "cookie");
  const session = cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("clearledger_session="));
  return session;
}

function rateLimitPolicy(
  path: string
): { readonly scope: string; readonly limit: number; readonly windowMilliseconds: number } | null {
  if (/^\/v1\/auth\/(sign-in|recover|callback)/.test(path))
    return { scope: "authentication", limit: 20, windowMilliseconds: 10 * 60_000 };
  if (path === "/v1/oauth/token")
    return { scope: "oauth-token", limit: 30, windowMilliseconds: 10 * 60_000 };
  if (/^\/public\/invoices\/[^/]+\/(checkout-sessions|pay)/.test(path))
    return { scope: "public-checkout", limit: 12, windowMilliseconds: 10 * 60_000 };
  if (path.startsWith("/public/invoices/"))
    return { scope: "public", limit: 120, windowMilliseconds: 5 * 60_000 };
  if (path.startsWith("/v1/imports/"))
    return { scope: "imports", limit: 30, windowMilliseconds: 10 * 60_000 };
  if (path.startsWith("/v1/exports") || path.startsWith("/v1/organization-closure"))
    return { scope: "exports", limit: 20, windowMilliseconds: 10 * 60_000 };
  if (path.startsWith("/v1/reports/") || path.startsWith("/v1/audit"))
    return { scope: "reporting", limit: 120, windowMilliseconds: 10 * 60_000 };
  if (path.includes("/invitations"))
    return { scope: "invitations", limit: 20, windowMilliseconds: 10 * 60_000 };
  return null;
}

function securityClassification(statusCode: number): string {
  if (statusCode === 401) return "authentication_failure";
  if (statusCode === 403) return "authorization_or_csrf_denial";
  if (statusCode === 429) return "rate_limit_denial";
  if (statusCode >= 500) return "server_error";
  return "client_error";
}

function renderPublicReceiptHtml(receipt: {
  receiptNumber: string;
  createdAt: string;
  renderData: unknown;
}): string {
  const data = receipt.renderData as {
    paymentDate?: unknown;
    amountMinor?: unknown;
    currency?: unknown;
    methodCategory?: unknown;
    refundedMinor?: unknown;
    allocations?: unknown;
  };
  const text = (value: unknown) => escapeHtml(typeof value === "string" ? value : "");
  const allocations = Array.isArray(data.allocations)
    ? data.allocations
        .map((allocation) => {
          const row = allocation as {
            invoiceNumber?: unknown;
            amountMinor?: unknown;
            remainingMinor?: unknown;
          };
          return `<tr><td>${text(row.invoiceNumber)}</td><td>${text(row.amountMinor)}</td><td>${text(row.remainingMinor)}</td></tr>`;
        })
        .join("")
    : "";
  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>Receipt ${text(receipt.receiptNumber)}</title><style>body{font-family:Arial,sans-serif;margin:2rem;color:#151515}main{max-width:42rem;margin:auto}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;border-bottom:1px solid #bbb;text-align:left}@media print{body{margin:0}}</style></head><body><main><h1>Payment receipt</h1><p><strong>${text(receipt.receiptNumber)}</strong></p><dl><dt>Payment date</dt><dd>${text(data.paymentDate)}</dd><dt>Amount</dt><dd>${text(data.amountMinor)} ${text(data.currency)}</dd><dt>Method</dt><dd>${text(data.methodCategory)}</dd><dt>Refunded</dt><dd>${text(data.refundedMinor)} ${text(data.currency)}</dd></dl><table><thead><tr><th>Invoice</th><th>Applied</th><th>Remaining</th></tr></thead><tbody>${allocations}</tbody></table></main></body></html>`;
}

function renderPublicInvoicePaymentAction(
  invoiceHtml: string,
  token: string,
  payment: {
    eligible: boolean;
    captureRequired: boolean;
    outstandingMinor: string;
    currency: string;
    allowPartialPayments: boolean;
    minimumPartialMinor: string;
  },
  returnState?: "success" | "cancelled",
  paymentStatuses: readonly { status: string; amountMinor: string }[] = [],
  checkoutSessionId?: string,
  captureState?: "requested"
): string {
  const confirmed = paymentStatuses.some((item) =>
    ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"].includes(item.status)
  );
  const captureAction =
    returnState === "success" &&
    !confirmed &&
    captureState !== "requested" &&
    payment.captureRequired &&
    checkoutSessionId
      ? `<form action="/public/invoices/${encodeURIComponent(token)}/checkout-sessions/${encodeURIComponent(checkoutSessionId)}/capture" method="post"><button type="submit" style="min-height:44px;padding:.6rem 1rem;color:#fff;background:#17674f;border:0;border-radius:4px;font-weight:700">Complete payment</button></form>`
      : "";
  const returnPanel =
    returnState === "cancelled"
      ? `<section role="status" style="max-width:42rem;margin:2rem auto;padding:1.25rem;border-top:2px solid #9a6b16"><h2>Payment cancelled</h2><p>No payment was recorded from this checkout.</p></section>`
      : returnState === "success" && confirmed
        ? `<section role="status" style="max-width:42rem;margin:2rem auto;padding:1.25rem;border-top:2px solid #17674f"><h2>Payment confirmed</h2><p>The verified payment has been applied to this invoice.</p></section>`
        : returnState === "success" && captureState === "requested"
          ? `<section role="status" style="max-width:42rem;margin:2rem auto;padding:1.25rem;border-top:2px solid #9a6b16"><h2>Payment verification pending</h2><p>Capture has been requested. Payment will appear only after server verification.</p></section>`
          : returnState === "success"
            ? `<section role="status" style="max-width:42rem;margin:2rem auto;padding:1.25rem;border-top:2px solid #9a6b16"><h2>Payment verification pending</h2><p>The provider has returned you to this invoice. Payment will appear only after server verification.</p>${captureAction}</section>`
            : "";
  if (!payment.eligible)
    return invoiceHtml.includes("</body>")
      ? invoiceHtml.replace("</body>", `${returnPanel}</body>`)
      : `${invoiceHtml}${returnPanel}`;
  const action = `/public/invoices/${encodeURIComponent(token)}/pay`;
  const partial = payment.allowPartialPayments
    ? `<label>Payment amount in minor units<input name="partialAmountMinor" inputmode="numeric" pattern="[0-9]+" min="${escapeHtml(payment.minimumPartialMinor)}" max="${escapeHtml(payment.outstandingMinor)}"></label><p>Leave blank to pay the full balance.</p>`
    : "";
  const panel = `<section aria-labelledby="pay-invoice-heading" style="max-width:42rem;margin:2rem auto;padding:1.25rem;border-top:2px solid #17674f"><h2 id="pay-invoice-heading">Pay invoice</h2><p>Outstanding balance: <strong>${escapeHtml(payment.outstandingMinor)} ${escapeHtml(payment.currency)}</strong></p><form action="${action}" method="post">${partial}<button type="submit" style="min-height:44px;padding:.6rem 1rem;color:#fff;background:#17674f;border:0;border-radius:4px;font-weight:700">Continue to secure payment</button></form><p>Payment details are entered only on the payment provider's hosted checkout.</p></section>`;
  return invoiceHtml.includes("</body>")
    ? invoiceHtml.replace("</body>", `${returnPanel}${panel}</body>`)
    : `${invoiceHtml}${returnPanel}${panel}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character]!;
  });
}

function sendError(reply: FastifyReply, request: FastifyRequest, error: AppError): void {
  reply.status(error.statusCode).send({
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? {},
      requestId: request.id
    }
  });
}
