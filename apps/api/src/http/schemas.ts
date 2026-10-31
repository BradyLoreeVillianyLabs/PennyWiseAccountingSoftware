import { membershipRoles } from "@clearledger/shared";
import { z } from "zod";
import { customerAddressSchema } from "../services/customer-address.js";

export const accountTypeSchema = z.enum([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
  "CONTRA_ASSET",
  "CONTRA_REVENUE"
]);

export const dateStringSchema = z.string().min(10).max(30);
export const calendarQuerySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
  .strict();
export const idSchema = z.string().uuid();
export const minorUnitStringSchema = z.string().regex(/^\d+$/);
export const signedMinorUnitStringSchema = z.string().regex(/^-?\d+$/);
export const quantityStringSchema = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
export const nonEmptyStringSchema = z.string().trim().min(1);
export const roleSchema = z.enum(membershipRoles);

export const createOrganizationSchema = z.object({
  legalName: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema,
  currency: z.literal("CAD").default("CAD"),
  timezone: nonEmptyStringSchema.default("America/Edmonton")
});

export const demoCompanyCreateSchema = z
  .object({
    templateKey: z.literal("canadian-service").default("canadian-service")
  })
  .strict();

export const workflowPreferencesSchema = z
  .object({
    version: z.number().int().positive(),
    profileKey: z.enum([
      "INVOICING_ONLY",
      "SOLO_SERVICE",
      "PROJECT_TRADES",
      "BOOKKEEPER_MANAGED",
      "PRODUCT_OPERATIONS"
    ]),
    // Keep this additive for older desktop and API clients. When omitted, the
    // service preserves the organization's existing owner-workspace setting.
    ownerWorkspaceEnabled: z.boolean().optional(),
    // Additive for older desktop/API clients; omission preserves the current policy.
    bankFeedReviewRequired: z.boolean().optional(),
    cashPlanningEnabled: z.boolean(),
    purchaseRequestsEnabled: z.boolean(),
    purchaseApprovalThresholdMinor: minorUnitStringSchema,
    requireSeparatePurchaseApprover: z.boolean(),
    customerDepositsEnabled: z.boolean(),
    progressBillingEnabled: z.boolean(),
    fixedAssetRegisterEnabled: z.boolean(),
    payrollSummaryImportEnabled: z.boolean()
  })
  .strict();

export const multiCurrencySettingsSchema = z
  .object({
    version: z.number().int().positive(),
    enabled: z.boolean(),
    rateMode: z.enum(["MANUAL", "PROVIDER", "IMPORTED"]),
    currencies: z
      .array(z.string().regex(/^[A-Z]{3}$/))
      .min(1)
      .max(50)
      .refine((values) => new Set(values).size === values.length, "Currencies must be unique")
  })
  .strict();

export const fxRateSnapshotSchema = z
  .object({
    transactionCurrency: z.string().regex(/^[A-Z]{3}$/),
    rate: z.string().regex(/^\d+(?:\.\d+)?$/),
    effectiveAt: z.string().datetime({ offset: true }),
    method: z.literal("MANUAL").default("MANUAL"),
    purpose: z
      .enum(["TRANSACTION", "CLOSING", "AVERAGE", "ACTUAL_SETTLEMENT"])
      .default("TRANSACTION"),
    sourceReference: z.string().trim().min(1).max(200)
  })
  .strict();

export const fxRevaluationSchema = z
  .object({
    valuationDate: dateStringSchema,
    rateSnapshotIds: z.array(idSchema).min(1).max(10),
    post: z.boolean().default(false)
  })
  .strict();

export const createInvitationSchema = z.object({
  email: z.string().email(),
  role: roleSchema
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(256)
});

export const changeRoleSchema = z.object({
  role: roleSchema
});

export const switchOrganizationSchema = z.object({
  organizationId: idSchema
});

export const createCompanySchema = z
  .object({
    legalName: nonEmptyStringSchema.max(240),
    displayName: nonEmptyStringSchema.max(160),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .default("CAD"),
    timezone: nonEmptyStringSchema.max(80).default("America/Edmonton"),
    locale: nonEmptyStringSchema.max(20).default("en-CA"),
    fiscalYearEndMonth: z.number().int().min(1).max(12).nullable().optional(),
    fiscalYearEndDay: z.number().int().min(1).max(31).nullable().optional()
  })
  .strict();

export const updateCompanySchema = z
  .object({
    legalName: nonEmptyStringSchema.max(240).optional(),
    displayName: nonEmptyStringSchema.max(160).optional(),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    timezone: nonEmptyStringSchema.max(80).optional(),
    locale: nonEmptyStringSchema.max(20).optional()
  })
  .strict();

export const switchCompanySchema = z.object({
  companyId: idSchema
});

export const deleteCompanySchema = z
  .object({
    confirmation: nonEmptyStringSchema.max(160)
  })
  .strict();

export const intercompanyTransactionSchema = z
  .object({
    fromCompanyId: idSchema,
    toCompanyId: idSchema,
    amountMinor: minorUnitStringSchema,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    effectiveDate: dateStringSchema,
    sourceType: nonEmptyStringSchema.max(80),
    sourceId: nonEmptyStringSchema.max(240),
    description: nonEmptyStringSchema.max(500)
  })
  .strict();

export const intercompanyTransitionSchema = z
  .object({
    status: z.enum(["DRAFT", "PROPOSED", "APPROVED", "REJECTED"])
  })
  .strict();

export const consolidationGroupSchema = z
  .object({
    name: nonEmptyStringSchema.max(160),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    companyIds: z.array(idSchema).min(2).max(100)
  })
  .strict();

export const apiCredentialSchema = z
  .object({
    name: nonEmptyStringSchema.max(120),
    scopes: z.array(nonEmptyStringSchema.max(80)).max(20),
    expiresAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const oauthClientSchema = z
  .object({
    name: nonEmptyStringSchema.max(120),
    redirectUris: z.array(z.string().trim().min(1).max(2048)).min(1).max(10),
    allowedScopes: z.array(nonEmptyStringSchema.max(80)).max(20)
  })
  .strict();

export const oauthAuthorizationSchema = z
  .object({
    clientId: z.string().trim().min(1).max(128),
    redirectUri: z.string().trim().min(1).max(2048),
    scopes: z.array(nonEmptyStringSchema.max(80)).max(20),
    codeChallenge: z.string().trim().min(43).max(128),
    state: z.string().trim().max(512).optional(),
    consent: z.literal(true)
  })
  .strict();

export const oauthTokenSchema = z
  .object({
    grant_type: z.enum(["authorization_code", "refresh_token"]),
    client_id: z.string().trim().min(1).max(128),
    client_secret: z.string().trim().min(1).max(256),
    code: z.string().trim().min(1).max(256).optional(),
    redirect_uri: z.string().trim().min(1).max(2048).optional(),
    code_verifier: z.string().trim().min(43).max(128).optional(),
    refresh_token: z.string().trim().min(1).max(256).optional()
  })
  .strict();

export const connectorDraftSchema = z
  .object({
    providerKey: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,80}$/),
    displayName: nonEmptyStringSchema.max(120),
    mapping: z.record(z.unknown()).default({})
  })
  .strict();

export const connectorConnectSchema = z
  .object({
    credentials: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0),
    backfillStartAt: z.string().datetime({ offset: true }).optional(),
    backfillEndAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const connectorMappingSchema = z
  .object({
    version: z.number().int().positive(),
    mapping: z.record(z.unknown())
  })
  .strict();

export const connectorSyncSchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    maxPages: z.number().int().min(1).max(10).default(3),
    pageSize: z.number().int().min(1).max(100).optional(),
    scope: z.enum(["ORDERS", "SETTLEMENTS", "ALL"]).optional(),
    continuationToken: idSchema.optional()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.continuationToken && (input.from || input.to || input.scope))
      context.addIssue({
        code: "custom",
        message: "A continuation token resumes its original window and scope."
      });
  });

const catalogImageSchema = z
  .object({
    externalImageId: z.string().trim().min(1).max(200),
    remoteUrl: z.string().trim().url().max(2048),
    contentTypeHint: z.string().trim().max(120).nullable().optional(),
    byteLengthHint: z.string().regex(/^\d+$/).nullable().optional(),
    width: z.number().int().positive().max(100_000).nullable().optional(),
    height: z.number().int().positive().max(100_000).nullable().optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    safeMetadata: z.record(z.unknown()).optional()
  })
  .strict();

const catalogVariantSchema = z
  .object({
    externalVariantId: z.string().trim().min(1).max(200),
    externalReferenceAliases: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    name: nonEmptyStringSchema.max(500),
    sku: z.string().trim().max(200).nullable().optional(),
    gtin: z.string().trim().max(32).nullable().optional(),
    manufacturer: z.string().trim().max(200).nullable().optional(),
    manufacturerPartNumber: z.string().trim().max(200).nullable().optional(),
    variantSignature: z.record(z.string().max(500)).optional(),
    sourceStatus: z.string().trim().max(80).nullable().optional(),
    providerUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
    observedQuantityMicros: z
      .string()
      .regex(/^-?\d+$/)
      .nullable()
      .optional(),
    images: z.array(catalogImageSchema).max(100).optional(),
    safeMetadata: z.record(z.unknown()).optional()
  })
  .strict();

export const connectorCatalogIngestSchema = z
  .object({
    externalProductId: z.string().trim().min(1).max(200),
    name: nonEmptyStringSchema.max(500),
    description: z.string().trim().max(20_000).nullable().optional(),
    sourceStatus: z.string().trim().max(80).nullable().optional(),
    sourceUrl: z.string().trim().url().max(2048).nullable().optional(),
    providerUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
    images: z.array(catalogImageSchema).max(100).optional(),
    variants: z.array(catalogVariantSchema).min(1).max(1_000)
  })
  .strict();

export const connectorCatalogPollSchema = z
  .object({
    maxPages: z.number().int().min(1).max(25).default(5),
    pageSize: z.number().int().min(1).max(25).default(10),
    restart: z.boolean().default(false)
  })
  .strict();

export const catalogCandidateDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().max(1_000).optional()
  })
  .strict();

export const catalogSkuAliasApprovalSchema = z
  .object({
    sourceSku: z.string().trim().min(1).max(200),
    productItemId: idSchema,
    quantityMultiplierMicros: z
      .string()
      .regex(/^[1-9]\d{0,17}$/)
      .optional(),
    unitOfMeasure: z.string().trim().max(40).optional(),
    reason: z.string().trim().max(500).optional()
  })
  .strict();

export const catalogSkuPatternApprovalSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    prefix: z.string().trim().min(1).max(80).optional(),
    suffix: z.string().trim().min(1).max(80).optional(),
    caseSensitive: z.boolean().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    quantityMultiplierMicros: z
      .string()
      .regex(/^[1-9]\d{0,17}$/)
      .optional(),
    examples: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    reason: z.string().trim().max(500).optional()
  })
  .strict()
  .refine((input) => Boolean(input.prefix || input.suffix), {
    message: "A prefix or suffix is required."
  });

export const inventorySyncPolicySchema = z
  .object({
    installationId: idSchema,
    catalogVariantId: idSchema,
    productItemId: idSchema,
    locationId: idSchema,
    sourceOfTruth: z.enum(["LOCAL", "CHANNEL", "MANUAL_REVIEW"]),
    desiredQuantityMicros: z
      .string()
      .regex(/^-?\d+$/)
      .nullable()
      .optional(),
    enabled: z.boolean(),
    version: z.number().int().positive().optional()
  })
  .strict();

export const inventorySyncObservationSchema = z
  .object({
    externalObservationId: z.string().trim().min(1).max(200),
    observedQuantityMicros: z.string().regex(/^-?\d+$/),
    desiredQuantityMicros: z
      .string()
      .regex(/^-?\d+$/)
      .nullable()
      .optional(),
    providerObservedAt: z.string().datetime({ offset: true }).nullable().optional(),
    safeMetadata: z.record(z.unknown()).optional()
  })
  .strict();

export const inventorySyncConflictResolutionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("IGNORE"),
      version: z.number().int().positive(),
      reason: nonEmptyStringSchema.max(1_000)
    })
    .strict(),
  z
    .object({
      action: z.literal("PUSH_LOCAL_TO_CHANNEL"),
      version: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      action: z.literal("ADOPT_CHANNEL_LOCALLY"),
      version: z.number().int().positive(),
      effectiveDate: dateStringSchema,
      reason: nonEmptyStringSchema.max(1_000),
      unitCostMinor: minorUnitStringSchema.optional()
    })
    .strict()
]);

export const catalogImageDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().max(500).optional()
  })
  .strict();

export const connectorWebhookRegistrationSchema = z
  .object({ deliveryUrl: z.string().trim().url().max(2048) })
  .strict();

export const connectorWebhookSecretSchema = z
  .object({ signingSecret: z.string().trim().min(24).max(1024) })
  .strict();

export const etsyOAuthStartSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(256),
    sharedSecret: z.string().trim().min(1).max(512),
    shopId: z.string().trim().min(1).max(200).optional(),
    redirectUri: z.string().trim().url().max(2048)
  })
  .strict();

export const etsyOAuthCompleteSchema = z
  .object({
    code: z.string().trim().min(1).max(2048),
    state: z.string().trim().min(32).max(512)
  })
  .strict();

const commerceNormalizationIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
    severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
    path: z.string().trim().max(300).optional(),
    externalRef: z.string().trim().max(200).optional()
  })
  .strict();

export const commerceInboxEventSchema = z
  .object({
    installationId: idSchema,
    providerKey: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{2,80}$/),
    shopExternalId: z.string().trim().min(1).max(200),
    externalEventId: z.string().trim().min(1).max(200),
    resourceType: z.string().trim().min(1).max(80),
    resourceId: z.string().trim().min(1).max(200),
    eventType: z.string().trim().min(1).max(120),
    eventVersion: z.string().trim().max(80).nullable().optional(),
    occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
    sourceCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    paymentCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    settlementCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    rawPayload: z.record(z.unknown()),
    normalizedPayload: z.record(z.unknown()).nullable().optional(),
    normalizedSchemaVersion: z.literal(1).optional(),
    normalizationIssues: z.array(commerceNormalizationIssueSchema).max(500).optional(),
    mappingVersion: z.number().int().positive().max(1000).optional()
  })
  .strict();

export const commerceInboxReviewSchema = z
  .object({
    status: z.enum(["REVIEW_REQUIRED", "NORMALIZED", "DEAD_LETTER"]),
    normalizedPayload: z.record(z.unknown()).nullable().optional(),
    reviewNote: z.string().trim().max(2000).nullable().optional()
  })
  .strict();

const commerceOrderCustomerSchema = z
  .object({
    customerNumber: nonEmptyStringSchema.max(40).regex(/^[A-Za-z0-9-]+$/),
    displayName: nonEmptyStringSchema.max(200),
    legalName: z.string().trim().max(200).nullable().optional(),
    email: z.string().email().nullable().optional(),
    telephone: z.string().trim().max(40).nullable().optional(),
    defaultPaymentTermsDays: z.number().int().min(0).max(365).default(30),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("CAD"),
    addresses: z.array(customerAddressSchema).min(1).max(10)
  })
  .strict();

export const commerceOrderConversionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("CONFIRM"),
      version: z.number().int().positive(),
      customerId: idSchema.optional(),
      customer: commerceOrderCustomerSchema.optional(),
      fxRateSnapshotId: idSchema.optional()
    })
    .strict(),
  z
    .object({
      decision: z.literal("REJECT"),
      version: z.number().int().positive(),
      reason: nonEmptyStringSchema.max(2_000)
    })
    .strict()
]);

export const commerceOrderBatchConversionSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            eventId: idSchema,
            decision: z.literal("CONFIRM"),
            version: z.number().int().positive(),
            customerId: idSchema.optional(),
            customer: commerceOrderCustomerSchema.optional(),
            fxRateSnapshotId: idSchema.optional()
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict();

export const webhookEndpointSchema = z
  .object({
    name: nonEmptyStringSchema.max(120),
    url: z.string().trim().min(1).max(2048),
    eventTypes: z.array(nonEmptyStringSchema.max(160)).min(1).max(50)
  })
  .strict();

export const webhookDisableSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

export const createAccountSchema = z.object({
  code: nonEmptyStringSchema.max(32),
  name: nonEmptyStringSchema.max(200),
  type: accountTypeSchema,
  subtype: z.string().trim().min(1).max(100).optional(),
  isControl: z.boolean().default(false)
});

export const patchAccountSchema = z.object({
  name: nonEmptyStringSchema.max(200).optional(),
  subtype: z.string().trim().min(1).max(100).nullable().optional()
});

export const createFiscalPeriodSchema = z.object({
  name: nonEmptyStringSchema.max(120),
  startDate: dateStringSchema,
  endDate: dateStringSchema
});

export const reasonSchema = z.object({
  reason: nonEmptyStringSchema.max(500).optional()
});

export const reopenPeriodSchema = z.object({
  reason: nonEmptyStringSchema.max(500)
});

export const journalLineSchema = z.object({
  accountId: idSchema,
  description: z.string().trim().min(1).max(500).optional(),
  debitMinor: minorUnitStringSchema.default("0"),
  creditMinor: minorUnitStringSchema.default("0"),
  transactionMinor: signedMinorUnitStringSchema.optional()
});

export const postJournalSchema = z.object({
  description: nonEmptyStringSchema.max(500),
  effectiveDate: dateStringSchema,
  sourceType: nonEmptyStringSchema.max(80),
  sourceId: nonEmptyStringSchema.max(120),
  postingKey: nonEmptyStringSchema.max(160),
  transactionCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  fxRateSnapshotId: idSchema.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  allowControlAccountPosting: z.boolean().default(false),
  lines: z.array(journalLineSchema).min(2)
});

export const manualJournalDraftSchema = z
  .object({
    description: nonEmptyStringSchema.max(500),
    effectiveDate: dateStringSchema,
    reason: nonEmptyStringSchema.max(500),
    allowControlAccountPosting: z.boolean().default(false),
    lines: z.array(journalLineSchema).min(2).max(500)
  })
  .strict();

export const manualJournalDraftUpdateSchema = manualJournalDraftSchema
  .extend({ version: z.number().int().positive() })
  .strict();

export const manualJournalDraftCancelSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

export const closePeriodSchema = z
  .object({
    reason: nonEmptyStringSchema.max(500),
    acknowledgeWarnings: z.boolean().default(false)
  })
  .strict();

export const reverseJournalSchema = z.object({
  effectiveDate: dateStringSchema,
  reason: nonEmptyStringSchema.max(500)
});

const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const documentNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/)
  .nullable()
  .optional();
const addressSchema = z
  .object({
    line1: nonEmptyStringSchema.max(200),
    line2: optionalText(200),
    city: nonEmptyStringSchema.max(120),
    province: nonEmptyStringSchema.max(80),
    postalCode: z.string().trim().min(3).max(20),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.country === "CA" && !/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(value.postalCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postalCode"],
        message: "Canadian postal code is invalid."
      });
    }
  });

const contactSchema = z
  .object({
    name: nonEmptyStringSchema.max(120),
    email: z.string().email().optional(),
    telephone: z.string().trim().max(40).optional()
  })
  .strict();

export const createCustomerSchema = z
  .object({
    customerNumber: nonEmptyStringSchema
      .max(40)
      .regex(/^[A-Za-z0-9-]+$/)
      .nullable()
      .optional(),
    legalName: optionalText(200),
    displayName: nonEmptyStringSchema.max(200),
    primaryContact: optionalText(120),
    additionalContacts: z.array(contactSchema).max(20).optional(),
    addresses: z.array(customerAddressSchema).max(50).optional(),
    billingAddress: customerAddressSchema.nullable().optional(),
    shippingAddress: customerAddressSchema.nullable().optional(),
    serviceAddress: customerAddressSchema.nullable().optional(),
    email: z.string().email().nullable().optional(),
    documentLanguage: z.enum(["en-CA", "fr-CA", "BILINGUAL"]).nullable().optional(),
    telephone: z.string().trim().max(40).nullable().optional(),
    website: z.string().url().nullable().optional(),
    taxRegistrationIdentifiers: z
      .record(z.string().trim().max(40), z.string().trim().max(80))
      .optional(),
    defaultPaymentTermsDays: z.number().int().min(0).max(365).default(30),
    defaultTaxCodeId: idSchema.nullable().optional(),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("CAD"),
    internalNotes: optionalText(4000),
    reminderDisabled: z.boolean().optional(),
    reminderTone: z.enum(["FRIENDLY", "FIRM"]).nullable().optional(),
    reminderOffsets: z.array(z.number().int().min(-90).max(365)).max(12).nullable().optional()
  })
  .strict();

export const updateCustomerSchema = createCustomerSchema
  .partial()
  .extend({
    customerNumber: nonEmptyStringSchema
      .max(40)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    version: z.number().int().positive()
  })
  .strict();

export const createProductSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .max(80)
      .regex(/^[A-Za-z0-9._-]+$/)
      .nullable()
      .optional(),
    gtin: z.string().trim().max(32).nullable().optional(),
    manufacturer: z.string().trim().max(200).nullable().optional(),
    manufacturerPartNumber: z.string().trim().max(200).nullable().optional(),
    name: nonEmptyStringSchema.max(200),
    description: optionalText(2000),
    itemType: z.enum([
      "SERVICE",
      "NON_INVENTORY_PRODUCT",
      "INVENTORY_PRODUCT",
      "DISCOUNT",
      "SHIPPING"
    ]),
    salesPriceMinor: minorUnitStringSchema,
    purchaseCostMinor: minorUnitStringSchema.nullable().optional(),
    incomeAccountId: idSchema,
    expenseAccountId: idSchema.nullable().optional(),
    inventoryAssetAccountId: idSchema.nullable().optional(),
    costOfGoodsSoldAccountId: idSchema.nullable().optional(),
    purchaseClearingAccountId: idSchema.nullable().optional(),
    adjustmentGainAccountId: idSchema.nullable().optional(),
    inventoryLossAccountId: idSchema.nullable().optional(),
    defaultLocationId: idSchema.nullable().optional(),
    reorderPointMicros: minorUnitStringSchema.default("0"),
    safetyStockMicros: minorUnitStringSchema.default("0"),
    preferredStockMicros: minorUnitStringSchema.default("0"),
    leadTimeDays: z.number().int().min(0).max(3650).default(0),
    orderMultipleMicros: minorUnitStringSchema.default("0"),
    minimumOrderMicros: minorUnitStringSchema.default("0"),
    inventoryCostingMethod: z.literal("WEIGHTED_AVERAGE").default("WEIGHTED_AVERAGE"),
    preferredVendorId: idSchema.nullable().optional(),
    defaultTaxCodeId: idSchema.nullable().optional(),
    unitOfMeasure: optionalText(40),
    productImageReference: optionalText(500),
    hsTariffCode: z
      .string()
      .trim()
      .max(20)
      .regex(/^\d{4,12}$/)
      .nullable()
      .optional(),
    countryOfOrigin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional()
  })
  .strict();

export const catalogCreateLocalProductSchema = createProductSchema
  .partial({ sku: true, name: true })
  .strict();

/**
 * Creates local inventory item definitions from a user-selected set of
 * observed channel variants. It intentionally excludes source identity and
 * image fields: the service derives those from the reviewed source evidence.
 */
export const catalogBulkCreateLocalProductsSchema = z
  .object({
    catalogVariantIds: z
      .array(idSchema)
      .min(1)
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        "Catalog variants must be unique"
      ),
    itemType: z.literal("INVENTORY_PRODUCT"),
    salesPriceMinor: minorUnitStringSchema,
    purchaseCostMinor: minorUnitStringSchema.nullable().optional(),
    incomeAccountId: idSchema,
    inventoryAssetAccountId: idSchema,
    costOfGoodsSoldAccountId: idSchema,
    purchaseClearingAccountId: idSchema,
    adjustmentGainAccountId: idSchema,
    inventoryLossAccountId: idSchema,
    defaultLocationId: idSchema,
    reorderPointMicros: minorUnitStringSchema.default("0"),
    safetyStockMicros: minorUnitStringSchema.default("0"),
    preferredStockMicros: minorUnitStringSchema.default("0"),
    leadTimeDays: z.number().int().min(0).max(3650).default(0),
    orderMultipleMicros: minorUnitStringSchema.default("0"),
    minimumOrderMicros: minorUnitStringSchema.default("0"),
    inventoryCostingMethod: z.literal("WEIGHTED_AVERAGE").default("WEIGHTED_AVERAGE"),
    preferredVendorId: idSchema.nullable().optional(),
    defaultTaxCodeId: idSchema.nullable().optional(),
    unitOfMeasure: optionalText(40),
    hsTariffCode: z
      .string()
      .trim()
      .max(20)
      .regex(/^\d{4,12}$/)
      .nullable()
      .optional(),
    countryOfOrigin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    attachFirstIngestedImage: z.boolean().default(true),
    /** An explicit user decision, never a fuzzy-match automation. */
    confirmMappings: z.boolean().default(false)
  })
  .strict();

export const updateProductSchema = createProductSchema
  .partial()
  .extend({
    version: z.number().int().positive()
  })
  .strict();

export const inventoryBarcodeSymbologySchema = z.enum([
  "AUTO",
  "CODE128",
  "CODE39",
  "EAN8",
  "EAN13",
  "UPC_A",
  "UPC_E",
  "ITF14",
  "QR",
  "DATA_MATRIX"
]);

export const inventoryBarcodeRegisterSchema = z
  .object({
    productItemId: idSchema,
    code: z.string().trim().min(1).max(200),
    symbology: inventoryBarcodeSymbologySchema.default("AUTO"),
    source: optionalText(80),
    isPrimary: z.boolean().default(false)
  })
  .strict();

export const inventoryScanResolveSchema = z
  .object({
    code: z.string().trim().min(1).max(200),
    captureMode: z.enum(["MANUAL", "HARDWARE", "CAMERA"]),
    symbology: inventoryBarcodeSymbologySchema.optional()
  })
  .strict();

export const inventoryLabelTemplateSchema = z
  .object({
    name: nonEmptyStringSchema.max(120),
    symbology: inventoryBarcodeSymbologySchema.exclude(["AUTO"]),
    widthMmMicros: z.string().regex(/^\d+$/),
    heightMmMicros: z.string().regex(/^\d+$/),
    fields: z
      .array(
        z.enum([
          "SKU",
          "NAME",
          "BARCODE",
          "GTIN",
          "MANUFACTURER_PART_NUMBER",
          "PRICE",
          "LOT",
          "SERIAL",
          "LOCATION"
        ])
      )
      .min(1)
      .max(9),
    isDefault: z.boolean().default(false)
  })
  .strict();

export const inventoryLabelPreviewSchema = z
  .object({
    productItemId: idSchema,
    barcodeId: idSchema.optional(),
    lot: optionalText(120),
    serial: optionalText(120),
    location: optionalText(120)
  })
  .strict();

export const invoiceLineInputSchema = z
  .object({
    productItemId: idSchema.nullable().optional(),
    description: nonEmptyStringSchema.max(500).optional(),
    quantity: quantityStringSchema,
    unitPriceMinor: minorUnitStringSchema.optional(),
    discountMinor: minorUnitStringSchema.default("0"),
    taxCodeId: idSchema.nullable().optional()
  })
  .strict();

export const createInvoiceSchema = z
  .object({
    customerId: idSchema,
    issueDate: dateStringSchema,
    dueDate: dateStringSchema.optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("CAD"),
    fxRateSnapshotId: idSchema.optional(),
    lines: z.array(invoiceLineInputSchema).min(1).max(500),
    customerFacingNotes: optionalText(4000),
    internalNotes: optionalText(4000),
    terms: optionalText(4000),
    paymentMethodSelection: z
      .array(z.enum(["E_TRANSFER", "EFT", "CHEQUE", "PAY_ONLINE", "CASH", "OTHER"]))
      .max(6)
      .optional()
  })
  .strict();

export const createEstimateSchema = z
  .object({
    customerId: idSchema,
    issueDate: dateStringSchema,
    expiryDate: dateStringSchema.nullable().optional(),
    estimateNumber: documentNumberSchema,
    currency: z.literal("CAD").default("CAD"),
    lines: z.array(invoiceLineInputSchema).min(1).max(500),
    customerFacingNotes: optionalText(4000),
    internalNotes: optionalText(4000),
    terms: optionalText(4000)
  })
  .strict();

export const updateEstimateSchema = createEstimateSchema
  .omit({ estimateNumber: true })
  .extend({
    version: z.number().int().positive()
  })
  .strict();

export const estimateTransitionSchema = z
  .object({
    version: z.number().int().positive(),
    reason: optionalText(500)
  })
  .strict();

export const estimateConvertSchema = z
  .object({
    version: z.number().int().positive(),
    issueDate: dateStringSchema.optional()
  })
  .strict();

export const createRecurringScheduleSchema = z
  .object({
    scheduleType: z.enum(["INVOICE", "BILL"]),
    customerId: idSchema.nullable().optional(),
    frequency: z.enum(["WEEK", "MONTH", "YEAR"]),
    interval: z.number().int().min(1).max(120).default(1),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    timeZone: nonEmptyStringSchema.max(80).default("America/Edmonton"),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    missedOccurrencePolicy: z.enum(["EVERY", "LATEST"]).default("EVERY"),
    invoiceMode: z.enum(["DRAFT", "FINALIZE", "SEND"]).default("DRAFT"),
    template: z.record(z.string(), z.unknown())
  })
  .strict();

export const patchRecurringScheduleSchema = createRecurringScheduleSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();

export const createProjectSchema = z
  .object({
    customerId: idSchema,
    projectNumber: nonEmptyStringSchema.max(40).regex(/^[A-Za-z0-9-]+$/),
    name: nonEmptyStringSchema.max(200),
    description: optionalText(4000),
    billingMethod: z
      .enum(["FIXED", "TIME_AND_MATERIALS", "NON_BILLABLE"])
      .default("TIME_AND_MATERIALS"),
    startDate: dateStringSchema.nullable().optional(),
    endDate: dateStringSchema.nullable().optional(),
    budgetMinor: minorUnitStringSchema.nullable().optional(),
    tags: z.array(nonEmptyStringSchema.max(40)).max(20).default([])
  })
  .strict();

export const updateProjectSchema = createProjectSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();

export const projectWorkItemKindSchema = z.enum([
  "TASK",
  "MILESTONE",
  "REMINDER",
  "MEETING",
  "APPOINTMENT",
  "FOLLOW_UP"
]);
export const projectWorkItemStatusSchema = z.enum([
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED"
]);
export const projectWorkItemPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const projectWorkItemDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createProjectWorkItemSchema = z
  .object({
    kind: projectWorkItemKindSchema,
    title: nonEmptyStringSchema.max(240),
    description: optionalText(4000),
    status: projectWorkItemStatusSchema.optional(),
    priority: projectWorkItemPrioritySchema.optional(),
    projectId: idSchema.nullable().optional(),
    customerId: idSchema.nullable().optional(),
    contactId: idSchema.nullable().optional(),
    assigneeMembershipId: idSchema.nullable().optional(),
    eventType: nonEmptyStringSchema.max(80).optional(),
    customStatus: optionalText(80),
    category: optionalText(80),
    label: optionalText(80),
    location: optionalText(500),
    startAt: z.string().datetime({ offset: true }).nullable().optional(),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    relatedResourceType: z.enum(["PROJECT", "INVOICE", "ESTIMATE", "BILL"]).nullable().optional(),
    relatedResourceId: idSchema.nullable().optional(),
    startDate: projectWorkItemDateSchema.nullable().optional(),
    dueDate: projectWorkItemDateSchema.nullable().optional()
  })
  .strict();

export const updateProjectWorkItemSchema = createProjectWorkItemSchema
  .omit({ status: true })
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();

export const projectWorkItemListSchema = z
  .object({
    projectId: idSchema.optional(),
    customerId: idSchema.optional(),
    contactId: idSchema.optional(),
    assigneeMembershipId: idSchema.optional(),
    kind: projectWorkItemKindSchema.optional(),
    status: projectWorkItemStatusSchema.optional(),
    eventType: z.string().trim().min(1).max(80).optional(),
    customStatus: z.string().trim().min(1).max(80).optional(),
    includeArchived: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional()
  })
  .strict();

export const createCustomerContactSchema = z
  .object({
    name: nonEmptyStringSchema.max(200),
    role: optionalText(120),
    email: z.string().email().nullable().optional(),
    telephone: z.string().trim().max(40).nullable().optional(),
    preferredChannel: optionalText(80),
    notes: optionalText(4000)
  })
  .strict();

export const updateCustomerContactSchema = createCustomerContactSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();

export const createCustomerActivitySchema = z
  .object({
    activityType: nonEmptyStringSchema.max(80).default("NOTE"),
    category: optionalText(80),
    subject: optionalText(240),
    body: nonEmptyStringSchema.max(10_000),
    happenedAt: z.string().datetime({ offset: true }).optional(),
    contactId: idSchema.nullable().optional(),
    relatedResourceType: z.enum(["PROJECT", "INVOICE", "ESTIMATE", "BILL"]).nullable().optional(),
    relatedResourceId: idSchema.nullable().optional()
  })
  .strict();

export const projectWorkItemStatusCommandSchema = z
  .object({
    status: projectWorkItemStatusSchema,
    version: z.number().int().positive()
  })
  .strict();

export const projectWorkItemDependencySchema = z
  .object({
    dependsOnItemId: idSchema,
    version: z.number().int().positive()
  })
  .strict();

export const createTimeEntrySchema = z
  .object({
    entryDate: dateStringSchema,
    durationMicros: minorUnitStringSchema,
    rateMinor: minorUnitStringSchema,
    description: optionalText(2000),
    billable: z.boolean().default(true),
    startedAt: z.string().datetime({ offset: true }).nullable().optional(),
    endedAt: z.string().datetime({ offset: true }).nullable().optional()
  })
  .strict();

export const updateTimeEntrySchema = createTimeEntrySchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();

export const createMileageSchema = z
  .object({
    projectId: idSchema.nullable().optional(),
    entryDate: dateStringSchema,
    purpose: nonEmptyStringSchema.max(500),
    distanceMicros: minorUnitStringSchema,
    vehicleLabel: optionalText(120),
    reimbursementRateMinor: minorUnitStringSchema,
    attachmentReference: optionalText(500)
  })
  .strict();

export const createCaptureReviewSchema = z
  .object({
    projectId: idSchema.nullable().optional(),
    kind: z.enum(["RECEIPT", "BILL"]),
    storageKey: nonEmptyStringSchema.max(500),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: nonEmptyStringSchema.max(120),
    byteSize: z.number().int().positive().max(25_000_000),
    scanStatus: z.enum(["PENDING", "CLEAN", "REJECTED"]),
    ocrProvider: optionalText(120),
    ocrVersion: optionalText(80),
    ocrConfidence: z.number().min(0).max(1).nullable().optional(),
    extractedData: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .strict();

export const reviewCaptureSchema = z
  .object({
    status: z.enum(["REVIEW_REQUIRED", "APPROVED", "REJECTED"]),
    reviewNotes: optionalText(2000),
    version: z.number().int().positive().optional()
  })
  .strict();

const capturePurchaseLineSchema = z
  .object({
    description: nonEmptyStringSchema.max(500),
    quantity: quantityStringSchema,
    unitCostMinor: minorUnitStringSchema,
    discountMinor: minorUnitStringSchema.optional(),
    accountId: idSchema,
    productItemId: idSchema.nullable().optional(),
    taxCodeId: idSchema.nullable().optional()
  })
  .strict();

const captureBillDraftSchema = z
  .object({
    vendorId: idSchema,
    vendorInvoiceNumber: nonEmptyStringSchema.max(128),
    issueDate: dateStringSchema,
    dueDate: dateStringSchema.optional(),
    paymentTermsDays: z.number().int().min(0).max(3650).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("CAD"),
    fxRateSnapshotId: idSchema.optional(),
    internalNotes: optionalText(10_000),
    lines: z.array(capturePurchaseLineSchema).min(1).max(500)
  })
  .strict();

const captureImmediateExpenseDraftSchema = z
  .object({
    vendorId: idSchema.nullable().optional(),
    reference: optionalText(128),
    expenseDate: dateStringSchema,
    method: z.enum(["CASH", "CHEQUE", "ELECTRONIC_TRANSFER", "CREDIT_CARD", "OWNER_PAID", "OTHER"]),
    payingAccountId: idSchema,
    internalNotes: optionalText(10_000),
    lines: z.array(capturePurchaseLineSchema).min(1).max(500)
  })
  .strict();

export const captureReviewConversionSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("BILL"),
      version: z.number().int().positive(),
      bill: captureBillDraftSchema
    })
    .strict(),
  z
    .object({
      target: z.literal("IMMEDIATE_EXPENSE"),
      version: z.number().int().positive(),
      expense: captureImmediateExpenseDraftSchema
    })
    .strict()
]);

export const budgetPlanSchema = z
  .object({
    name: nonEmptyStringSchema.max(120),
    periodType: z.enum(["WEEK", "MONTH"]),
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    lines: z
      .array(
        z
          .object({
            accountId: idSchema,
            periodStart: dateStringSchema,
            plannedMinor: minorUnitStringSchema,
            note: optionalText(500)
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict();

export const cashForecastAssumptionSchema = z
  .object({
    weekStart: dateStringSchema,
    label: nonEmptyStringSchema.max(160),
    direction: z.enum(["INFLOW", "OUTFLOW"]),
    amountMinor: minorUnitStringSchema,
    note: optionalText(500)
  })
  .strict();

export const purchaseRequestSchema = z
  .object({
    requestNumber: nonEmptyStringSchema.max(40).regex(/^[A-Za-z0-9-]+$/),
    vendorId: idSchema.nullable().optional(),
    requestedDate: dateStringSchema,
    neededByDate: dateStringSchema.nullable().optional(),
    purpose: nonEmptyStringSchema.max(1000),
    lines: z
      .array(
        z
          .object({
            description: nonEmptyStringSchema.max(500),
            quantity: quantityStringSchema,
            unitCostMinor: minorUnitStringSchema,
            accountId: idSchema.nullable().optional()
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict();

export const versionSchema = z.object({ version: z.number().int().positive() }).strict();

export const purchaseRequestDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    decisionNote: optionalText(1000)
  })
  .strict();

export const customerDepositRequestSchema = z
  .object({
    requestNumber: nonEmptyStringSchema.max(40).regex(/^[A-Za-z0-9-]+$/),
    customerId: idSchema,
    estimateId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    classification: z.enum(["REFUNDABLE_DEPOSIT", "ADVANCE_PAYMENT"]),
    requestDate: dateStringSchema,
    dueDate: dateStringSchema.nullable().optional(),
    amountMinor: minorUnitStringSchema,
    currency: z.literal("CAD").default("CAD"),
    purpose: nonEmptyStringSchema.max(1000),
    customerMessage: optionalText(2000)
  })
  .strict();

const progressMilestoneSchema = z
  .object({
    name: nonEmptyStringSchema.max(160),
    customerDescription: optionalText(1000),
    dueDate: dateStringSchema.nullable().optional(),
    basis: z.enum(["PERCENT_OF_ESTIMATE", "FIXED_SUBTOTAL", "REMAINING_BALANCE"]),
    ratioMicros: minorUnitStringSchema.nullable().optional(),
    fixedSubtotalMinor: minorUnitStringSchema.nullable().optional()
  })
  .strict()
  .superRefine((milestone, context) => {
    if (
      milestone.basis === "PERCENT_OF_ESTIMATE" &&
      (milestone.ratioMicros == null || milestone.fixedSubtotalMinor != null)
    )
      context.addIssue({
        code: "custom",
        message: "Percentage milestones require ratioMicros only."
      });
    if (
      milestone.basis === "FIXED_SUBTOTAL" &&
      (milestone.fixedSubtotalMinor == null || milestone.ratioMicros != null)
    )
      context.addIssue({
        code: "custom",
        message: "Fixed milestones require fixedSubtotalMinor only."
      });
    if (
      milestone.basis === "REMAINING_BALANCE" &&
      (milestone.ratioMicros != null || milestone.fixedSubtotalMinor != null)
    )
      context.addIssue({
        code: "custom",
        message: "Remaining-balance milestones cannot specify a ratio or amount."
      });
  });

export const progressBillingPlanSchema = z
  .object({
    planNumber: nonEmptyStringSchema.max(40).regex(/^[A-Za-z0-9-]+$/),
    projectId: idSchema.nullable().optional(),
    notes: optionalText(2000),
    milestones: z.array(progressMilestoneSchema).min(1).max(100)
  })
  .strict();

export const nonPostingWorkflowCommandSchema = z
  .object({
    version: z.number().int().positive(),
    reason: optionalText(1000)
  })
  .strict();

const bookDepreciationMethodSchema = z.enum(["NONE", "STRAIGHT_LINE"]);
const bookDepreciationConventionSchema = z.enum(["FULL_MONTH", "NEXT_MONTH"]);
const fixedAssetLedgerTreatmentSchema = z.enum([
  "UNDECIDED",
  "ALREADY_RECORDED",
  "OPENING_BALANCE",
  "RECLASSIFICATION_REQUIRED"
]);

export const fixedAssetClassSchema = z
  .object({
    code: nonEmptyStringSchema.max(40).regex(/^[A-Za-z0-9_-]+$/),
    name: nonEmptyStringSchema.max(200),
    description: optionalText(1000),
    defaultBookMethod: bookDepreciationMethodSchema,
    defaultBookConvention: bookDepreciationConventionSchema.nullable().optional(),
    defaultUsefulLifeMonths: z.number().int().min(1).max(1200).nullable().optional(),
    defaultResidualRatioMicros: minorUnitStringSchema.nullable().optional(),
    defaultAssetAccountId: idSchema.nullable().optional(),
    defaultAccumulatedAccountId: idSchema.nullable().optional(),
    defaultDepreciationExpenseId: idSchema.nullable().optional(),
    defaultDisposalGainAccountId: idSchema.nullable().optional(),
    defaultDisposalLossAccountId: idSchema.nullable().optional()
  })
  .strict();

export const fixedAssetCreateSchema = z
  .object({
    fixedAssetClassId: idSchema,
    assetNumber: nonEmptyStringSchema.max(40).regex(/^[A-Za-z0-9_-]+$/),
    name: nonEmptyStringSchema.max(200),
    description: optionalText(1000),
    acquiredOn: dateStringSchema,
    inServiceOn: dateStringSchema,
    acquisitionCostMinor: minorUnitStringSchema,
    residualValueMinor: minorUnitStringSchema.nullable().optional(),
    openingAccumulatedDepreciationMinor: minorUnitStringSchema.optional(),
    openingBalanceDate: dateStringSchema.nullable().optional(),
    remainingUsefulLifeMonths: z.number().int().min(1).max(1200).nullable().optional(),
    bookMethod: bookDepreciationMethodSchema.optional(),
    bookConvention: bookDepreciationConventionSchema.nullable().optional(),
    usefulLifeMonths: z.number().int().min(1).max(1200).nullable().optional(),
    ledgerTreatment: fixedAssetLedgerTreatmentSchema,
    sourceKind: z.literal("MANUAL_REFERENCE").optional(),
    sourceReference: nonEmptyStringSchema.max(500),
    assetAccountId: idSchema.nullable().optional(),
    accumulatedDepreciationAccountId: idSchema.nullable().optional(),
    depreciationExpenseAccountId: idSchema.nullable().optional(),
    disposalGainAccountId: idSchema.nullable().optional(),
    disposalLossAccountId: idSchema.nullable().optional(),
    serialNumber: optionalText(200),
    location: optionalText(300),
    notes: optionalText(2000)
  })
  .strict();

export const fixedAssetPatchSchema = fixedAssetCreateSchema
  .omit({ fixedAssetClassId: true, sourceKind: true })
  .partial()
  .extend({
    version: z.number().int().positive(),
    residualValueMinor: minorUnitStringSchema.optional()
  })
  .strict();

export const updateInvoiceSchema = createInvoiceSchema
  .extend({
    version: z.number().int().positive()
  })
  .strict();

export const invoicePostSchema = z
  .object({
    version: z.number().int().positive(),
    effectiveDate: dateStringSchema.optional()
  })
  .strict();

export const invoiceVoidSchema = z
  .object({
    version: z.number().int().positive(),
    effectiveDate: dateStringSchema.optional(),
    reason: nonEmptyStringSchema.max(500)
  })
  .strict();

export const creditNoteLineSchema = z
  .object({
    invoiceLineId: idSchema,
    quantity: quantityStringSchema.optional(),
    amountMinor: minorUnitStringSchema.optional()
  })
  .strict()
  .superRefine((line, ctx) => {
    if (!line.quantity && !line.amountMinor)
      ctx.addIssue({ code: "custom", message: "A quantity or amount is required." });
    if (line.quantity && line.amountMinor)
      ctx.addIssue({ code: "custom", message: "Provide quantity or amount, not both." });
  });

export const createCreditNoteSchema = z
  .object({
    invoiceId: idSchema,
    issueDate: dateStringSchema,
    reason: nonEmptyStringSchema.max(500),
    fullCredit: z.boolean().default(false),
    lines: z.array(creditNoteLineSchema).max(500).default([])
  })
  .strict()
  .superRefine((input, ctx) => {
    if (!input.fullCredit && input.lines.length === 0)
      ctx.addIssue({
        code: "custom",
        message: "Credit note lines are required unless fullCredit is true."
      });
    if (input.fullCredit && input.lines.length > 0)
      ctx.addIssue({ code: "custom", message: "Full credits do not accept line overrides." });
  });

export const creditNotePostSchema = z
  .object({
    version: z.number().int().positive()
  })
  .strict();

export const invoiceTemplateKeySchema = z.enum([
  "clean-professional",
  "contractor",
  "ranch-agriculture",
  "retail",
  "creative",
  "modern",
  "minimal",
  "service-professional"
]);

export const invoiceTemplateConfigurationSchema = z
  .object({
    logoAssetId: idSchema.nullable(),
    headerImageAssetId: idSchema.nullable(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    fontPairing: z.enum(["system", "classic", "modern", "editorial", "technical"]),
    headingFontSize: z.number().int().min(24).max(42),
    bodyFontSize: z.number().int().min(9).max(14),
    tableFontSize: z.number().int().min(8).max(13),
    notesFontSize: z.number().int().min(8).max(13),
    backgroundTreatment: z.enum(["none", "brand-wash", "image-watermark"]),
    spacing: z.enum(["compact", "comfortable", "airy"]),
    detailStyle: z.enum(["rules", "tinted", "minimal"]),
    headerAlignment: z.enum(["left", "center", "right"]),
    pageSize: z.enum(["LETTER", "A4"]),
    visibleColumns: z
      .array(z.enum(["description", "quantity", "unitPrice", "tax", "total"]))
      .min(1)
      .max(5),
    showTaxDetails: z.boolean(),
    showItemImages: z.boolean(),
    customerNotes: optionalText(4000),
    terms: optionalText(4000),
    paymentInstructions: optionalText(4000),
    footer: optionalText(2000),
    signatureBlock: optionalText(2000),
    qrCodePlaceholder: z.boolean(),
    paymentButtonPlaceholder: z.boolean(),
    customFields: z
      .array(z.object({ label: nonEmptyStringSchema.max(80), value: z.string().max(500) }).strict())
      .max(20)
  })
  .strict();

export const updateInvoiceTemplateSchema = z
  .object({
    templateKey: invoiceTemplateKeySchema,
    configuration: invoiceTemplateConfigurationSchema,
    version: z.number().int().positive().optional()
  })
  .strict();

export const contractStarterKeySchema = z.enum([
  "work-authorization",
  "estimate-acceptance",
  "change-order"
]);

const contractVariableValuesSchema = z
  .record(
    z
      .string()
      .regex(/^[a-z][A-Za-z0-9]*$/)
      .max(80),
    z.string().trim().max(4000)
  )
  .refine((values) => Object.keys(values).length <= 60, "Too many contract variables.");

export const createContractSchema = z
  .object({
    starterKey: contractStarterKeySchema.optional(),
    templateId: idSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    jurisdiction: z.string().trim().min(1).max(120).optional(),
    customerId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    estimateId: idSchema.nullable().optional(),
    variableValues: contractVariableValuesSchema.default({})
  })
  .strict()
  .refine(
    (value) => Boolean(value.starterKey) !== Boolean(value.templateId),
    "Choose one starter template or one saved company template."
  );

export const updateContractSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(30000).optional(),
    jurisdiction: z.string().trim().min(1).max(120).nullable().optional(),
    variableValues: contractVariableValuesSchema.optional()
  })
  .strict();

export const readyContractSchema = z
  .object({
    version: z.number().int().positive(),
    legalReviewAcknowledged: z.literal(true)
  })
  .strict();

export const emailConnectionProviderSchema = z.enum(["GMAIL", "MICROSOFT"]);

export const emailConnectionCallbackSchema = z
  .object({
    provider: emailConnectionProviderSchema,
    state: z.string().min(32).max(500),
    code: z.string().min(1).max(8000).optional(),
    error: z.string().min(1).max(120).optional(),
    error_description: z.string().max(1000).optional()
  })
  .strict();

export const sendInvoiceSchema = z
  .object({
    recipientEmail: z.string().email().optional(),
    subject: nonEmptyStringSchema
      .max(998)
      .refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks.")
      .optional(),
    message: optionalText(10000)
  })
  .strict();

export const manualInvoiceDeliverySchema = z
  .object({
    recipientEmails: z.array(z.string().email()).min(1).max(10),
    subject: nonEmptyStringSchema
      .max(998)
      .refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks.")
      .optional(),
    message: optionalText(10000)
  })
  .strict();

export const reminderSettingsSchema = z
  .object({
    version: z.number().int().positive(),
    enabled: z.boolean().optional(),
    tone: z.enum(["FRIENDLY", "FIRM"]).optional(),
    offsets: z.array(z.number().int().min(-90).max(365)).max(12).optional(),
    quietStartHour: z.number().int().min(0).max(23).optional(),
    quietEndHour: z.number().int().min(0).max(23).optional()
  })
  .strict();

export const statementRequestSchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema,
    type: z.enum(["OPEN_ITEM", "ACTIVITY"]).default("ACTIVITY")
  })
  .strict();

export const statementSendSchema = statementRequestSchema
  .extend({
    recipientEmail: z.string().email(),
    subject: nonEmptyStringSchema.max(998).optional(),
    message: optionalText(10000)
  })
  .strict();

export const publicInvoiceLinkSchema = z
  .object({
    expiresAt: z.string().datetime().optional()
  })
  .strict();

export const migrationRunSchema = z
  .object({
    sourceSystem: nonEmptyStringSchema.max(120),
    entries: z
      .array(
        z
          .object({
            entity: z.enum([
              "accounts",
              "taxCodes",
              "customers",
              "vendors",
              "products",
              "openingBalances",
              "outstandingInvoices",
              "outstandingBills",
              "historicalArchive"
            ]),
            source: nonEmptyStringSchema.max(200),
            rowCount: z.number().int().min(0),
            supported: z.boolean(),
            unsupportedReason: optionalText(500)
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict();

export const migrationRunTransitionSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["VALIDATED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]),
    errorMessage: optionalText(500)
  })
  .strict();

export const commercialSubscriptionSchema = z
  .object({
    planCode: nonEmptyStringSchema.max(80),
    entitlements: z.array(nonEmptyStringSchema.max(120)).max(200),
    provider: optionalText(80).nullable().optional(),
    providerCustomerId: optionalText(200).nullable().optional(),
    providerSubscriptionId: optionalText(200).nullable().optional(),
    currentPeriodEnd: z.string().datetime().nullable().optional()
  })
  .strict();

export const commercialTransitionSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE", "CANCELLED", "ENDED"])
  })
  .strict();

export const commercialEventSchema = z
  .object({
    provider: nonEmptyStringSchema.max(80),
    providerEventId: nonEmptyStringSchema.max(200),
    eventType: nonEmptyStringSchema.max(160),
    payload: z.record(z.unknown())
  })
  .strict();

// Browser-facing commercial administration is intentionally manual during the
// controlled beta. Provider-labelled events must enter through a future
// server-side adapter that verifies the provider signature before it calls the
// commercial service; a tenant administrator must never be able to impersonate
// that path with a client request.
export const manualCommercialSubscriptionSchema = z
  .object({
    planCode: nonEmptyStringSchema.max(80),
    entitlements: z.array(nonEmptyStringSchema.max(120)).max(200),
    currentPeriodEnd: z.string().datetime().nullable().optional()
  })
  .strict();

export const manualCommercialEventSchema = z
  .object({
    providerEventId: nonEmptyStringSchema.max(200),
    eventType: nonEmptyStringSchema.max(160),
    payload: z.record(z.unknown())
  })
  .strict();

export const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: idSchema.optional(),
    active: z.enum(["true", "false"]).optional(),
    status: z.string().optional()
  })
  .strict();

export const profileSchema = z
  .object({
    version: z.number().int().positive(),
    legalName: nonEmptyStringSchema.max(200),
    displayName: nonEmptyStringSchema.max(200),
    businessType: optionalText(100),
    businessNumber: optionalText(30),
    businessAddress: addressSchema.nullable().optional(),
    mailingAddress: addressSchema.nullable().optional(),
    phone: optionalText(40),
    email: z.string().email().nullable().optional(),
    website: z.string().url().nullable().optional(),
    locale: z.enum(["en-CA", "fr-CA"]),
    timeZone: nonEmptyStringSchema.max(100),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    fiscalYearEndMonth: z.number().int().min(1).max(12).nullable().optional(),
    fiscalYearEndDay: z.number().int().min(1).max(31).nullable().optional(),
    accountingStartDate: dateStringSchema.nullable().optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional()
  })
  .strict();

export const presetKeySchema = z.enum([
  "general-service",
  "contractor-trades",
  "ranch-agriculture",
  "repair-business",
  "tourism-experiences",
  "small-product-seller"
]);
export const taxRegistrationSchema = z
  .object({
    version: z.number().int().positive().optional(),
    registrationType: nonEmptyStringSchema.max(40),
    jurisdiction: nonEmptyStringSchema.max(40),
    registrationNumber: optionalText(50),
    registered: z.boolean(),
    effectiveFrom: dateStringSchema.nullable().optional(),
    effectiveTo: dateStringSchema.nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.registered) return;
    const number = value.registrationNumber?.replace(/[\s-]/g, "").toUpperCase();
    if (!number) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationNumber"],
        message: "A registration number is required when the business is registered."
      });
      return;
    }
    const pattern =
      value.registrationType === "GST_HST"
        ? /^\d{9}RT\d{4}$/
        : value.registrationType === "QST"
          ? /^\d{10}TQ\d{4}$/
          : null;
    if (pattern && !pattern.test(number)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationNumber"],
        message:
          value.registrationType === "QST"
            ? "QST numbers use 10 digits, TQ, and four digits."
            : "GST/HST numbers use nine digits, RT, and four digits."
      });
    }
  });
const decimalRateSchema = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/);
export const taxCodeVersionSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{1,20}$/),
    name: nonEmptyStringSchema.max(100),
    treatment: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT"]),
    calculationMode: z.enum(["EXCLUSIVE", "INCLUSIVE"]),
    effectiveFrom: dateStringSchema,
    effectiveTo: dateStringSchema.nullable().optional(),
    sourceName: nonEmptyStringSchema.max(200),
    sourceUrl: z.string().url().nullable().optional(),
    sourceRetrievedAt: z.string().datetime(),
    expectedTaxCodeVersion: z.number().int().positive().optional(),
    components: z
      .array(
        z
          .object({
            name: nonEmptyStringSchema.max(80),
            jurisdiction: nonEmptyStringSchema.max(40),
            rate: decimalRateSchema,
            recoverablePercent: decimalRateSchema,
            payableAccountId: idSchema.nullable().optional(),
            recoverableAccountId: idSchema.nullable().optional()
          })
          .strict()
      )
      .max(5)
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.treatment === "STANDARD" && input.components.length === 0)
      ctx.addIssue({ code: "custom", message: "Standard tax codes require a component." });
    if (
      input.treatment === "EXEMPT" &&
      input.components.some((item) => item.rate !== "0" && !/^0\.0+$/.test(item.rate))
    )
      ctx.addIssue({ code: "custom", message: "Exempt tax codes must have zero rates." });
  });

export const openingBalanceSchema = z
  .object({
    version: z.number().int().positive().optional(),
    effectiveDate: dateStringSchema,
    lines: z
      .array(
        z
          .object({
            accountId: idSchema,
            debitMinor: minorUnitStringSchema,
            creditMinor: minorUnitStringSchema,
            controlDifferenceMinor: z
              .string()
              .regex(/^-?\d+$/)
              .nullable()
              .optional(),
            note: optionalText(300)
          })
          .strict()
      )
      .min(2)
  })
  .strict();
export const businessDefaultsSchema = z
  .object({
    version: z.number().int().positive(),
    paymentTermsDays: z.number().int().min(0).max(365),
    invoicePrefix: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{1,12}$/),
    invoiceNextPlaceholder: z.string().regex(/^\d{1,12}$/),
    estimatePrefix: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{1,12}$/),
    estimateNextPlaceholder: z.string().regex(/^\d{1,12}$/),
    taxCalculationMode: z.enum(["EXCLUSIVE", "INCLUSIVE"]),
    customerNotes: optionalText(2000),
    paymentInstructions: optionalText(2000),
    paymentMethods: z
      .array(z.enum(["E_TRANSFER", "EFT", "CHEQUE", "CARD", "CASH", "OTHER"]))
      .max(6)
      .optional(),
    documentLanguage: z.enum(["en-CA", "fr-CA", "BILINGUAL"]).optional(),
    dateFormat: z.enum(["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"]),
    numberFormat: z.enum(["en-CA", "fr-CA"]),
    showLogo: z.boolean(),
    showBusinessNumber: z.boolean()
  })
  .strict();
const paymentInstructionMethodSchema = z
  .object({
    key: z.enum(["E_TRANSFER", "EFT", "CHEQUE", "PAY_ONLINE", "CASH", "OTHER"]),
    position: z.number().int().min(0).max(20).optional(),
    recipientEmail: z.string().email().max(320).optional(),
    autodeposit: z.boolean().optional(),
    institution: optionalText(160),
    transitNumber: z.string().trim().min(1).max(32).optional(),
    accountNumber: z.string().trim().min(1).max(64).optional(),
    payableTo: optionalText(200),
    mailingAddress: optionalText(1000),
    url: z.string().trim().max(2048).optional(),
    description: optionalText(1000)
  })
  .strict();
export const paymentInstructionUpdateSchema = z
  .object({
    version: z.number().int().positive().optional(),
    legacyInstructions: optionalText(4000),
    methods: z.array(paymentInstructionMethodSchema).max(6)
  })
  .strict();
export const setupStepSchema = z.enum([
  "BUSINESS_PROFILE",
  "FISCAL_CURRENCY",
  "TAX_REGISTRATION",
  "INDUSTRY_PRESET",
  "CHART_REVIEW",
  "OPENING_BALANCES",
  "BRANDING_DEFAULTS",
  "FINAL_REVIEW"
]);
export const setupStepUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["IN_PROGRESS", "COMPLETED", "SKIPPED"])
  })
  .strict();
export const completeSetupSchema = z.object({ version: z.number().int().positive() }).strict();

export const productEventSchema = z
  .object({
    clientEventId: idSchema,
    eventType: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Z][A-Z0-9_.-]*$/),
    eventVersion: z.number().int().positive().max(10).default(1),
    occurredAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const productAnalyticsConsentSchema = z.object({ enabled: z.boolean() }).strict();

const payrollIdentifierEnvelopeSchema = z
  .object({
    ciphertext: nonEmptyStringSchema.max(8_000),
    keyVersion: nonEmptyStringSchema.max(120),
    lastFour: z.string().regex(/^\d{4}$/)
  })
  .strict();

export const payrollSettingsSchema = z
  .object({
    defaultExpenseAccountId: idSchema,
    defaultLiabilityAccountId: idSchema,
    netPayClearingAccountId: idSchema,
    calculationRulePackId: nonEmptyStringSchema.max(160),
    calculationRulePackVersion: nonEmptyStringSchema.max(80)
  })
  .strict();

export const payrollCodeSchema = z
  .object({
    code: nonEmptyStringSchema.max(80),
    name: nonEmptyStringSchema.max(160),
    kind: z.enum(["EARNING", "DEDUCTION", "EMPLOYER_CONTRIBUTION"]),
    statutoryAttributes: z.record(z.any()).default({}),
    expenseAccountId: idSchema.nullable().optional(),
    liabilityAccountId: idSchema.nullable().optional(),
    remittanceAuthority: optionalText(120).nullable().optional()
  })
  .strict();

export const payrollWorkerSchema = z
  .object({
    workerNumber: nonEmptyStringSchema.max(80),
    kind: z.enum(["EMPLOYEE", "CONTRACTOR"]),
    displayName: nonEmptyStringSchema.max(200),
    governmentId: payrollIdentifierEnvelopeSchema.nullable().optional(),
    bankAccount: payrollIdentifierEnvelopeSchema.nullable().optional(),
    profile: z
      .object({
        effectiveFrom: dateStringSchema,
        effectiveTo: dateStringSchema.nullable().optional(),
        status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).optional(),
        jurisdictionCode: nonEmptyStringSchema.max(40),
        taxAttributes: z.record(z.any()).default({})
      })
      .strict(),
    compensation: z
      .object({
        effectiveFrom: dateStringSchema,
        effectiveTo: dateStringSchema.nullable().optional(),
        kind: z.enum(["HOURLY", "SALARY", "FIXED"]),
        rateMinor: minorUnitStringSchema,
        hoursPerPeriodMicros: minorUnitStringSchema.nullable().optional()
      })
      .strict()
  })
  .strict();

export const payrollScheduleSchema = z
  .object({
    code: nonEmptyStringSchema.max(80),
    name: nonEmptyStringSchema.max(160),
    frequency: z.enum(["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"]),
    anchorPayDate: dateStringSchema,
    automaticDraftsEnabled: z.boolean().optional(),
    draftLeadDays: z.number().int().min(0).max(31).optional()
  })
  .strict();

export const payrollScheduleAutomationSchema = z
  .object({
    version: z.number().int().positive(),
    automaticDraftsEnabled: z.boolean(),
    draftLeadDays: z.number().int().min(0).max(31)
  })
  .strict();

export const payrollPeriodSchema = z
  .object({
    scheduleId: idSchema,
    periodStart: dateStringSchema,
    periodEnd: dateStringSchema,
    payDate: dateStringSchema,
    sequence: z.number().int().positive().max(100_000)
  })
  .strict();

export const payrollScheduledDraftSchema = z
  .object({
    periodStart: dateStringSchema,
    periodEnd: dateStringSchema,
    payDate: dateStringSchema,
    sequence: z.number().int().positive().max(100_000).optional()
  })
  .strict();

export const payrollRunSchema = z
  .object({
    runNumber: nonEmptyStringSchema.max(120),
    kind: z.enum(["REGULAR", "OFF_CYCLE", "CORRECTION"]),
    scheduleId: idSchema.nullable().optional(),
    periodId: idSchema.nullable().optional(),
    correctionOfRunId: idSchema.nullable().optional(),
    periodStart: dateStringSchema,
    periodEnd: dateStringSchema,
    payDate: dateStringSchema,
    workers: z
      .array(
        z
          .object({
            workerId: idSchema,
            grossPayMinor: signedMinorUnitStringSchema,
            statutory: z.record(z.any()).optional()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict();

export const payrollPaymentBatchSchema = z
  .object({
    batchNumber: nonEmptyStringSchema.max(120),
    paymentDate: dateStringSchema
  })
  .strict();

export const payrollPaymentExportSchema = z
  .object({
    format: nonEmptyStringSchema.max(80),
    contentHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
    encryptedStorageKey: nonEmptyStringSchema.max(2_000)
  })
  .strict();

export const payrollAutomationRunSchema = z.object({ asOfDate: dateStringSchema }).strict();
