import { describe, expect, it } from "vitest";
import { AppError, assertFound } from "./errors.js";

describe("AppError", () => {
  it("carries API error metadata", () => {
    const error = new AppError("EXAMPLE", "Example message", 409, { id: "value" });

    expect(error.code).toBe("EXAMPLE");
    expect(error.statusCode).toBe(409);
    expect(error.details).toEqual({ id: "value" });
  });

  it("throws not-found errors through assertFound", () => {
    expect(() => assertFound(null, "NOT_FOUND", "Missing")).toThrow("Missing");
    expect(assertFound("present", "NOT_FOUND", "Missing")).toBe("present");
  });
});
