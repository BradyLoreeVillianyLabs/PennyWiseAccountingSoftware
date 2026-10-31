import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase11-owner@example.test";

function headers(organizationId?: string, email = owner, key?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

async function api(
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  key?: string,
  email = owner
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: headers(organizationId, email, key),
    ...(payload === undefined ? {} : { payload })
  });
}

async function fixture() {
  const created = await api("POST", "/v1/organizations", undefined, {
    legalName: "Phase Eleven Ltd",
    displayName: "Phase Eleven"
  });
  const organizationId = created.json<{ organization: { id: string } }>().organization.id;
  await api("POST", "/v1/setup/presets/general-service/apply", organizationId, {}, randomUUID());
  await api("POST", "/v1/fiscal-periods", organizationId, {
    name: "Fiscal year 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31"
  });
  const accounts = (await api("GET", "/v1/accounts", organizationId)).json<{
    accounts: Array<{
      id: string;
      type: string;
      isControl: boolean;
      systemPurpose: string | null;
    }>;
  }>().accounts;
  const period = await prisma.fiscalPeriod.findFirstOrThrow({ where: { organizationId } });
  return {
    organizationId,
    period,
    cash: accounts.find((row) => row.systemPurpose === "cash")!,
    revenue: accounts.find((row) => row.systemPurpose === "sales")!,
    receivables: accounts.find((row) => row.systemPurpose === "accounts-receivable")!
  };
}

function draftPayload(
  debitAccountId: string,
  creditAccountId: string,
  allowControlAccountPosting = false
) {
  return {
    description: "Accountant adjustment",
    effectiveDate: "2026-06-30",
    reason: "Reviewed adjustment",
    allowControlAccountPosting,
    lines: [
      { accountId: debitAccountId, debitMinor: "125", creditMinor: "0" },
      { accountId: creditAccountId, debitMinor: "0", creditMinor: "125" }
    ]
  };
}

async function addMember(organizationId: string, email: string, role: "BOOKKEEPER" | "READ_ONLY") {
  const user = await prisma.user.create({
    data: { email, displayName: email, emailVerifiedAt: new Date() }
  });
  await prisma.membership.create({ data: { organizationId, userId: user.id, role } });
}

beforeAll(async () => {
  await app.ready();
});
beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Phase 11 accountant review and close", () => {
  it("edits one non-posting draft in place and posts only its final balanced lines", async () => {
    const f = await fixture();
    const created = await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.cash.id, f.revenue.id)
    );
    expect(created.statusCode, created.body).toBe(201);
    const original = created.json<{
      draft: {
        id: string;
        version: number;
        accountingBoundary: {
          classification: string;
          financialPosting: boolean;
          authoritative: boolean;
          editable: boolean;
        };
      };
    }>().draft;
    expect(original.accountingBoundary).toMatchObject({
      classification: "NON_POSTING_DRAFT",
      financialPosting: false,
      authoritative: false,
      editable: true
    });

    const invalidReplacement = draftPayload(f.cash.id, f.revenue.id);
    invalidReplacement.lines[1]!.creditMinor = "124";
    expect(
      (
        await api("PATCH", `/v1/accountant/manual-journals/${original.id}`, f.organizationId, {
          ...invalidReplacement,
          version: original.version
        })
      ).statusCode
    ).toBe(422);
    expect(
      await prisma.manualJournalDraft.findUniqueOrThrow({
        where: { id: original.id },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      })
    ).toMatchObject({
      version: original.version,
      lines: [
        expect.objectContaining({ debitMinor: 125n, creditMinor: 0n }),
        expect.objectContaining({ debitMinor: 0n, creditMinor: 125n })
      ]
    });

    const replacement = draftPayload(f.cash.id, f.revenue.id);
    replacement.description = "Final reviewed adjustment";
    replacement.lines[0]!.debitMinor = "275";
    replacement.lines[1]!.creditMinor = "275";
    const edited = await api(
      "PUT",
      `/v1/accountant/manual-journals/${original.id}`,
      f.organizationId,
      { ...replacement, version: original.version }
    );
    expect(edited.statusCode, edited.body).toBe(200);
    const finalDraft = edited.json<{
      draft: {
        id: string;
        version: number;
        description: string;
        lines: Array<{ debitMinor: string; creditMinor: string }>;
        accountingBoundary: { classification: string; financialPosting: boolean };
      };
    }>().draft;
    expect(finalDraft).toMatchObject({
      id: original.id,
      version: original.version + 1,
      description: "Final reviewed adjustment",
      accountingBoundary: {
        classification: "NON_POSTING_DRAFT",
        financialPosting: false
      }
    });
    expect(finalDraft.lines).toEqual([
      expect.objectContaining({ debitMinor: "275", creditMinor: "0" }),
      expect.objectContaining({ debitMinor: "0", creditMinor: "275" })
    ]);
    expect(
      await prisma.manualJournalDraft.count({ where: { organizationId: f.organizationId } })
    ).toBe(1);
    expect(await prisma.journal.count({ where: { organizationId: f.organizationId } })).toBe(0);
    expect(await prisma.journalLine.count({ where: { organizationId: f.organizationId } })).toBe(0);

    const updateAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: f.organizationId,
        action: "MANUAL_JOURNAL_DRAFT_UPDATED",
        targetId: original.id
      }
    });
    const metadata = updateAudit.metadata as Record<string, unknown>;
    expect(metadata.oldContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.newContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.oldContentHash).not.toBe(metadata.newContentHash);
    expect(metadata.financialPosting).toBe(false);

    const posted = await api(
      "POST",
      `/v1/accountant/manual-journals/${original.id}/post`,
      f.organizationId,
      { version: finalDraft.version },
      randomUUID()
    );
    expect(posted.statusCode, posted.body).toBe(201);
    expect(
      posted.json<{
        draft: { accountingBoundary: { classification: string; authoritative: boolean } };
      }>().draft.accountingBoundary
    ).toMatchObject({ classification: "AUTHORITATIVE_POSTED_JOURNAL", authoritative: true });
    expect(await prisma.journal.count({ where: { organizationId: f.organizationId } })).toBe(1);
    expect(
      await prisma.journalLine.findMany({
        where: { organizationId: f.organizationId },
        orderBy: { lineNumber: "asc" },
        select: { debitMinor: true, creditMinor: true }
      })
    ).toEqual([
      { debitMinor: 275n, creditMinor: 0n },
      { debitMinor: 0n, creditMinor: 275n }
    ]);
    expect(
      (
        await api("PATCH", `/v1/accountant/manual-journals/${original.id}`, f.organizationId, {
          ...replacement,
          version: finalDraft.version + 1
        })
      ).statusCode
    ).toBe(409);
  });

  it("cancels a draft without posting and rejects later edits or posting", async () => {
    const f = await fixture();
    const created = await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.cash.id, f.revenue.id)
    );
    const draft = created.json<{ draft: { id: string; version: number } }>().draft;
    const cancelled = await api(
      "POST",
      `/v1/accountant/manual-journals/${draft.id}/cancel`,
      f.organizationId,
      { version: draft.version }
    );
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const cancelledDraft = cancelled.json<{
      draft: {
        status: string;
        version: number;
        lines: unknown[];
        accountingBoundary: {
          classification: string;
          financialPosting: boolean;
          authoritative: boolean;
          editable: boolean;
          cancellable: boolean;
        };
      };
    }>().draft;
    expect(cancelledDraft).toMatchObject({
      status: "CANCELLED",
      version: draft.version + 1,
      accountingBoundary: {
        classification: "NON_POSTING_CANCELLED",
        financialPosting: false,
        authoritative: false,
        editable: false,
        cancellable: false
      }
    });
    expect(cancelledDraft.lines).toHaveLength(2);
    expect(
      (
        await api("PUT", `/v1/accountant/manual-journals/${draft.id}`, f.organizationId, {
          ...draftPayload(f.cash.id, f.revenue.id),
          version: cancelledDraft.version
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await api(
          "POST",
          `/v1/accountant/manual-journals/${draft.id}/post`,
          f.organizationId,
          { version: cancelledDraft.version },
          randomUUID()
        )
      ).statusCode
    ).toBe(409);
    expect(await prisma.journal.count({ where: { organizationId: f.organizationId } })).toBe(0);
    expect(await prisma.journalLine.count({ where: { organizationId: f.organizationId } })).toBe(0);
  });

  it("rejects stale and concurrent draft replacements", async () => {
    const f = await fixture();
    const created = await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.cash.id, f.revenue.id)
    );
    const draft = created.json<{ draft: { id: string; version: number } }>().draft;
    const first = draftPayload(f.cash.id, f.revenue.id);
    first.description = "Concurrent replacement A";
    first.lines[0]!.debitMinor = "200";
    first.lines[1]!.creditMinor = "200";
    const second = draftPayload(f.cash.id, f.revenue.id);
    second.description = "Concurrent replacement B";
    second.lines[0]!.debitMinor = "300";
    second.lines[1]!.creditMinor = "300";
    const results = await Promise.all([
      api("PATCH", `/v1/accountant/manual-journals/${draft.id}`, f.organizationId, {
        ...first,
        version: draft.version
      }),
      api("PUT", `/v1/accountant/manual-journals/${draft.id}`, f.organizationId, {
        ...second,
        version: draft.version
      })
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const persisted = await prisma.manualJournalDraft.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });
    expect(persisted.version).toBe(draft.version + 1);
    expect(["Concurrent replacement A", "Concurrent replacement B"]).toContain(
      persisted.description
    );
    expect(
      await prisma.manualJournalDraft.count({ where: { organizationId: f.organizationId } })
    ).toBe(1);
    expect(await prisma.journal.count({ where: { organizationId: f.organizationId } })).toBe(0);
  });

  it("keeps draft workpapers and active planning data out of authoritative reports", async () => {
    const f = await fixture();
    expect(
      (
        await api(
          "POST",
          "/v1/accountant/manual-journals",
          f.organizationId,
          draftPayload(f.cash.id, f.revenue.id)
        )
      ).statusCode
    ).toBe(201);
    const budget = await api("POST", "/v1/budgets", f.organizationId, {
      name: "Active workpaper plan",
      periodType: "MONTH",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      lines: [
        {
          accountId: f.revenue.id,
          periodStart: "2026-06-01",
          plannedMinor: "500000"
        }
      ]
    });
    expect(budget.statusCode, budget.body).toBe(201);
    const budgetDraft = budget.json<{ budget: { id: string; version: number } }>().budget;
    expect(
      (
        await api("POST", `/v1/budgets/${budgetDraft.id}/activate`, f.organizationId, {
          version: budgetDraft.version
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await api("POST", "/v1/cash-forecast/assumptions", f.organizationId, {
          weekStart: "2026-06-29",
          label: "Projected receipt",
          direction: "INFLOW",
          amountMinor: "750000"
        })
      ).statusCode
    ).toBe(201);

    const profit = await api(
      "GET",
      "/v1/reports/profit-and-loss?from=2026-01-01&to=2026-12-31&basis=ACCRUAL",
      f.organizationId
    );
    const balance = await api("GET", "/v1/reports/balance-sheet?asOf=2026-12-31", f.organizationId);
    const journals = await api(
      "GET",
      "/v1/reports/journals?from=2026-01-01&to=2026-12-31&page=1&pageSize=100",
      f.organizationId
    );
    expect(profit.statusCode, profit.body).toBe(200);
    expect(
      profit.json<{
        report: { totalRevenueMinor: string; netIncomeMinor: string; support: string };
      }>().report
    ).toMatchObject({
      totalRevenueMinor: "0",
      netIncomeMinor: "0",
      support: "All posted journal lines in the selected effective-date range."
    });
    expect(
      balance.json<{ report: { totalAssetsMinor: string; currentEarningsMinor: string } }>().report
    ).toMatchObject({
      totalAssetsMinor: "0",
      currentEarningsMinor: "0"
    });
    expect(
      journals.json<{ report: { total: number; journals: unknown[] } }>().report
    ).toMatchObject({
      total: 0,
      journals: []
    });
    expect(
      await prisma.budgetPlan.count({
        where: { organizationId: f.organizationId, status: "ACTIVE" }
      })
    ).toBe(1);
    expect(
      await prisma.cashForecastAssumption.count({ where: { organizationId: f.organizationId } })
    ).toBe(1);
    expect(await prisma.journal.count({ where: { organizationId: f.organizationId } })).toBe(0);
    expect(await prisma.journalLine.count({ where: { organizationId: f.organizationId } })).toBe(0);
  });

  it("posts balanced manual drafts once, preserves them, and traces source and reversal", async () => {
    const f = await fixture();
    const created = await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.cash.id, f.revenue.id)
    );
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ draft: { id: string; version: number } }>().draft;
    const key = randomUUID();
    const posted = await api(
      "POST",
      `/v1/accountant/manual-journals/${draft.id}/post`,
      f.organizationId,
      { version: draft.version },
      key
    );
    expect(posted.statusCode, posted.body).toBe(201);
    const result = posted.json<{ journalId: string }>();
    const replay = await api(
      "POST",
      `/v1/accountant/manual-journals/${draft.id}/post`,
      f.organizationId,
      { version: draft.version },
      key
    );
    expect(replay.json<{ journalId: string }>().journalId).toBe(result.journalId);
    await expect(
      prisma.manualJournalDraft.update({
        where: { id: draft.id },
        data: { description: "tamper" }
      })
    ).rejects.toThrow(/immutable/i);
    const trace = await api(
      "GET",
      `/v1/accountant/journals/${result.journalId}/trace`,
      f.organizationId
    );
    expect(trace.json<{ trace: { source: { id: string } } }>().trace.source.id).toBe(draft.id);
    const reversed = await api(
      "POST",
      `/v1/journals/${result.journalId}/reverse`,
      f.organizationId,
      { effectiveDate: "2026-07-01", reason: "Replace adjustment" },
      randomUUID()
    );
    expect(reversed.statusCode, reversed.body).toBe(201);
    expect(await prisma.journal.count({ where: { organizationId: f.organizationId } })).toBe(2);
  });

  it("rejects unbalanced drafts, unauthorized posting, and unapproved control-account access", async () => {
    const f = await fixture();
    const unbalanced = draftPayload(f.cash.id, f.revenue.id);
    unbalanced.lines[1]!.creditMinor = "124";
    expect(
      (await api("POST", "/v1/accountant/manual-journals", f.organizationId, unbalanced)).statusCode
    ).toBe(422);
    const noOverride = await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.receivables.id, f.revenue.id)
    );
    const draft = noOverride.json<{ draft: { id: string; version: number } }>().draft;
    expect(
      (
        await api(
          "POST",
          `/v1/accountant/manual-journals/${draft.id}/post`,
          f.organizationId,
          { version: draft.version },
          randomUUID()
        )
      ).statusCode
    ).toBe(403);
    const bookkeeper = "phase11-bookkeeper@example.test";
    await addMember(f.organizationId, bookkeeper, "BOOKKEEPER");
    const allowedDraft = await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.cash.id, f.revenue.id),
      undefined,
      bookkeeper
    );
    expect(allowedDraft.statusCode).toBe(201);
    const bookkeeperDraft = allowedDraft.json<{ draft: { id: string; version: number } }>().draft;
    expect(
      (
        await api(
          "POST",
          `/v1/accountant/manual-journals/${bookkeeperDraft.id}/post`,
          f.organizationId,
          { version: bookkeeperDraft.version },
          randomUUID(),
          bookkeeper
        )
      ).statusCode
    ).toBe(403);

    const readOnly = "phase11-read-only@example.test";
    await addMember(f.organizationId, readOnly, "READ_ONLY");
    expect(
      (
        await api(
          "POST",
          "/v1/accountant/manual-journals",
          f.organizationId,
          draftPayload(f.cash.id, f.revenue.id),
          undefined,
          readOnly
        )
      ).statusCode
    ).toBe(403);

    expect(
      (
        await api(
          "PATCH",
          `/v1/accountant/manual-journals/${draft.id}`,
          f.organizationId,
          { ...draftPayload(f.receivables.id, f.revenue.id), version: draft.version },
          undefined,
          readOnly
        )
      ).statusCode
    ).toBe(403);
    expect(
      (
        await api(
          "POST",
          `/v1/accountant/manual-journals/${draft.id}/cancel`,
          f.organizationId,
          { version: draft.version },
          undefined,
          readOnly
        )
      ).statusCode
    ).toBe(403);

    const otherOrganization = await api("POST", "/v1/organizations", undefined, {
      legalName: "Phase Eleven Other Ltd",
      displayName: "Phase Eleven Other"
    });
    const otherOrganizationId = otherOrganization.json<{ organization: { id: string } }>()
      .organization.id;
    expect(
      (
        await api("PUT", `/v1/accountant/manual-journals/${draft.id}`, otherOrganizationId, {
          ...draftPayload(f.receivables.id, f.revenue.id),
          version: draft.version
        })
      ).statusCode
    ).toBe(404);
  });

  it("surfaces control-account discrepancies in close evidence and the review queue", async () => {
    const f = await fixture();
    const created = await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.receivables.id, f.revenue.id, true)
    );
    const draft = created.json<{ draft: { id: string; version: number } }>().draft;
    expect(
      (
        await api(
          "POST",
          `/v1/accountant/manual-journals/${draft.id}/post`,
          f.organizationId,
          { version: draft.version },
          randomUUID()
        )
      ).statusCode
    ).toBe(201);

    const preview = (
      await api("GET", `/v1/fiscal-periods/${f.period.id}/close-preview`, f.organizationId)
    ).json<{
      checklist: {
        checks: { receivablesControlDifferenceMinor: string };
        warnings: Array<{ code: string }>;
      };
    }>().checklist;
    expect(preview.checks.receivablesControlDifferenceMinor).toBe("125");
    expect(preview.warnings).toContainEqual(
      expect.objectContaining({ code: "receivablesControlDifferenceMinor" })
    );

    const queue = (
      await api("GET", "/v1/accountant/review-queue?asOf=2026-12-31", f.organizationId)
    ).json<{ queue: { items: Array<{ category: string }> } }>().queue;
    expect(queue.items).toContainEqual(expect.objectContaining({ category: "AR_CONTROL" }));
  });

  it("requires warning acknowledgement, persists close evidence, and blocks later posting", async () => {
    const f = await fixture();
    await api(
      "POST",
      "/v1/accountant/manual-journals",
      f.organizationId,
      draftPayload(f.cash.id, f.revenue.id)
    );
    const preview = await api(
      "GET",
      `/v1/fiscal-periods/${f.period.id}/close-preview`,
      f.organizationId
    );
    expect(preview.json<{ checklist: { clean: boolean } }>().checklist.clean).toBe(false);
    const blocked = await api("POST", `/v1/fiscal-periods/${f.period.id}/close`, f.organizationId, {
      reason: "Year end review",
      acknowledgeWarnings: false
    });
    expect(blocked.statusCode).toBe(409);
    const closed = await api("POST", `/v1/fiscal-periods/${f.period.id}/close`, f.organizationId, {
      reason: "Warnings reviewed",
      acknowledgeWarnings: true
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(await prisma.periodCloseRecord.count({ where: { fiscalPeriodId: f.period.id } })).toBe(
      1
    );
    const journal = await api(
      "POST",
      "/v1/journals",
      f.organizationId,
      {
        description: "Late posting",
        effectiveDate: "2026-06-30",
        sourceType: "PHASE11_TEST",
        sourceId: randomUUID(),
        postingKey: randomUUID(),
        lines: draftPayload(f.cash.id, f.revenue.id).lines
      },
      randomUUID()
    );
    expect(journal.statusCode).toBe(409);
  });

  it("requires stronger reopen permission, audits reopening, and creates the next year once", async () => {
    const f = await fixture();
    await api("POST", `/v1/fiscal-periods/${f.period.id}/close`, f.organizationId, {
      reason: "Clean close"
    });
    const bookkeeper = "phase11-reopen-bookkeeper@example.test";
    await addMember(f.organizationId, bookkeeper, "BOOKKEEPER");
    expect(
      (
        await api(
          "POST",
          `/v1/fiscal-periods/${f.period.id}/reopen`,
          f.organizationId,
          { reason: "Not authorized" },
          undefined,
          bookkeeper
        )
      ).statusCode
    ).toBe(403);
    const reopened = await api(
      "POST",
      `/v1/fiscal-periods/${f.period.id}/reopen`,
      f.organizationId,
      { reason: "Approved correction" }
    );
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(
      await prisma.auditEvent.count({
        where: { organizationId: f.organizationId, action: "FISCAL_PERIOD_REOPENED" }
      })
    ).toBe(1);
    await api("POST", `/v1/fiscal-periods/${f.period.id}/close`, f.organizationId, {
      reason: "Reclosed"
    });
    const [first, second] = await Promise.all([
      api("POST", `/v1/fiscal-periods/${f.period.id}/next-year`, f.organizationId),
      api("POST", `/v1/fiscal-periods/${f.period.id}/next-year`, f.organizationId)
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.json<{ period: { id: string } }>().period.id).toBe(
      first.json<{ period: { id: string } }>().period.id
    );
  });

  it("detects and dismisses deterministic review items with a reason", async () => {
    const f = await fixture();
    await prisma.outboxEvent.create({
      data: {
        organizationId: f.organizationId,
        eventType: "phase11.failed",
        aggregateType: "ReviewFixture",
        payload: {},
        status: "FAILED"
      }
    });
    const queue = (
      await api("GET", "/v1/accountant/review-queue?asOf=2026-12-31", f.organizationId)
    ).json<{ queue: { items: Array<{ fingerprint: string; category: string }> } }>().queue;
    const item = queue.items.find((entry) => entry.category === "FAILED_OUTBOX")!;
    expect(item).toBeDefined();
    expect(
      (
        await api("POST", "/v1/accountant/review-queue/dismiss", f.organizationId, {
          fingerprint: item.fingerprint,
          category: item.category,
          reason: "Delivery handled manually",
          asOf: "2026-12-31"
        })
      ).statusCode
    ).toBe(200);
    const after = (
      await api("GET", "/v1/accountant/review-queue?asOf=2026-12-31", f.organizationId)
    ).json<{ queue: { items: Array<{ fingerprint: string }> } }>().queue;
    expect(after.items.some((entry) => entry.fingerprint === item.fingerprint)).toBe(false);
    expect(
      (
        await api("POST", "/v1/accountant/review-queue/dismiss", f.organizationId, {
          fingerprint: "a".repeat(64),
          category: "FAILED_OUTBOX",
          reason: "Fabricated item",
          asOf: "2026-12-31"
        })
      ).statusCode
    ).toBe(409);
  });

  it("redacts and exports tenant-scoped audit history while rejecting cross-tenant access", async () => {
    const first = await fixture();
    await prisma.auditEvent.create({
      data: {
        organizationId: first.organizationId,
        action: "SENSITIVE_TEST",
        targetType: "Credential",
        metadata: { accessToken: "must-not-leak", safe: "visible" }
      }
    });
    const audit = (
      await api("GET", "/v1/accountant/audit-events?action=SENSITIVE_TEST", first.organizationId)
    ).json<{ audit: { events: Array<{ metadata: { accessToken: string; safe: string } }> } }>()
      .audit;
    expect(audit.events[0]!.metadata).toEqual({
      accessToken: "[REDACTED]",
      safe: "visible"
    });
    const csv = await api(
      "GET",
      "/v1/accountant/audit-events.csv?action=SENSITIVE_TEST",
      first.organizationId
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body).not.toContain("must-not-leak");
    const secondOwner = "phase11-other@example.test";
    const second = await api(
      "POST",
      "/v1/organizations",
      undefined,
      { legalName: "Other Ltd", displayName: "Other" },
      undefined,
      secondOwner
    );
    const secondId = second.json<{ organization: { id: string } }>().organization.id;
    const isolated = await api(
      "GET",
      "/v1/accountant/audit-events?action=SENSITIVE_TEST",
      secondId,
      undefined,
      undefined,
      secondOwner
    );
    expect(isolated.json<{ audit: { total: number } }>().audit.total).toBe(0);
  });

  it("rejects direct cross-tenant draft lines and mutation of close evidence", async () => {
    const first = await fixture();
    const secondOwner = "phase11-db-other@example.test";
    const created = await api(
      "POST",
      "/v1/organizations",
      undefined,
      { legalName: "Other Ltd", displayName: "Other" },
      undefined,
      secondOwner
    );
    const secondId = created.json<{ organization: { id: string } }>().organization.id;
    await api(
      "POST",
      "/v1/setup/presets/general-service/apply",
      secondId,
      {},
      randomUUID(),
      secondOwner
    );
    const draft = await prisma.manualJournalDraft.create({
      data: {
        organizationId: first.organizationId,
        description: "Tenant guard",
        effectiveDate: new Date("2026-06-30"),
        reason: "Test",
        createdByUserId: randomUUID(),
        updatedByUserId: randomUUID()
      }
    });
    const otherAccount = await prisma.account.findFirstOrThrow({
      where: { organizationId: secondId }
    });
    await expect(
      prisma.manualJournalDraftLine.create({
        data: {
          organizationId: first.organizationId,
          draftId: draft.id,
          accountId: otherAccount.id,
          lineNumber: 1,
          debitMinor: 1n
        }
      })
    ).rejects.toThrow();
    await api("POST", `/v1/fiscal-periods/${first.period.id}/close`, first.organizationId, {
      reason: "Evidence test",
      acknowledgeWarnings: true
    });
    const record = await prisma.periodCloseRecord.findFirstOrThrow({
      where: { organizationId: first.organizationId }
    });
    await expect(
      prisma.periodCloseRecord.update({ where: { id: record.id }, data: { reason: "tamper" } })
    ).rejects.toThrow(/append-only/i);
  });
});
