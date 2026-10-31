import { describe, expect, it } from "vitest";
import {
  assertEstimateTransition,
  estimateConversionIdempotencyKey,
  nextRecurrenceDate,
  recurrenceRunIdempotencyKey
} from "./sales-automation.js";

describe("sales automation contracts", () => {
  it("enforces the non-posting estimate lifecycle", () => {
    expect(() => assertEstimateTransition("DRAFT", "ACCEPTED")).toThrow(
      "cannot move from DRAFT to ACCEPTED"
    );
    expect(() => assertEstimateTransition("SENT", "ACCEPTED")).not.toThrow();
    expect(() => assertEstimateTransition("ACCEPTED", "CONVERTED")).not.toThrow();
  });

  it("clamps monthly recurrence to the last day of the month", () => {
    const next = nextRecurrenceDate(new Date("2026-01-31T09:00:00.000Z"), {
      frequency: "MONTH",
      interval: 1,
      timeZone: "America/Edmonton"
    });
    expect(next.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("generates replay-safe identities", () => {
    expect(estimateConversionIdempotencyKey("estimate-1", 2)).toBe(
      "estimate-conversion:estimate-1:v2"
    );
    expect(recurrenceRunIdempotencyKey("schedule-1", new Date("2026-07-25T00:00:00.000Z"))).toBe(
      "recurring-run:schedule-1:2026-07-25T00:00:00.000Z"
    );
  });
});
