import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "deposit-progress-owner@example.test";

interface WorkflowPreferences {
  version: number;
  profileKey: string;
  cashPlanningEnabled: boolean;
  purchaseRequestsEnabled: boolean;
  purchaseApprovalThresholdMinor: string;
  requireSeparatePurchaseApprover: boolean;
  customerDepositsEnabled: boolean;
  progressBillingEnabled: boolean;
  fixedAssetRegisterEnabled: boolean;
  payrollSummaryImportEnabled: boolean;
}

interface EstimateDto {
  id: string;
  version: number;
  status: string;
  subtotalMinor: string;
  taxTotalMinor: string;
  grandTotalMinor: string;
  lines: Array<{ id: string; lineNumber: number }>;
}

interface DepositRequestDto {
  id: string;
  version: number;
  status: string;
  classification: string;
  amountMinor: string;
  financialState: string;
  capabilities: { financialPosting: boolean };
}

interface ProgressBillingPlanDto {
  id: string;
  version: number;
  status: string;
  estimateVersionSnapshot: number;
  estimateSubtotalSnapshotMinor: string;
  estimateTaxSnapshotMinor: string;
  estimateTotalSnapshotMinor: string;
  financialState: string;
  capabilities: { financialPosting: boolean };
  milestones: Array<{
    sequence: number;
    basis: string;
    ratioMicros: string | null;
    plannedNetMinor: string;
    estimatedTaxMinor: string;
    estimatedTotalMinor: string;
    allocations: Array<{
      estimateLineId: string;
      plannedNetMinor: string;
      estimatedTaxMinor: string;
      estimatedTotalMinor: string;
    }>;
  }>;
}

function headers(organizationId?: string, idempotencyKey?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Deposit Progress Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
  };
}

async function createOrganization(name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: `${name} Ltd`, displayName: name }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configure(organizationId: string) {
  const state = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  expect(state.statusCode, state.body).toBe(200);
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  const profile = await app.inject({
    method: "PATCH",
    url: "/v1/setup/profile",
    headers: headers(organizationId),
    payload: {
      version,
      legalName: "Deposit Progress Ltd",
      displayName: "Deposit Progress",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      baseCurrency: "CAD",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      accountingStartDate: "2026-01-01"
    }
  });
  expect(profile.statusCode, profile.body).toBe(200);
  const preset = await app.inject({
    method: "POST",
    url: "/v1/setup/presets/general-service/apply",
    headers: headers(organizationId, randomUUID()),
    payload: {}
  });
  expect(preset.statusCode, preset.body).toBe(201);
  const fiscalYear = await app.inject({
    method: "POST",
    url: "/v1/setup/fiscal-year/initialize",
    headers: headers(organizationId),
    payload: {}
  });
  expect(fiscalYear.statusCode, fiscalYear.body).toBe(200);
}

async function enableProjectTrades(organizationId: string) {
  const currentResponse = await app.inject({
    method: "GET",
    url: "/v1/settings/workflow-preferences",
    headers: headers(organizationId)
  });
  expect(currentResponse.statusCode, currentResponse.body).toBe(200);
  const current = currentResponse.json<{ workflowPreferences: WorkflowPreferences }>()
    .workflowPreferences;
  const updatedResponse = await app.inject({
    method: "PUT",
    url: "/v1/settings/workflow-preferences",
    headers: headers(organizationId),
    payload: {
      version: current.version,
      profileKey: "PROJECT_TRADES",
      cashPlanningEnabled: true,
      purchaseRequestsEnabled: true,
      purchaseApprovalThresholdMinor: "0",
      requireSeparatePurchaseApprover: false,
      customerDepositsEnabled: true,
      progressBillingEnabled: true,
      fixedAssetRegisterEnabled: true,
      payrollSummaryImportEnabled: false
    }
  });
  expect(updatedResponse.statusCode, updatedResponse.body).toBe(200);
  expect(
    updatedResponse.json<{ workflowPreferences: WorkflowPreferences }>().workflowPreferences
  ).toMatchObject({
    profileKey: "PROJECT_TRADES",
    customerDepositsEnabled: true,
    progressBillingEnabled: true
  });
}

async function createCustomer(organizationId: string, customerNumber: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: headers(organizationId),
    payload: {
      customerNumber,
      displayName,
      email: `${customerNumber.toLowerCase()}@example.test`,
      defaultPaymentTermsDays: 30,
      defaultCurrency: "CAD"
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ customer: { id: string } }>().customer.id;
}

async function createProject(organizationId: string, customerId: string, projectNumber: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: headers(organizationId),
    payload: {
      customerId,
      projectNumber,
      name: `Project ${projectNumber}`,
      billingMethod: "FIXED",
      tags: []
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ project: { id: string } }>().project.id;
}

async function createTaxCode(organizationId: string) {
  const accounts = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId)
  });
  expect(accounts.statusCode, accounts.body).toBe(200);
  const taxPayable = accounts
    .json<{ accounts: Array<{ id: string; systemPurpose: string | null }> }>()
    .accounts.find((account) => account.systemPurpose === "tax-payable");
  expect(taxPayable).toBeDefined();
  const response = await app.inject({
    method: "POST",
    url: "/v1/setup/tax-codes/versions",
    headers: headers(organizationId),
    payload: {
      code: "GST",
      name: "GST",
      treatment: "STANDARD",
      calculationMode: "EXCLUSIVE",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      sourceName: "Deposit and progress billing integration fixture",
      sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
      components: [
        {
          name: "GST",
          jurisdiction: "CA",
          rate: "0.050000",
          recoverablePercent: "1.000000",
          payableAccountId: taxPayable!.id,
          recoverableAccountId: null
        }
      ]
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ taxCodeVersion: { taxCodeId: string } }>().taxCodeVersion.taxCodeId;
}

async function createAcceptedEstimate(
  organizationId: string,
  customerId: string,
  taxCodeId: string
) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/estimates",
    headers: headers(organizationId),
    payload: {
      customerId,
      issueDate: "2026-07-29",
      lines: [
        {
          description: "Foundation work",
          quantity: "1",
          unitPriceMinor: "10000",
          taxCodeId
        },
        {
          description: "Framing work",
          quantity: "2",
          unitPriceMinor: "10000",
          taxCodeId
        }
      ]
    }
  });
  expect(created.statusCode, created.body).toBe(201);
  const draft = created.json<{ estimate: EstimateDto }>().estimate;
  const sent = await app.inject({
    method: "POST",
    url: `/v1/estimates/${draft.id}/send`,
    headers: headers(organizationId),
    payload: { version: draft.version }
  });
  expect(sent.statusCode, sent.body).toBe(200);
  const sentEstimate = sent.json<{ estimate: EstimateDto }>().estimate;
  const accepted = await app.inject({
    method: "POST",
    url: `/v1/estimates/${draft.id}/accept`,
    headers: headers(organizationId),
    payload: { version: sentEstimate.version }
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const estimate = accepted.json<{ estimate: EstimateDto }>().estimate;
  expect(estimate).toMatchObject({
    status: "ACCEPTED",
    subtotalMinor: "30000",
    taxTotalMinor: "1500",
    grandTotalMinor: "31500"
  });
  return estimate;
}

function depositPayload(customerId: string, projectId?: string) {
  return {
    requestNumber: "DEP-001",
    customerId,
    ...(projectId ? { projectId } : {}),
    classification: "REFUNDABLE_DEPOSIT" as const,
    requestDate: "2026-07-29",
    dueDate: "2026-08-05",
    amountMinor: "5000",
    currency: "CAD" as const,
    purpose: "Refundable mobilization security",
    customerMessage: "Held as a refundable deposit until the agreed conditions are met."
  };
}

function progressPayload(projectId?: string) {
  return {
    planNumber: "PB-001",
    ...(projectId ? { projectId } : {}),
    notes: "Approved schedule only; invoice creation remains disabled.",
    milestones: [
      {
        name: "Mobilization",
        customerDescription: "Forty percent after mobilization.",
        dueDate: "2026-08-15",
        basis: "PERCENT_OF_ESTIMATE" as const,
        ratioMicros: "400000"
      },
      {
        name: "Completion",
        customerDescription: "All remaining estimate value.",
        dueDate: "2026-09-15",
        basis: "REMAINING_BALANCE" as const
      }
    ]
  };
}

function sum(values: readonly string[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

async function expectNoFinancialDocuments(organizationId: string) {
  expect(await prisma.payment.count({ where: { organizationId } })).toBe(0);
  expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
  expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
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

describe("customer deposits and progress billing", () => {
  it("gates deposits, requires explicit classification and idempotency, and never posts", async () => {
    const organizationId = await createOrganization("Deposit Workflow");
    await configure(organizationId);
    const customerId = await createCustomer(organizationId, "C-DEP", "Deposit Customer");
    const payload = depositPayload(customerId);

    const missingIdempotency = await app.inject({
      method: "POST",
      url: "/v1/customer-deposit-requests",
      headers: headers(organizationId),
      payload
    });
    expect(missingIdempotency.statusCode).toBe(400);
    expect(missingIdempotency.json<{ error: { code: string } }>().error.code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED"
    );

    const missingClassificationPayload = { ...payload, classification: undefined };
    const missingClassification = await app.inject({
      method: "POST",
      url: "/v1/customer-deposit-requests",
      headers: headers(organizationId, randomUUID()),
      payload: missingClassificationPayload
    });
    expect(missingClassification.statusCode).toBe(400);
    expect(missingClassification.json<{ error: { code: string } }>().error.code).toBe(
      "VALIDATION_ERROR"
    );

    const disabled = await app.inject({
      method: "POST",
      url: "/v1/customer-deposit-requests",
      headers: headers(organizationId, randomUUID()),
      payload
    });
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json<{ error: { code: string } }>().error.code).toBe(
      "CUSTOMER_DEPOSITS_DISABLED"
    );
    await enableProjectTrades(organizationId);

    const createKey = randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/v1/customer-deposit-requests",
      headers: headers(organizationId, createKey),
      payload
    });
    expect(created.statusCode, created.body).toBe(201);
    const deposit = created.json<{ depositRequest: DepositRequestDto }>().depositRequest;
    expect(deposit).toMatchObject({
      status: "DRAFT",
      classification: "REFUNDABLE_DEPOSIT",
      amountMinor: "5000",
      financialState: "NON_POSTING",
      capabilities: { financialPosting: false }
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/customer-deposit-requests",
      headers: headers(organizationId, createKey),
      payload
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json<{ depositRequest: DepositRequestDto }>().depositRequest.id).toBe(deposit.id);
    expect(await prisma.customerDepositRequest.count({ where: { organizationId } })).toBe(1);

    const submitted = await app.inject({
      method: "POST",
      url: `/v1/customer-deposit-requests/${deposit.id}/submit`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: deposit.version }
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const submittedDeposit = submitted.json<{ depositRequest: DepositRequestDto }>().depositRequest;
    expect(submittedDeposit.status).toBe("SUBMITTED");
    const approved = await app.inject({
      method: "POST",
      url: `/v1/customer-deposit-requests/${deposit.id}/approve`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: submittedDeposit.version }
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json<{ depositRequest: DepositRequestDto }>().depositRequest).toMatchObject({
      status: "APPROVED",
      financialState: "NON_POSTING",
      capabilities: { financialPosting: false }
    });
    await expectNoFinancialDocuments(organizationId);
    const otherOrganizationId = await createOrganization("Isolated Deposit Workflow");
    const hiddenDeposit = await app.inject({
      method: "GET",
      url: `/v1/customer-deposit-requests/${deposit.id}`,
      headers: headers(otherOrganizationId)
    });
    expect(hiddenDeposit.statusCode).toBe(404);
  });

  it("reconciles percentage and final-balance milestones without creating financial records", async () => {
    const organizationId = await createOrganization("Progress Workflow");
    await configure(organizationId);
    const customerId = await createCustomer(organizationId, "C-PROG", "Progress Customer");
    const otherCustomerId = await createCustomer(
      organizationId,
      "C-OTHER",
      "Other Project Customer"
    );
    const projectId = await createProject(organizationId, customerId, "P-PROG");
    const otherProjectId = await createProject(organizationId, otherCustomerId, "P-OTHER");
    const taxCodeId = await createTaxCode(organizationId);
    const estimate = await createAcceptedEstimate(organizationId, customerId, taxCodeId);
    const payload = progressPayload(projectId);

    const disabled = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/progress-billing-plans`,
      headers: headers(organizationId, randomUUID()),
      payload
    });
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json<{ error: { code: string } }>().error.code).toBe(
      "PROGRESS_BILLING_DISABLED"
    );
    await enableProjectTrades(organizationId);

    const crossCustomerProject = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/progress-billing-plans`,
      headers: headers(organizationId, randomUUID()),
      payload: progressPayload(otherProjectId)
    });
    expect(crossCustomerProject.statusCode).toBe(422);
    expect(crossCustomerProject.json<{ error: { code: string } }>().error.code).toBe(
      "PROGRESS_PROJECT_CUSTOMER_MISMATCH"
    );

    const created = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/progress-billing-plans`,
      headers: headers(organizationId, randomUUID()),
      payload
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ progressBillingPlan: ProgressBillingPlanDto }>()
      .progressBillingPlan;
    expect(draft).toMatchObject({
      status: "DRAFT",
      estimateVersionSnapshot: estimate.version,
      estimateSubtotalSnapshotMinor: estimate.subtotalMinor,
      estimateTaxSnapshotMinor: estimate.taxTotalMinor,
      estimateTotalSnapshotMinor: estimate.grandTotalMinor,
      financialState: "NON_POSTING",
      capabilities: { financialPosting: false }
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/progress-billing-plans/${draft.id}`,
      headers: headers(organizationId)
    });
    expect(detailResponse.statusCode, detailResponse.body).toBe(200);
    const detail = detailResponse.json<{ progressBillingPlan: ProgressBillingPlanDto }>()
      .progressBillingPlan;
    expect(detail.milestones).toHaveLength(2);
    expect(detail.milestones[0]).toMatchObject({
      sequence: 1,
      basis: "PERCENT_OF_ESTIMATE",
      ratioMicros: "400000",
      plannedNetMinor: "12000",
      estimatedTaxMinor: "600",
      estimatedTotalMinor: "12600"
    });
    expect(detail.milestones[1]).toMatchObject({
      sequence: 2,
      basis: "REMAINING_BALANCE",
      ratioMicros: null,
      plannedNetMinor: "18000",
      estimatedTaxMinor: "900",
      estimatedTotalMinor: "18900"
    });
    expect(sum(detail.milestones.map((milestone) => milestone.plannedNetMinor))).toBe(
      BigInt(estimate.subtotalMinor)
    );
    expect(sum(detail.milestones.map((milestone) => milestone.estimatedTaxMinor))).toBe(
      BigInt(estimate.taxTotalMinor)
    );
    expect(sum(detail.milestones.map((milestone) => milestone.estimatedTotalMinor))).toBe(
      BigInt(estimate.grandTotalMinor)
    );
    for (const milestone of detail.milestones) {
      expect(sum(milestone.allocations.map((allocation) => allocation.plannedNetMinor))).toBe(
        BigInt(milestone.plannedNetMinor)
      );
      expect(sum(milestone.allocations.map((allocation) => allocation.estimatedTaxMinor))).toBe(
        BigInt(milestone.estimatedTaxMinor)
      );
      expect(sum(milestone.allocations.map((allocation) => allocation.estimatedTotalMinor))).toBe(
        BigInt(milestone.estimatedTotalMinor)
      );
      for (const allocation of milestone.allocations) {
        expect(BigInt(allocation.estimatedTotalMinor)).toBe(
          BigInt(allocation.plannedNetMinor) + BigInt(allocation.estimatedTaxMinor)
        );
      }
    }
    for (const line of estimate.lines) {
      const source = await prisma.estimateLine.findUniqueOrThrow({ where: { id: line.id } });
      const allocations = detail.milestones.flatMap((milestone) =>
        milestone.allocations.filter((allocation) => allocation.estimateLineId === line.id)
      );
      expect(sum(allocations.map((allocation) => allocation.plannedNetMinor))).toBe(
        source.netAmountMinor
      );
      expect(sum(allocations.map((allocation) => allocation.estimatedTaxMinor))).toBe(
        source.taxTotalMinor
      );
      expect(sum(allocations.map((allocation) => allocation.estimatedTotalMinor))).toBe(
        source.totalMinor
      );
    }

    const submitted = await app.inject({
      method: "POST",
      url: `/v1/progress-billing-plans/${draft.id}/submit`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: draft.version }
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const submittedPlan = submitted.json<{ progressBillingPlan: ProgressBillingPlanDto }>()
      .progressBillingPlan;
    const approved = await app.inject({
      method: "POST",
      url: `/v1/progress-billing-plans/${draft.id}/approve`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: submittedPlan.version }
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const approvedPlan = approved.json<{ progressBillingPlan: ProgressBillingPlanDto }>()
      .progressBillingPlan;
    expect(approvedPlan).toMatchObject({
      status: "APPROVED",
      financialState: "NON_POSTING",
      capabilities: { financialPosting: false }
    });
    await expectNoFinancialDocuments(organizationId);

    const otherOrganizationId = await createOrganization("Isolated Workflow");
    const hiddenPlan = await app.inject({
      method: "GET",
      url: `/v1/progress-billing-plans/${draft.id}`,
      headers: headers(otherOrganizationId)
    });
    expect(hiddenPlan.statusCode).toBe(404);

    const blockedConversion = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/convert`,
      headers: headers(organizationId),
      payload: { version: estimate.version }
    });
    expect(blockedConversion.statusCode).toBe(409);
    expect(blockedConversion.json<{ error: { code: string } }>().error.code).toBe(
      "ESTIMATE_HAS_ACTIVE_PROGRESS_PLAN"
    );
    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/progress-billing-plans/${draft.id}/cancel`,
      headers: headers(organizationId, randomUUID()),
      payload: {
        version: approvedPlan.version,
        reason: "Customer requested a single final invoice instead."
      }
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(
      cancelled.json<{ progressBillingPlan: ProgressBillingPlanDto }>().progressBillingPlan.status
    ).toBe("CANCELLED");
    const converted = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/convert`,
      headers: headers(organizationId),
      payload: { version: estimate.version }
    });
    expect(converted.statusCode, converted.body).toBe(201);
    expect(
      await prisma.invoice.count({ where: { organizationId, sourceEstimateId: estimate.id } })
    ).toBe(1);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("rejects stale estimate snapshots and cross-customer deposit references", async () => {
    const organizationId = await createOrganization("Snapshot Workflow");
    await configure(organizationId);
    await enableProjectTrades(organizationId);
    const customerId = await createCustomer(organizationId, "C-SNAP", "Snapshot Customer");
    const otherCustomerId = await createCustomer(organizationId, "C-SNAP-2", "Different Customer");
    const otherProjectId = await createProject(organizationId, otherCustomerId, "P-SNAP-2");
    const taxCodeId = await createTaxCode(organizationId);
    const estimate = await createAcceptedEstimate(organizationId, customerId, taxCodeId);

    const mismatchedDeposit = await app.inject({
      method: "POST",
      url: "/v1/customer-deposit-requests",
      headers: headers(organizationId, randomUUID()),
      payload: depositPayload(customerId, otherProjectId)
    });
    expect(mismatchedDeposit.statusCode).toBe(422);
    expect(mismatchedDeposit.json<{ error: { code: string } }>().error.code).toBe(
      "CUSTOMER_DEPOSIT_CUSTOMER_MISMATCH"
    );

    const created = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/progress-billing-plans`,
      headers: headers(organizationId, randomUUID()),
      payload: progressPayload()
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ progressBillingPlan: ProgressBillingPlanDto }>()
      .progressBillingPlan;
    await prisma.estimate.update({
      where: { id: estimate.id },
      data: { version: { increment: 1 } }
    });
    const stale = await app.inject({
      method: "POST",
      url: `/v1/progress-billing-plans/${draft.id}/submit`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: draft.version }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe("PROGRESS_ESTIMATE_CHANGED");
    expect(
      await prisma.progressBillingPlan.findUniqueOrThrow({ where: { id: draft.id } })
    ).toMatchObject({ status: "DRAFT", version: draft.version });
    await expectNoFinancialDocuments(organizationId);
  });

  it("enforces ancestry, lifecycle evidence, and exact reconciliation in PostgreSQL", async () => {
    const organizationId = await createOrganization("Database Integrity Workflow");
    await configure(organizationId);
    await enableProjectTrades(organizationId);
    const customerId = await createCustomer(organizationId, "C-DB-1", "Database Customer");
    const otherCustomerId = await createCustomer(
      organizationId,
      "C-DB-2",
      "Other Database Customer"
    );
    const projectId = await createProject(organizationId, customerId, "P-DB-1");
    const otherProjectId = await createProject(organizationId, otherCustomerId, "P-DB-2");
    const taxCodeId = await createTaxCode(organizationId);
    const estimate = await createAcceptedEstimate(organizationId, customerId, taxCodeId);
    const otherEstimate = await createAcceptedEstimate(organizationId, otherCustomerId, taxCodeId);

    const depositResponse = await app.inject({
      method: "POST",
      url: "/v1/customer-deposit-requests",
      headers: headers(organizationId, randomUUID()),
      payload: {
        ...depositPayload(customerId, projectId),
        estimateId: estimate.id,
        requestNumber: "DEP-DB-001"
      }
    });
    expect(depositResponse.statusCode, depositResponse.body).toBe(201);
    const deposit = depositResponse.json<{ depositRequest: DepositRequestDto }>().depositRequest;
    await expect(
      prisma.customerDepositRequest.update({
        where: { id: deposit.id },
        data: { customerId: otherCustomerId }
      })
    ).rejects.toThrow("must belong to the selected customer");
    await expect(
      prisma.customerDepositRequest.update({
        where: { id: deposit.id },
        data: { status: "APPROVED" }
      })
    ).rejects.toThrow();

    const planResponse = await app.inject({
      method: "POST",
      url: `/v1/estimates/${estimate.id}/progress-billing-plans`,
      headers: headers(organizationId, randomUUID()),
      payload: { ...progressPayload(projectId), planNumber: "PB-DB-001" }
    });
    expect(planResponse.statusCode, planResponse.body).toBe(201);
    const plan = planResponse.json<{ progressBillingPlan: ProgressBillingPlanDto }>()
      .progressBillingPlan;
    await expect(
      prisma.progressBillingPlan.update({
        where: { id: plan.id },
        data: { projectId: otherProjectId }
      })
    ).rejects.toThrow("must belong to the same customer");
    await expect(
      prisma.progressBillingPlan.update({
        where: { id: plan.id },
        data: { status: "APPROVED" }
      })
    ).rejects.toThrow();

    const milestone = await prisma.progressBillingMilestone.findFirstOrThrow({
      where: { organizationId, progressBillingPlanId: plan.id },
      orderBy: { sequence: "asc" }
    });
    await expect(
      prisma.progressBillingMilestone.update({
        where: { id: milestone.id },
        data: {
          plannedNetMinor: milestone.plannedNetMinor + 1n,
          estimatedTotalMinor: milestone.estimatedTotalMinor + 1n
        }
      })
    ).rejects.toThrow("must reconcile exactly to the estimate snapshot");

    const allocation = await prisma.progressBillingAllocation.findFirstOrThrow({
      where: {
        organizationId,
        progressBillingMilestone: { progressBillingPlanId: plan.id }
      }
    });
    await expect(
      prisma.progressBillingAllocation.update({
        where: { id: allocation.id },
        data: { estimateLineId: otherEstimate.lines[0]!.id }
      })
    ).rejects.toThrow("must reference lines from the plan estimate");
    await expectNoFinancialDocuments(organizationId);
  });
});
