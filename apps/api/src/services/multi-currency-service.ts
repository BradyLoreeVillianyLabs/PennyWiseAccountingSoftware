import { InMemoryCurrencyRegistry, parseExactRate } from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

const registry = new InMemoryCurrencyRegistry();

export interface MultiCurrencySettingsInput {
  readonly version: number;
  readonly enabled: boolean;
  readonly rateMode: "MANUAL" | "PROVIDER" | "IMPORTED";
  readonly currencies: readonly string[];
}

export interface FxRateSnapshotInput {
  readonly transactionCurrency: string;
  readonly rate: string;
  readonly effectiveAt: string;
  readonly method: "MANUAL" | "PROVIDER" | "IMPORTED";
  readonly purpose: "TRANSACTION" | "CLOSING" | "AVERAGE" | "ACTUAL_SETTLEMENT";
  readonly sourceReference?: string | null | undefined;
}

type CurrencyRow = {
  id: string;
  currencyCode: string;
  exponent: number;
  enabled: boolean;
};

type RateRow = {
  id: string;
  transactionCurrency: string;
  baseCurrency: string;
  transactionExponent: number;
  baseExponent: number;
  numerator: bigint;
  denominator: bigint;
  method: string;
  purpose: string;
  sourceReference: string | null;
  effectiveAt: Date;
  observedAt: Date | null;
};

export class MultiCurrencyService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async getSettings(context: OrganizationContext) {
    await this.authorization.assert(context, "settings:read", "OrganizationSettings");
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.readSettings(tx, context.organizationId)
    );
  }

  private async readSettings(tx: Prisma.TransactionClient, organizationId: string) {
    const settings = await tx.$queryRaw<
      {
        version: number;
        baseCurrency: string;
        multiCurrencyEnabled: boolean;
        fxRateMode: string;
      }[]
    >`
        SELECT "version", "baseCurrency", "multiCurrencyEnabled", "fxRateMode"::text AS "fxRateMode"
        FROM "OrganizationSettings"
        WHERE "organizationId" = ${organizationId}::uuid
    `;
    const organization = await tx.$queryRaw<{ currency: string }[]>`
        SELECT "currency" FROM "Organization" WHERE "id" = ${organizationId}::uuid
    `;
    const currencies = await tx.$queryRaw<CurrencyRow[]>`
        SELECT "id", trim("currencyCode") AS "currencyCode", "exponent", "enabled"
        FROM "OrganizationCurrency"
        WHERE "organizationId" = ${organizationId}::uuid
        ORDER BY "currencyCode"
    `;
    const rates = await tx.$queryRaw<RateRow[]>`
        SELECT "id", trim("transactionCurrency") AS "transactionCurrency",
          trim("baseCurrency") AS "baseCurrency", "transactionExponent", "baseExponent",
          "numerator", "denominator", "method"::text AS "method", "purpose"::text AS "purpose", "sourceReference",
          "effectiveAt", "observedAt"
        FROM "FxRateSnapshot"
        WHERE "organizationId" = ${organizationId}::uuid
        ORDER BY "effectiveAt" DESC, "createdAt" DESC
        LIMIT 100
    `;
    const row = settings[0];
    if (!row || !organization[0])
      throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
    return {
      version: row.version,
      baseCurrency: row.baseCurrency.trim() || organization[0].currency.trim(),
      enabled: row.multiCurrencyEnabled,
      rateMode: row.fxRateMode,
      currencies: currencies.map((currency) => ({
        ...currency,
        currencyCode: currency.currencyCode.trim()
      })),
      rates: rates.map(rateDto)
    };
  }

  public async updateSettings(context: OrganizationContext, input: MultiCurrencySettingsInput) {
    await this.authorization.assert(context, "settings:write", "OrganizationSettings");
    if (input.rateMode !== "MANUAL") {
      throw new AppError(
        "FX_RATE_MODE_NOT_RELEASED",
        "Imported and provider rate modes remain disabled until their approved adapters are implemented.",
        409
      );
    }
    const normalizedCurrencies = [
      ...new Set(input.currencies.map((currency) => currency.trim().toUpperCase()))
    ];
    const unsupported = normalizedCurrencies.filter((code) => !["CAD", "USD"].includes(code));
    if (unsupported.length > 0) {
      throw new AppError(
        "CURRENCY_NOT_RELEASED",
        "The first multi-currency release supports CAD and USD only.",
        422,
        { currencies: unsupported }
      );
    }
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const settings = await tx.$queryRaw<{ version: number; baseCurrency: string }[]>`
        SELECT "version", trim("baseCurrency") AS "baseCurrency"
        FROM "OrganizationSettings"
        WHERE "organizationId" = ${context.organizationId}::uuid
        FOR UPDATE
      `;
      const current = settings[0];
      if (!current)
        throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
      const baseCurrency = current.baseCurrency.trim();
      if (!normalizedCurrencies.includes(baseCurrency)) normalizedCurrencies.unshift(baseCurrency);
      if (input.enabled) {
        for (const code of ["CAD", "USD"])
          if (!normalizedCurrencies.includes(code)) normalizedCurrencies.push(code);
      }
      for (const code of normalizedCurrencies) {
        const definition = registry.get(code);
        await tx.$executeRaw`
          INSERT INTO "OrganizationCurrency" ("organizationId", "currencyCode", "exponent", "enabled", "updatedAt")
          VALUES (${context.organizationId}::uuid, ${code}, ${definition.exponent}, true, CURRENT_TIMESTAMP)
          ON CONFLICT ("organizationId", "currencyCode") DO UPDATE SET
            "exponent" = EXCLUDED."exponent", "enabled" = true, "updatedAt" = CURRENT_TIMESTAMP
        `;
      }
      const configured = await tx.$queryRaw<{ currencyCode: string }[]>`
        SELECT trim("currencyCode") AS "currencyCode"
        FROM "OrganizationCurrency"
        WHERE "organizationId" = ${context.organizationId}::uuid
      `;
      for (const existing of configured) {
        const code = existing.currencyCode.trim();
        if (!normalizedCurrencies.includes(code)) {
          const used = await tx.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count FROM "JournalLine"
            WHERE "organizationId" = ${context.organizationId}::uuid
              AND trim(COALESCE("transactionCurrency", '')) = ${code}
          `;
          if ((used[0]?.count ?? 0n) > 0n) {
            throw new AppError(
              "CURRENCY_IN_USE",
              `Currency ${code} cannot be disabled after it has been posted.`,
              409
            );
          }
          await tx.$executeRaw`
            UPDATE "OrganizationCurrency" SET "enabled" = false, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "organizationId" = ${context.organizationId}::uuid AND "currencyCode" = ${code}
          `;
        }
      }
      const updated = await tx.$executeRaw`
        UPDATE "OrganizationSettings"
        SET "multiCurrencyEnabled" = ${input.enabled},
            "fxRateMode" = ${input.rateMode}::"FxRateMethod",
            "version" = "version" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "organizationId" = ${context.organizationId}::uuid AND "version" = ${input.version}
      `;
      if (updated !== 1)
        throw new AppError("STALE_VERSION", "Settings were changed by another request.", 409);
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "MULTI_CURRENCY_SETTINGS_UPDATED",
          targetType: "OrganizationSettings",
          targetId: context.organizationId,
          requestId: context.requestId,
          metadata: withAuditOrigin(context.auditOrigin, {
            enabled: input.enabled,
            rateMode: input.rateMode,
            currencies: normalizedCurrencies
          })
        }
      });
      return this.readSettings(tx, context.organizationId);
    });
  }

  public async createRate(context: OrganizationContext, input: FxRateSnapshotInput) {
    await this.authorization.assert(context, "settings:write", "FxRateSnapshot");
    if (input.method !== "MANUAL") {
      throw new AppError(
        "FX_RATE_METHOD_NOT_RELEASED",
        "Only manually documented rate snapshots are available during accounting review.",
        409
      );
    }
    const sourceReference = input.sourceReference?.trim();
    if (!sourceReference) {
      throw new AppError(
        "FX_RATE_SOURCE_REQUIRED",
        "A source or approval note is required for every manual rate snapshot.",
        422
      );
    }
    const transactionCurrency = input.transactionCurrency.trim().toUpperCase();
    const rate = parseExactRate(input.rate);
    const effectiveAt = new Date(input.effectiveAt);
    if (Number.isNaN(effectiveAt.getTime()))
      throw new AppError("INVALID_RATE_DATE", "Rate effectiveAt is invalid.", 400);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const organization = await tx.$queryRaw<{ baseCurrency: string }[]>`
        SELECT trim("baseCurrency") AS "baseCurrency" FROM "OrganizationSettings"
        WHERE "organizationId" = ${context.organizationId}::uuid
      `;
      const baseCurrency = organization[0]?.baseCurrency;
      if (!baseCurrency)
        throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
      const currency = await tx.$queryRaw<{ exponent: number; enabled: boolean }[]>`
        SELECT "exponent", "enabled" FROM "OrganizationCurrency"
        WHERE "organizationId" = ${context.organizationId}::uuid AND "currencyCode" = ${transactionCurrency}
      `;
      if (!currency[0]?.enabled)
        throw new AppError(
          "CURRENCY_NOT_ENABLED",
          `Currency ${transactionCurrency} is not enabled.`,
          409
        );
      const baseDefinition = registry.get(baseCurrency.trim());
      if (
        transactionCurrency === baseCurrency.trim() &&
        (rate.numerator !== 1n || rate.denominator !== 1n)
      ) {
        throw new AppError(
          "SAME_CURRENCY_RATE_INVALID",
          "A same-currency rate must be exactly 1:1.",
          422
        );
      }
      const inserted = await tx.$queryRaw<RateRow[]>`
        INSERT INTO "FxRateSnapshot" (
          "organizationId", "transactionCurrency", "baseCurrency", "transactionExponent", "baseExponent",
          "numerator", "denominator", "method", "purpose", "sourceReference", "effectiveAt", "observedAt",
          "approvedByUserId", "approvalNote"
        ) VALUES (
          ${context.organizationId}::uuid, ${transactionCurrency}, ${baseCurrency.trim()}, ${currency[0].exponent},
          ${baseDefinition.exponent}, ${rate.numerator}, ${rate.denominator}, ${input.method}::"FxRateMethod",
          ${input.purpose}::"FxRatePurpose",
          ${sourceReference}, ${effectiveAt}, CURRENT_TIMESTAMP,
          ${context.user.id}::uuid, ${sourceReference}
        ) RETURNING "id", trim("transactionCurrency") AS "transactionCurrency", trim("baseCurrency") AS "baseCurrency",
          "transactionExponent", "baseExponent", "numerator", "denominator", "method"::text AS "method",
          "purpose"::text AS "purpose",
          "sourceReference", "effectiveAt", "observedAt"
      `;
      const created = inserted[0];
      if (!created)
        throw new AppError("FX_RATE_CREATE_FAILED", "Rate snapshot could not be created.", 500);
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "FX_RATE_SNAPSHOT_CREATED",
          targetType: "FxRateSnapshot",
          targetId: created.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context.auditOrigin, {
            transactionCurrency,
            numerator: rate.numerator.toString(),
            denominator: rate.denominator.toString(),
            method: input.method,
            purpose: input.purpose
          })
        }
      });
      return rateDto(created);
    });
  }
}

function rateDto(rate: RateRow) {
  return {
    ...rate,
    numerator: rate.numerator.toString(),
    denominator: rate.denominator.toString(),
    transactionCurrency: rate.transactionCurrency.trim(),
    baseCurrency: rate.baseCurrency.trim(),
    effectiveAt: rate.effectiveAt.toISOString(),
    observedAt: rate.observedAt?.toISOString() ?? null
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
