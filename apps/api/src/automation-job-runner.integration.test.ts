import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

describe("automation job runner", () => {
  beforeAll(async () => prisma.$connect());
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => prisma.$disconnect());

  it("discovers a tenant, records startup work, exposes controls, and releases its lease", async () => {
    const user = await prisma.user.create({
      data: {
        email: "automation-owner@example.test",
        displayName: "Automation owner",
        emailVerifiedAt: new Date()
      }
    });
    const organization = await prisma.organization.create({
      data: {
        legalName: "Automation test legal",
        displayName: "Automation test",
        memberships: { create: { userId: user.id, role: "OWNER" } }
      }
    });
    const app = buildApp({ prisma });
    const runner = (
      app as typeof app & { automationRunner: { start(): Promise<void>; stop(): Promise<void> } }
    ).automationRunner;
    try {
      await app.ready();
      await runner.start();
      const status = await app.inject({
        method: "GET",
        url: "/v1/organizations/current/automations",
        headers: {
          "x-clearledger-user-email": user.email,
          "x-clearledger-organization-id": organization.id
        }
      });
      expect(status.statusCode).toBe(200);
      const statusBody = status.json<{
        jobs: Array<{ name: string }>;
        status: { recoveryComplete: boolean };
      }>();
      expect(statusBody.status.recoveryComplete).toBe(true);
      expect(statusBody.jobs.map((job) => job.name)).toEqual(
        expect.arrayContaining(["payment-webhook-retry", "recurring-invoice-generation"])
      );

      const runNow = await app.inject({
        method: "POST",
        url: "/v1/organizations/current/automations/payment-webhook-retry/run",
        headers: {
          "x-clearledger-user-email": user.email,
          "x-clearledger-organization-id": organization.id
        },
        payload: {}
      });
      expect(runNow.statusCode).toBe(202);
      expect(runNow.json<{ automation: { status: string } }>().automation.status).toBe("started");

      const paused = await app.inject({
        method: "PATCH",
        url: "/v1/organizations/current/automations/payment-webhook-retry",
        headers: {
          "x-clearledger-user-email": user.email,
          "x-clearledger-organization-id": organization.id
        },
        payload: { paused: true }
      });
      expect(paused.statusCode).toBe(200);
      expect(
        paused
          .json<{ automations: { jobs: Array<{ name: string; paused: boolean }> } }>()
          .automations.jobs.find((job) => job.name === "payment-webhook-retry")?.paused
      ).toBe(true);
    } finally {
      await runner.stop();
      await app.close();
    }
    expect(
      await prisma.automationJobRun.count({ where: { organizationId: organization.id } })
    ).toBeGreaterThan(0);
    expect(
      await prisma.automationJobLease.count({
        where: { organizationId: organization.id, leaseToken: { not: null } }
      })
    ).toBe(0);
  });

  it("allows only one of two API processes to claim a job interval", async () => {
    const user = await prisma.user.create({
      data: {
        email: "automation-race@example.test",
        displayName: "Race owner",
        emailVerifiedAt: new Date()
      }
    });
    await prisma.organization.create({
      data: {
        legalName: "Automation race legal",
        displayName: "Automation race",
        memberships: { create: { userId: user.id, role: "OWNER" } }
      }
    });
    const first = buildApp({ prisma });
    const second = buildApp({ prisma });
    const firstRunner = (
      first as typeof first & {
        automationRunner: { start(): Promise<void>; stop(): Promise<void> };
      }
    ).automationRunner;
    const secondRunner = (
      second as typeof second & {
        automationRunner: { start(): Promise<void>; stop(): Promise<void> };
      }
    ).automationRunner;
    try {
      await Promise.all([first.ready(), second.ready(), firstRunner.start(), secondRunner.start()]);
      expect(
        await prisma.automationJobRun.count({ where: { jobName: "payment-webhook-retry" } })
      ).toBe(1);
    } finally {
      await Promise.all([firstRunner.stop(), secondRunner.stop(), first.close(), second.close()]);
    }
  });
});
