import { randomUUID } from "node:crypto";
import { PrismaClient, withTenantTransaction } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { PRESET_VERSION } from "./services/account-presets.js";
import { setupSteps } from "./services/company-setup-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase3-owner@example.test";

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
    payload: { legalName: "Phase Three Ltd", displayName: "Phase Three" }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}
async function state(organizationId: string, email = owner) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId, email)
  });
  expect(response.statusCode).toBe(200);
  return response.json<{
    setup: {
      settings: {
        version: number;
        baseCurrency: string;
        accountingStartDate: string | null;
        setupCompletedAt: string | null;
      };
      steps: Array<{ step: string; status: string; version: number }>;
      defaults: { version: number };
      organization: { legalName: string };
    };
  }>().setup;
}
function profilePayload(version: number, overrides: Record<string, unknown> = {}) {
  return {
    version,
    legalName: "Phase Three Ltd",
    displayName: "Phase Three",
    businessType: "corporation",
    businessNumber: "123456789RC0001",
    locale: "en-CA",
    timeZone: "America/Edmonton",
    baseCurrency: "CAD",
    fiscalYearEndMonth: 12,
    fiscalYearEndDay: 31,
    accountingStartDate: "2026-01-01",
    primaryColor: "#17674f",
    accentColor: "#e2b13c",
    ...overrides
  };
}
async function configure(organizationId: string) {
  const current = await state(organizationId);
  const profile = await app.inject({
    method: "PATCH",
    url: "/v1/setup/profile",
    headers: headers(organizationId),
    payload: profilePayload(current.settings.version)
  });
  expect(profile.statusCode).toBe(200);
  const preset = await app.inject({
    method: "POST",
    url: "/v1/setup/presets/general-service/apply",
    headers: headers(organizationId, owner, randomUUID()),
    payload: {}
  });
  expect([200, 201]).toContain(preset.statusCode);
  const fiscal = await app.inject({
    method: "POST",
    url: "/v1/setup/fiscal-year/initialize",
    headers: headers(organizationId),
    payload: {}
  });
  expect(fiscal.statusCode).toBe(200);
}
async function accounts(organizationId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId)
  });
  return response.json<{
    accounts: Array<{ id: string; code: string; systemPurpose?: string; isControl: boolean }>;
  }>().accounts;
}
async function inviteReadOnly(organizationId: string) {
  const invitation = await app.inject({
    method: "POST",
    url: "/v1/organizations/current/invitations",
    headers: headers(organizationId),
    payload: { email: "reader@example.test", role: "READ_ONLY" }
  });
  const token = invitation.json<{ token: string }>().token;
  await app.inject({
    method: "POST",
    url: "/v1/invitations/accept",
    headers: headers(undefined, "reader@example.test"),
    payload: { token }
  });
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

describe("Phase 3 company setup", () => {
  it("creates resumable tenant-owned setup records and denies cross-tenant access", async () => {
    const first = await createOrganization();
    const second = await createOrganization("other-owner@example.test");
    expect((await state(first)).steps).toHaveLength(8);
    const denied = await app.inject({ method: "GET", url: "/v1/setup", headers: headers(second) });
    expect(denied.statusCode).toBe(404);
    const hidden = await withTenantTransaction(
      prisma,
      {
        organizationId: first,
        actorUserId: (await prisma.user.findUniqueOrThrow({ where: { email: owner } })).id
      },
      (tx) => tx.organizationSettings.count({ where: { organizationId: second } })
    );
    expect(hidden).toBe(0);
  });

  it("enforces optimistic versions and does not expose business numbers in audit metadata", async () => {
    const organizationId = await createOrganization();
    const current = await state(organizationId);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/setup/profile",
          headers: headers(organizationId),
          payload: profilePayload(current.settings.version)
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/setup/profile",
          headers: headers(organizationId),
          payload: profilePayload(current.settings.version)
        })
      ).statusCode
    ).toBe(409);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId, action: "ORGANIZATION_SETTINGS_UPDATED" }
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("123456789RC0001");
  });

  it("applies all six versioned presets idempotently without duplicate purposes", async () => {
    for (const key of [
      "general-service",
      "contractor-trades",
      "ranch-agriculture",
      "repair-business",
      "tourism-experiences",
      "small-product-seller"
    ]) {
      const organizationId = await createOrganization(`${key}@example.test`);
      const first = await app.inject({
        method: "POST",
        url: `/v1/setup/presets/${key}/apply`,
        headers: headers(organizationId, `${key}@example.test`, `${key}-key`),
        payload: {}
      });
      const replay = await app.inject({
        method: "POST",
        url: `/v1/setup/presets/${key}/apply`,
        headers: headers(organizationId, `${key}@example.test`, `${key}-key`),
        payload: {}
      });
      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(201);
      const rows = await prisma.account.findMany({ where: { organizationId } });
      expect(new Set(rows.map((row) => row.systemPurpose)).size).toBe(rows.length);
      expect(await prisma.appliedAccountPreset.count({ where: { organizationId } })).toBe(1);
    }
  });

  it("preserves user-created accounts when a preset code conflicts", async () => {
    const organizationId = await createOrganization();
    await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: headers(organizationId),
      payload: { code: "1000", name: "My bank", type: "ASSET" }
    });
    const result = await app.inject({
      method: "POST",
      url: "/v1/setup/presets/general-service/apply",
      headers: headers(organizationId, owner, randomUUID()),
      payload: {}
    });
    expect(result.statusCode).toBe(409);
    expect(
      (await prisma.account.findFirstOrThrow({ where: { organizationId, code: "1000" } })).name
    ).toBe("My bank");
  });

  it("reuses a compatible user-created specialty account without renaming it", async () => {
    const organizationId = await createOrganization();
    await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: headers(organizationId),
      payload: { code: "4100", name: "Consulting income", type: "REVENUE" }
    });

    const result = await app.inject({
      method: "POST",
      url: "/v1/setup/presets/general-service/apply",
      headers: headers(organizationId, owner, randomUUID()),
      payload: {}
    });

    expect(result.statusCode).toBe(201);
    expect(result.json<{ reusedCount: number }>().reusedCount).toBe(1);
    const account = await prisma.account.findFirstOrThrow({
      where: { organizationId, code: "4100" }
    });
    expect(account).toMatchObject({
      name: "Consulting income",
      systemPurpose: "professional-services",
      presetKey: "general-service",
      presetVersion: PRESET_VERSION
    });
  });

  it("blocks an incompatible user-created specialty account", async () => {
    const organizationId = await createOrganization();
    await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: headers(organizationId),
      payload: { code: "4100", name: "Misclassified account", type: "ASSET" }
    });

    const result = await app.inject({
      method: "POST",
      url: "/v1/setup/presets/general-service/apply",
      headers: headers(organizationId, owner, randomUUID()),
      payload: {}
    });

    expect(result.statusCode).toBe(409);
    expect(
      (await prisma.account.findFirstOrThrow({ where: { organizationId, code: "4100" } }))
        .systemPurpose
    ).toBeNull();
  });

  it("initializes exactly one non-overlapping first fiscal year", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const again = await app.inject({
      method: "POST",
      url: "/v1/setup/fiscal-year/initialize",
      headers: headers(organizationId),
      payload: {}
    });
    expect(again.statusCode).toBe(200);
    expect(await prisma.fiscalPeriod.count({ where: { organizationId } })).toBe(1);
    await expect(
      prisma.fiscalPeriod.create({
        data: {
          organizationId,
          name: "Overlap",
          startDate: new Date("2026-06-01"),
          endDate: new Date("2027-05-31")
        }
      })
    ).rejects.toThrow();
  });

  it("creates immutable effective-dated tax versions and validates control accounts", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const payable = chart.find((item) => item.systemPurpose === "tax-payable")!;
    const recoverable = chart.find((item) => item.systemPurpose === "tax-recoverable")!;
    const payload = {
      code: "GST",
      name: "GST",
      treatment: "STANDARD",
      calculationMode: "EXCLUSIVE",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      sourceName: "Owner verified configuration",
      sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
      components: [
        {
          name: "GST",
          jurisdiction: "CA",
          rate: "0.050000",
          recoverablePercent: "1.000000",
          payableAccountId: payable.id,
          recoverableAccountId: recoverable.id
        }
      ]
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/setup/tax-codes/versions",
      headers: headers(organizationId),
      payload
    });
    expect(created.statusCode).toBe(201);
    const versionId = created.json<{ taxCodeVersion: { id: string } }>().taxCodeVersion.id;
    await expect(
      prisma.taxCodeVersion.update({ where: { id: versionId }, data: { sourceName: "Changed" } })
    ).rejects.toThrow(/immutable/i);
    const overlap = await app.inject({
      method: "POST",
      url: "/v1/setup/tax-codes/versions",
      headers: headers(organizationId),
      payload: {
        ...payload,
        expectedTaxCodeVersion: 1,
        effectiveFrom: "2026-06-01",
        effectiveTo: "2027-01-01"
      }
    });
    expect(overlap.statusCode).toBe(409);
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/setup/tax-codes/versions",
      headers: headers(organizationId),
      payload: {
        ...payload,
        code: "BAD",
        components: [{ ...payload.components[0], payableAccountId: recoverable.id }]
      }
    });
    expect(invalid.statusCode).toBe(422);
  });

  it("posts balanced opening balances once through the Phase 1 ledger under concurrency", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const cash = chart.find((item) => item.systemPurpose === "cash")!;
    const equity = chart.find((item) => item.systemPurpose === "opening-equity")!;
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/setup/opening-balances",
      headers: headers(organizationId),
      payload: {
        effectiveDate: "2026-01-01",
        lines: [
          { accountId: cash.id, debitMinor: "9223372036854775807", creditMinor: "0" },
          { accountId: equity.id, debitMinor: "0", creditMinor: "9223372036854775807" }
        ]
      }
    });
    expect(saved.statusCode).toBe(200);
    const draftId = saved.json<{ openingBalance: { id: string } }>().openingBalance.id;
    const key = randomUUID();
    const results = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/setup/opening-balances/${draftId}/post`,
          headers: headers(organizationId, owner, key),
          payload: {}
        })
      )
    );
    expect(results.map((item) => item.statusCode)).toEqual([201, 201]);
    expect(
      await prisma.journal.count({ where: { organizationId, sourceType: "opening_balance" } })
    ).toBe(1);
    expect(
      (await prisma.openingBalanceDraft.findUniqueOrThrow({ where: { id: draftId } })).status
    ).toBe("POSTED");
  });

  it("rejects unbalanced, zero-sided, duplicate-account, and closed-period opening balances", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const cash = chart[0]!;
    const equity = chart[1]!;
    for (const [lines, expectedStatus] of [
      [
        [
          { accountId: cash.id, debitMinor: "10", creditMinor: "0" },
          { accountId: equity.id, debitMinor: "0", creditMinor: "9" }
        ],
        422
      ],
      [
        [
          { accountId: cash.id, debitMinor: "0", creditMinor: "0" },
          { accountId: equity.id, debitMinor: "0", creditMinor: "0" }
        ],
        400
      ],
      [
        [
          { accountId: cash.id, debitMinor: "10", creditMinor: "0" },
          { accountId: cash.id, debitMinor: "0", creditMinor: "10" }
        ],
        422
      ]
    ] as const) {
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/v1/setup/opening-balances",
            headers: headers(organizationId),
            payload: { effectiveDate: "2026-01-01", lines }
          })
        ).statusCode
      ).toBe(expectedStatus);
    }
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/setup/opening-balances",
      headers: headers(organizationId),
      payload: {
        effectiveDate: "2026-01-01",
        lines: [
          { accountId: cash.id, debitMinor: "10", creditMinor: "0" },
          { accountId: equity.id, debitMinor: "0", creditMinor: "10" }
        ]
      }
    });
    const draftId = saved.json<{ openingBalance: { id: string } }>().openingBalance.id;
    const storedLine = await prisma.openingBalanceLine.findFirstOrThrow({
      where: { openingBalanceDraftId: draftId }
    });
    await expect(
      prisma.openingBalanceLine.update({
        where: { id: storedLine.id },
        data: { debitMinor: 1n, creditMinor: 1n }
      })
    ).rejects.toThrow();
    const period = await prisma.fiscalPeriod.findFirstOrThrow({ where: { organizationId } });
    await app.inject({
      method: "POST",
      url: `/v1/fiscal-periods/${period.id}/close`,
      headers: headers(organizationId),
      payload: { reason: "Close test" }
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/setup/opening-balances/${draftId}/post`,
          headers: headers(organizationId, owner, randomUUID()),
          payload: {}
        })
      ).statusCode
    ).toBe(409);
  });

  it("requires a journal reversal before opening-balance correction", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const cash = chart.find((item) => item.systemPurpose === "cash")!;
    const equity = chart.find((item) => item.systemPurpose === "opening-equity")!;
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/setup/opening-balances",
      headers: headers(organizationId),
      payload: {
        effectiveDate: "2026-01-01",
        lines: [
          { accountId: cash.id, debitMinor: "10", creditMinor: "0" },
          { accountId: equity.id, debitMinor: "0", creditMinor: "10" }
        ]
      }
    });
    const draftId = saved.json<{ openingBalance: { id: string } }>().openingBalance.id;
    const posted = await app.inject({
      method: "POST",
      url: `/v1/setup/opening-balances/${draftId}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: {}
    });
    const journalId = posted.json<{ openingBalance: { journalId: string } }>().openingBalance
      .journalId;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/setup/opening-balances/${draftId}/mark-reversed`,
          headers: headers(organizationId),
          payload: {}
        })
      ).statusCode
    ).toBe(409);
    await expect(
      prisma.organizationSettings.update({
        where: { organizationId },
        data: { baseCurrency: "EUR" }
      })
    ).rejects.toThrow(/currency is locked/i);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/journals/${journalId}/reverse`,
          headers: headers(organizationId, owner, randomUUID()),
          payload: { effectiveDate: "2026-01-01", reason: "Correct opening balance" }
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/setup/opening-balances/${draftId}/mark-reversed`,
          headers: headers(organizationId),
          payload: {}
        })
      ).statusCode
    ).toBe(200);
  });

  it("locks base currency after posting and denies setup writes to read-only members", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    await inviteReadOnly(organizationId);
    const chart = await accounts(organizationId);
    const cash = chart[0]!;
    const other = chart[1]!;
    await app.inject({
      method: "POST",
      url: "/v1/journals",
      headers: headers(organizationId, owner, randomUUID()),
      payload: {
        description: "Activity",
        effectiveDate: "2026-01-01",
        sourceType: "test",
        sourceId: "activity",
        postingKey: "activity",
        allowControlAccountPosting: true,
        reason: "Test",
        lines: [
          { accountId: cash.id, debitMinor: "1", creditMinor: "0" },
          { accountId: other.id, debitMinor: "0", creditMinor: "1" }
        ]
      }
    });
    const current = await state(organizationId);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/setup/profile",
          headers: headers(organizationId),
          payload: profilePayload(current.settings.version, { baseCurrency: "USD" })
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/setup/profile",
          headers: headers(organizationId, "reader@example.test"),
          payload: profilePayload(current.settings.version)
        })
      ).statusCode
    ).toBe(403);
  });

  it("accepts real image bytes and rejects spoofed, oversized, and cross-tenant logo access", async () => {
    const organizationId = await createOrganization();
    const other = await createOrganization("logo-other@example.test");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const uploaded = await app.inject({
      method: "POST",
      url: "/v1/setup/logo",
      headers: { ...headers(organizationId), "content-type": "image/png" },
      payload: png
    });
    expect(uploaded.statusCode).toBe(201);
    const id = uploaded.json<{ logo: { id: string } }>().logo.id;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/setup/logo/${id}/content`,
          headers: headers(organizationId)
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/setup/logo/${id}/content`,
          headers: headers(other, "logo-other@example.test")
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/setup/logo",
          headers: { ...headers(organizationId), "content-type": "image/png" },
          payload: Buffer.from("<svg><script>alert(1)</script></svg>")
        })
      ).statusCode
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/setup/logo",
          headers: { ...headers(organizationId), "content-type": "application/octet-stream" },
          payload: Buffer.alloc(2_097_153)
        })
      ).statusCode
    ).toBe(413);
  });

  it("enforces mandatory setup steps and completes a valid resumable setup", async () => {
    const organizationId = await createOrganization();
    const initial = await state(organizationId);
    expect(initial.steps.map((item) => item.step)).toEqual(setupSteps);
    const fiscalStep = initial.steps.find((item) => item.step === "FISCAL_CURRENCY")!;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/setup/steps/FISCAL_CURRENCY",
          headers: headers(organizationId),
          payload: { version: fiscalStep.version, status: "COMPLETED" }
        })
      ).statusCode
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/setup/steps/BUSINESS_PROFILE",
          headers: headers(organizationId),
          payload: { version: initial.steps[0]!.version, status: "SKIPPED" }
        })
      ).statusCode
    ).toBe(422);
    await configure(organizationId);
    let current = await state(organizationId);
    expect(current.steps.map((item) => item.step)).toEqual(setupSteps);
    for (const item of current.steps.filter((item) => item.step !== "FINAL_REVIEW")) {
      const optional = ["TAX_REGISTRATION", "OPENING_BALANCES", "BRANDING_DEFAULTS"].includes(
        item.step
      );
      const response = await app.inject({
        method: "PATCH",
        url: `/v1/setup/steps/${item.step}`,
        headers: headers(organizationId),
        payload: { version: item.version, status: optional ? "SKIPPED" : "COMPLETED" }
      });
      expect(response.statusCode).toBe(200);
    }
    current = await state(organizationId);
    const completed = await app.inject({
      method: "POST",
      url: "/v1/setup/complete",
      headers: headers(organizationId),
      payload: { version: current.settings.version }
    });
    expect(completed.statusCode).toBe(200);
    expect(
      completed.json<{ settings: { setupCompletedAt: string } }>().settings.setupCompletedAt
    ).toBeTruthy();
  });
});
