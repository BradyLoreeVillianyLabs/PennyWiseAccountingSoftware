import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });

describe("payroll HTTP workflow", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });

  beforeEach(async () => resetDatabase(prisma));

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("exposes a controlled scheduled-draft workflow without exposing payment or filing as enabled", async () => {
    const fixture = await createFixture();
    const headers = organizationHeaders(fixture.email, fixture.organizationId);

    const initial = await app.inject({
      method: "GET",
      url: "/v1/payroll/overview",
      headers
    });
    expect(initial.statusCode).toBe(200);
    const initialPayroll = initial.json<{
      payroll: {
        settings: unknown;
        caAbBaseCodes: { ready: boolean; missing: string[]; invalid: string[] };
        capabilities: {
          scheduledDrafts: { enabled: boolean };
          automaticPosting: { enabled: boolean };
          directDeposit: { enabled: boolean };
          taxFiling: { enabled: boolean };
          providerGates: {
            directDeposit: { status: string; blockers: string[] };
            taxFiling: { status: string; blockers: string[] };
          };
          releasedPostingJurisdictions: string[];
        };
      };
    }>().payroll;
    expect(initialPayroll.settings).toBeNull();
    expect(initialPayroll.caAbBaseCodes.ready).toBe(false);
    expect(initialPayroll.caAbBaseCodes.missing).toEqual(
      expect.arrayContaining(["GROSS_PAY", "CA_CPP_EMPLOYEE", "CA_TD1_ADDITIONAL_TAX"])
    );
    expect(initialPayroll.caAbBaseCodes.invalid).toEqual([]);
    expect(initialPayroll.capabilities).toMatchObject({
      scheduledDrafts: { enabled: true },
      automaticPosting: { enabled: false },
      directDeposit: { enabled: false },
      taxFiling: { enabled: false },
      releasedPostingJurisdictions: ["CA-AB"]
    });
    expect(initialPayroll.capabilities.providerGates).toMatchObject({
      directDeposit: {
        status: "PROVIDER_REQUIRED"
      },
      taxFiling: {
        status: "PROVIDER_REQUIRED"
      }
    });
    expect(initialPayroll.capabilities.providerGates.directDeposit.blockers).toContain(
      "PAYROLL_DIRECT_DEPOSIT_ADAPTER_NOT_IMPLEMENTED"
    );
    expect(initialPayroll.capabilities.providerGates.taxFiling.blockers).toContain(
      "PAYROLL_TAX_FILING_ADAPTER_NOT_IMPLEMENTED"
    );

    const invalidAccountTypes = await app.inject({
      method: "PUT",
      url: "/v1/payroll/settings",
      headers,
      payload: {
        defaultExpenseAccountId: fixture.liabilityAccountId,
        defaultLiabilityAccountId: fixture.expenseAccountId,
        netPayClearingAccountId: fixture.clearingAccountId,
        calculationRulePackId: "clearledger-payroll-ca-ab",
        calculationRulePackVersion: "2026.2"
      }
    });
    expect(invalidAccountTypes.statusCode).toBe(422);
    expect(invalidAccountTypes.json<{ error: { code: string } }>().error.code).toBe(
      "PAYROLL_LEDGER_ACCOUNT_TYPE_INVALID"
    );

    const configured = await app.inject({
      method: "PUT",
      url: "/v1/payroll/settings",
      headers,
      payload: {
        defaultExpenseAccountId: fixture.expenseAccountId,
        defaultLiabilityAccountId: fixture.liabilityAccountId,
        netPayClearingAccountId: fixture.clearingAccountId,
        calculationRulePackId: "clearledger-payroll-ca-ab",
        calculationRulePackVersion: "2026.2"
      }
    });
    expect(configured.statusCode, configured.body).toBe(200);

    const rejectedWithoutIdempotency = await app.inject({
      method: "POST",
      url: "/v1/payroll/workers",
      headers,
      payload: workerPayload("E-REJECT")
    });
    expect(rejectedWithoutIdempotency.statusCode).toBe(400);
    expect(rejectedWithoutIdempotency.json<{ error: { code: string } }>().error.code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED"
    );

    const workerResponse = await app.inject({
      method: "POST",
      url: "/v1/payroll/workers",
      headers: { ...headers, "idempotency-key": `worker-${fixture.suffix}` },
      payload: workerPayload("E-100")
    });
    expect(workerResponse.statusCode, workerResponse.body).toBe(201);
    const workerId = workerResponse.json<{ payrollWorker: { id: string } }>().payrollWorker.id;

    const scheduleResponse = await app.inject({
      method: "POST",
      url: "/v1/payroll/schedules",
      headers: { ...headers, "idempotency-key": `schedule-${fixture.suffix}` },
      payload: {
        code: "BIWEEKLY",
        name: "Biweekly staff",
        frequency: "BIWEEKLY",
        anchorPayDate: "2026-01-16",
        automaticDraftsEnabled: true,
        draftLeadDays: 3
      }
    });
    expect(scheduleResponse.statusCode, scheduleResponse.body).toBe(201);
    const scheduleId = scheduleResponse.json<{ payrollSchedule: { id: string } }>().payrollSchedule
      .id;

    const draftResponse = await app.inject({
      method: "POST",
      url: `/v1/payroll/schedules/${scheduleId}/generate-draft`,
      headers: { ...headers, "idempotency-key": `draft-${fixture.suffix}` },
      payload: {
        periodStart: "2026-01-01",
        periodEnd: "2026-01-14",
        payDate: "2026-01-16",
        sequence: 1
      }
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    expect(draftResponse.json<{ payrollRun: unknown }>().payrollRun).toMatchObject({
      status: "DRAFT",
      workers: [{ workerId, draftGrossPayMinor: "200000" }]
    });
    const runId = draftResponse.json<{ payrollRun: { id: string } }>().payrollRun.id;

    const codeSet = await app.inject({
      method: "POST",
      url: "/v1/payroll/ca-ab-base-codes",
      headers: { ...headers, "idempotency-key": `ca-ab-codes-${fixture.suffix}` },
      payload: {}
    });
    expect(codeSet.statusCode, codeSet.body).toBe(201);
    expect(
      codeSet.json<{
        payrollCodeSet: {
          created: number;
          existingMappingsPreserved: boolean;
          readiness: { ready: boolean; missing: string[]; invalid: unknown[] };
        };
      }>().payrollCodeSet
    ).toMatchObject({
      created: 10,
      existingMappingsPreserved: true,
      readiness: { ready: true, missing: [], invalid: [] }
    });

    const calculated = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${runId}/calculate`,
      headers,
      payload: {}
    });
    expect(calculated.statusCode, calculated.body).toBe(200);
    const calculatedRun = calculated.json<{
      payrollRun: { status: string; workers: Array<{ components: Array<{ code: string }> }> };
    }>().payrollRun;
    expect(calculatedRun.status).toBe("CALCULATED");
    expect(calculatedRun.workers[0]?.components.map((component) => component.code)).toContain(
      "CA_TD1_ADDITIONAL_TAX"
    );

    const overview = await app.inject({
      method: "GET",
      url: "/v1/payroll/overview",
      headers
    });
    expect(overview.statusCode).toBe(200);
    expect(
      overview.json<{ payroll: { runs: unknown[]; caAbBaseCodes: { ready: boolean } } }>().payroll
    ).toMatchObject({ caAbBaseCodes: { ready: true } });
    expect(overview.json<{ payroll: { runs: unknown[] } }>().payroll.runs).toHaveLength(1);
    expect(await prisma.journal.count({ where: { organizationId: fixture.organizationId } })).toBe(
      0
    );
  });

  it("lets a narrow API credential prepare only due drafts, never arbitrary or posted payroll", async () => {
    const fixture = await createFixture();
    const headers = organizationHeaders(fixture.email, fixture.organizationId);
    const settings = await app.inject({
      method: "PUT",
      url: "/v1/payroll/settings",
      headers,
      payload: {
        defaultExpenseAccountId: fixture.expenseAccountId,
        defaultLiabilityAccountId: fixture.liabilityAccountId,
        netPayClearingAccountId: fixture.clearingAccountId,
        calculationRulePackId: "clearledger-payroll-ca-ab",
        calculationRulePackVersion: "2026.2"
      }
    });
    expect(settings.statusCode, settings.body).toBe(200);
    const worker = await app.inject({
      method: "POST",
      url: "/v1/payroll/workers",
      headers: { ...headers, "idempotency-key": `automation-worker-${fixture.suffix}` },
      payload: workerPayload("E-AUTOMATION")
    });
    expect(worker.statusCode, worker.body).toBe(201);
    const schedule = await app.inject({
      method: "POST",
      url: "/v1/payroll/schedules",
      headers: { ...headers, "idempotency-key": `automation-schedule-${fixture.suffix}` },
      payload: {
        code: "AUTOMATION-BIWEEKLY",
        name: "Automation biweekly",
        frequency: "BIWEEKLY",
        anchorPayDate: "2026-01-16",
        automaticDraftsEnabled: true,
        draftLeadDays: 3
      }
    });
    expect(schedule.statusCode, schedule.body).toBe(201);
    const scheduleId = schedule.json<{ payrollSchedule: { id: string } }>().payrollSchedule.id;
    const period = await app.inject({
      method: "POST",
      url: "/v1/payroll/periods",
      headers,
      payload: {
        scheduleId,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-14",
        payDate: "2026-01-16",
        sequence: 1
      }
    });
    expect(period.statusCode, period.body).toBe(201);
    const periodId = period.json<{ payrollPeriod: { id: string } }>().payrollPeriod.id;
    const credential = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/api-credentials",
      headers: { ...headers, "idempotency-key": `automation-key-${fixture.suffix}` },
      payload: {
        name: "Payroll scheduled-draft runner",
        scopes: ["payroll:automation"],
        expiresAt: "2027-01-01T00:00:00.000Z"
      }
    });
    expect(credential.statusCode, credential.body).toBe(201);
    const secret = credential.json<{ secret: string }>().secret;
    expect(secret).toMatch(/^cl_live_/);
    const credentialHeaders = { authorization: `Bearer ${secret}` };

    const arbitraryDraft = await app.inject({
      method: "POST",
      url: `/v1/payroll/schedules/${scheduleId}/generate-draft`,
      headers: { ...credentialHeaders, "idempotency-key": `not-allowed-${fixture.suffix}` },
      payload: {
        periodStart: "2026-01-01",
        periodEnd: "2026-01-14",
        payDate: "2026-01-16",
        sequence: 1
      }
    });
    expect(arbitraryDraft.statusCode).toBe(403);
    expect(arbitraryDraft.json<{ error: { code: string } }>().error.code).toBe("FORBIDDEN");

    const dueDrafts = await app.inject({
      method: "POST",
      url: "/v1/payroll/automation/run",
      headers: credentialHeaders,
      payload: { asOfDate: "2026-01-13" }
    });
    expect(dueDrafts.statusCode, dueDrafts.body).toBe(200);
    expect(
      dueDrafts.json<{ payrollAutomation: { created: string[]; blocked: unknown[] } }>()
        .payrollAutomation
    ).toMatchObject({ created: [periodId], blocked: [] });
    expect(
      await prisma.payrollRun.findFirstOrThrow({
        where: { organizationId: fixture.organizationId, periodId },
        select: { status: true }
      })
    ).toEqual({ status: "DRAFT" });
    expect(await prisma.journal.count({ where: { organizationId: fixture.organizationId } })).toBe(
      0
    );
  });
});

async function createFixture() {
  const suffix = randomUUID();
  const email = `payroll-api-${suffix}@example.test`;
  const user = await prisma.user.create({
    data: { email, displayName: "Payroll API Owner", emailVerifiedAt: new Date() }
  });
  const organization = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: { legalName: `Payroll API ${suffix}`, displayName: "Payroll API", currency: "CAD" }
    });
    await tx.membership.create({
      data: { organizationId: created.id, userId: user.id, role: "OWNER" }
    });
    return created;
  });
  const [expense, liability, clearing] = await Promise.all([
    prisma.account.create({
      data: {
        organizationId: organization.id,
        code: `6000-${suffix}`,
        name: "Payroll expense",
        type: "EXPENSE"
      }
    }),
    prisma.account.create({
      data: {
        organizationId: organization.id,
        code: `2200-${suffix}`,
        name: "Payroll liability",
        type: "LIABILITY"
      }
    }),
    prisma.account.create({
      data: {
        organizationId: organization.id,
        code: `2210-${suffix}`,
        name: "Payroll clearing",
        type: "LIABILITY"
      }
    })
  ]);
  return {
    suffix,
    email,
    organizationId: organization.id,
    expenseAccountId: expense.id,
    liabilityAccountId: liability.id,
    clearingAccountId: clearing.id
  };
}

function organizationHeaders(email: string, organizationId: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": "Payroll API Owner",
    "x-clearledger-organization-id": organizationId
  };
}

function workerPayload(workerNumber: string) {
  return {
    workerNumber,
    kind: "EMPLOYEE",
    displayName: "Payroll Worker",
    profile: {
      effectiveFrom: "2026-01-01",
      jurisdictionCode: "CA-AB",
      taxAttributes: {
        canadianWithholding: {
          federalClaimCode: 1,
          provincialClaimCode: 1,
          additionalTaxMinor: "250"
        }
      }
    },
    compensation: {
      effectiveFrom: "2026-01-01",
      kind: "SALARY",
      rateMinor: "5200000"
    }
  };
}
