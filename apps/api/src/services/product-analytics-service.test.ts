import { describe, expect, it } from "vitest";
import { AppError } from "@clearledger/shared";
import { normalizeProductEvent } from "./product-analytics-service.js";

describe("privacy-safe product events", () => {
  it("accepts only the allowlisted event vocabulary and normalizes dates", () => {
    const recentEvent = new Date(Date.now() - 60 * 1000).toISOString();
    const result = normalizeProductEvent({
      clientEventId: "00000000-0000-4000-8000-000000000001",
      eventType: "ACTIVATION_CHECKLIST_VIEWED",
      eventVersion: 1,
      occurredAt: recentEvent
    });
    expect(result.eventType).toBe("ACTIVATION_CHECKLIST_VIEWED");
    expect(result.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects unsupported event types and dates outside the retention window", () => {
    expect(() =>
      normalizeProductEvent({
        clientEventId: "00000000-0000-4000-8000-000000000002",
        eventType: "CUSTOMER_EMAIL",
        eventVersion: 1
      })
    ).toThrow(AppError);
    expect(() =>
      normalizeProductEvent({
        clientEventId: "00000000-0000-4000-8000-000000000003",
        eventType: "ACTIVATION_CHECKLIST_VIEWED",
        eventVersion: 1,
        occurredAt: "2020-01-01T00:00:00.000Z"
      })
    ).toThrow("out of range");
  });

  it("includes every sanitized event emitted by the web workflow", () => {
    for (const eventType of [
      "GUIDED_TOUR_TASK_OPENED",
      "GUIDED_TOUR_COMPLETED",
      "ESTIMATE_DRAFT_CREATED",
      "ESTIMATE_PREVIEW_VIEWED"
    ]) {
      expect(() =>
        normalizeProductEvent({
          clientEventId: "00000000-0000-4000-8000-000000000004",
          eventType,
          eventVersion: 1
        })
      ).not.toThrow();
    }
  });
});
