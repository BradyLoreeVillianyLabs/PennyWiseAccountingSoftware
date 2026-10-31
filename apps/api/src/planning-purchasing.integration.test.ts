import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "planning-owner@example.test";

function headers(organizationId?: string, email = owner) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

interface WorkflowPreference {
  version: number;
  profileKey: "SOLO_SERVICE" | "PROJECT_TRADES" | "BOOKKEEPER_MANAGED" | "PRODUCT_OPERATIONS";
  cashPlanningEnabled: boolean;
  purchaseRequestsEnabled: boolean;
  purchaseApprovalThresholdMinor: string;
  requireSeparatePurchaseApprover: boolean;
  customerDepositsEnabled: boolean;
  progressBillingEnabled: boolean;
  fixedAssetRegisterEnabled: boolean;
  payrollSummaryImportEnabled: boolean;
}

function workflowPayload(
  preferences: WorkflowPreference,
  overrides: Partial<WorkflowPreference> = {}
) {
  return {
    version: preferences.version,
    profileKey: preferences.profileKey,
    cashPlanningEnabled: preferences.cashPlanningEnabled,
    purchaseRequestsEnabled: preferences.purchaseRequestsEnabled,
    purchaseApprovalThresholdMinor: preferences.purchaseApprovalThresholdMinor,
    requireSeparatePurchaseApprover: preferences.requireSeparatePurchaseApprover,
    customerDepositsEnabled: preferences.customerDepositsEnabled,
    progressBillingEnabled: preferences.progressBillingEnabled,
    fixedAssetRegisterEnabled: preferences.fixedAssetRegisterEnabled,
    payrollSummaryImportEnabled: preferences.payrollSummaryImportEnabled,
    ...overrides
  };
}

async function setup() {
  const organization = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "Planning Ltd", displayName: "Planning" }
  });
  const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
  const state = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  const profileUpdate = await app.inject({
    method: "PATCH",
    url: "/v1/setup/profile",
    headers: headers(organizationId),
    payload: {
      version,
      legalName: "Planning Ltd",
      displayName: "Planning",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      baseCurrency: "CAD",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      accountingStartDate: "2026-01-01"
    }
  });
  expect(profileUpdate.statusCode).toBe(200);
  const presetApply = await app.inject({
    method: "POST",
    url: "/v1/setup/presets/general-service/apply",
    headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
    payload: {}
  });
  expect(presetApply.statusCode).toBe(201);
  const preferencesResponse = await app.inject({
    method: "GET",
    url: "/v1/settings/workflow-preferences",
    headers: headers(organizationId)
  });
  const preferences = preferencesResponse.json<{
    workflowPreferences: WorkflowPreference;
  }>().workflowPreferences;
  const workflowUpdate = await app.inject({
    method: "PUT",
    url: "/v1/settings/workflow-preferences",
    headers: headers(organizationId),
    payload: workflowPayload(preferences, { purchaseRequestsEnabled: true })
  });
  expect(workflowUpdate.statusCode).toBe(200);
  await app.inject({
    method: "POST",
    url: "/v1/setup/fiscal-year/initialize",
    headers: headers(organizationId),
    payload: {}
  });
  const accounts = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId)
  });
  const chart = accounts.json<{ accounts: Array<{ id: string; type: string }> }>().accounts;
  return {
    organizationId,
    revenueId: chart.find((account) => account.type === "REVENUE")!.id,
    expenseId: chart.find((account) => account.type === "EXPENSE")!.id
  };
}

describe("planning and purchase-request workflows", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("keeps budgets and forecast assumptions non-posting and versioned", async () => {
    const { organizationId, revenueId } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/v1/budgets",
      headers: headers(organizationId),
      payload: {
        name: "2026 operating plan",
        periodType: "MONTH",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        lines: [
          {
            accountId: revenueId,
            periodStart: "2026-07-01",
            plannedMinor: "500000"
          }
        ]
      }
    });
    expect(created.statusCode, created.body).toBe(201);
    const budget = created.json<{ budget: { id: string; version: number } }>().budget;
    const activated = await app.inject({
      method: "POST",
      url: `/v1/budgets/${budget.id}/activate`,
      headers: headers(organizationId),
      payload: { version: budget.version }
    });
    expect(activated.statusCode).toBe(200);
    const assumption = await app.inject({
      method: "POST",
      url: "/v1/cash-forecast/assumptions",
      headers: headers(organizationId),
      payload: {
        weekStart: "2026-07-27",
        label: "Owner contribution",
        direction: "INFLOW",
        amountMinor: "100000"
      }
    });
    expect(assumption.statusCode).toBe(201);
    const forecast = await app.inject({
      method: "GET",
      url: "/v1/cash-forecast?from=2026-07-27",
      headers: headers(organizationId)
    });
    expect(forecast.statusCode).toBe(200);
    expect(
      forecast.json<{ forecast: { weeks: Array<{ drivers: Array<{ label: string }> }> } }>()
        .forecast.weeks[0]?.drivers
    ).toContainEqual(expect.objectContaining({ label: "Owner contribution" }));
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("requires an explicit approval transition without posting accounting entries", async () => {
    const { organizationId, expenseId } = await setup();
    const vendor = await app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: headers(organizationId),
      payload: {
        vendorNumber: "V-PR-1",
        legalName: "Approval Supplier Ltd",
        displayName: "Approval Supplier",
        defaultPaymentTermsDays: 30
      }
    });
    const vendorId = vendor.json<{ vendor: { id: string } }>().vendor.id;
    const created = await app.inject({
      method: "POST",
      url: "/v1/purchase-requests",
      headers: headers(organizationId),
      payload: {
        requestNumber: "PR-001",
        vendorId,
        requestedDate: "2026-07-29",
        neededByDate: "2026-08-15",
        purpose: "Replacement equipment",
        lines: [
          {
            description: "Replacement equipment",
            quantity: "1.5",
            unitCostMinor: "125000",
            accountId: expenseId
          }
        ]
      }
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ purchaseRequest: { id: string; version: number } }>()
      .purchaseRequest;
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/purchase-requests/${draft.id}/submit`,
      headers: headers(organizationId),
      payload: { version: draft.version }
    });
    expect(submitted.statusCode).toBe(200);
    const pending = submitted.json<{ purchaseRequest: { version: number } }>().purchaseRequest;
    const approved = await app.inject({
      method: "POST",
      url: `/v1/purchase-requests/${draft.id}/approve`,
      headers: headers(organizationId),
      payload: { version: pending.version, decisionNote: "Within budget" }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<{ purchaseRequest: { status: string } }>().purchaseRequest.status).toBe(
      "APPROVED"
    );
    expect(
      approved.json<{ purchaseRequest: { totalMinor: string } }>().purchaseRequest.totalMinor
    ).toBe("187500");
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("automatically approves requests below the configured threshold without a journal", async () => {
    const { organizationId, expenseId } = await setup();
    const current = await app.inject({
      method: "GET",
      url: "/v1/settings/workflow-preferences",
      headers: headers(organizationId)
    });
    const preferences = current.json<{
      workflowPreferences: WorkflowPreference;
    }>().workflowPreferences;
    const configured = await app.inject({
      method: "PUT",
      url: "/v1/settings/workflow-preferences",
      headers: headers(organizationId),
      payload: workflowPayload(preferences, {
        purchaseApprovalThresholdMinor: "200000"
      })
    });
    expect(configured.statusCode).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/v1/purchase-requests",
      headers: headers(organizationId),
      payload: {
        requestNumber: "PR-AUTO-001",
        requestedDate: "2026-07-29",
        purpose: "Below approval threshold",
        lines: [
          {
            description: "Shop supplies",
            quantity: "1",
            unitCostMinor: "100000",
            accountId: expenseId
          }
        ]
      }
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ purchaseRequest: { id: string; version: number } }>()
      .purchaseRequest;
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/purchase-requests/${draft.id}/submit`,
      headers: headers(organizationId),
      payload: { version: draft.version }
    });
    expect(submitted.statusCode).toBe(200);
    expect(
      submitted.json<{
        purchaseRequest: {
          status: string;
          approvedByUserId: string | null;
          decisionNote: string | null;
        };
      }>().purchaseRequest
    ).toMatchObject({
      status: "APPROVED",
      approvedByUserId: null,
      decisionNote: "Automatically approved below the configured threshold."
    });
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("enforces a different authorized approver when the organization requires one", async () => {
    const { organizationId, expenseId } = await setup();
    const current = await app.inject({
      method: "GET",
      url: "/v1/settings/workflow-preferences",
      headers: headers(organizationId)
    });
    const preferences = current.json<{
      workflowPreferences: WorkflowPreference;
    }>().workflowPreferences;
    const configured = await app.inject({
      method: "PUT",
      url: "/v1/settings/workflow-preferences",
      headers: headers(organizationId),
      payload: workflowPayload(preferences, {
        purchaseApprovalThresholdMinor: "0",
        requireSeparatePurchaseApprover: true
      })
    });
    expect(configured.statusCode).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/v1/purchase-requests",
      headers: headers(organizationId),
      payload: {
        requestNumber: "PR-SEPARATE-001",
        requestedDate: "2026-07-29",
        purpose: "Requires independent approval",
        lines: [
          {
            description: "Service equipment",
            quantity: "1",
            unitCostMinor: "250000",
            accountId: expenseId
          }
        ]
      }
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ purchaseRequest: { id: string; version: number } }>()
      .purchaseRequest;
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/purchase-requests/${draft.id}/submit`,
      headers: headers(organizationId),
      payload: { version: draft.version }
    });
    const pending = submitted.json<{ purchaseRequest: { version: number } }>().purchaseRequest;
    const selfApproval = await app.inject({
      method: "POST",
      url: `/v1/purchase-requests/${draft.id}/approve`,
      headers: headers(organizationId),
      payload: { version: pending.version, decisionNote: "Self approval" }
    });
    expect(selfApproval.statusCode).toBe(409);

    const approverEmail = "planning-approver@example.test";
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/invitations",
      headers: headers(organizationId),
      payload: { email: approverEmail, role: "ACCOUNTANT" }
    });
    const token = invitation.json<{ token: string }>().token;
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      headers: headers(undefined, approverEmail),
      payload: { token }
    });
    expect(accepted.statusCode).toBe(200);
    const independentApproval = await app.inject({
      method: "POST",
      url: `/v1/purchase-requests/${draft.id}/approve`,
      headers: headers(organizationId, approverEmail),
      payload: { version: pending.version, decisionNote: "Independently reviewed" }
    });
    expect(independentApproval.statusCode).toBe(200);
    expect(
      independentApproval.json<{ purchaseRequest: { status: string } }>().purchaseRequest.status
    ).toBe("APPROVED");
  });
});
