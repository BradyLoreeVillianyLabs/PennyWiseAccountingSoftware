import {
  Prisma,
  withTenantTransaction,
  type PrismaClient,
  type SetupStep,
  type SetupStepStatus
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";

export const setupSteps = [
  "BUSINESS_PROFILE",
  "FISCAL_CURRENCY",
  "TAX_REGISTRATION",
  "INDUSTRY_PRESET",
  "CHART_REVIEW",
  "OPENING_BALANCES",
  "BRANDING_DEFAULTS",
  "FINAL_REVIEW"
] as const satisfies readonly SetupStep[];
const optionalSteps = new Set<SetupStep>([
  "TAX_REGISTRATION",
  "OPENING_BALANCES",
  "BRANDING_DEFAULTS"
]);

export interface ProfileInput {
  version: number;
  legalName: string;
  displayName: string;
  businessType?: string | null | undefined;
  businessNumber?: string | null | undefined;
  businessAddress?: Prisma.InputJsonValue | null | undefined;
  mailingAddress?: Prisma.InputJsonValue | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  website?: string | null | undefined;
  locale: string;
  timeZone: string;
  baseCurrency: string;
  fiscalYearEndMonth?: number | null | undefined;
  fiscalYearEndDay?: number | null | undefined;
  accountingStartDate?: string | null | undefined;
  primaryColor?: string | null | undefined;
  accentColor?: string | null | undefined;
}

export interface TaxCodeInput {
  code: string;
  name: string;
  treatment: "STANDARD" | "ZERO_RATED" | "EXEMPT";
  calculationMode: "EXCLUSIVE" | "INCLUSIVE";
  effectiveFrom: string;
  effectiveTo?: string | null | undefined;
  sourceName: string;
  sourceUrl?: string | null | undefined;
  sourceRetrievedAt: string;
  expectedTaxCodeVersion?: number | undefined;
  components: readonly {
    name: string;
    jurisdiction: string;
    rate: string;
    recoverablePercent: string;
    payableAccountId?: string | null | undefined;
    recoverableAccountId?: string | null | undefined;
  }[];
}

export class CompanySetupService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async getState(context: OrganizationContext) {
    await this.authorization.assert(context, "settings:read", "OrganizationSettings");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await ensureSetupRecords(tx, context.organizationId);
      const [organization, settings, steps, defaults, registrations, taxCodes] = await Promise.all([
        tx.organization.findUniqueOrThrow({ where: { id: context.organizationId } }),
        tx.organizationSettings.findUniqueOrThrow({
          where: { organizationId: context.organizationId }
        }),
        tx.setupStepState.findMany({ where: { organizationId: context.organizationId } }),
        tx.businessDefaults.findUniqueOrThrow({
          where: { organizationId: context.organizationId }
        }),
        tx.taxRegistration.findMany({ where: { organizationId: context.organizationId } }),
        tx.taxCode.findMany({
          where: { organizationId: context.organizationId },
          include: {
            versions: { include: { components: true }, orderBy: { version: "desc" }, take: 1 }
          }
        })
      ]);
      return {
        organization,
        settings: settingsDto(settings),
        steps: orderSetupSteps(steps),
        defaults,
        registrations: registrations.map(redactRegistration),
        taxCodes: taxCodes.map(taxCodeDto)
      };
    });
  }

  public async updateProfile(context: OrganizationContext, input: ProfileInput) {
    await this.authorization.assert(context, "settings:write", "OrganizationSettings");
    const accountingStartDate = input.accountingStartDate
      ? parseDate(input.accountingStartDate, "accountingStartDate")
      : null;
    validateFiscalDate(input.fiscalYearEndMonth, input.fiscalYearEndDay, accountingStartDate);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await ensureSetupRecords(tx, context.organizationId);
      const current = await tx.organizationSettings.findUniqueOrThrow({
        where: { organizationId: context.organizationId }
      });
      const currencyChanged = current.baseCurrency !== input.baseCurrency;
      const fiscalChanged =
        current.accountingStartDate?.getTime() !== accountingStartDate?.getTime() ||
        current.fiscalYearEndMonth !== input.fiscalYearEndMonth ||
        current.fiscalYearEndDay !== input.fiscalYearEndDay;
      if (
        currencyChanged &&
        (await tx.journal.count({
          where: { organizationId: context.organizationId, status: "POSTED" }
        }))
      ) {
        throw new AppError(
          "BASE_CURRENCY_LOCKED",
          "Base currency cannot change after financial activity is posted.",
          409
        );
      }
      if (
        fiscalChanged &&
        (await tx.fiscalPeriod.count({ where: { organizationId: context.organizationId } }))
      ) {
        throw new AppError(
          "FISCAL_SETTINGS_LOCKED",
          "Fiscal settings cannot change after periods are initialized.",
          409
        );
      }
      const updated = await tx.organizationSettings.updateMany({
        where: { organizationId: context.organizationId, version: input.version },
        data: {
          businessType: input.businessType ?? null,
          businessNumber: input.businessNumber ?? null,
          businessAddress: jsonValue(input.businessAddress),
          mailingAddress: jsonValue(input.mailingAddress),
          phone: input.phone ?? null,
          email: input.email ?? null,
          website: input.website ?? null,
          locale: input.locale,
          timeZone: input.timeZone,
          baseCurrency: input.baseCurrency,
          fiscalYearEndMonth: input.fiscalYearEndMonth ?? null,
          fiscalYearEndDay: input.fiscalYearEndDay ?? null,
          accountingStartDate,
          primaryColor: input.primaryColor ?? null,
          accentColor: input.accentColor ?? null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1)
        throw new AppError("STALE_VERSION", "Settings were changed by another request.", 409);
      await tx.organization.update({
        where: { id: context.organizationId },
        data: {
          legalName: input.legalName,
          displayName: input.displayName,
          currency: input.baseCurrency,
          timezone: input.timeZone
        }
      });
      await tx.$executeRaw`
        INSERT INTO "OrganizationCurrency" ("organizationId", "currencyCode", "exponent", "enabled", "updatedAt")
        VALUES (${context.organizationId}::uuid, ${input.baseCurrency}, 2, true, CURRENT_TIMESTAMP)
        ON CONFLICT ("organizationId", "currencyCode") DO UPDATE SET "enabled" = true, "updatedAt" = CURRENT_TIMESTAMP
      `;
      await audit(
        tx,
        context,
        "ORGANIZATION_SETTINGS_UPDATED",
        "OrganizationSettings",
        current.id,
        {
          changedFields: changedProfileFields(current, input),
          containsSensitiveIdentifierChange: current.businessNumber !== input.businessNumber
        }
      );
      const settings = await tx.organizationSettings.findUniqueOrThrow({
        where: { organizationId: context.organizationId }
      });
      return settingsDto(settings);
    });
  }

  public async initializeFiscalYear(context: OrganizationContext) {
    await this.authorization.assert(context, "periods:manage", "FiscalPeriod");
    return withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        const settings = await tx.organizationSettings.findUniqueOrThrow({
          where: { organizationId: context.organizationId }
        });
        if (
          !settings.accountingStartDate ||
          !settings.fiscalYearEndMonth ||
          !settings.fiscalYearEndDay
        ) {
          throw new AppError(
            "FISCAL_SETTINGS_REQUIRED",
            "Accounting start date and fiscal year-end are required.",
            422
          );
        }
        const endDate = firstFiscalYearEnd(
          settings.accountingStartDate,
          settings.fiscalYearEndMonth,
          settings.fiscalYearEndDay
        );
        const existing = await tx.fiscalPeriod.findFirst({
          where: {
            organizationId: context.organizationId,
            ...companyScope(context),
            startDate: settings.accountingStartDate,
            endDate
          }
        });
        if (existing) return existing;
        try {
          const period = await tx.fiscalPeriod.create({
            data: {
              organizationId: context.organizationId,
              ...companyScope(context),
              name: `Fiscal year ending ${serializeDate(endDate).slice(0, 10)}`,
              startDate: settings.accountingStartDate,
              endDate
            }
          });
          await audit(tx, context, "FISCAL_YEAR_INITIALIZED", "FiscalPeriod", period.id, {
            startDate: serializeDate(period.startDate),
            endDate: serializeDate(period.endDate)
          });
          return period;
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError ||
            String(error).includes("overlap")
          )
            throw new AppError(
              "FISCAL_PERIOD_OVERLAP",
              "The fiscal period overlaps an existing period.",
              409
            );
          throw error;
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async saveRegistration(
    context: OrganizationContext,
    input: {
      version?: number | undefined;
      registrationType: string;
      jurisdiction: string;
      registrationNumber?: string | null | undefined;
      registered: boolean;
      effectiveFrom?: string | null | undefined;
      effectiveTo?: string | null | undefined;
    }
  ) {
    await this.authorization.assert(context, "taxes:configure", "TaxRegistration");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.taxRegistration.findUnique({
        where: {
          organizationId_registrationType_jurisdiction: {
            organizationId: context.organizationId,
            registrationType: input.registrationType,
            jurisdiction: input.jurisdiction
          }
        }
      });
      const data = {
        registered: input.registered,
        registrationNumber: normalizeRegistrationNumber(input.registrationNumber),
        effectiveFrom: input.effectiveFrom ? parseDate(input.effectiveFrom, "effectiveFrom") : null,
        effectiveTo: input.effectiveTo ? parseDate(input.effectiveTo, "effectiveTo") : null
      };
      let registration;
      if (existing) {
        const result = await tx.taxRegistration.updateMany({
          where: {
            id: existing.id,
            organizationId: context.organizationId,
            version: input.version ?? -1
          },
          data: { ...data, version: { increment: 1 } }
        });
        if (result.count !== 1)
          throw new AppError(
            "STALE_VERSION",
            "Tax registration was changed by another request.",
            409
          );
        registration = await tx.taxRegistration.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        registration = await tx.taxRegistration.create({
          data: {
            organizationId: context.organizationId,
            registrationType: input.registrationType,
            jurisdiction: input.jurisdiction,
            ...data
          }
        });
      }
      await audit(tx, context, "TAX_REGISTRATION_UPDATED", "TaxRegistration", registration.id, {
        registrationType: input.registrationType,
        jurisdiction: input.jurisdiction,
        registered: input.registered,
        identifierChanged: existing?.registrationNumber !== data.registrationNumber
      });
      return redactRegistration(registration);
    });
  }

  public async createTaxCodeVersion(context: OrganizationContext, input: TaxCodeInput) {
    await this.authorization.assert(context, "taxes:configure", "TaxCode");
    return withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        for (const component of input.components)
          await validateControlAccounts(tx, context.organizationId, component);
        let taxCode = await tx.taxCode.findUnique({
          where: {
            organizationId_code: { organizationId: context.organizationId, code: input.code }
          }
        });
        if (!taxCode)
          taxCode = await tx.taxCode.create({
            data: { organizationId: context.organizationId, code: input.code, name: input.name }
          });
        else if (input.expectedTaxCodeVersion !== taxCode.version)
          throw new AppError("STALE_VERSION", "Tax code was changed by another request.", 409);
        const nextVersion =
          taxCode.version +
          ((await tx.taxCodeVersion.count({ where: { taxCodeId: taxCode.id } })) ? 1 : 0);
        const effectiveFrom = parseDate(input.effectiveFrom, "effectiveFrom");
        const effectiveTo = input.effectiveTo ? parseDate(input.effectiveTo, "effectiveTo") : null;
        const overlap = await tx.taxCodeVersion.count({
          where: {
            taxCodeId: taxCode.id,
            effectiveFrom: { lte: effectiveTo ?? new Date("9999-12-31T00:00:00.000Z") },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }]
          }
        });
        if (overlap)
          throw new AppError(
            "TAX_VERSION_OVERLAP",
            "Tax code effective dates may not overlap.",
            409
          );
        const version = await tx.taxCodeVersion.create({
          data: {
            organizationId: context.organizationId,
            taxCodeId: taxCode.id,
            version: nextVersion,
            treatment: input.treatment,
            calculationMode: input.calculationMode,
            effectiveFrom,
            effectiveTo,
            sourceName: input.sourceName,
            sourceUrl: input.sourceUrl ?? null,
            sourceRetrievedAt: new Date(input.sourceRetrievedAt),
            components: {
              create: input.components.map((component) => ({
                organizationId: context.organizationId,
                name: component.name,
                jurisdiction: component.jurisdiction,
                rate: component.rate,
                recoverablePercent: component.recoverablePercent,
                payableAccountId: component.payableAccountId ?? null,
                recoverableAccountId: component.recoverableAccountId ?? null
              }))
            }
          },
          include: { components: true }
        });
        await tx.taxCode.update({
          where: { id: taxCode.id },
          data: { name: input.name, version: nextVersion }
        });
        await audit(tx, context, "TAX_CODE_VERSION_CREATED", "TaxCodeVersion", version.id, {
          code: input.code,
          version: nextVersion,
          effectiveFrom: input.effectiveFrom,
          sourceName: input.sourceName
        });
        const saved = await tx.taxCodeVersion.findUniqueOrThrow({
          where: { id: version.id },
          include: { components: true }
        });
        return { ...saved, components: saved.components.map(componentDto) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async updateDefaults(
    context: OrganizationContext,
    input: {
      version: number;
      paymentTermsDays: number;
      invoicePrefix: string;
      invoiceNextPlaceholder: string;
      estimatePrefix: string;
      estimateNextPlaceholder: string;
      taxCalculationMode: "EXCLUSIVE" | "INCLUSIVE";
      customerNotes?: string | null | undefined;
      paymentInstructions?: string | null | undefined;
      paymentMethods?: Prisma.InputJsonValue | null | undefined;
      documentLanguage?: string | undefined;
      dateFormat: string;
      numberFormat: string;
      showLogo: boolean;
      showBusinessNumber: boolean;
    }
  ) {
    await this.authorization.assert(context, "branding:manage", "BusinessDefaults");
    rejectActiveContent(input.customerNotes, input.paymentInstructions);
    const { paymentMethods, documentLanguage, ...defaultFields } = input;
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await ensureSetupRecords(tx, context.organizationId);
      const result = await tx.businessDefaults.updateMany({
        where: { organizationId: context.organizationId, version: input.version },
        data: {
          ...defaultFields,
          customerNotes: input.customerNotes ?? null,
          paymentInstructions: input.paymentInstructions ?? null,
          ...(paymentMethods === undefined ? {} : { paymentMethods: jsonValue(paymentMethods) }),
          ...(documentLanguage === undefined ? {} : { documentLanguage }),
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError("STALE_VERSION", "Defaults were changed by another request.", 409);
      const updated = await tx.businessDefaults.findUniqueOrThrow({
        where: { organizationId: context.organizationId }
      });
      await audit(tx, context, "BUSINESS_DEFAULTS_UPDATED", "BusinessDefaults", updated.id, {
        version: updated.version
      });
      return updated;
    });
  }

  public async setStep(
    context: OrganizationContext,
    step: SetupStep,
    status: SetupStepStatus,
    version: number
  ) {
    await this.authorization.assert(context, "settings:write", "SetupStepState");
    if (status === "SKIPPED" && !optionalSteps.has(step))
      throw new AppError("SETUP_STEP_REQUIRED", "This setup step cannot be skipped.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await ensureSetupRecords(tx, context.organizationId);
      await assertStepReady(tx, context.organizationId, step, status);
      const result = await tx.setupStepState.updateMany({
        where: { organizationId: context.organizationId, step, version },
        data: {
          status,
          version: { increment: 1 },
          completedAt: status === "COMPLETED" || status === "SKIPPED" ? new Date() : null,
          completedByUserId: status === "COMPLETED" || status === "SKIPPED" ? context.user.id : null
        }
      });
      if (result.count !== 1)
        throw new AppError("STALE_VERSION", "Setup state was changed by another request.", 409);
      const state = await tx.setupStepState.findUniqueOrThrow({
        where: { organizationId_step: { organizationId: context.organizationId, step } }
      });
      await audit(tx, context, "SETUP_STEP_UPDATED", "SetupStepState", state.id, { step, status });
      return state;
    });
  }

  public async complete(context: OrganizationContext, version: number) {
    await this.authorization.assert(context, "setup:complete", "OrganizationSettings");
    return withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        const settings = await tx.organizationSettings.findUniqueOrThrow({
          where: { organizationId: context.organizationId }
        });
        const steps = await tx.setupStepState.findMany({
          where: { organizationId: context.organizationId }
        });
        const incomplete = steps.filter(
          (item) => item.step !== "FINAL_REVIEW" && !["COMPLETED", "SKIPPED"].includes(item.status)
        );
        if (incomplete.length)
          throw new AppError(
            "SETUP_INCOMPLETE",
            "Required setup decisions remain incomplete.",
            422,
            { steps: incomplete.map((item) => item.step) }
          );
        if (
          !settings.accountingStartDate ||
          !settings.fiscalYearEndMonth ||
          !settings.industryPresetKey
        )
          throw new AppError(
            "SETUP_CONFIGURATION_REQUIRED",
            "Fiscal settings and an industry preset are required.",
            422
          );
        if (!(await tx.fiscalPeriod.count({ where: { organizationId: context.organizationId } })))
          throw new AppError(
            "FISCAL_PERIOD_REQUIRED",
            "Initialize the first fiscal year before completing setup.",
            422
          );
        const result = await tx.organizationSettings.updateMany({
          where: { organizationId: context.organizationId, version, setupCompletedAt: null },
          data: { setupCompletedAt: new Date(), version: { increment: 1 } }
        });
        if (result.count !== 1)
          throw new AppError("STALE_VERSION", "Setup was already completed or changed.", 409);
        await tx.setupStepState.update({
          where: {
            organizationId_step: { organizationId: context.organizationId, step: "FINAL_REVIEW" }
          },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            completedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await audit(
          tx,
          context,
          "ORGANIZATION_SETUP_COMPLETED",
          "OrganizationSettings",
          settings.id,
          {}
        );
        return settingsDto(
          await tx.organizationSettings.findUniqueOrThrow({
            where: { organizationId: context.organizationId }
          })
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }
}

async function ensureSetupRecords(tx: Prisma.TransactionClient, organizationId: string) {
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  await tx.organizationSettings.upsert({
    where: { organizationId },
    create: {
      organizationId,
      baseCurrency: organization.currency,
      timeZone: organization.timezone
    },
    update: {}
  });
  await tx.businessDefaults.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {}
  });
  for (const step of setupSteps)
    await tx.setupStepState.upsert({
      where: { organizationId_step: { organizationId, step } },
      create: { organizationId, step },
      update: {}
    });
}

async function assertStepReady(
  tx: Prisma.TransactionClient,
  organizationId: string,
  step: SetupStep,
  status: SetupStepStatus
) {
  const settings = await tx.organizationSettings.findUniqueOrThrow({ where: { organizationId } });
  if (settings.setupCompletedAt)
    throw new AppError(
      "SETUP_ALREADY_COMPLETED",
      "Completed setup progress cannot be reopened; edit permitted settings directly.",
      409
    );
  if (status !== "COMPLETED") return;
  if (step === "BUSINESS_PROFILE" && !settings.businessType)
    throw new AppError("SETUP_STEP_INCOMPLETE", "Business type is required.", 422);
  if (
    step === "FISCAL_CURRENCY" &&
    (!settings.accountingStartDate || !settings.fiscalYearEndMonth || !settings.fiscalYearEndDay)
  )
    throw new AppError("SETUP_STEP_INCOMPLETE", "Fiscal configuration is incomplete.", 422);
  if (step === "FISCAL_CURRENCY" && !(await tx.fiscalPeriod.count({ where: { organizationId } })))
    throw new AppError(
      "SETUP_STEP_INCOMPLETE",
      "Initialize the first fiscal year before completing this step.",
      422
    );
  if (
    step === "INDUSTRY_PRESET" &&
    !(await tx.appliedAccountPreset.count({ where: { organizationId } }))
  )
    throw new AppError("SETUP_STEP_INCOMPLETE", "Apply an account preset first.", 422);
  if (step === "CHART_REVIEW" && !(await tx.account.count({ where: { organizationId } })))
    throw new AppError("SETUP_STEP_INCOMPLETE", "The chart of accounts is empty.", 422);
  if (
    step === "OPENING_BALANCES" &&
    !(await tx.openingBalanceDraft.count({ where: { organizationId, status: "POSTED" } }))
  )
    throw new AppError("SETUP_STEP_INCOMPLETE", "Post or explicitly skip opening balances.", 422);
  if (
    step === "TAX_REGISTRATION" &&
    !(await tx.taxRegistration.count({ where: { organizationId } }))
  )
    throw new AppError("SETUP_STEP_INCOMPLETE", "Save or explicitly skip tax registration.", 422);
  if (step === "FINAL_REVIEW")
    throw new AppError("SETUP_COMPLETION_REQUIRED", "Use the setup completion action.", 422);
}

function firstFiscalYearEnd(start: Date, month: number, day: number): Date {
  const year = start.getUTCFullYear();
  let end = exactDate(year, month, day);
  if (end < start) end = exactDate(year + 1, month, day);
  return end;
}
function exactDate(year: number, month: number, day: number): Date {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day)
    throw new AppError(
      "INVALID_FISCAL_YEAR_END",
      "Fiscal year-end is not a valid calendar date.",
      422
    );
  return value;
}
function validateFiscalDate(month?: number | null, day?: number | null, start?: Date | null) {
  if ((month == null) !== (day == null))
    throw new AppError(
      "INVALID_FISCAL_YEAR_END",
      "Fiscal year-end month and day are both required.",
      422
    );
  if (month && day && start) firstFiscalYearEnd(start, month, day);
}
function rejectActiveContent(...values: (string | null | undefined)[]) {
  if (
    values.some(
      (value) => value && /<\s*\/?\s*(script|iframe|object|embed|svg)|javascript:/i.test(value)
    )
  )
    throw new AppError("ACTIVE_CONTENT_REJECTED", "Defaults must contain plain text only.", 422);
}
function jsonValue(
  value: Prisma.InputJsonValue | null | undefined
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value == null ? Prisma.JsonNull : value;
}
function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function companyScope(context: OrganizationContext) {
  return context.companyId ? { companyId: context.companyId } : {};
}

function orderSetupSteps<T extends { step: SetupStep }>(steps: readonly T[]): T[] {
  return [...steps].sort(
    (left, right) => setupSteps.indexOf(left.step) - setupSteps.indexOf(right.step)
  );
}
function settingsDto(
  settings: { accountingStartDate: Date | null; createdAt: Date; updatedAt: Date } & Record<
    string,
    unknown
  >
) {
  const { lateFeeAmountMinor, lateFeeCapMinor, ...serializableSettings } = settings;
  return {
    ...serializableSettings,
    lateFeeAmountMinor: serializeMinorSetting(lateFeeAmountMinor),
    lateFeeCapMinor: serializeMinorSetting(lateFeeCapMinor),
    accountingStartDate: settings.accountingStartDate
      ? serializeDate(settings.accountingStartDate).slice(0, 10)
      : null,
    createdAt: serializeDate(settings.createdAt),
    updatedAt: serializeDate(settings.updatedAt)
  };
}

function serializeMinorSetting(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string")
    return value.toString();
  throw new TypeError("Minor-unit settings must be numeric.");
}

function redactRegistration<T extends { registrationNumber: string | null }>(registration: T) {
  return {
    ...registration,
    registrationNumber: registration.registrationNumber
      ? `***${registration.registrationNumber.slice(-4)}`
      : null
  };
}
function componentDto(
  component: { rate: Prisma.Decimal; recoverablePercent: Prisma.Decimal } & Record<string, unknown>
) {
  return {
    ...component,
    rate: component.rate.toFixed(6),
    recoverablePercent: component.recoverablePercent.toFixed(6)
  };
}
function taxCodeDto(
  code: {
    versions: Array<
      { components: Array<{ rate: Prisma.Decimal; recoverablePercent: Prisma.Decimal }> } & Record<
        string,
        unknown
      >
    >;
  } & Record<string, unknown>
) {
  return {
    ...code,
    versions: code.versions.map((version) => ({
      ...version,
      components: version.components.map(componentDto)
    }))
  };
}
async function validateControlAccounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  component: TaxCodeInput["components"][number]
) {
  for (const [kind, id] of [
    ["payable", component.payableAccountId],
    ["recoverable", component.recoverableAccountId]
  ] as const) {
    if (!id) continue;
    const account = await tx.account.findFirst({ where: { id, organizationId } });
    if (
      !account ||
      !account.isControl ||
      (kind === "payable" ? account.type !== "LIABILITY" : account.type !== "ASSET")
    )
      throw new AppError("INVALID_TAX_CONTROL_ACCOUNT", `Tax ${kind} account is invalid.`, 422);
  }
}
function changedProfileFields(current: Record<string, unknown>, input: ProfileInput) {
  return [
    "businessType",
    "businessNumber",
    "phone",
    "email",
    "website",
    "locale",
    "timeZone",
    "baseCurrency",
    "fiscalYearEndMonth",
    "fiscalYearEndDay",
    "primaryColor",
    "accentColor"
  ].filter((key) => current[key] !== input[key as keyof ProfileInput]);
}

function normalizeRegistrationNumber(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[\s-]/g, "").trim().toUpperCase();
  return normalized || null;
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
