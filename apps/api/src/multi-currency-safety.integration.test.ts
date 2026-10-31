import { randomUUID } from "node:crypto";
import { PrismaClient, withTenantTransaction } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });

function headers(email: string, organizationId?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function createOrganization(email: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(email),
    payload: { legalName: `${name} Ltd`, displayName: name }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function createAccount(email: string, organizationId: string, code: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    headers: headers(email, organizationId),
    payload: { code, name: `Account ${code}`, type: "ASSET", isControl: false }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

beforeAll(async () => {
  await prisma.$connect();
  await app.ready();
});
beforeEach(async () => resetDatabase(prisma));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("CAD/USD multi-currency safety boundary", () => {
  it("keeps foreign manual journals blocked and requires explicit closing rates", async () => {
    const email = "mcf-safety-owner@example.test";
    const organizationId = await createOrganization(email, "Safety");
    const foreignJournal = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: { ...headers(email, organizationId), "idempotency-key": randomUUID() },
      payload: {
        description: "Must remain disabled",
        effectiveDate: "2026-07-29",
        sourceType: "review_test",
        sourceId: randomUUID(),
        postingKey: `review:${randomUUID()}`,
        transactionCurrency: "USD",
        lines: [
          { accountId: randomUUID(), debitMinor: "135", creditMinor: "0" },
          { accountId: randomUUID(), debitMinor: "0", creditMinor: "135" }
        ]
      }
    });
    expect(foreignJournal.statusCode, foreignJournal.body).toBe(422);
    expect(foreignJournal.json<{ error: { code: string } }>().error.code).toBe(
      "FOREIGN_MANUAL_JOURNAL_UNSUPPORTED"
    );

    const revaluation = await app.inject({
      method: "POST",
      url: "/v1/accounting/fx-revaluation/preview",
      headers: headers(email, organizationId),
      payload: { valuationDate: "2026-07-31", post: false }
    });
    expect(revaluation.statusCode, revaluation.body).toBe(400);
  });

  it("enforces the release gate and tenant references in PostgreSQL", async () => {
    const firstEmail = "mcf-tenant-first@example.test";
    const secondEmail = "mcf-tenant-second@example.test";
    const firstOrganizationId = await createOrganization(firstEmail, "First");
    const secondOrganizationId = await createOrganization(secondEmail, "Second");
    const firstAccountId = await createAccount(firstEmail, firstOrganizationId, "1000");
    const secondAccountId = await createAccount(secondEmail, secondOrganizationId, "1000");
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { email: firstEmail } });
    const secondSettingsResponse = await app.inject({
      method: "GET",
      url: "/v1/settings/multi-currency",
      headers: headers(secondEmail, secondOrganizationId)
    });
    expect(secondSettingsResponse.statusCode, secondSettingsResponse.body).toBe(200);
    const secondSettings = secondSettingsResponse.json<{
      multiCurrency: { version: number };
    }>().multiCurrency;
    const preparedSettings = await app.inject({
      method: "PUT",
      url: "/v1/settings/multi-currency",
      headers: headers(secondEmail, secondOrganizationId),
      payload: {
        version: secondSettings.version,
        enabled: true,
        rateMode: "MANUAL",
        currencies: ["CAD", "USD"]
      }
    });
    expect(preparedSettings.statusCode, preparedSettings.body).toBe(200);
    const unsupportedRate = await app.inject({
      method: "POST",
      url: "/v1/settings/multi-currency/rates",
      headers: headers(secondEmail, secondOrganizationId),
      payload: {
        transactionCurrency: "USD",
        rate: "1.35",
        effectiveAt: "2026-07-29T12:00:00.000Z",
        method: "PROVIDER",
        sourceReference: "Unapproved provider"
      }
    });
    expect(unsupportedRate.statusCode, unsupportedRate.body).toBe(400);
    const documentedRate = await app.inject({
      method: "POST",
      url: "/v1/settings/multi-currency/rates",
      headers: headers(secondEmail, secondOrganizationId),
      payload: {
        transactionCurrency: "USD",
        rate: "1.35",
        effectiveAt: "2026-07-29T12:00:00.000Z",
        method: "MANUAL",
        sourceReference: "Bank of Canada daily rate, reviewed by owner"
      }
    });
    expect(documentedRate.statusCode, documentedRate.body).toBe(201);
    const secondRateId = documentedRate.json<{ rate: { id: string } }>().rate.id;

    expect(
      await withTenantTransaction(
        prisma,
        { organizationId: firstOrganizationId, actorUserId: firstUser.id },
        (tx) =>
          tx.$executeRaw`
            UPDATE "OrganizationSettings"
            SET "multiCurrencyEnabled" = false
            WHERE "organizationId" = ${firstOrganizationId}::uuid
          `
      )
    ).toBe(1);

    await expect(
      withTenantTransaction(
        prisma,
        { organizationId: firstOrganizationId, actorUserId: firstUser.id },
        (tx) =>
          tx.$executeRaw`
            INSERT INTO "MonetaryPosition" (
              "organizationId", "accountId", "kind", "currency", "sourceType", "sourceId",
              "carryingMinor", "asOfDate", "updatedAt"
            ) VALUES (
              ${firstOrganizationId}::uuid, ${secondAccountId}::uuid,
              'BANK'::"MonetaryPositionKind", 'USD', 'review', ${randomUUID()},
              100, DATE '2026-07-29', CURRENT_TIMESTAMP
            )
          `
      )
    ).rejects.toThrow(/MonetaryPosition_accountId_fkey/i);

    const period = await app.inject({
      method: "POST",
      url: "/v1/fiscal-periods",
      headers: headers(firstEmail, firstOrganizationId),
      payload: { name: "Review", startDate: "2026-01-01", endDate: "2026-12-31" }
    });
    expect(period.statusCode, period.body).toBe(201);
    const periodId = period.json<{ period: { id: string } }>().period.id;
    const draftJournalId = await withTenantTransaction(
      prisma,
      { organizationId: firstOrganizationId, actorUserId: firstUser.id },
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "Journal" (
            "organizationId", "fiscalPeriodId", "status", "effectiveDate", "description",
            "sourceType", "sourceId", "postingKey", "baseCurrency"
          ) VALUES (
            ${firstOrganizationId}::uuid, ${periodId}::uuid, 'DRAFT'::"JournalStatus",
            DATE '2026-07-29', 'Review draft', 'review', ${randomUUID()}, ${randomUUID()}, 'CAD'
          ) RETURNING "id"
        `;
        return rows[0]!.id;
      }
    );
    await expect(
      withTenantTransaction(
        prisma,
        { organizationId: firstOrganizationId, actorUserId: firstUser.id },
        (tx) =>
          tx.$executeRaw`
            UPDATE "Journal"
            SET "fxRateSnapshotId" = ${secondRateId}::uuid
            WHERE "organizationId" = ${firstOrganizationId}::uuid
              AND "id" = ${draftJournalId}::uuid
          `
      )
    ).rejects.toThrow(/Journal_fxRateSnapshotId_fkey/i);
    await expect(
      withTenantTransaction(
        prisma,
        { organizationId: firstOrganizationId, actorUserId: firstUser.id },
        (tx) =>
          tx.$executeRaw`
            INSERT INTO "JournalLine" (
              "organizationId", "journalId", "accountId", "lineNumber", "debitMinor",
              "creditMinor", "transactionCurrency", "transactionMinor", "baseCurrency",
              "transactionExponentSnapshot", "baseExponentSnapshot",
              "conversionNumerator", "conversionDenominator"
            ) VALUES (
              ${firstOrganizationId}::uuid, ${draftJournalId}::uuid, ${firstAccountId}::uuid,
              1, 135, 0, 'EUR', 100, 'CAD', 2, 2, 27, 20
            )
          `
      )
    ).rejects.toThrow(/Only CAD and USD foreign posting is released/i);
    expect(
      await prisma.monetaryPosition.count({ where: { organizationId: firstOrganizationId } })
    ).toBe(0);
    expect(await prisma.journalLine.count({ where: { journalId: draftJournalId } })).toBe(0);
  });
});
