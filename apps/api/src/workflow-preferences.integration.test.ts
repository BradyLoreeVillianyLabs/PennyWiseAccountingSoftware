import { randomUUID } from "node:crypto";
import { PrismaClient, withTenantTransaction } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "workflow-owner@example.test";

function headers(organizationId?: string, email = owner, idempotencyKey?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
  };
}

async function createOrganization(email = owner) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(undefined, email),
    payload: { legalName: "Workflow Ltd", displayName: "Workflow" }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

interface Preferences {
  id: string;
  version: number;
  profileKey:
    | "INVOICING_ONLY"
    | "SOLO_SERVICE"
    | "PROJECT_TRADES"
    | "BOOKKEEPER_MANAGED"
    | "PRODUCT_OPERATIONS";
  sourcePresetKey: string | null;
  bankFeedReviewRequired: boolean;
  cashPlanningEnabled: boolean;
  purchaseRequestsEnabled: boolean;
  purchaseApprovalThresholdMinor: string;
  requireSeparatePurchaseApprover: boolean;
  customerDepositsEnabled: boolean;
  progressBillingEnabled: boolean;
  fixedAssetRegisterEnabled: boolean;
  ownerWorkspaceEnabled: boolean;
  payrollSummaryImportEnabled: boolean;
  customizedAt: string | null;
}

interface WorkflowResponse {
  workflowPreferences: Preferences;
  profileDefaults: Array<
    Omit<Preferences, "id" | "version" | "sourcePresetKey" | "customizedAt"> & {
      key: Preferences["profileKey"];
      label: string;
    }
  >;
  safetyControls: {
    bankImportReviewRequired: boolean;
    ocrCaptureReviewRequired: boolean;
    automaticPostingEnabled: boolean;
    holdbacksEnabled: boolean;
    payrollSummaryImportAvailable: boolean;
  };
}

async function getPreferences(organizationId: string, email = owner) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/settings/workflow-preferences",
    headers: headers(organizationId, email)
  });
  expect(response.statusCode).toBe(200);
  return response.json<WorkflowResponse>();
}

function updatePayload(preferences: Preferences, overrides: Partial<Preferences> = {}) {
  return {
    version: preferences.version,
    profileKey: preferences.profileKey,
    bankFeedReviewRequired: preferences.bankFeedReviewRequired,
    cashPlanningEnabled: preferences.cashPlanningEnabled,
    purchaseRequestsEnabled: preferences.purchaseRequestsEnabled,
    purchaseApprovalThresholdMinor: preferences.purchaseApprovalThresholdMinor,
    requireSeparatePurchaseApprover: preferences.requireSeparatePurchaseApprover,
    customerDepositsEnabled: preferences.customerDepositsEnabled,
    progressBillingEnabled: preferences.progressBillingEnabled,
    fixedAssetRegisterEnabled: preferences.fixedAssetRegisterEnabled,
    ownerWorkspaceEnabled: preferences.ownerWorkspaceEnabled,
    payrollSummaryImportEnabled: preferences.payrollSummaryImportEnabled,
    ...overrides
  };
}

async function applyAccountPreset(organizationId: string, presetKey: string, email = owner) {
  return app.inject({
    method: "POST",
    url: `/v1/setup/presets/${presetKey}/apply`,
    headers: headers(organizationId, email, randomUUID()),
    payload: {}
  });
}

async function inviteReadOnly(organizationId: string) {
  const email = "workflow-reader@example.test";
  const invitation = await app.inject({
    method: "POST",
    url: "/v1/organizations/current/invitations",
    headers: headers(organizationId),
    payload: { email, role: "READ_ONLY" }
  });
  expect(invitation.statusCode).toBe(201);
  const token = invitation.json<{ token: string }>().token;
  const accepted = await app.inject({
    method: "POST",
    url: "/v1/invitations/accept",
    headers: headers(undefined, email),
    payload: { token }
  });
  expect(accepted.statusCode).toBe(200);
  return email;
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

describe("workflow preferences", () => {
  it("bootstraps a conservative profile and exposes non-adjustable safety controls", async () => {
    const organizationId = await createOrganization();
    const response = await getPreferences(organizationId);

    expect(response.workflowPreferences).toMatchObject({
      version: 1,
      profileKey: "SOLO_SERVICE",
      sourcePresetKey: null,
      bankFeedReviewRequired: true,
      cashPlanningEnabled: true,
      purchaseRequestsEnabled: false,
      purchaseApprovalThresholdMinor: "0",
      requireSeparatePurchaseApprover: false,
      customerDepositsEnabled: false,
      progressBillingEnabled: false,
      fixedAssetRegisterEnabled: false,
      ownerWorkspaceEnabled: true,
      payrollSummaryImportEnabled: false,
      customizedAt: null
    });
    expect(response.safetyControls).toEqual({
      bankImportReviewRequired: true,
      ocrCaptureReviewRequired: true,
      automaticPostingEnabled: false,
      holdbacksEnabled: false,
      payrollSummaryImportAvailable: false
    });
    expect(
      response.profileDefaults.find((profile) => profile.key === "BOOKKEEPER_MANAGED")
    ).toMatchObject({
      requireSeparatePurchaseApprover: true,
      purchaseApprovalThresholdMinor: "0"
    });
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId, action: "WORKFLOW_PREFERENCES_INITIALIZED" }
      })
    ).toBe(1);
  });

  it("seeds once from account presets and never overwrites owner customization", async () => {
    const seededOrganizationId = await createOrganization();
    expect((await applyAccountPreset(seededOrganizationId, "contractor-trades")).statusCode).toBe(
      201
    );
    let seeded = (await getPreferences(seededOrganizationId)).workflowPreferences;
    expect(seeded).toMatchObject({
      profileKey: "PROJECT_TRADES",
      sourcePresetKey: "contractor-trades",
      purchaseRequestsEnabled: true,
      customerDepositsEnabled: true,
      progressBillingEnabled: true,
      fixedAssetRegisterEnabled: true
    });

    await prisma.workflowPreferences.delete({
      where: { organizationId: seededOrganizationId }
    });
    seeded = (await getPreferences(seededOrganizationId)).workflowPreferences;
    expect(seeded).toMatchObject({
      profileKey: "PROJECT_TRADES",
      sourcePresetKey: "contractor-trades"
    });

    const customizedOrganizationId = await createOrganization("custom-workflow@example.test");
    const initial = (await getPreferences(customizedOrganizationId, "custom-workflow@example.test"))
      .workflowPreferences;
    const customized = await app.inject({
      method: "PUT",
      url: "/v1/settings/workflow-preferences",
      headers: headers(customizedOrganizationId, "custom-workflow@example.test"),
      payload: updatePayload(initial, {
        profileKey: "BOOKKEEPER_MANAGED",
        purchaseRequestsEnabled: true,
        purchaseApprovalThresholdMinor: "25000",
        requireSeparatePurchaseApprover: true,
        customerDepositsEnabled: false
      })
    });
    expect(customized.statusCode).toBe(200);
    expect(
      (
        await applyAccountPreset(
          customizedOrganizationId,
          "general-service",
          "custom-workflow@example.test"
        )
      ).statusCode
    ).toBe(201);
    expect(
      (await getPreferences(customizedOrganizationId, "custom-workflow@example.test"))
        .workflowPreferences
    ).toMatchObject({
      profileKey: "BOOKKEEPER_MANAGED",
      sourcePresetKey: null,
      purchaseApprovalThresholdMinor: "25000",
      requireSeparatePurchaseApprover: true,
      customerDepositsEnabled: false
    });
  });

  it("persists the invoicing-only profile through the database constraint", async () => {
    const organizationId = await createOrganization();
    const initial = (await getPreferences(organizationId)).workflowPreferences;
    const response = await app.inject({
      method: "PUT",
      url: "/v1/settings/workflow-preferences",
      headers: headers(organizationId),
      payload: updatePayload(initial, {
        profileKey: "INVOICING_ONLY",
        cashPlanningEnabled: false
      })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<WorkflowResponse>().workflowPreferences).toMatchObject({
      profileKey: "INVOICING_ONLY",
      cashPlanningEnabled: false
    });
    expect(
      await prisma.workflowPreferences.findUniqueOrThrow({ where: { organizationId } })
    ).toMatchObject({ profileKey: "INVOICING_ONLY" });
  });

  it("uses optimistic concurrency, exact minor units, and audited owner updates", async () => {
    const organizationId = await createOrganization();
    const initial = (await getPreferences(organizationId)).workflowPreferences;
    const payload = updatePayload(initial, {
      profileKey: "PRODUCT_OPERATIONS",
      purchaseRequestsEnabled: true,
      purchaseApprovalThresholdMinor: "12345",
      fixedAssetRegisterEnabled: true,
      ownerWorkspaceEnabled: false,
      bankFeedReviewRequired: false,
      payrollSummaryImportEnabled: true
    });
    const [first, stale] = await Promise.all([
      app.inject({
        method: "PUT",
        url: "/v1/settings/workflow-preferences",
        headers: headers(organizationId),
        payload
      }),
      app.inject({
        method: "PUT",
        url: "/v1/settings/workflow-preferences",
        headers: headers(organizationId),
        payload
      })
    ]);
    expect([first.statusCode, stale.statusCode].sort()).toEqual([200, 409]);
    const saved = (await getPreferences(organizationId)).workflowPreferences;
    expect(saved.purchaseApprovalThresholdMinor).toBe("12345");
    expect(saved.payrollSummaryImportEnabled).toBe(false);
    expect(saved.ownerWorkspaceEnabled).toBe(false);
    expect(saved.bankFeedReviewRequired).toBe(false);
    expect(
      (
        await prisma.workflowPreferences.findUniqueOrThrow({
          where: { organizationId }
        })
      ).payrollSummaryImportEnabled
    ).toBe(false);
    expect(saved.customizedAt).not.toBeNull();

    const outOfRange = await app.inject({
      method: "PUT",
      url: "/v1/settings/workflow-preferences",
      headers: headers(organizationId),
      payload: updatePayload(saved, {
        purchaseApprovalThresholdMinor: "9223372036854775808"
      })
    });
    expect(outOfRange.statusCode).toBe(400);
    const immutableControl = await app.inject({
      method: "PUT",
      url: "/v1/settings/workflow-preferences",
      headers: headers(organizationId),
      payload: { ...updatePayload(saved), automaticPostingEnabled: true }
    });
    expect(immutableControl.statusCode).toBe(400);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId, action: "WORKFLOW_PREFERENCES_UPDATED" },
      orderBy: { createdAt: "desc" }
    });
    expect(audit.metadata).toHaveProperty("profileKey", "PRODUCT_OPERATIONS");
    const changedFields = (audit.metadata as { changedFields?: unknown }).changedFields;
    expect(changedFields).toEqual(
      expect.arrayContaining([
        "profileKey",
        "purchaseRequestsEnabled",
        "purchaseApprovalThresholdMinor",
        "ownerWorkspaceEnabled",
        "bankFeedReviewRequired"
      ])
    );
  });

  it("allows read-only visibility while denying updates and cross-tenant reads", async () => {
    const first = await createOrganization();
    const second = await createOrganization("workflow-other-owner@example.test");
    const reader = await inviteReadOnly(first);
    const read = await getPreferences(first, reader);
    expect(read.workflowPreferences.profileKey).toBe("SOLO_SERVICE");

    const deniedUpdate = await app.inject({
      method: "PUT",
      url: "/v1/settings/workflow-preferences",
      headers: headers(first, reader),
      payload: updatePayload(read.workflowPreferences)
    });
    expect(deniedUpdate.statusCode).toBe(403);
    const deniedCrossTenant = await app.inject({
      method: "GET",
      url: "/v1/settings/workflow-preferences",
      headers: headers(second)
    });
    expect(deniedCrossTenant.statusCode).toBe(404);

    const firstOwnerId = (await prisma.user.findUniqueOrThrow({ where: { email: owner } })).id;
    const hidden = await withTenantTransaction(
      prisma,
      { organizationId: first, actorUserId: firstOwnerId },
      (tx) => tx.workflowPreferences.count({ where: { organizationId: second } })
    );
    expect(hidden).toBe(0);
  });
});
