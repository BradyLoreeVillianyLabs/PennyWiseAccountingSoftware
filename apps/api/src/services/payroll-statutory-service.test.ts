import { describe, expect, it } from "vitest";
import {
  PAYROLL_STATUTORY_RULE_PACKS,
  PayrollStatutoryCalculator,
  PayrollStatutoryDiagnosticError,
  type PayrollStatutoryCalculation,
  type PayrollStatutoryComponent
} from "./payroll-statutory-service.js";

const calculator = new PayrollStatutoryCalculator();

function component(result: PayrollStatutoryCalculation, code: string): PayrollStatutoryComponent {
  const found = result.components.find((candidate) => candidate.code === code);
  if (!found) throw new Error(`Missing payroll component ${code}`);
  return found;
}

function expectDiagnostic(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PayrollStatutoryDiagnosticError);
    expect((error as PayrollStatutoryDiagnosticError).code).toBe(code);
    return;
  }
  throw new Error(`Expected PayrollStatutoryDiagnosticError ${code}`);
}

describe("2026 payroll statutory rule packs", () => {
  it("publishes immutable, date-effective rule identities and is deterministic", () => {
    expect(PAYROLL_STATUTORY_RULE_PACKS).toHaveLength(3);
    expect(PAYROLL_STATUTORY_RULE_PACKS.map((pack) => pack.jurisdiction)).toEqual([
      "CA-AB",
      "CA-QC",
      "US-FEDERAL"
    ]);
    for (const pack of PAYROLL_STATUTORY_RULE_PACKS) {
      expect(pack.version).toMatch(/^2026\./);
      expect(pack.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(pack.effectiveFrom).toBe("2026-01-01");
      expect(pack.effectiveTo).toBe("2026-12-31");
    }

    const input = {
      jurisdiction: "CA-AB",
      payDate: "2026-08-03",
      payFrequency: "WEEKLY" as const,
      grossPayMinor: 68_500n
    };
    expect(calculator.calculate(input)).toEqual(calculator.calculate(input));
  });

  it("calculates Alberta weekly CPP, EI, and Option 1 income tax", () => {
    const result = calculator.calculate({
      jurisdiction: "CA-AB",
      payDate: "2026-08-03",
      payFrequency: "WEEKLY",
      grossPayMinor: 68_500n,
      canadianWithholding: { federalClaimCode: 1, provincialClaimCode: 1 }
    });

    expect(component(result, "CA_CPP_EMPLOYEE").employeeAmountMinor).toBe(3_675n);
    expect(component(result, "CA_EI_EMPLOYEE").employeeAmountMinor).toBe(1_117n);
    expect(component(result, "CA_FEDERAL_INCOME_TAX").employeeAmountMinor).toBe(4_086n);
    expect(component(result, "CA_AB_INCOME_TAX").employeeAmountMinor).toBe(1_594n);
    expect(result.totals).toEqual({
      grossPayMinor: 68_500n,
      employeeDeductionsMinor: 10_472n,
      employerContributionsMinor: 5_239n,
      netPayMinor: 58_028n
    });

    // T4032-AB's weekly lookup table groups $682-$686 and prints $40.75 federal
    // and $15.95 Alberta. The exact Option 1 formula uses the actual $685 wage,
    // so its results are expected to be within the table-band rounding interval.
    expect(
      component(result, "CA_FEDERAL_INCOME_TAX").employeeAmountMinor - 4_075n
    ).toBeLessThanOrEqual(15n);
    expect(
      component(result, "CA_AB_INCOME_TAX").employeeAmountMinor - 1_595n
    ).toBeGreaterThanOrEqual(-1n);
  });

  it("stops CPP at the annual maximum and starts CPP2 above the YMPE", () => {
    const result = calculator.calculate({
      jurisdiction: "CA-AB",
      payDate: "2026-08-03",
      payFrequency: "WEEKLY",
      grossPayMinor: 100_000n,
      ytd: {
        pensionableWagesMinor: 7_440_000n,
        pensionPlanContributionMinor: 420_000n
      }
    });

    expect(component(result, "CA_CPP_EMPLOYEE").employeeAmountMinor).toBe(3_045n);
    expect(component(result, "CA_CPP2_EMPLOYEE")).toMatchObject({
      employeeAmountMinor: 3_200n,
      subjectWagesMinor: 80_000n
    });
  });

  it("records employee-requested TD1 additional tax as a distinct deduction", () => {
    const result = calculator.calculate({
      jurisdiction: "CA-AB",
      payDate: "2026-08-03",
      payFrequency: "WEEKLY",
      grossPayMinor: 68_500n,
      canadianWithholding: { additionalTaxMinor: 2_500n }
    });

    expect(component(result, "CA_TD1_ADDITIONAL_TAX")).toMatchObject({
      category: "DEDUCTION",
      employeeAmountMinor: 2_500n
    });
    expect(result.totals.employeeDeductionsMinor).toBe(12_972n);
  });

  it("matches Revenu Quebec's published weekly QPP example and flags incomplete Quebec gross-to-net", () => {
    const result = calculator.calculate({
      jurisdiction: "CA-QC",
      payDate: "2026-08-03",
      payFrequency: "WEEKLY",
      grossPayMinor: 51_500n
    });

    expect(component(result, "CA_QPP_EMPLOYEE").employeeAmountMinor).toBe(2_821n);
    expect(component(result, "CA_EI_QC_EMPLOYEE").employeeAmountMinor).toBe(670n);
    expect(component(result, "CA_QPIP_EMPLOYEE").employeeAmountMinor).toBe(221n);
    expect(result.explanation).toMatchObject({
      calculationComplete: false,
      diagnostics: [expect.objectContaining({ code: "CA_QC_INCOME_TAX_NOT_IMPLEMENTED" })]
    });
  });

  it("applies employee and employer QPIP annual maximums independently", () => {
    const result = calculator.calculate({
      jurisdiction: "CA-QC",
      payDate: "2026-08-03",
      payFrequency: "WEEKLY",
      grossPayMinor: 100_000n,
      ytd: {
        qpipEmployeeContributionMinor: 44_200n,
        qpipEmployerContributionMinor: 61_800n
      }
    });

    expect(component(result, "CA_QPIP_EMPLOYEE").employeeAmountMinor).toBe(90n);
    expect(component(result, "CA_QPIP_EMPLOYER").employerAmountMinor).toBe(206n);
  });

  it("implements the 2026 IRS Publication 15-T automated percentage method", () => {
    const result = calculator.calculate({
      jurisdiction: "US-FEDERAL",
      payDate: "2026-08-03",
      payFrequency: "BIWEEKLY",
      grossPayMinor: 400_000n,
      usW4: {
        formYear: 2026,
        filingStatus: "SINGLE_OR_MARRIED_FILING_SEPARATELY"
      }
    });

    expect(component(result, "US_FIT").employeeAmountMinor).toBe(54_038n);
    expect(component(result, "US_SOCIAL_SECURITY_EMPLOYEE").employeeAmountMinor).toBe(24_800n);
    expect(component(result, "US_MEDICARE_EMPLOYEE").employeeAmountMinor).toBe(5_800n);
    expect(component(result, "US_FUTA_GROSS").employerAmountMinor).toBe(24_000n);
    expect(result.totals.netPayMinor).toBe(315_362n);
  });

  it("honours Social Security, Additional Medicare, and evidenced FUTA limits", () => {
    const result = calculator.calculate({
      jurisdiction: "US-FEDERAL",
      payDate: "2026-08-03",
      payFrequency: "MONTHLY",
      grossPayMinor: 1_000_000n,
      usW4: {
        formYear: 2026,
        filingStatus: "SINGLE_OR_MARRIED_FILING_SEPARATELY"
      },
      usFutaStateCreditRatePpm: 54_000n,
      ytd: {
        socialSecurityWagesMinor: 18_400_000n,
        medicareWagesMinor: 19_950_000n,
        futaWagesMinor: 600_000n
      }
    });

    expect(component(result, "US_SOCIAL_SECURITY_EMPLOYEE")).toMatchObject({
      employeeAmountMinor: 3_100n,
      subjectWagesMinor: 50_000n
    });
    expect(component(result, "US_ADDITIONAL_MEDICARE_EMPLOYEE")).toMatchObject({
      employeeAmountMinor: 8_550n,
      subjectWagesMinor: 950_000n
    });
    expect(component(result, "US_FUTA_NET")).toMatchObject({
      employerAmountMinor: 600n,
      subjectWagesMinor: 100_000n
    });
  });

  it("applies W-4 Step 3 credits per period before Step 4(c) extra withholding", () => {
    const result = calculator.calculate({
      jurisdiction: "US-FEDERAL",
      payDate: "2026-08-03",
      payFrequency: "BIWEEKLY",
      grossPayMinor: 400_000n,
      usW4: {
        formYear: 2026,
        filingStatus: "SINGLE_OR_MARRIED_FILING_SEPARATELY",
        step3CreditsAnnualMinor: 200_000n,
        extraWithholdingPerPeriodMinor: 1_000n
      }
    });

    expect(component(result, "US_FIT").employeeAmountMinor).toBe(47_346n);
  });

  it.each([
    [
      "rejects unsupported jurisdictions",
      { jurisdiction: "CA-ON", payDate: "2026-08-03", payFrequency: "WEEKLY", grossPayMinor: 1n },
      "UNSUPPORTED_JURISDICTION_OR_DATE"
    ],
    [
      "rejects dates outside a rule pack",
      { jurisdiction: "CA-AB", payDate: "2027-01-01", payFrequency: "WEEKLY", grossPayMinor: 1n },
      "UNSUPPORTED_JURISDICTION_OR_DATE"
    ],
    [
      "rejects impossible dates",
      { jurisdiction: "CA-AB", payDate: "2026-02-31", payFrequency: "WEEKLY", grossPayMinor: 1n },
      "INVALID_PAY_DATE"
    ],
    [
      "rejects negative monetary inputs",
      { jurisdiction: "CA-AB", payDate: "2026-08-03", payFrequency: "WEEKLY", grossPayMinor: -1n },
      "NEGATIVE_PAYROLL_INPUT"
    ]
  ])("%s", (_name, input, code) => {
    expectDiagnostic(() => calculator.calculate(input as never), code);
  });

  it("fails closed for pre-2020 W-4 forms", () => {
    expectDiagnostic(
      () =>
        calculator.calculate({
          jurisdiction: "US-FEDERAL",
          payDate: "2026-08-03",
          payFrequency: "WEEKLY",
          grossPayMinor: 100_000n,
          usW4: {
            formYear: 2019,
            filingStatus: "SINGLE_OR_MARRIED_FILING_SEPARATELY"
          }
        }),
      "US_PRE_2020_W4_UNSUPPORTED"
    );
  });
});
