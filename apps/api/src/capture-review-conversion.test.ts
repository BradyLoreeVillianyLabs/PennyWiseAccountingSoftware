import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureReviewConversionSchema } from "./http/schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(resolve(here, "services/purchase-service.ts"), "utf8");
const projectServiceSource = readFileSync(resolve(here, "services/project-service.ts"), "utf8");
const appSource = readFileSync(resolve(here, "app.ts"), "utf8");
const openApiSource = readFileSync(resolve(here, "openapi.ts"), "utf8");
const migrationSource = readFileSync(
  resolve(
    here,
    "../../../packages/db/prisma/migrations/20260804050000_capture_review_draft_conversion/migration.sql"
  ),
  "utf8"
);
const rollbackSource = readFileSync(
  resolve(
    here,
    "../../../packages/db/prisma/migrations/20260804050000_capture_review_draft_conversion/down.sql"
  ),
  "utf8"
);

const vendorId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const line = {
  description: "Reviewed office supplies",
  quantity: "2.5",
  unitCostMinor: "1200",
  discountMinor: "100",
  accountId
};

describe("capture review purchase-draft conversion contract", () => {
  it("strictly validates the versioned bill and immediate-expense variants", () => {
    expect(
      captureReviewConversionSchema.parse({
        target: "BILL",
        version: 3,
        bill: {
          vendorId,
          vendorInvoiceNumber: "EVIDENCE-100",
          issueDate: "2026-08-03",
          lines: [line]
        }
      })
    ).toMatchObject({ target: "BILL", version: 3, bill: { currency: "CAD" } });
    expect(
      captureReviewConversionSchema.parse({
        target: "IMMEDIATE_EXPENSE",
        version: 7,
        expense: {
          expenseDate: "2026-08-03",
          method: "CREDIT_CARD",
          payingAccountId: accountId,
          lines: [line]
        }
      })
    ).toMatchObject({ target: "IMMEDIATE_EXPENSE", version: 7 });

    expect(() =>
      captureReviewConversionSchema.parse({
        target: "BILL",
        version: 3,
        expense: {
          expenseDate: "2026-08-03",
          method: "CASH",
          payingAccountId: accountId,
          lines: [line]
        }
      })
    ).toThrow();
    expect(() =>
      captureReviewConversionSchema.parse({
        target: "BILL",
        version: 3,
        bill: {
          vendorId,
          vendorInvoiceNumber: "EVIDENCE-100",
          issueDate: "2026-08-03",
          lines: [{ ...line, unexpected: true }]
        }
      })
    ).toThrow();
  });

  it("enforces one tenant-owned immutable target at the database boundary", () => {
    expect(migrationSource).toContain('CREATE TABLE "CaptureReviewConversion"');
    expect(migrationSource).toContain(
      'CREATE UNIQUE INDEX "CaptureReviewConversion_organizationId_captureReviewId_key"'
    );
    expect(migrationSource).toContain('CONSTRAINT "CaptureReviewConversion_target_check"');
    expect(migrationSource).toContain('FOREIGN KEY ("organizationId", "captureReviewId")');
    expect(migrationSource).toContain('FOREIGN KEY ("organizationId", "immediateExpenseDraftId")');
    expect(migrationSource).toContain('FOREIGN KEY ("organizationId", "taxCodeVersionId")');
    expect(migrationSource).toContain('ALTER TABLE "CaptureReview" FORCE ROW LEVEL SECURITY');
    expect(migrationSource).toContain("app_actor_has_tenant_access()");
    expect(migrationSource).toContain('CREATE TRIGGER "CaptureReviewConversion_append_only"');
    expect(rollbackSource).toContain('DROP TABLE IF EXISTS "CaptureReviewConversion"');
    expect(rollbackSource).toContain('DROP TABLE IF EXISTS "ImmediateExpenseDraft"');
    expect(rollbackSource).toContain('DROP TYPE IF EXISTS "CaptureConversionTarget"');
  });

  it("locks and versions approved clean evidence while sharing purchase/tax calculation", () => {
    const conversionSource = serviceSource.slice(
      serviceSource.indexOf("public async convertApprovedCaptureReview"),
      serviceSource.indexOf("private async createBillDraftInTransaction")
    );
    expect(conversionSource).toContain("runIdempotent(");
    expect(conversionSource).toContain("FOR UPDATE");
    expect(conversionSource).toContain('capture.status !== "APPROVED"');
    expect(conversionSource).toContain('capture.scanStatus !== "CLEAN"');
    expect(conversionSource).toContain("capture.version !== input.version");
    expect(conversionSource).toContain("CAPTURE_ALREADY_CONVERTED");
    expect(conversionSource).toContain("CAPTURE_TARGET_MISMATCH");
    expect(serviceSource.match(/const lines = await calculateLines/g)).toHaveLength(4);
    expect(conversionSource).toContain("accountingEntriesCreated: 0");
    expect(conversionSource).not.toContain("this.journals.post");
    expect(conversionSource).not.toContain("recordImmediateExpense(");
  });

  it("registers and documents the strict non-posting API boundary", () => {
    expect(appSource).toContain("/v1/capture-reviews/:captureReviewId/convert");
    expect(appSource).toContain('requestHeader(request, "idempotency-key")');
    expect(appSource).toContain("captureReviewConversionSchema.parse(request.body)");
    expect(appSource).toContain("/v1/immediate-expense-drafts/:immediateExpenseDraftId");
    expect(openApiSource).toContain('"/v1/capture-reviews/{captureReviewId}/convert"');
    expect(openApiSource).toContain("exactly one purchase draft");
    expect(openApiSource).toContain("never posts accounting entries");
    expect(openApiSource).toContain("additionalProperties: false");
    expect(openApiSource).toContain("review-state, type, and draft-link filters");
  });

  it("keeps evidence inbox filters strict and tenant-scoped", () => {
    expect(appSource).toContain('"/v1/capture-reviews"');
    expect(appSource).toContain('z.enum(["RECEIVED", "REVIEW_REQUIRED", "APPROVED", "REJECTED"])');
    expect(appSource).toContain('z.enum(["RECEIPT", "BILL"])');
    expect(appSource).toContain('z.enum(["LINKED", "UNLINKED"])');
    expect(projectServiceSource).toContain("organizationId: context.organizationId");
    expect(projectServiceSource).toContain('filters.conversion === "LINKED"');
    expect(projectServiceSource).toContain("include: { conversion: true }");
  });
});
