import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

interface OrganizationResponse {
  readonly organization: {
    readonly id: string;
  };
}

interface AccountResponse {
  readonly account: {
    readonly id: string;
    readonly isControl: boolean;
  };
}

interface PeriodResponse {
  readonly period: {
    readonly id: string;
    readonly status: "OPEN" | "CLOSED";
  };
}

interface JournalResponse {
  readonly journal: {
    readonly id: string;
    readonly status: "POSTED";
    readonly reversedJournalId: string | null;
    readonly lines: readonly {
      readonly id: string;
      readonly accountId: string;
      readonly debitMinor: string;
      readonly creditMinor: string;
    }[];
  };
}

interface TrialBalanceResponse {
  readonly trialBalance: {
    readonly totalDebitMinor: string;
    readonly totalCreditMinor: string;
    readonly isBalanced: boolean;
    readonly rows: readonly {
      readonly accountId: string;
      readonly balanceMinor: string;
    }[];
  };
}

interface GeneralLedgerResponse {
  readonly generalLedger: {
    readonly lines: readonly {
      readonly journalId: string;
      readonly accountId: string;
      readonly debitMinor: string;
      readonly creditMinor: string;
      readonly runningBalanceMinor: string;
    }[];
  };
}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for integration tests.");
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});
const app = buildApp({ prisma });

function headers(email: string, organizationId?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

function idempotencyHeaders(email: string, organizationId: string, key: string) {
  return {
    ...headers(email, organizationId),
    "Idempotency-Key": key
  };
}

async function createOrganization(email = "owner@example.test") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(email),
    payload: {
      legalName: "Example Legal Co",
      displayName: "Example Co"
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json<OrganizationResponse>().organization.id;
}

async function createAccount(
  organizationId: string,
  code: string,
  name: string,
  type: string,
  isControl = false,
  email = "owner@example.test"
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    headers: headers(email, organizationId),
    payload: { code, name, type, isControl }
  });

  expect(response.statusCode).toBe(201);
  return response.json<AccountResponse>().account;
}

async function createFiscalPeriod(organizationId: string, email = "owner@example.test") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/fiscal-periods",
    headers: headers(email, organizationId),
    payload: {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31"
    }
  });

  expect(response.statusCode).toBe(201);
  return response.json<PeriodResponse>().period;
}

async function createLedgerFixture(email = "owner@example.test") {
  const organizationId = await createOrganization(email);
  await createFiscalPeriod(organizationId, email);
  const cash = await createAccount(organizationId, "1000", "Cash", "ASSET", false, email);
  const revenue = await createAccount(organizationId, "4000", "Revenue", "REVENUE", false, email);

  return { organizationId, cash, revenue, email };
}

async function inviteAndAcceptMember(
  organizationId: string,
  ownerEmail: string,
  memberEmail: string,
  role: string
) {
  const invitationResponse = await app.inject({
    method: "POST",
    url: "/v1/organizations/current/invitations",
    headers: headers(ownerEmail, organizationId),
    payload: { email: memberEmail, role }
  });
  expect(invitationResponse.statusCode).toBe(201);
  const token = invitationResponse.json<{ token: string }>().token;
  const acceptanceResponse = await app.inject({
    method: "POST",
    url: "/v1/invitations/accept",
    headers: headers(memberEmail),
    payload: { token }
  });
  expect(acceptanceResponse.statusCode).toBe(200);
  return acceptanceResponse.json<{ membership: { id: string } }>().membership;
}

async function createExpandedLedgerFixture(email = "owner@example.test") {
  const organizationId = await createOrganization(email);
  const period = await createFiscalPeriod(organizationId, email);
  const cash = await createAccount(organizationId, "1000", "Cash", "ASSET", false, email);
  const receivable = await createAccount(
    organizationId,
    "1200",
    "Accounts Receivable",
    "ASSET",
    false,
    email
  );
  const payable = await createAccount(
    organizationId,
    "2100",
    "Accounts Payable",
    "LIABILITY",
    false,
    email
  );
  const revenue = await createAccount(organizationId, "4000", "Revenue", "REVENUE", false, email);
  const expense = await createAccount(organizationId, "5000", "Expense", "EXPENSE", false, email);

  return { organizationId, period, cash, receivable, payable, revenue, expense, email };
}

async function createDirectDraftJournal(input: {
  readonly organizationId: string;
  readonly fiscalPeriodId: string;
  readonly sourceId: string;
  readonly reversedJournalId?: string | null | undefined;
}) {
  return prisma.journal.create({
    data: {
      organizationId: input.organizationId,
      fiscalPeriodId: input.fiscalPeriodId,
      status: "DRAFT",
      effectiveDate: new Date("2026-03-15T00:00:00.000Z"),
      description: `Direct closeout journal ${input.sourceId}`,
      sourceType: "direct_closeout_test",
      sourceId: input.sourceId,
      postingKey: `direct-closeout:${input.sourceId}`,
      reversedJournalId: input.reversedJournalId ?? null
    }
  });
}

async function postDirectDraftJournal(journalId: string, userId: string) {
  return prisma.journal.update({
    where: { id: journalId },
    data: {
      status: "POSTED",
      postedAt: new Date("2026-03-15T00:00:00.000Z"),
      postedByUserId: userId
    },
    include: {
      lines: { orderBy: { lineNumber: "asc" } }
    }
  });
}

function balancedJournalPayload(cashAccountId: string, revenueAccountId: string, sourceId: string) {
  return {
    description: "Manual service sale",
    effectiveDate: "2026-03-15",
    sourceType: "manual_journal",
    sourceId,
    postingKey: `manual:${sourceId}`,
    lines: [
      { accountId: cashAccountId, debitMinor: "10000", creditMinor: "0" },
      { accountId: revenueAccountId, debitMinor: "0", creditMinor: "10000" }
    ]
  };
}

describe("ledger foundation integration", () => {
  beforeAll(async () => {
    await app.ready();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("posts a balanced journal and reports it in the trial balance", async () => {
    const fixture = await createLedgerFixture();
    const unusedAccount = await createAccount(
      fixture.organizationId,
      "5100",
      "Unused expense",
      "EXPENSE"
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "journal-balanced"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-1")
    });

    expect(response.statusCode).toBe(201);
    const journal = response.json<JournalResponse>().journal;
    expect(journal.status).toBe("POSTED");

    const trialBalanceResponse = await app.inject({
      method: "GET",
      url: "/v1/reports/trial-balance",
      headers: headers(fixture.email, fixture.organizationId)
    });

    expect(trialBalanceResponse.statusCode).toBe(200);
    const trialBalance = trialBalanceResponse.json<TrialBalanceResponse>().trialBalance;
    expect(trialBalance.totalDebitMinor).toBe("10000");
    expect(trialBalance.totalCreditMinor).toBe("10000");
    expect(trialBalance.isBalanced).toBe(true);
    expect(trialBalance.rows).toContainEqual(
      expect.objectContaining({ accountId: unusedAccount.id, balanceMinor: "0" })
    );
  });

  it("reports posted journal detail in the general ledger", async () => {
    const fixture = await createLedgerFixture();
    const response = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "general-ledger-key"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-gl")
    });
    const journal = response.json<JournalResponse>().journal;

    const ledgerResponse = await app.inject({
      method: "GET",
      url: `/v1/reports/general-ledger?accountId=${fixture.cash.id}`,
      headers: headers(fixture.email, fixture.organizationId)
    });

    expect(ledgerResponse.statusCode).toBe(200);
    const generalLedger = ledgerResponse.json<GeneralLedgerResponse>().generalLedger;
    expect(generalLedger.lines).toHaveLength(1);
    expect(generalLedger.lines[0]).toMatchObject({
      journalId: journal.id,
      accountId: fixture.cash.id,
      debitMinor: "10000",
      creditMinor: "0",
      runningBalanceMinor: "10000"
    });
  });

  it("lists accounts, archives accounts, and blocks posting to archived accounts", async () => {
    const fixture = await createLedgerFixture();

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: headers(fixture.email, fixture.organizationId)
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json<{ accounts: readonly { id: string }[] }>().accounts).toHaveLength(2);

    const archiveResponse = await app.inject({
      method: "POST",
      url: `/v1/accounts/${fixture.revenue.id}/archive`,
      headers: headers(fixture.email, fixture.organizationId)
    });
    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json<AccountResponse>().account.isControl).toBe(false);

    const postResponse = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "archived-account-key"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-archived")
    });
    expect(postResponse.statusCode).toBe(422);
    expect(postResponse.json<{ error: { code: string } }>().error.code).toBe("ACCOUNT_ARCHIVED");
  });

  it("enforces duplicate organization-scoped account codes through API and database constraints", async () => {
    const organizationId = await createOrganization("duplicate-account@example.test");
    const [firstApiCreate, secondApiCreate] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/accounts",
        headers: headers("duplicate-account@example.test", organizationId),
        payload: {
          code: "1999",
          name: "Duplicate Cash A",
          type: "ASSET"
        }
      }),
      app.inject({
        method: "POST",
        url: "/v1/accounts",
        headers: headers("duplicate-account@example.test", organizationId),
        payload: {
          code: "1999",
          name: "Duplicate Cash B",
          type: "ASSET"
        }
      })
    ]);
    const apiStatusCodes = [firstApiCreate.statusCode, secondApiCreate.statusCode].sort();

    expect(apiStatusCodes).toEqual([201, 409]);
    const apiConflict = [firstApiCreate, secondApiCreate].find(
      (response) => response.statusCode === 409
    )!;
    expect(apiConflict.json<{ error: { code: string } }>().error.code).toBe(
      "ACCOUNT_CODE_ALREADY_EXISTS"
    );
    expect(await prisma.account.count({ where: { organizationId, code: "1999" } })).toBe(1);

    const directResults = await Promise.allSettled([
      prisma.account.create({
        data: {
          organizationId,
          code: "2999",
          name: "Direct Duplicate A",
          type: "ASSET"
        }
      }),
      prisma.account.create({
        data: {
          organizationId,
          code: "2999",
          name: "Direct Duplicate B",
          type: "ASSET"
        }
      })
    ]);

    expect(directResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(directResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.account.count({ where: { organizationId, code: "2999" } })).toBe(1);
  });

  it("rejects an unbalanced journal without partial journal, audit, outbox, or idempotency state", async () => {
    const fixture = await createLedgerFixture();
    const auditCountBefore = await prisma.auditEvent.count();

    const response = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "journal-unbalanced"),
      payload: {
        ...balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "bad-sale"),
        lines: [
          { accountId: fixture.cash.id, debitMinor: "10000", creditMinor: "0" },
          { accountId: fixture.revenue.id, debitMinor: "0", creditMinor: "9999" }
        ]
      }
    });

    expect(response.statusCode).toBe(422);
    expect(await prisma.journal.count()).toBe(0);
    expect(await prisma.journalLine.count()).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(auditCountBefore);
  });

  it("rejects out-of-range minor units before journal state is persisted", async () => {
    const fixture = await createLedgerFixture();

    const response = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "money-range"),
      payload: {
        ...balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "money-range"),
        lines: [
          {
            accountId: fixture.cash.id,
            debitMinor: "9223372036854775808",
            creditMinor: "0"
          },
          {
            accountId: fixture.revenue.id,
            debitMinor: "0",
            creditMinor: "9223372036854775808"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("MINOR_UNIT_OUT_OF_RANGE");
    expect(await prisma.journal.count()).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });

  it("replays duplicate idempotent journal posts without duplicate ledger effect", async () => {
    const fixture = await createLedgerFixture();
    const payload = balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-2");

    const first = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "duplicate-key"),
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "duplicate-key"),
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json<JournalResponse>().journal.id).toBe(
      second.json<JournalResponse>().journal.id
    );
    expect(await prisma.journal.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it("handles simultaneous posting requests with the same idempotency key", async () => {
    const fixture = await createLedgerFixture("same-key-race@example.test");
    const payload = balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "same-key-race");
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/journals",
        headers: idempotencyHeaders(fixture.email, fixture.organizationId, "same-key-race"),
        payload
      }),
      app.inject({
        method: "POST",
        url: "/v1/journals",
        headers: idempotencyHeaders(fixture.email, fixture.organizationId, "same-key-race"),
        payload
      })
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json<JournalResponse>().journal.id).toBe(
      second.json<JournalResponse>().journal.id
    );
    expect(await prisma.journal.count()).toBe(1);
    expect(await prisma.journalLine.count()).toBe(2);
    expect(await prisma.outboxEvent.count()).toBe(1);
    expect(await prisma.idempotencyRecord.count()).toBe(1);
  });

  it("rejects reused idempotency keys with a different request hash", async () => {
    const fixture = await createLedgerFixture();
    const firstPayload = balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-3");
    const secondPayload = {
      ...balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-4"),
      description: "Different request"
    };

    await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "hash-key"),
      payload: firstPayload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "hash-key"),
      payload: secondPayload
    });

    expect(second.statusCode).toBe(409);
    expect(await prisma.journal.count()).toBe(1);
  });

  it("rejects duplicate posting keys even with a new idempotency key", async () => {
    const fixture = await createLedgerFixture();
    const payload = balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-duplicate");

    const first = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "duplicate-source-1"),
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "duplicate-source-2"),
      payload
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe("DUPLICATE_POSTING");
    expect(await prisma.journal.count()).toBe(1);
  });

  it("enforces posted journal and audit immutability in PostgreSQL", async () => {
    const fixture = await createLedgerFixture();
    const response = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "immutable-key"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-5")
    });
    const journal = response.json<JournalResponse>().journal;
    const lineId = journal.lines[0]!.id;
    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "JOURNAL_POSTED" }
    });

    await expect(
      prisma.journalLine.update({
        where: { id: lineId },
        data: { debitMinor: 1n }
      })
    ).rejects.toThrow();
    await expect(prisma.journalLine.delete({ where: { id: lineId } })).rejects.toThrow();
    await expect(
      prisma.journal.update({
        where: { id: journal.id },
        data: { description: "Mutated" }
      })
    ).rejects.toThrow();
    await expect(
      prisma.journalLine.create({
        data: {
          organizationId: fixture.organizationId,
          journalId: journal.id,
          accountId: fixture.revenue.id,
          lineNumber: 3,
          debitMinor: 0n,
          creditMinor: 1n
        }
      })
    ).rejects.toThrow();
    await expect(prisma.journal.delete({ where: { id: journal.id } })).rejects.toThrow();
    await expect(
      prisma.auditEvent.update({
        where: { id: auditEvent.id },
        data: { reason: "mutated" }
      })
    ).rejects.toThrow();
  });

  it("rejects direct database attempts to create or post invalid journals", async () => {
    const fixture = await createLedgerFixture();
    const period = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { organizationId: fixture.organizationId }
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: fixture.email } });

    await expect(
      prisma.journal.create({
        data: {
          organizationId: fixture.organizationId,
          fiscalPeriodId: period.id,
          status: "POSTED",
          effectiveDate: new Date("2026-03-15T00:00:00.000Z"),
          description: "Direct posted journal without lines",
          sourceType: "direct_test",
          sourceId: "posted-without-lines",
          postingKey: "direct:posted-without-lines",
          postedAt: new Date("2026-03-15T00:00:00.000Z"),
          postedByUserId: user.id
        }
      })
    ).rejects.toThrow();

    const draft = await prisma.journal.create({
      data: {
        organizationId: fixture.organizationId,
        fiscalPeriodId: period.id,
        status: "DRAFT",
        effectiveDate: new Date("2026-03-15T00:00:00.000Z"),
        description: "Direct unbalanced draft",
        sourceType: "direct_test",
        sourceId: "unbalanced-transition",
        postingKey: "direct:unbalanced-transition"
      }
    });

    await prisma.journalLine.createMany({
      data: [
        {
          organizationId: fixture.organizationId,
          journalId: draft.id,
          accountId: fixture.cash.id,
          lineNumber: 1,
          debitMinor: 10000n,
          creditMinor: 0n
        },
        {
          organizationId: fixture.organizationId,
          journalId: draft.id,
          accountId: fixture.revenue.id,
          lineNumber: 2,
          debitMinor: 0n,
          creditMinor: 9999n
        }
      ]
    });

    await expect(
      prisma.journal.update({
        where: { id: draft.id },
        data: {
          status: "POSTED",
          postedAt: new Date("2026-03-15T00:00:00.000Z"),
          postedByUserId: user.id
        }
      })
    ).rejects.toThrow();
  });

  it("posts generated balanced journals through database invariants", async () => {
    const fixture = await createExpandedLedgerFixture("generated-balanced@example.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: fixture.email } });
    const generatedCases = [
      [
        { accountId: fixture.cash.id, debitMinor: 1n, creditMinor: 0n },
        { accountId: fixture.revenue.id, debitMinor: 0n, creditMinor: 1n }
      ],
      [
        { accountId: fixture.cash.id, debitMinor: 1250n, creditMinor: 0n },
        { accountId: fixture.expense.id, debitMinor: 375n, creditMinor: 0n },
        { accountId: fixture.revenue.id, debitMinor: 0n, creditMinor: 1400n },
        { accountId: fixture.payable.id, debitMinor: 0n, creditMinor: 225n }
      ],
      [
        { accountId: fixture.receivable.id, debitMinor: 999999999n, creditMinor: 0n },
        { accountId: fixture.revenue.id, debitMinor: 0n, creditMinor: 999999999n }
      ],
      [
        { accountId: fixture.cash.id, debitMinor: 9223372036854775807n, creditMinor: 0n },
        { accountId: fixture.revenue.id, debitMinor: 0n, creditMinor: 9223372036854775807n }
      ]
    ];

    for (const [caseIndex, lines] of generatedCases.entries()) {
      const draft = await createDirectDraftJournal({
        organizationId: fixture.organizationId,
        fiscalPeriodId: fixture.period.id,
        sourceId: `generated-balanced-${caseIndex.toString()}`
      });

      await prisma.journalLine.createMany({
        data: lines.map((line, lineIndex) => ({
          organizationId: fixture.organizationId,
          journalId: draft.id,
          accountId: line.accountId,
          lineNumber: lineIndex + 1,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor
        }))
      });

      const posted = await postDirectDraftJournal(draft.id, user.id);
      const debitTotal = posted.lines.reduce((total, line) => total + line.debitMinor, 0n);
      const creditTotal = posted.lines.reduce((total, line) => total + line.creditMinor, 0n);

      expect(posted.status).toBe("POSTED");
      expect(debitTotal).toBe(creditTotal);
    }
  });

  it("rejects generated unbalanced journals through database invariants", async () => {
    const fixture = await createExpandedLedgerFixture("generated-unbalanced@example.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: fixture.email } });
    const generatedCases = [
      [
        { accountId: fixture.cash.id, debitMinor: 2n, creditMinor: 0n },
        { accountId: fixture.revenue.id, debitMinor: 0n, creditMinor: 1n }
      ],
      [
        { accountId: fixture.cash.id, debitMinor: 1250n, creditMinor: 0n },
        { accountId: fixture.expense.id, debitMinor: 375n, creditMinor: 0n },
        { accountId: fixture.revenue.id, debitMinor: 0n, creditMinor: 1400n }
      ],
      [
        { accountId: fixture.receivable.id, debitMinor: 999999999n, creditMinor: 0n },
        { accountId: fixture.revenue.id, debitMinor: 0n, creditMinor: 999999998n }
      ]
    ];

    for (const [caseIndex, lines] of generatedCases.entries()) {
      const draft = await createDirectDraftJournal({
        organizationId: fixture.organizationId,
        fiscalPeriodId: fixture.period.id,
        sourceId: `generated-unbalanced-${caseIndex.toString()}`
      });

      await prisma.journalLine.createMany({
        data: lines.map((line, lineIndex) => ({
          organizationId: fixture.organizationId,
          journalId: draft.id,
          accountId: line.accountId,
          lineNumber: lineIndex + 1,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor
        }))
      });

      await expect(postDirectDraftJournal(draft.id, user.id)).rejects.toThrow();
      const unchanged = await prisma.journal.findUniqueOrThrow({ where: { id: draft.id } });
      expect(unchanged.status).toBe("DRAFT");
    }
  });

  it("rejects zero, negative, and two-sided lines through database constraints", async () => {
    const fixture = await createExpandedLedgerFixture("line-constraints@example.test");
    const draft = await createDirectDraftJournal({
      organizationId: fixture.organizationId,
      fiscalPeriodId: fixture.period.id,
      sourceId: "invalid-lines"
    });
    const invalidLines = [
      { debitMinor: 0n, creditMinor: 0n },
      { debitMinor: -1n, creditMinor: 0n },
      { debitMinor: 0n, creditMinor: -1n },
      { debitMinor: 1n, creditMinor: 1n }
    ];

    for (const [lineIndex, line] of invalidLines.entries()) {
      await expect(
        prisma.journalLine.create({
          data: {
            organizationId: fixture.organizationId,
            journalId: draft.id,
            accountId: fixture.cash.id,
            lineNumber: lineIndex + 1,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor
          }
        })
      ).rejects.toThrow();
    }
  });

  it("rejects direct database posting into a closed fiscal period", async () => {
    const fixture = await createExpandedLedgerFixture("direct-closed-period@example.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: fixture.email } });

    await prisma.fiscalPeriod.update({
      where: { id: fixture.period.id },
      data: {
        status: "CLOSED",
        closedAt: new Date("2026-03-15T00:00:00.000Z"),
        closedByUserId: user.id
      }
    });

    const draft = await createDirectDraftJournal({
      organizationId: fixture.organizationId,
      fiscalPeriodId: fixture.period.id,
      sourceId: "direct-closed-period"
    });
    await prisma.journalLine.createMany({
      data: [
        {
          organizationId: fixture.organizationId,
          journalId: draft.id,
          accountId: fixture.cash.id,
          lineNumber: 1,
          debitMinor: 100n,
          creditMinor: 0n
        },
        {
          organizationId: fixture.organizationId,
          journalId: draft.id,
          accountId: fixture.revenue.id,
          lineNumber: 2,
          debitMinor: 0n,
          creditMinor: 100n
        }
      ]
    });

    await expect(postDirectDraftJournal(draft.id, user.id)).rejects.toThrow();
  });

  it("rejects direct database cross-tenant journal period and reversal references", async () => {
    const fixtureA = await createLedgerFixture("tenant-a-db@example.test");
    const fixtureB = await createLedgerFixture("tenant-b-db@example.test");
    const periodB = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { organizationId: fixtureB.organizationId }
    });

    await expect(
      prisma.journal.create({
        data: {
          organizationId: fixtureA.organizationId,
          fiscalPeriodId: periodB.id,
          status: "DRAFT",
          effectiveDate: new Date("2026-03-15T00:00:00.000Z"),
          description: "Cross-tenant period",
          sourceType: "direct_test",
          sourceId: "cross-period",
          postingKey: "direct:cross-period"
        }
      })
    ).rejects.toThrow();

    const postResponse = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixtureA.email, fixtureA.organizationId, "cross-reversal-base"),
      payload: balancedJournalPayload(fixtureA.cash.id, fixtureA.revenue.id, "cross-reversal-base")
    });
    const original = postResponse.json<JournalResponse>().journal;

    await expect(
      prisma.journal.create({
        data: {
          organizationId: fixtureB.organizationId,
          fiscalPeriodId: periodB.id,
          status: "DRAFT",
          effectiveDate: new Date("2026-03-16T00:00:00.000Z"),
          description: "Cross-tenant reversal",
          sourceType: "direct_test",
          sourceId: "cross-reversal",
          postingKey: "direct:cross-reversal",
          reversedJournalId: original.id
        }
      })
    ).rejects.toThrow();
  });

  it("creates an exact inverse reversal and leaves the original unchanged", async () => {
    const fixture = await createLedgerFixture();
    const postedResponse = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "reverse-source"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-6")
    });
    const original = postedResponse.json<JournalResponse>().journal;

    const reversalResponse = await app.inject({
      method: "POST",
      url: `/v1/journals/${original.id}/reverse`,
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "reverse-key"),
      payload: {
        effectiveDate: "2026-03-16",
        reason: "Customer cancellation"
      }
    });

    expect(reversalResponse.statusCode).toBe(201);
    const reversal = reversalResponse.json<JournalResponse>().journal;
    expect(reversal.reversedJournalId).toBe(original.id);
    expect(reversal.lines[0]!.debitMinor).toBe(original.lines[0]!.creditMinor);
    expect(reversal.lines[0]!.creditMinor).toBe(original.lines[0]!.debitMinor);

    const originalAfter = await app.inject({
      method: "GET",
      url: `/v1/journals/${original.id}`,
      headers: headers(fixture.email, fixture.organizationId)
    });

    expect(originalAfter.json<JournalResponse>().journal.reversedJournalId).toBeNull();
    expect(await prisma.journal.count()).toBe(2);
    expect(await prisma.outboxEvent.count()).toBe(2);

    const duplicateReversalResponse = await app.inject({
      method: "POST",
      url: `/v1/journals/${original.id}/reverse`,
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "reverse-key-duplicate"),
      payload: {
        effectiveDate: "2026-03-17",
        reason: "Duplicate cancellation"
      }
    });
    expect(duplicateReversalResponse.statusCode).toBe(409);
    expect(duplicateReversalResponse.json<{ error: { code: string } }>().error.code).toBe(
      "JOURNAL_ALREADY_REVERSED"
    );
    expect(await prisma.journal.count()).toBe(2);

    const journalAuditEvents = await prisma.auditEvent.findMany({
      where: {
        organizationId: fixture.organizationId,
        action: { in: ["JOURNAL_POSTED", "JOURNAL_REVERSED"] }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(journalAuditEvents.map((event) => event.action)).toEqual([
      "JOURNAL_POSTED",
      "JOURNAL_REVERSED"
    ]);
  });

  it("creates exact inverse reversal lines for generated multi-line journals", async () => {
    const fixture = await createExpandedLedgerFixture("multi-line-reversal@example.test");
    const postedResponse = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(
        fixture.email,
        fixture.organizationId,
        "multi-line-reversal-post"
      ),
      payload: {
        description: "Generated multi-line journal",
        effectiveDate: "2026-03-15",
        sourceType: "manual_journal",
        sourceId: "multi-line-reversal",
        postingKey: "manual:multi-line-reversal",
        lines: [
          { accountId: fixture.cash.id, debitMinor: "1250", creditMinor: "0" },
          { accountId: fixture.expense.id, debitMinor: "375", creditMinor: "0" },
          { accountId: fixture.revenue.id, debitMinor: "0", creditMinor: "1400" },
          { accountId: fixture.payable.id, debitMinor: "0", creditMinor: "225" }
        ]
      }
    });
    expect(postedResponse.statusCode).toBe(201);
    const original = postedResponse.json<JournalResponse>().journal;

    const reversalResponse = await app.inject({
      method: "POST",
      url: `/v1/journals/${original.id}/reverse`,
      headers: idempotencyHeaders(
        fixture.email,
        fixture.organizationId,
        "multi-line-reversal-reverse"
      ),
      payload: {
        effectiveDate: "2026-03-16",
        reason: "Generated equivalence check"
      }
    });
    expect(reversalResponse.statusCode).toBe(201);
    const reversal = reversalResponse.json<JournalResponse>().journal;

    expect(reversal.reversedJournalId).toBe(original.id);
    expect(reversal.lines).toHaveLength(original.lines.length);
    for (const [lineIndex, originalLine] of original.lines.entries()) {
      const reversalLine = reversal.lines[lineIndex]!;
      expect(reversalLine.accountId).toBe(originalLine.accountId);
      expect(reversalLine.debitMinor).toBe(originalLine.creditMinor);
      expect(reversalLine.creditMinor).toBe(originalLine.debitMinor);
    }
  });

  it("allows only one reversal when simultaneous reversal requests race", async () => {
    const fixture = await createLedgerFixture("reversal-race@example.test");
    const postedResponse = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "reversal-race-post"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "reversal-race")
    });
    expect(postedResponse.statusCode).toBe(201);
    const original = postedResponse.json<JournalResponse>().journal;

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/journals/${original.id}/reverse`,
        headers: idempotencyHeaders(fixture.email, fixture.organizationId, "reversal-race-a"),
        payload: {
          effectiveDate: "2026-03-16",
          reason: "Race reversal A"
        }
      }),
      app.inject({
        method: "POST",
        url: `/v1/journals/${original.id}/reverse`,
        headers: idempotencyHeaders(fixture.email, fixture.organizationId, "reversal-race-b"),
        payload: {
          effectiveDate: "2026-03-16",
          reason: "Race reversal B"
        }
      })
    ]);
    const statusCodes = [first.statusCode, second.statusCode].sort();

    expect(statusCodes).toEqual([201, 409]);
    expect(
      [first, second]
        .find((response) => response.statusCode === 409)!
        .json<{
          error: { code: string };
        }>().error.code
    ).toBe("JOURNAL_ALREADY_REVERSED");
    expect(
      await prisma.journal.count({
        where: {
          organizationId: fixture.organizationId,
          reversedJournalId: original.id
        }
      })
    ).toBe(1);
    expect(await prisma.journal.count()).toBe(2);
  });

  it("rejects posting into a closed period until it is explicitly reopened", async () => {
    const fixture = await createLedgerFixture();
    const period = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { organizationId: fixture.organizationId }
    });

    const closeResponse = await app.inject({
      method: "POST",
      url: `/v1/fiscal-periods/${period.id}/close`,
      headers: headers(fixture.email, fixture.organizationId),
      payload: { reason: "Month end" }
    });
    expect(closeResponse.statusCode).toBe(200);
    expect(closeResponse.json<PeriodResponse>().period.status).toBe("CLOSED");

    const lockedPost = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "closed-period"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-7")
    });
    expect(lockedPost.statusCode).toBe(409);

    const reopenResponse = await app.inject({
      method: "POST",
      url: `/v1/fiscal-periods/${period.id}/reopen`,
      headers: headers(fixture.email, fixture.organizationId),
      payload: { reason: "Correction required" }
    });
    expect(reopenResponse.statusCode).toBe(200);
    expect(reopenResponse.json<PeriodResponse>().period.status).toBe("OPEN");
  });

  it("keeps a consistent ledger when posting races fiscal period closure", async () => {
    const fixture = await createLedgerFixture("close-post-race@example.test");
    const period = await prisma.fiscalPeriod.findFirstOrThrow({
      where: { organizationId: fixture.organizationId }
    });
    const [postResponse, closeResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/journals",
        headers: idempotencyHeaders(fixture.email, fixture.organizationId, "close-post-race"),
        payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "close-post-race")
      }),
      app.inject({
        method: "POST",
        url: `/v1/fiscal-periods/${period.id}/close`,
        headers: headers(fixture.email, fixture.organizationId),
        payload: { reason: "Concurrent close" }
      })
    ]);

    expect(closeResponse.statusCode).toBe(200);
    expect([201, 409]).toContain(postResponse.statusCode);

    const closedPeriod = await prisma.fiscalPeriod.findUniqueOrThrow({
      where: { id: period.id }
    });
    expect(closedPeriod.status).toBe("CLOSED");

    const postedJournals = await prisma.journal.findMany({
      where: {
        organizationId: fixture.organizationId,
        status: "POSTED"
      },
      include: {
        lines: true
      }
    });
    expect(postedJournals).toHaveLength(postResponse.statusCode === 201 ? 1 : 0);
    for (const journal of postedJournals) {
      const debitTotal = journal.lines.reduce((total, line) => total + line.debitMinor, 0n);
      const creditTotal = journal.lines.reduce((total, line) => total + line.creditMinor, 0n);
      expect(journal.fiscalPeriodId).toBe(period.id);
      expect(debitTotal).toBe(creditTotal);
    }
  });

  it("rejects overlapping fiscal periods through the API and database constraint", async () => {
    const organizationId = await createOrganization("period-overlap@example.test");
    await createFiscalPeriod(organizationId, "period-overlap@example.test");

    const apiOverlap = await app.inject({
      method: "POST",
      url: "/v1/fiscal-periods",
      headers: headers("period-overlap@example.test", organizationId),
      payload: {
        name: "Overlapping FY2026",
        startDate: "2026-06-01",
        endDate: "2027-05-31"
      }
    });
    expect(apiOverlap.statusCode).toBe(409);
    expect(apiOverlap.json<{ error: { code: string } }>().error.code).toBe("FISCAL_PERIOD_OVERLAP");

    await expect(
      prisma.fiscalPeriod.create({
        data: {
          organizationId,
          name: "Direct overlap",
          startDate: new Date("2026-02-01T00:00:00.000Z"),
          endDate: new Date("2026-02-28T00:00:00.000Z")
        }
      })
    ).rejects.toThrow();
  });

  it("rejects unauthorized journal posting", async () => {
    const fixture = await createLedgerFixture();
    await inviteAndAcceptMember(
      fixture.organizationId,
      fixture.email,
      "sales@example.test",
      "SALES"
    );

    const postResponse = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders("sales@example.test", fixture.organizationId, "sales-post"),
      payload: balancedJournalPayload(fixture.cash.id, fixture.revenue.id, "sale-8")
    });

    expect(postResponse.statusCode).toBe(403);
    expect(await prisma.journal.count()).toBe(0);
  });

  it("rejects and audits non-admin role escalation attempts", async () => {
    const fixture = await createLedgerFixture();
    const salesEmail = "sales-escalation@example.test";
    const membership = await inviteAndAcceptMember(
      fixture.organizationId,
      fixture.email,
      salesEmail,
      "SALES"
    );

    const escalationResponse = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/current/members/${membership.id}/role`,
      headers: headers(salesEmail, fixture.organizationId),
      payload: { role: "ADMIN" }
    });

    expect(escalationResponse.statusCode).toBe(403);
    const salesUser = await prisma.user.findUniqueOrThrow({ where: { email: salesEmail } });
    const storedMembership = await prisma.membership.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: fixture.organizationId,
          userId: salesUser.id
        }
      }
    });
    expect(storedMembership.role).toBe("SALES");

    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: fixture.organizationId,
        actorUserId: salesUser.id,
        action: "AUTHORIZATION_DENIED"
      }
    });
    expect(auditEvent.metadata).toMatchObject({
      actorRole: "SALES",
      permission: "members:roles",
      reason: "ROLE_DENIED"
    });
  });

  it("audits membership role assignment with before and after metadata", async () => {
    const fixture = await createLedgerFixture();
    const memberEmail = "role-audit@example.test";
    const auditHeaders = {
      ...headers(fixture.email, fixture.organizationId),
      "user-agent": "ClearLedgerIntegrationTest/1.0"
    };

    const membership = await inviteAndAcceptMember(
      fixture.organizationId,
      fixture.email,
      memberEmail,
      "SALES"
    );

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/current/members/${membership.id}/role`,
      headers: auditHeaders,
      payload: { role: "READ_ONLY" }
    });
    expect(updateResponse.statusCode).toBe(200);

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        organizationId: fixture.organizationId,
        action: "MEMBER_ROLE_CHANGED",
        targetId: membership.id
      },
      orderBy: { createdAt: "asc" }
    });

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.metadata).toMatchObject({
      before: { role: "SALES" },
      after: { role: "READ_ONLY" },
      auditOrigin: {
        userAgent: "ClearLedgerIntegrationTest/1.0"
      }
    });
  });

  it("does not expose another organization's journal by id", async () => {
    const fixtureA = await createLedgerFixture("owner-a@example.test");
    const fixtureB = await createLedgerFixture("owner-b@example.test");
    const postResponse = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixtureA.email, fixtureA.organizationId, "tenant-a-post"),
      payload: balancedJournalPayload(fixtureA.cash.id, fixtureA.revenue.id, "sale-9")
    });
    const journal = postResponse.json<JournalResponse>().journal;

    const crossTenantResponse = await app.inject({
      method: "GET",
      url: `/v1/journals/${journal.id}`,
      headers: headers(fixtureB.email, fixtureB.organizationId)
    });

    expect(crossTenantResponse.statusCode).toBe(404);
  });

  it("blocks direct control-account posting unless explicitly authorized and reasoned", async () => {
    const fixture = await createLedgerFixture();
    const receivable = await createAccount(
      fixture.organizationId,
      "1200",
      "Accounts Receivable",
      "ASSET",
      true
    );
    const payload = balancedJournalPayload(receivable.id, fixture.revenue.id, "control-1");

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "control-blocked"),
      payload
    });
    expect(blocked.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: idempotencyHeaders(fixture.email, fixture.organizationId, "control-allowed"),
      payload: {
        ...payload,
        sourceId: "control-2",
        postingKey: "manual:control-2",
        allowControlAccountPosting: true,
        reason: "Accountant-approved opening correction"
      }
    });
    expect(allowed.statusCode).toBe(201);
  });
});
