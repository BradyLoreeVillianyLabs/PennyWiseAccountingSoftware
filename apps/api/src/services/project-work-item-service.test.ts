import { describe, expect, it } from "vitest";
import {
  validateProjectWorkItemDates,
  wouldCreateDependencyCycle
} from "./project-work-item-service.js";

describe("ProjectWorkItemService domain rules", () => {
  it("accepts organization-local task and reminder dates", () => {
    expect(validateProjectWorkItemDates("TASK", "2026-08-03", "2026-08-04")).toEqual({
      startDate: new Date("2026-08-03T00:00:00.000Z"),
      dueDate: new Date("2026-08-04T00:00:00.000Z")
    });
    expect(validateProjectWorkItemDates("REMINDER", null, "2026-08-04")).toEqual({
      startDate: null,
      dueDate: new Date("2026-08-04T00:00:00.000Z")
    });
  });

  it("requires milestone due dates and rejects invalid ranges", () => {
    expect(() => validateProjectWorkItemDates("MILESTONE", null, null)).toThrow(
      "A milestone requires dueDate"
    );
    expect(() => validateProjectWorkItemDates("MILESTONE", "2026-08-03", "2026-08-04")).toThrow(
      "startDate must be omitted or equal dueDate"
    );
    expect(() => validateProjectWorkItemDates("TASK", "2026-08-05", "2026-08-04")).toThrow(
      "dueDate cannot precede startDate"
    );
  });

  it("detects direct and transitive dependency cycles", () => {
    const edges = [
      { workItemId: "a", dependsOnItemId: "b" },
      { workItemId: "b", dependsOnItemId: "c" }
    ];
    expect(wouldCreateDependencyCycle("c", "a", edges)).toBe(true);
    expect(wouldCreateDependencyCycle("d", "a", edges)).toBe(false);
    expect(wouldCreateDependencyCycle("a", "a", edges)).toBe(true);
  });
});
