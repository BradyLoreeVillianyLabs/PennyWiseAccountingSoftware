import { describe, expect, it } from "vitest";
import { assertPermission, hasPermission, roleRequiresMfa } from "./permissions.js";

describe("central permissions", () => {
  it("allows bookkeepers to post ordinary manual journals", () => {
    expect(hasPermission("BOOKKEEPER", "journals:post")).toBe(true);
  });

  it("default-denies sales users from posting journals", () => {
    expect(hasPermission("SALES", "journals:post")).toBe(false);
    expect(() => assertPermission("SALES", "journals:post")).toThrow(
      "You do not have permission to perform this action."
    );
  });

  it("limits direct control-account overrides to owner, admin, or accountant roles", () => {
    expect(hasPermission("ACCOUNTANT", "control-accounts:post")).toBe(true);
    expect(hasPermission("BOOKKEEPER", "control-accounts:post")).toBe(false);
  });

  it("limits membership administration to owners and administrators", () => {
    expect(hasPermission("OWNER", "members:roles")).toBe(true);
    expect(hasPermission("ADMIN", "members:invite")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "members:read")).toBe(false);
  });

  it("grants purchasing workflows by permission while keeping read-only and sales roles non-mutating", () => {
    expect(hasPermission("PURCHASES", "bills:post")).toBe(true);
    expect(hasPermission("PURCHASES", "bills:pay")).toBe(true);
    expect(hasPermission("READ_ONLY", "bills:read")).toBe(true);
    expect(hasPermission("READ_ONLY", "bills:post")).toBe(false);
    expect(hasPermission("SALES", "vendors:read")).toBe(false);
    expect(hasPermission("SALES", "expenses:record")).toBe(false);
  });

  it("keeps invoice and customer correction mutations unavailable to viewers", () => {
    expect(hasPermission("READ_ONLY", "invoices:post")).toBe(false);
    expect(hasPermission("READ_ONLY", "invoices:correct")).toBe(false);
    expect(hasPermission("READ_ONLY", "credit-notes:create")).toBe(false);
    expect(hasPermission("READ_ONLY", "customers:manage")).toBe(false);
  });

  it("separates banking operations, sensitive reopening, and read-only reporting", () => {
    expect(hasPermission("BOOKKEEPER", "bank-imports:create")).toBe(true);
    expect(hasPermission("BOOKKEEPER", "bank-transactions:match")).toBe(true);
    expect(hasPermission("BOOKKEEPER", "bank-reconciliations:manage")).toBe(true);
    expect(hasPermission("BOOKKEEPER", "bank-reconciliations:reopen")).toBe(false);
    expect(hasPermission("READ_ONLY", "bank-reports:read")).toBe(true);
    expect(hasPermission("READ_ONLY", "bank-transactions:categorize")).toBe(false);
    expect(hasPermission("SALES", "bank-reports:read")).toBe(false);
  });

  it("default-denies permissions absent from the registry", () => {
    const evaluate = hasPermission as (role: "OWNER", permission: string) => boolean;
    expect(evaluate("OWNER", "unknown:permission")).toBe(false);
  });

  it("separates payroll preparation, approval, posting, and payment authority", () => {
    expect(hasPermission("BOOKKEEPER", "payroll:read")).toBe(true);
    expect(hasPermission("BOOKKEEPER", "payroll:manage")).toBe(true);
    expect(hasPermission("BOOKKEEPER", "payroll:approve")).toBe(false);
    expect(hasPermission("ACCOUNTANT", "payroll:post")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "payroll:payments")).toBe(false);
    expect(hasPermission("ADMIN", "payroll:payments")).toBe(true);
    expect(hasPermission("READ_ONLY", "payroll:read")).toBe(false);
  });

  it("requires MFA for finance-capable production roles", () => {
    expect(roleRequiresMfa("OWNER")).toBe(true);
    expect(roleRequiresMfa("ADMIN")).toBe(true);
    expect(roleRequiresMfa("ACCOUNTANT")).toBe(true);
    expect(roleRequiresMfa("BOOKKEEPER")).toBe(true);
    expect(roleRequiresMfa("READ_ONLY")).toBe(false);
  });
});
