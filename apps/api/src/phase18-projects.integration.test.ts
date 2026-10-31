import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase18-owner@example.test";

function headers(organizationId?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "Phase 18 Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function setup() {
  const organization = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "Phase 18 Ltd", displayName: "Phase 18" }
  });
  const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
  const state = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  await app.inject({
    method: "PATCH",
    url: "/v1/setup/profile",
    headers: headers(organizationId),
    payload: {
      version,
      legalName: "Phase 18 Ltd",
      displayName: "Phase 18",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      baseCurrency: "CAD",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      accountingStartDate: "2026-01-01"
    }
  });
  await app.inject({
    method: "POST",
    url: "/v1/setup/presets/general-service/apply",
    headers: { ...headers(organizationId), "idempotency-key": randomUUID() },
    payload: {}
  });
  await app.inject({
    method: "POST",
    url: "/v1/setup/fiscal-year/initialize",
    headers: headers(organizationId),
    payload: {}
  });
  const customer = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: headers(organizationId),
    payload: {
      customerNumber: "C-018",
      displayName: "Project Customer",
      defaultPaymentTermsDays: 30,
      defaultCurrency: "CAD"
    }
  });
  return { organizationId, customerId: customer.json<{ customer: { id: string } }>().customer.id };
}

describe("Phase 18 projects and field productivity", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("keeps time, mileage, and capture review workflows off-ledger until approved", async () => {
    const { organizationId, customerId } = await setup();
    const project = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: headers(organizationId),
      payload: { customerId, projectNumber: "P-018", name: "Field job", tags: [] }
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json<{ project: { id: string; version: number } }>().project.id;
    const time = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/time-entries`,
      headers: headers(organizationId),
      payload: {
        entryDate: "2026-07-25",
        durationMicros: "1000000",
        rateMinor: "12000",
        description: "Site visit"
      }
    });
    expect(time.statusCode).toBe(201);
    const entry = time.json<{ timeEntry: { id: string; version: number; amountMinor: string } }>()
      .timeEntry;
    expect(entry.amountMinor).toBe("12000");
    const approved = await app.inject({
      method: "POST",
      url: `/v1/time-entries/${entry.id}/approve`,
      headers: headers(organizationId),
      payload: { version: entry.version }
    });
    expect(approved.statusCode).toBe(200);
    const mileage = await app.inject({
      method: "POST",
      url: "/v1/mileage",
      headers: headers(organizationId),
      payload: {
        projectId,
        entryDate: "2026-07-25",
        purpose: "Travel",
        distanceMicros: "1000000",
        reimbursementRateMinor: "70"
      }
    });
    expect(mileage.statusCode).toBe(201);
    const capture = await app.inject({
      method: "POST",
      url: "/v1/capture-reviews",
      headers: headers(organizationId),
      payload: {
        projectId,
        kind: "RECEIPT",
        storageKey: "capture/1.jpg",
        checksum: "a".repeat(64),
        mediaType: "image/jpeg",
        byteSize: 100,
        scanStatus: "CLEAN",
        ocrProvider: "fixture",
        ocrVersion: "1",
        ocrConfidence: 0.82,
        extractedData: { total: "12.00" }
      }
    });
    expect(capture.statusCode).toBe(201);
    const uploaded = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/upload?projectId=${projectId}&kind=RECEIPT`,
      headers: {
        ...headers(organizationId),
        "content-type": "text/plain",
        "x-file-name": "receipt.txt"
      },
      payload: Buffer.from("receipt total 12.00")
    });
    expect(uploaded.statusCode).toBe(201);
    const uploadedBody = uploaded.json<{
      capture: {
        id: string;
        version: number;
        processingState: string;
        reviewReasons: string[];
        extractedData: { localExtraction?: { engine?: { networkAccess?: string } } };
      };
    }>();
    const uploadedId = uploadedBody.capture.id;
    expect(uploadedBody.capture.processingState).toBe("NEEDS_REVIEW");
    expect(uploadedBody.capture.reviewReasons).toContain("FIELD_REQUIRED_CURRENCY");
    expect(uploadedBody.capture.extractedData.localExtraction?.engine?.networkAccess).toBe("NONE");
    const processed = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${uploadedId}/process`,
      headers: headers(organizationId),
      payload: { version: uploadedBody.capture.version }
    });
    expect(processed.statusCode).toBe(200);
    expect(processed.json<{ capture: { version: number } }>().capture.version).toBe(2);
    const processedRetry = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/${uploadedId}/process`,
      headers: headers(organizationId),
      payload: { version: uploadedBody.capture.version }
    });
    expect(processedRetry.statusCode).toBe(200);
    expect(processedRetry.json<{ capture: { version: number } }>().capture.version).toBe(2);
    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/capture-reviews/upload?projectId=${projectId}&kind=RECEIPT`,
      headers: {
        ...headers(organizationId),
        "content-type": "text/plain",
        "x-file-name": "receipt-copy.txt"
      },
      payload: Buffer.from("receipt total 12.00")
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe("CAPTURE_DUPLICATE");
    const content = await app.inject({
      method: "GET",
      url: `/v1/capture-reviews/${uploadedId}/content`,
      headers: headers(organizationId)
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toContain("text/plain");
    expect(content.body).toContain("receipt total 12.00");
    const captures = await app.inject({
      method: "GET",
      url: `/v1/capture-reviews?projectId=${projectId}`,
      headers: headers(organizationId)
    });
    expect(captures.statusCode).toBe(200);
    expect(captures.json<{ captures: Array<{ version: number }> }>().captures).toHaveLength(2);
    const unlinkedReceipts = await app.inject({
      method: "GET",
      url: "/v1/capture-reviews?kind=RECEIPT&conversion=UNLINKED",
      headers: headers(organizationId)
    });
    expect(unlinkedReceipts.statusCode).toBe(200);
    expect(
      unlinkedReceipts.json<{ captures: Array<{ kind: string; conversion: unknown }> }>().captures
    ).toHaveLength(2);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });

  it("supports tenant-scoped contacts, append-only activity, and linked calendar events", async () => {
    const { organizationId, customerId } = await setup();
    const contact = await app.inject({
      method: "POST",
      url: `/v1/customers/${customerId}/contacts`,
      headers: headers(organizationId),
      payload: {
        name: "Jordan Reviewer",
        role: "Operations",
        email: "jordan@example.test",
        preferredChannel: "Email"
      }
    });
    expect(contact.statusCode).toBe(201);
    const contactBody = contact.json<{ contact: { id: string; version: number } }>().contact;

    const project = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: headers(organizationId),
      payload: { customerId, projectNumber: "P-CRM", name: "Relationship project", tags: [] }
    });
    const projectId = project.json<{ project: { id: string } }>().project.id;
    const activity = await app.inject({
      method: "POST",
      url: `/v1/customers/${customerId}/activities`,
      headers: headers(organizationId),
      payload: {
        activityType: "MEETING",
        category: "Onboarding",
        subject: "Discovery call",
        body: "Reviewed the initial scope and next steps.",
        happenedAt: "2026-08-06T16:00:00.000Z",
        contactId: contactBody.id,
        relatedResourceType: "PROJECT",
        relatedResourceId: projectId
      }
    });
    expect(activity.statusCode).toBe(201);

    const workItem = await app.inject({
      method: "POST",
      url: "/v1/project-work-items",
      headers: headers(organizationId),
      payload: {
        kind: "MEETING",
        title: "Quarterly review",
        customerId,
        contactId: contactBody.id,
        projectId,
        eventType: "Client review",
        category: "Onboarding",
        label: "Priority",
        location: "Video call",
        description: "Review the onboarding plan and confirm the next client decision.",
        startAt: "2026-08-07T16:00:00.000Z",
        endAt: "2026-08-07T17:00:00.000Z",
        relatedResourceType: "PROJECT",
        relatedResourceId: projectId
      }
    });
    expect(workItem.statusCode).toBe(201);
    const workItemBody = workItem.json<{ workItem: { id: string; version: number } }>().workItem;

    const timeline = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}/timeline`,
      headers: headers(organizationId)
    });
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json<{ timeline: Array<{ entryType: string }> }>().timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryType: "ACTIVITY" }),
        expect.objectContaining({ entryType: "CALENDAR" })
      ])
    );

    const calendar = await app.inject({
      method: "GET",
      url: "/v1/calendar/events?startDate=2026-08-01&endDate=2026-08-31",
      headers: headers(organizationId)
    });
    expect(calendar.statusCode).toBe(200);
    const calendarEvents = calendar.json<{
      calendar: {
        events: Array<{
          source: { id: string };
          eventType?: string;
          customerId?: string;
          customerName?: string | null;
          contactName?: string | null;
          projectName?: string | null;
          description?: string | null;
          startAt?: string | null;
          endAt?: string | null;
          canReschedule?: boolean;
          version?: number | null;
          financial?: boolean;
        }>;
      };
    }>().calendar.events;
    const scheduled = calendarEvents.filter((entry) => entry.source.id === workItemBody.id);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      eventType: "Client review",
      customerId,
      customerName: "Project Customer",
      contactName: "Jordan Reviewer",
      projectName: "P-CRM — Relationship project",
      description: "Review the onboarding plan and confirm the next client decision.",
      startAt: "2026-08-07T16:00:00.000Z",
      endAt: "2026-08-07T17:00:00.000Z",
      canReschedule: true,
      version: workItemBody.version,
      financial: false
    });

    const moved = await app.inject({
      method: "PATCH",
      url: `/v1/project-work-items/${workItemBody.id}`,
      headers: headers(organizationId),
      payload: {
        version: workItemBody.version,
        startAt: "2026-08-07T18:30:00.000Z",
        endAt: "2026-08-07T19:30:00.000Z"
      }
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json<{ workItem: { version: number } }>().workItem.version).toBe(
      workItemBody.version + 1
    );
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
  });
});
