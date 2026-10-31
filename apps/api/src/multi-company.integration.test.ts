import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });

function headers(email: string, organizationId?: string, companyId?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(companyId ? { "x-clearledger-company-id": companyId } : {})
  };
}

describe("multi-company accounting context", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });

  beforeEach(async () => resetDatabase(prisma));

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("backfills a default company, supports safe switching, and scopes core accounts", async () => {
    const owner = "multi-company-owner@example.test";
    const organizationResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(owner),
      payload: {
        legalName: "North Star Workspace Ltd.",
        displayName: "North Star Workspace"
      }
    });
    expect(organizationResponse.statusCode).toBe(201);
    const organizationId = organizationResponse.json<{ organization: { id: string } }>()
      .organization.id;

    const defaultCompanies = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/companies",
      headers: headers(owner, organizationId)
    });
    expect(defaultCompanies.statusCode).toBe(200);
    const firstCompany = defaultCompanies.json<{
      companies: Array<{ id: string; isDefault: boolean }>;
    }>().companies[0];
    expect(firstCompany?.isDefault).toBe(true);

    const firstAccount = await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { code: "9100", name: "North Star income", type: "REVENUE", isControl: false }
    });
    expect(firstAccount.statusCode).toBe(201);
    expect(firstAccount.json<{ account: { companyId: string } }>().account.companyId).toBe(
      firstCompany.id
    );

    const secondCompanyResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/companies",
      headers: headers(owner, organizationId, firstCompany.id),
      payload: {
        legalName: "Aurora Services Inc.",
        displayName: "Aurora Services",
        baseCurrency: "USD",
        timezone: "America/Denver"
      }
    });
    expect(secondCompanyResponse.statusCode).toBe(201);
    const secondCompany = secondCompanyResponse.json<{
      company: { id: string; baseCurrency: string };
    }>().company;
    expect(secondCompany.baseCurrency).toBe("USD");

    const invitation = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/invitations",
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { email: "company-bookkeeper@example.test", role: "BOOKKEEPER" }
    });
    expect(invitation.statusCode).toBe(201);
    const invitationToken = invitation.json<{ token: string }>().token;
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: headers("company-bookkeeper@example.test"),
      payload: { token: invitationToken }
    });
    expect(accepted.statusCode).toBe(200);
    const invitedUserId = accepted.json<{ membership: { userId: string } }>().membership.userId;
    const assigned = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/current/companies/${secondCompany.id}/members/${invitedUserId}`,
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { role: "BOOKKEEPER" }
    });
    expect(assigned.statusCode).toBe(200);

    const switched = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/companies/switch",
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { companyId: secondCompany.id }
    });
    expect(switched.statusCode).toBe(200);

    const secondAccount = await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: headers(owner, organizationId, secondCompany.id),
      payload: { code: "9200", name: "Aurora income", type: "REVENUE", isControl: false }
    });
    expect(secondAccount.statusCode).toBe(201);
    expect(secondAccount.json<{ account: { companyId: string } }>().account.companyId).toBe(
      secondCompany.id
    );

    const isolatedAccounts = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: headers(owner, organizationId, secondCompany.id)
    });
    expect(isolatedAccounts.statusCode).toBe(200);
    expect(
      isolatedAccounts.json<{ accounts: Array<{ code: string }> }>().accounts.map((a) => a.code)
    ).toEqual(["9100", "9200"]);

    const concurrentReads = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: "GET",
          url: "/v1/accounts",
          headers: headers(
            owner,
            organizationId,
            index % 2 === 0 ? firstCompany.id : secondCompany.id
          )
        })
      )
    );
    expect(concurrentReads.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(
      concurrentReads[0]!
        .json<{ accounts: Array<{ companyId: string }> }>()
        .accounts.every((account) => account.companyId === firstCompany.id)
    ).toBe(true);
    expect(
      concurrentReads[1]!
        .json<{ accounts: Array<{ companyId: string }> }>()
        .accounts.every((account) => account.companyId === secondCompany.id)
    ).toBe(true);

    const unauthorized = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/companies",
      headers: headers("unrelated-user@example.test", organizationId, secondCompany.id)
    });
    expect(unauthorized.statusCode).toBe(404);
    expect(unauthorized.json<{ error: { code: string } }>().error.code).toBe(
      "ORGANIZATION_NOT_FOUND"
    );
  });

  it("rejects a company identifier from another organization", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers("first-company-user@example.test"),
      payload: { legalName: "First Company Ltd.", displayName: "First Company" }
    });
    const firstOrganizationId = first.json<{ organization: { id: string } }>().organization.id;
    const firstCompanies = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/companies",
      headers: headers("first-company-user@example.test", firstOrganizationId)
    });
    const firstCompanyId = firstCompanies.json<{ companies: Array<{ id: string }> }>().companies[0]!
      .id;

    const second = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers("second-company-user@example.test"),
      payload: { legalName: "Second Company Ltd.", displayName: "Second Company" }
    });
    const secondOrganizationId = second.json<{ organization: { id: string } }>().organization.id;
    const response = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/companies",
      headers: headers("second-company-user@example.test", secondOrganizationId, firstCompanyId)
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("COMPANY_NOT_FOUND");
  });

  it("creates and removes a company with confirmation while retaining audit records", async () => {
    const owner = "company-lifecycle-owner@example.test";
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(owner),
      payload: { legalName: "Lifecycle Workspace Ltd.", displayName: "Lifecycle Workspace" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const initial = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/companies",
      headers: headers(owner, organizationId)
    });
    const firstCompany = initial.json<{
      companies: Array<{ id: string; displayName: string }>;
    }>().companies[0]!;

    const created = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/companies",
      headers: headers(owner, organizationId, firstCompany.id),
      payload: {
        legalName: "Lifecycle Services Inc.",
        displayName: "Lifecycle Services"
      }
    });
    expect(created.statusCode).toBe(201);
    const secondCompany = created.json<{
      company: { id: string; displayName: string };
    }>().company;

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/current/companies/${secondCompany.id}`,
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { displayName: "Lifecycle Services Updated", timezone: "America/Toronto" }
    });
    expect(updated.statusCode).toBe(200);
    expect(
      updated.json<{ company: { displayName: string; timezone: string } }>().company
    ).toMatchObject({ displayName: "Lifecycle Services Updated", timezone: "America/Toronto" });

    const mismatch = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/current/companies/${secondCompany.id}`,
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { confirmation: "Wrong company" }
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json<{ error: { code: string } }>().error.code).toBe(
      "COMPANY_DELETE_CONFIRMATION_MISMATCH"
    );

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/current/companies/${secondCompany.id}`,
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { confirmation: "Lifecycle Services Updated" }
    });
    expect(removed.statusCode).toBe(200);
    expect(
      removed.json<{ result: { replacementCompanyId: string } }>().result.replacementCompanyId
    ).toBe(firstCompany.id);
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: secondCompany.id } })).status
    ).toBe("ARCHIVED");

    const remaining = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/companies",
      headers: headers(owner, organizationId, firstCompany.id)
    });
    expect(
      remaining.json<{ companies: Array<{ id: string }> }>().companies.map((item) => item.id)
    ).toEqual([firstCompany.id]);

    const lastCompany = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/current/companies/${firstCompany.id}`,
      headers: headers(owner, organizationId, firstCompany.id),
      payload: { confirmation: firstCompany.displayName }
    });
    expect(lastCompany.statusCode).toBe(409);
    expect(lastCompany.json<{ error: { code: string } }>().error.code).toBe("COMPANY_LAST_ACTIVE");
  });

  it("keeps intercompany and consolidation work explicit and non-posting", async () => {
    const owner = "intercompany-owner@example.test";
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(owner),
      payload: { legalName: "Group Workspace Ltd.", displayName: "Group Workspace" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const companies = await app.inject({
      method: "GET",
      url: "/v1/organizations/current/companies",
      headers: headers(owner, organizationId)
    });
    const firstCompanyId = companies.json<{ companies: Array<{ id: string }> }>().companies[0]!.id;
    const second = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/companies",
      headers: headers(owner, organizationId, firstCompanyId),
      payload: {
        legalName: "Group Services Inc.",
        displayName: "Group Services",
        baseCurrency: "USD"
      }
    });
    const secondCompanyId = second.json<{ company: { id: string } }>().company.id;

    const created = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/intercompany/transactions",
      headers: headers(owner, organizationId, firstCompanyId),
      payload: {
        fromCompanyId: firstCompanyId,
        toCompanyId: secondCompanyId,
        amountMinor: "12500",
        currency: "CAD",
        effectiveDate: "2026-08-08",
        sourceType: "manual_intercompany",
        sourceId: "ic-001",
        description: "Shared services allocation"
      }
    });
    expect(created.statusCode).toBe(201);
    const transactionId = created.json<{ transaction: { id: string; postingCreated: boolean } }>()
      .transaction.id;
    expect(
      created.json<{ transaction: { postingCreated: boolean } }>().transaction.postingCreated
    ).toBe(false);

    const proposed = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/intercompany/transactions/${transactionId}/transition`,
      headers: headers(owner, organizationId, firstCompanyId),
      payload: { status: "PROPOSED" }
    });
    expect(proposed.statusCode).toBe(200);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/intercompany/transactions/${transactionId}/transition`,
      headers: headers(owner, organizationId, firstCompanyId),
      payload: { status: "APPROVED" }
    });
    expect(approved.statusCode).toBe(200);

    const group = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/consolidation-groups",
      headers: headers(owner, organizationId, firstCompanyId),
      payload: {
        name: "Group Workspace Consolidation",
        baseCurrency: "CAD",
        companyIds: [firstCompanyId, secondCompanyId]
      }
    });
    expect(group.statusCode).toBe(201);
    expect(
      group.json<{ group: { configurationRequired: boolean; postingsCreated: number } }>().group
    ).toMatchObject({
      configurationRequired: true,
      postingsCreated: 0
    });
  });
});
