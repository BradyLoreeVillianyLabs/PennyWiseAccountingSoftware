import { randomUUID } from "node:crypto";
import { PrismaClient, withTenantTransaction } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PayrollService,
  type PayrollCodeInput,
  type PayrollWorkerInput
} from "./services/payroll-service.js";
import { PayrollStatutoryCalculator } from "./services/payroll-statutory-service.js";

const prisma = new PrismaClient();
const service = new PayrollService(prisma);

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

describe("payroll domain foundation", () => {
  it("calculates, independently approves, and atomically posts payroll only to expense and liability accounts", async () => {
    const fixture = await createFixture();
    await configureFixture(fixture);
    const worker = await service.createWorker(
      fixture.owner,
      workerInput("PAYROLL-GOV-CIPHERTEXT", "PAYROLL-BANK-CIPHERTEXT"),
      `worker-${fixture.suffix}`
    );
    const schedule = await service.createSchedule(
      fixture.owner,
      {
        code: "BIWEEKLY",
        name: "Biweekly",
        frequency: "BIWEEKLY",
        anchorPayDate: "2026-01-16"
      },
      `schedule-${fixture.suffix}`
    );
    const period = await service.createPeriod(fixture.owner, {
      scheduleId: schedule.body.payrollSchedule.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-14",
      payDate: "2026-01-16",
      sequence: 1
    });
    const created = await service.createRun(
      fixture.owner,
      {
        runNumber: `RUN-${fixture.suffix}`,
        kind: "REGULAR",
        scheduleId: schedule.body.payrollSchedule.id,
        periodId: period.id,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-14",
        payDate: "2026-01-16",
        workers: [
          {
            workerId: worker.body.payrollWorker.id,
            grossPayMinor: "200000",
            statutory: { canadianWithholding: { federalClaimCode: 1, provincialClaimCode: 1 } }
          }
        ]
      },
      `run-${fixture.suffix}`
    );

    const calculated = await service.calculate(fixture.owner, created.body.payrollRun.id);
    expect(calculated).toMatchObject({
      status: "CALCULATED",
      rulePack: { id: "clearledger-payroll-ca-ab", version: "2026.2" }
    });
    expect(calculated.workers[0].grossPayMinor).toBe("200000");
    expect(BigInt(calculated.workers[0].netPayMinor)).toBeGreaterThan(0n);
    expect(calculated.workers[0].components.map((component) => component.code)).toContain(
      "GROSS_PAY"
    );

    const reviewed = await service.review(fixture.owner, calculated.id, calculated.version);
    await expectAppError(
      () => service.approve(fixture.owner, reviewed!.id, reviewed!.version),
      "PAYROLL_APPROVER_SEPARATION_REQUIRED"
    );
    const approved = await service.approve(fixture.approver, reviewed!.id, reviewed!.version);
    const posted = await service.post(
      fixture.owner,
      approved!.id,
      approved!.version,
      `post-${fixture.suffix}`
    );
    const postedRun = posted.body.payrollRun;
    if (!postedRun?.journalId) throw new Error("Posted payroll run is missing its journal.");
    expect(postedRun.status).toBe("POSTED");
    expect(postedRun.workers[0]!.payslip!.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const journal = await prisma.journal.findUniqueOrThrow({
      where: { id: postedRun.journalId },
      select: {
        status: true,
        lines: {
          select: {
            debitMinor: true,
            creditMinor: true,
            accountId: true,
            account: { select: { type: true } }
          }
        }
      }
    });
    expect(journal.status).toBe("POSTED");
    expect(journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(
      journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n)
    );
    expect(
      journal.lines.every((line) => ["EXPENSE", "LIABILITY"].includes(line.account.type))
    ).toBe(true);
    expect(journal.lines.some((line) => line.accountId === fixture.bankAccountId)).toBe(false);
    expect(
      await prisma.payrollYtdBalance.count({ where: { organizationId: fixture.organizationId } })
    ).toBeGreaterThan(0);
    expect(
      await prisma.payrollRemittance.count({ where: { runId: postedRun.id } })
    ).toBeGreaterThan(0);

    await expect(
      withTenantTransaction(
        prisma,
        { organizationId: fixture.organizationId, actorUserId: fixture.owner.user.id },
        (tx) =>
          tx.payrollRun.update({
            where: { id: postedRun.id },
            data: { runNumber: "HISTORY-REWRITE" }
          })
      )
    ).rejects.toThrow("Posted payroll runs are immutable");
  });

  it("masks encrypted identifiers, isolates tenant reads, and records non-posting payment exports", async () => {
    const fixture = await createFixture();
    await configureFixture(fixture);
    const worker = await service.createWorker(
      fixture.owner,
      workerInput("secret-government-envelope", "secret-bank-envelope"),
      `worker-${fixture.suffix}`
    );
    expect(worker.body.payrollWorker).toMatchObject({
      governmentIdMask: "***6789",
      bankAccountMask: "***4321"
    });
    expect(JSON.stringify(worker.body.payrollWorker)).not.toContain("secret-");
    expect(JSON.stringify(await service.listWorkers(fixture.owner))).not.toContain("secret-");

    const other = await createFixture();
    await expectAppError(() => service.getRun(other.owner, randomUUID()), "PAYROLL_RUN_NOT_FOUND");
    expect(
      await withTenantTransaction(
        prisma,
        { organizationId: other.organizationId, actorUserId: other.owner.user.id },
        (tx) => tx.payrollWorker.count()
      )
    ).toBe(0);

    const posted = await createPostedRun(fixture, worker.body.payrollWorker.id);
    const journalsBefore = await prisma.journal.count({
      where: { organizationId: fixture.organizationId }
    });
    const batch = await service.createPaymentBatch(
      fixture.owner,
      posted.id,
      { batchNumber: `BATCH-${fixture.suffix}`, paymentDate: "2026-02-02" },
      `batch-${fixture.suffix}`
    );
    expect(batch.body.payrollPaymentBatch.totalMinor).toBe(posted.workers[0].netPayMinor);
    const item = await prisma.payrollPaymentItem.findFirstOrThrow({
      where: { organizationId: fixture.organizationId, batchId: batch.body.payrollPaymentBatch.id }
    });
    expect(item.bankAccountMask).toBe("***4321");
    const exported = await service.recordPaymentExport(
      fixture.owner,
      batch.body.payrollPaymentBatch.id,
      {
        format: "CPA-005",
        contentHash: "a".repeat(64),
        encryptedStorageKey: "kms:v1:encrypted-object-key"
      }
    );
    expect(exported).toMatchObject({ format: "CPA-005", sequence: 1, contentHash: "a".repeat(64) });
    expect(await prisma.journal.count({ where: { organizationId: fixture.organizationId } })).toBe(
      journalsBefore
    );
    const auditText = JSON.stringify(
      await prisma.auditEvent.findMany({ where: { organizationId: fixture.organizationId } })
    );
    expect(auditText).not.toContain("secret-government-envelope");
    expect(auditText).not.toContain("secret-bank-envelope");
  });

  it("prepares deterministic scheduled drafts without posting, funding, or filing payroll", async () => {
    const fixture = await createFixture();
    await configureFixture(fixture);
    const worker = await service.createWorker(
      fixture.owner,
      {
        ...workerInput("automation-government-envelope", "automation-bank-envelope"),
        profile: {
          effectiveFrom: "2026-01-01",
          jurisdictionCode: "CA-AB",
          taxAttributes: {
            canadianWithholding: { federalClaimCode: 1, provincialClaimCode: 1 }
          }
        }
      },
      `automation-worker-${fixture.suffix}`
    );
    const schedule = await service.createSchedule(
      fixture.owner,
      {
        code: `AUTO-${fixture.suffix}`,
        name: "Automated biweekly draft",
        frequency: "BIWEEKLY",
        anchorPayDate: "2026-02-13",
        automaticDraftsEnabled: true,
        draftLeadDays: 5
      },
      `automation-schedule-${fixture.suffix}`
    );
    const journalsBefore = await prisma.journal.count({
      where: { organizationId: fixture.organizationId }
    });
    const draft = await service.generateScheduledDraft(
      fixture.owner,
      schedule.body.payrollSchedule.id,
      {
        periodStart: "2026-01-29",
        periodEnd: "2026-02-11",
        payDate: "2026-02-13",
        sequence: 1
      },
      `automation-draft-${fixture.suffix}`
    );
    expect(draft.statusCode).toBe(201);
    expect(draft.body.payrollRun).toMatchObject({
      status: "DRAFT",
      kind: "REGULAR",
      workers: [{ workerId: worker.body.payrollWorker.id, draftGrossPayMinor: "200000" }]
    });
    expect(await prisma.journal.count({ where: { organizationId: fixture.organizationId } })).toBe(
      journalsBefore
    );
    expect(
      await prisma.payrollRemittance.count({ where: { organizationId: fixture.organizationId } })
    ).toBe(0);
    expect(
      await prisma.payrollPaymentBatch.count({ where: { organizationId: fixture.organizationId } })
    ).toBe(0);

    const duplicate = await service.generateScheduledDraft(
      fixture.owner,
      schedule.body.payrollSchedule.id,
      {
        periodStart: "2026-01-29",
        periodEnd: "2026-02-11",
        payDate: "2026-02-13",
        sequence: 1
      },
      `automation-draft-repeat-${fixture.suffix}`
    );
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.body.payrollRun.id).toBe(draft.body.payrollRun.id);

    const overview = await service.overview(fixture.owner);
    expect(overview.schedules).toContainEqual(
      expect.objectContaining({
        id: schedule.body.payrollSchedule.id,
        automaticDraftsEnabled: true,
        draftLeadDays: 5
      })
    );
    expect(overview.capabilities).toMatchObject({
      scheduledDrafts: { enabled: true },
      automaticPosting: { enabled: false },
      directDeposit: { enabled: false },
      taxFiling: { enabled: false }
    });
  });

  it("runs enabled period automation only within its lead window and fails closed for unpaid hourly defaults", async () => {
    const fixture = await createFixture();
    await configureFixture(fixture);
    const worker = await service.createWorker(
      fixture.owner,
      {
        ...workerInput("hourly-government-envelope", "hourly-bank-envelope"),
        compensation: {
          effectiveFrom: "2026-01-01",
          kind: "HOURLY",
          rateMinor: "3000",
          hoursPerPeriodMicros: null
        }
      },
      `hourly-worker-${fixture.suffix}`
    );
    const schedule = await service.createSchedule(
      fixture.owner,
      {
        code: `DUE-${fixture.suffix}`,
        name: "Due schedule",
        frequency: "WEEKLY",
        anchorPayDate: "2026-03-06",
        automaticDraftsEnabled: true,
        draftLeadDays: 3
      },
      `due-schedule-${fixture.suffix}`
    );
    await service.createPeriod(fixture.owner, {
      scheduleId: schedule.body.payrollSchedule.id,
      periodStart: "2026-02-26",
      periodEnd: "2026-03-04",
      payDate: "2026-03-06",
      sequence: 1
    });
    const beforeWindow = await service.generateDueScheduledDrafts(fixture.owner, "2026-03-01");
    expect(beforeWindow.created).toEqual([]);
    expect(beforeWindow.notDue).toHaveLength(1);

    const due = await service.generateDueScheduledDrafts(fixture.owner, "2026-03-03");
    expect(due.created).toEqual([]);
    expect(due.blocked).toContainEqual(
      expect.objectContaining({ code: "PAYROLL_AUTOMATION_HOURS_REQUIRED" })
    );
    expect(
      await prisma.payrollRun.count({ where: { organizationId: fixture.organizationId } })
    ).toBe(0);
    expect(worker.body.payrollWorker.bankAccountMask).toBe("***4321");
  });
});

interface Fixture {
  readonly suffix: string;
  readonly organizationId: string;
  readonly owner: OrganizationContext;
  readonly approver: OrganizationContext;
  readonly expenseAccountId: string;
  readonly liabilityAccountId: string;
  readonly clearingAccountId: string;
  readonly bankAccountId: string;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const ownerUser = await prisma.user.create({
    data: {
      email: `payroll-owner-${suffix}@example.test`,
      displayName: "Payroll Owner",
      emailVerifiedAt: new Date()
    }
  });
  const approverUser = await prisma.user.create({
    data: {
      email: `payroll-approver-${suffix}@example.test`,
      displayName: "Payroll Approver",
      emailVerifiedAt: new Date()
    }
  });
  const { organization, ownerMembership } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { legalName: `Payroll ${suffix}`, displayName: "Payroll Test", currency: "CAD" }
    });
    const ownerMembership = await tx.membership.create({
      data: { organizationId: organization.id, userId: ownerUser.id, role: "OWNER" }
    });
    return { organization, ownerMembership };
  });
  const approverMembership = await prisma.membership.create({
    data: { organizationId: organization.id, userId: approverUser.id, role: "ADMIN" }
  });
  const expense = await prisma.account.create({
    data: {
      organizationId: organization.id,
      code: `${suffix}-6000`,
      name: "Payroll expense",
      type: "EXPENSE"
    }
  });
  const liability = await prisma.account.create({
    data: {
      organizationId: organization.id,
      code: `${suffix}-2200`,
      name: "Payroll remittance payable",
      type: "LIABILITY"
    }
  });
  const clearing = await prisma.account.create({
    data: {
      organizationId: organization.id,
      code: `${suffix}-2210`,
      name: "Net pay clearing",
      type: "LIABILITY"
    }
  });
  const bank = await prisma.account.create({
    data: { organizationId: organization.id, code: `${suffix}-1000`, name: "Bank", type: "ASSET" }
  });
  await prisma.fiscalPeriod.create({
    data: {
      organizationId: organization.id,
      name: "2026",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T23:59:59.999Z")
    }
  });
  return {
    suffix,
    organizationId: organization.id,
    expenseAccountId: expense.id,
    liabilityAccountId: liability.id,
    clearingAccountId: clearing.id,
    bankAccountId: bank.id,
    owner: context(ownerUser, organization.id, ownerMembership.id, "OWNER"),
    approver: context(approverUser, organization.id, approverMembership.id, "ADMIN")
  };
}

async function configureFixture(fixture: Fixture) {
  await service.configure(fixture.owner, {
    defaultExpenseAccountId: fixture.expenseAccountId,
    defaultLiabilityAccountId: fixture.liabilityAccountId,
    netPayClearingAccountId: fixture.clearingAccountId,
    calculationRulePackId: "clearledger-payroll-ca-ab",
    calculationRulePackVersion: "2026.2"
  });
  const result = new PayrollStatutoryCalculator().calculate({
    jurisdiction: "CA-AB",
    payDate: "2026-01-16",
    payFrequency: "BIWEEKLY",
    grossPayMinor: 200000n,
    canadianWithholding: { federalClaimCode: 1, provincialClaimCode: 1 }
  });
  for (const component of result.components) {
    const input: PayrollCodeInput = {
      code: component.code,
      name: component.code.replaceAll("_", " "),
      kind: component.category,
      statutoryAttributes: { jurisdiction: "CA-AB", statutory: component.category !== "EARNING" },
      expenseAccountId:
        component.category === "EARNING" || component.category === "EMPLOYER_CONTRIBUTION"
          ? fixture.expenseAccountId
          : null,
      liabilityAccountId:
        component.category === "DEDUCTION" || component.category === "EMPLOYER_CONTRIBUTION"
          ? fixture.liabilityAccountId
          : null,
      remittanceAuthority: component.category === "EARNING" ? null : "CRA"
    };
    await service.createCode(fixture.owner, input, `code-${fixture.suffix}-${component.code}`);
  }
}

function workerInput(governmentCiphertext: string, bankCiphertext: string): PayrollWorkerInput {
  return {
    workerNumber: `E-${randomUUID()}`,
    kind: "EMPLOYEE",
    displayName: "Masked Employee",
    governmentId: { ciphertext: governmentCiphertext, keyVersion: "kms-v1", lastFour: "6789" },
    bankAccount: { ciphertext: bankCiphertext, keyVersion: "kms-v1", lastFour: "4321" },
    profile: {
      effectiveFrom: "2026-01-01",
      jurisdictionCode: "CA-AB",
      taxAttributes: { federalClaimCode: 1, provincialClaimCode: 1 }
    },
    compensation: {
      effectiveFrom: "2026-01-01",
      kind: "SALARY",
      rateMinor: "5200000"
    }
  };
}

async function createPostedRun(fixture: Fixture, workerId: string) {
  const schedule = await service.createSchedule(
    fixture.owner,
    {
      code: `S-${fixture.suffix}`,
      name: "Payment schedule",
      frequency: "BIWEEKLY",
      anchorPayDate: "2026-01-30"
    },
    `schedule-payment-${fixture.suffix}`
  );
  const created = await service.createRun(
    fixture.owner,
    {
      runNumber: `PAY-${fixture.suffix}`,
      kind: "REGULAR",
      scheduleId: schedule.body.payrollSchedule.id,
      periodStart: "2026-01-15",
      periodEnd: "2026-01-28",
      payDate: "2026-01-30",
      workers: [
        {
          workerId,
          grossPayMinor: "200000",
          statutory: { canadianWithholding: { federalClaimCode: 1, provincialClaimCode: 1 } }
        }
      ]
    },
    `run-payment-${fixture.suffix}`
  );
  const calculated = await service.calculate(fixture.owner, created.body.payrollRun.id);
  const reviewed = await service.review(fixture.owner, calculated.id, calculated.version);
  const approved = await service.approve(fixture.approver, reviewed!.id, reviewed!.version);
  const posted = await service.post(
    fixture.owner,
    approved!.id,
    approved!.version,
    `post-payment-${fixture.suffix}`
  );
  return posted.body.payrollRun;
}

function context(
  user: { id: string; email: string; displayName: string | null; emailVerifiedAt: Date | null },
  organizationId: string,
  membershipId: string,
  role: "OWNER" | "ADMIN"
): OrganizationContext {
  return {
    requestId: randomUUID(),
    user,
    organizationId,
    membershipId,
    role,
    sessionId: null,
    recentAuthAt: new Date(),
    mfaAuthenticated: true,
    authenticationMethod: "DEVELOPMENT",
    auditOrigin: { ipAddress: null, userAgent: null }
  };
}

async function expectAppError(work: () => Promise<unknown>, code: string) {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}
