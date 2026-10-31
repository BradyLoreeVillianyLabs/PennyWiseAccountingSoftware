import { describe, expect, it } from "vitest";
import {
  buildBooksHealth,
  importReconciliationSignals,
  type BooksHealthSnapshot
} from "./books-health-service.js";

const healthySnapshot = {
  commerce: {
    reviewRequired: 0,
    received: 0,
    deadLetter: 0,
    mappingIssueEvents: 0,
    openConflicts: 0
  },
  banking: { unmatched: 0, unreconciled: 0, previewImports: 0, failedImports: 0 },
  imports: {
    incomplete: 0,
    awaitingAcknowledgement: 0,
    failed: 0,
    compensationRequired: 0,
    variance: 0
  },
  settings: {
    setupCompleted: true,
    missingFields: [],
    taxStepReady: true,
    registeredTaxCount: 0,
    effectiveTaxVersionCount: 0,
    missingTaxAccountCount: 0
  },
  period: null,
  fiscalPeriodCoversAsOf: true
} satisfies BooksHealthSnapshot;

describe("Books Health read model", () => {
  it("recognizes only contractual import reconciliation exceptions", () => {
    expect(
      importReconciliationSignals({
        openingTrialBalanceDifferenceMinor: "100",
        receivablesDifferenceMinor: "000",
        payablesDifferenceMinor: "-0",
        inventoryDifferenceMinor: 25,
        inventoryReconciled: false,
        failedRows: 2,
        skippedRows: "1",
        unsupportedFields: ["legacy_class"],
        unrelatedDifferenceMinor: "900",
        customerReconciled: false
      })
    ).toEqual([
      "openingTrialBalanceDifferenceMinor",
      "inventoryDifferenceMinor",
      "inventoryReconciled",
      "failedRows",
      "skippedRows",
      "unsupportedFields"
    ]);
    expect(importReconciliationSignals(null)).toEqual([]);
    expect(importReconciliationSignals([])).toEqual([]);
  });

  it("sorts actionable findings and supplies a direct target for every checked area", () => {
    const result = buildBooksHealth(
      {
        commerce: {
          reviewRequired: 2,
          received: 1,
          deadLetter: 1,
          mappingIssueEvents: 2,
          openConflicts: 1
        },
        banking: { unmatched: 1, unreconciled: 2, previewImports: 1, failedImports: 1 },
        imports: {
          incomplete: 1,
          awaitingAcknowledgement: 1,
          failed: 1,
          compensationRequired: 1,
          variance: 1
        },
        settings: {
          setupCompleted: false,
          missingFields: ["fiscal year end"],
          taxStepReady: false,
          registeredTaxCount: 1,
          effectiveTaxVersionCount: 0,
          missingTaxAccountCount: 1
        },
        period: {
          id: "period-1",
          name: "2025",
          endDate: "2025-12-31",
          overdue: true,
          blockers: [{ label: "manual journal drafts", count: 1 }]
        },
        fiscalPeriodCoversAsOf: false
      },
      "2026-08-02",
      "2026-08-02T12:00:00.000Z"
    );

    expect(result.status).toBe("ACTION_REQUIRED");
    expect(result.mode).toBe("READ_ONLY");
    expect(result.accountingEntriesCreated).toBe(0);
    expect(result.summary.checkedAreas).toBe(5);
    expect(new Set(result.findings.map((finding) => finding.category))).toEqual(
      new Set(["COMMERCE", "BANKING", "IMPORTS", "TAX_SETTINGS", "PERIOD_CLOSE"])
    );
    expect(result.findings.every((finding) => Boolean(finding.target.workspaceId))).toBe(true);
    expect(result.findings.every((finding) => Boolean(finding.target.anchorId))).toBe(true);
    const firstWarning = result.findings.findIndex((finding) => finding.severity === "WARNING");
    expect(firstWarning).toBeGreaterThan(0);
    expect(
      result.findings.slice(0, firstWarning).every((finding) => finding.severity === "BLOCKER")
    ).toBe(true);
    expect(result.findings.map((finding) => finding.id)).toContain("TAX_ACCOUNT_MAPPING_MISSING");
  });

  it("does not turn a clean automated result into professional approval", () => {
    const result = buildBooksHealth(healthySnapshot, "2026-08-02", "2026-08-02T12:00:00.000Z");

    expect(result.status).toBe("NO_FINDINGS");
    expect(result.findings).toEqual([]);
    expect(result.disclaimer).toContain("not accountant, tax, provider, or professional approval");
    expect(result.mode).toBe("READ_ONLY");
    expect(result.accountingEntriesCreated).toBe(0);
  });
});
