import type { Prisma } from "@clearledger/db";

const RATE_SCALE = 1_000_000n;
const ZERO = 0n;

export type PayrollJurisdiction = "CA-AB" | "CA-QC" | "US-FEDERAL";
export type PayrollComponentCategory = "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
export type PayrollFrequency =
  | "ANNUAL"
  | "SEMIANNUAL"
  | "QUARTERLY"
  | "MONTHLY"
  | "SEMIMONTHLY"
  | "BIWEEKLY"
  | "WEEKLY"
  | "DAILY";
export type CanadianClaimCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type UsW4FilingStatus =
  | "MARRIED_FILING_JOINTLY"
  | "SINGLE_OR_MARRIED_FILING_SEPARATELY"
  | "HEAD_OF_HOUSEHOLD";

export interface PayrollYearToDateInput {
  readonly pensionableWagesMinor?: bigint | undefined;
  readonly pensionPlanContributionMinor?: bigint | undefined;
  readonly pensionPlanSecondContributionMinor?: bigint | undefined;
  readonly eiEmployeeContributionMinor?: bigint | undefined;
  readonly eiEmployerContributionMinor?: bigint | undefined;
  readonly qpipEmployeeContributionMinor?: bigint | undefined;
  readonly qpipEmployerContributionMinor?: bigint | undefined;
  readonly socialSecurityWagesMinor?: bigint | undefined;
  readonly medicareWagesMinor?: bigint | undefined;
  readonly futaWagesMinor?: bigint | undefined;
}

export interface CanadianWithholdingInput {
  /** T4127 claim codes 0-10. Code E and direct custom TD1 amounts are not yet supported. */
  readonly federalClaimCode?: CanadianClaimCode | undefined;
  readonly provincialClaimCode?: CanadianClaimCode | undefined;
  /** Additional tax requested on TD1, per pay period. */
  readonly additionalTaxMinor?: bigint | undefined;
}

export interface UsW4Input {
  /** This engine intentionally supports the 2020-or-later Form W-4 path only. */
  readonly formYear: number;
  readonly filingStatus: UsW4FilingStatus;
  readonly step2Checkbox?: boolean | undefined;
  readonly step3CreditsAnnualMinor?: bigint | undefined;
  readonly step4OtherIncomeAnnualMinor?: bigint | undefined;
  readonly step4DeductionsAnnualMinor?: bigint | undefined;
  readonly extraWithholdingPerPeriodMinor?: bigint | undefined;
}

export interface PayrollStatutoryCalculationInput {
  readonly jurisdiction: string;
  /** ISO calendar date (YYYY-MM-DD). The rule pack is selected from this value. */
  readonly payDate: string;
  readonly payFrequency: PayrollFrequency;
  readonly grossPayMinor: bigint;
  readonly pensionableWagesMinor?: bigint | undefined;
  readonly insurableWagesMinor?: bigint | undefined;
  readonly qpipInsurableWagesMinor?: bigint | undefined;
  readonly federalIncomeTaxWagesMinor?: bigint | undefined;
  readonly ficaWagesMinor?: bigint | undefined;
  readonly futaWagesMinor?: bigint | undefined;
  readonly monthsSubjectToPensionPlan?: number | undefined;
  readonly ytd?: PayrollYearToDateInput | undefined;
  readonly canadianWithholding?: CanadianWithholdingInput | undefined;
  readonly usW4?: UsW4Input | undefined;
  /**
   * FUTA is 6% before state unemployment credit. Supply an evidenced credit
   * rate (0 through 5.4%) to calculate net FUTA; otherwise the component is
   * deliberately labelled gross-before-credit.
   */
  readonly usFutaStateCreditRatePpm?: bigint | undefined;
}

export interface PayrollRulePackIdentity {
  readonly id: string;
  readonly version: string;
  readonly jurisdiction: PayrollJurisdiction;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | undefined;
  readonly sourceHash: string;
}

export interface PayrollStatutoryComponent {
  readonly code: string;
  readonly category: PayrollComponentCategory;
  readonly employeeAmountMinor: bigint;
  readonly employerAmountMinor: bigint;
  readonly subjectWagesMinor: bigint;
  readonly explanation: Prisma.InputJsonValue;
}

export interface PayrollStatutoryCalculation {
  readonly rulePack: PayrollRulePackIdentity;
  readonly components: readonly PayrollStatutoryComponent[];
  readonly totals: {
    readonly grossPayMinor: bigint;
    readonly employeeDeductionsMinor: bigint;
    readonly employerContributionsMinor: bigint;
    readonly netPayMinor: bigint;
  };
  readonly explanation: Prisma.InputJsonValue;
}

interface PayrollRulePackDefinition extends PayrollRulePackIdentity {
  readonly sourceUrls: readonly string[];
}

export class PayrollStatutoryDiagnosticError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly diagnostic: Prisma.InputJsonValue
  ) {
    super(message);
    this.name = "PayrollStatutoryDiagnosticError";
  }
}

const RULE_PACKS = {
  CA_AB_2026: {
    id: "clearledger-payroll-ca-ab",
    version: "2026.2",
    jurisdiction: "CA-AB",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    sourceHash: "adce354bf401640799590ad0d46385b52b17aa6b4df233b48d2d63781df42c38",
    sourceUrls: [
      "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html",
      "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html"
    ]
  },
  CA_QC_2026: {
    id: "clearledger-payroll-ca-qc",
    version: "2026.1",
    jurisdiction: "CA-QC",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    sourceHash: "d1a8f314d92173d119052bc8985fd11237232eefdc2f4bdca0adf3627335db9e",
    sourceUrls: [
      "https://www.revenuquebec.ca/en/online-services/forms-and-publications/current-details/tp-1015-f-v/",
      "https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/employers-principal-changes-for-2026/"
    ]
  },
  US_FEDERAL_2026: {
    id: "clearledger-payroll-us-federal",
    version: "2026.1",
    jurisdiction: "US-FEDERAL",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    sourceHash: "19b8a040c1b0bd3bb915b21262d883bf71b8419feee98f81c0601e3f5e439e24",
    sourceUrls: [
      "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
      "https://www.irs.gov/publications/p15",
      "https://www.ssa.gov/OACT/cola/cbb.html"
    ]
  }
} as const satisfies Record<string, PayrollRulePackDefinition>;

export const PAYROLL_STATUTORY_RULE_PACKS: readonly PayrollRulePackDefinition[] = Object.freeze(
  Object.values(RULE_PACKS)
);

const CA_FEDERAL_CLAIM_AMOUNTS_MINOR = [
  0n,
  1_645_200n,
  1_786_850n,
  2_070_150n,
  2_353_450n,
  2_636_750n,
  2_920_050n,
  3_203_350n,
  3_486_650n,
  3_769_950n,
  4_053_250n
] as const;

const CA_AB_CLAIM_AMOUNTS_MINOR = [
  0n,
  2_276_900n,
  2_439_750n,
  2_765_450n,
  3_091_150n,
  3_416_850n,
  3_742_550n,
  4_068_250n,
  4_393_950n,
  4_719_650n,
  5_045_350n
] as const;

interface RateBracket {
  readonly thresholdMinor: bigint;
  readonly ratePpm: bigint;
  readonly constantMinor: bigint;
}

const CA_FEDERAL_BRACKETS: readonly RateBracket[] = [
  { thresholdMinor: 0n, ratePpm: 140_000n, constantMinor: 0n },
  { thresholdMinor: 5_852_300n, ratePpm: 205_000n, constantMinor: 380_400n },
  { thresholdMinor: 11_704_500n, ratePpm: 260_000n, constantMinor: 1_024_100n },
  { thresholdMinor: 18_144_000n, ratePpm: 290_000n, constantMinor: 1_568_500n },
  { thresholdMinor: 25_848_200n, ratePpm: 330_000n, constantMinor: 2_602_400n }
];

const CA_AB_BRACKETS: readonly RateBracket[] = [
  { thresholdMinor: 0n, ratePpm: 80_000n, constantMinor: 0n },
  { thresholdMinor: 6_120_000n, ratePpm: 100_000n, constantMinor: 122_400n },
  { thresholdMinor: 15_425_900n, ratePpm: 120_000n, constantMinor: 430_900n },
  { thresholdMinor: 18_511_100n, ratePpm: 130_000n, constantMinor: 616_000n },
  { thresholdMinor: 24_681_300n, ratePpm: 140_000n, constantMinor: 862_800n },
  { thresholdMinor: 37_022_000n, ratePpm: 150_000n, constantMinor: 1_233_100n }
];

interface UsRateBracket {
  readonly thresholdMinor: bigint;
  readonly baseTaxMinor: bigint;
  readonly ratePpm: bigint;
}

const US_STANDARD_BRACKETS: Record<UsW4FilingStatus, readonly UsRateBracket[]> = {
  MARRIED_FILING_JOINTLY: usBrackets([
    [0n, 0n, 0n],
    [1_930_000n, 0n, 100_000n],
    [4_410_000n, 248_000n, 120_000n],
    [12_010_000n, 1_160_000n, 220_000n],
    [23_070_000n, 3_593_200n, 240_000n],
    [42_285_000n, 8_204_800n, 320_000n],
    [53_175_000n, 11_689_600n, 350_000n],
    [78_800_000n, 20_658_350n, 370_000n]
  ]),
  SINGLE_OR_MARRIED_FILING_SEPARATELY: usBrackets([
    [0n, 0n, 0n],
    [750_000n, 0n, 100_000n],
    [1_990_000n, 124_000n, 120_000n],
    [5_790_000n, 580_000n, 220_000n],
    [11_320_000n, 1_796_600n, 240_000n],
    [20_927_500n, 4_102_400n, 320_000n],
    [26_372_500n, 5_844_800n, 350_000n],
    [64_810_000n, 19_297_925n, 370_000n]
  ]),
  HEAD_OF_HOUSEHOLD: usBrackets([
    [0n, 0n, 0n],
    [1_555_000n, 0n, 100_000n],
    [3_325_000n, 177_000n, 120_000n],
    [8_300_000n, 774_000n, 220_000n],
    [12_125_000n, 1_615_500n, 240_000n],
    [21_730_000n, 3_920_700n, 320_000n],
    [27_175_000n, 5_663_100n, 350_000n],
    [65_615_000n, 19_117_100n, 370_000n]
  ])
};

const US_STEP2_BRACKETS: Record<UsW4FilingStatus, readonly UsRateBracket[]> = {
  MARRIED_FILING_JOINTLY: usBrackets([
    [0n, 0n, 0n],
    [1_610_000n, 0n, 100_000n],
    [2_850_000n, 124_000n, 120_000n],
    [6_650_000n, 580_000n, 220_000n],
    [12_180_000n, 1_796_600n, 240_000n],
    [21_787_500n, 4_102_400n, 320_000n],
    [27_232_500n, 5_844_800n, 350_000n],
    [40_045_000n, 10_329_175n, 370_000n]
  ]),
  SINGLE_OR_MARRIED_FILING_SEPARATELY: usBrackets([
    [0n, 0n, 0n],
    [805_000n, 0n, 100_000n],
    [1_425_000n, 62_000n, 120_000n],
    [3_325_000n, 290_000n, 220_000n],
    [6_090_000n, 898_300n, 240_000n],
    [10_893_800n, 2_051_200n, 320_000n],
    [13_616_300n, 2_922_400n, 350_000n],
    [32_835_000n, 9_648_963n, 370_000n]
  ]),
  HEAD_OF_HOUSEHOLD: usBrackets([
    [0n, 0n, 0n],
    [1_207_500n, 0n, 100_000n],
    [2_092_500n, 88_500n, 120_000n],
    [4_580_000n, 387_000n, 220_000n],
    [6_492_500n, 807_750n, 240_000n],
    [11_295_000n, 1_960_350n, 320_000n],
    [14_017_500n, 2_831_550n, 350_000n],
    [33_237_500n, 9_558_550n, 370_000n]
  ])
};

/** Pure, deterministic statutory calculation. No I/O, persistence, or clock access. */
export class PayrollStatutoryCalculator {
  public calculate(input: PayrollStatutoryCalculationInput): PayrollStatutoryCalculation {
    validateCommonInput(input);
    const pack = selectRulePack(input.jurisdiction, input.payDate);
    if (pack.jurisdiction === "CA-AB" || pack.jurisdiction === "CA-QC")
      return calculateCanada(input, pack);
    return calculateUnitedStates(input, pack);
  }
}

function calculateCanada(
  input: PayrollStatutoryCalculationInput,
  pack: PayrollRulePackDefinition
): PayrollStatutoryCalculation {
  const periods = periodsPerYear(input.payFrequency, "CA");
  const months = BigInt(input.monthsSubjectToPensionPlan ?? 12);
  if (months < 1n || months > 12n)
    diagnostic("INVALID_CPP_MONTHS", "monthsSubjectToPensionPlan must be from 1 through 12.", {
      months: months.toString()
    });
  const pensionable = nonNegative(
    input.pensionableWagesMinor ?? input.grossPayMinor,
    "pensionableWagesMinor"
  );
  const insurable = nonNegative(
    input.insurableWagesMinor ?? input.grossPayMinor,
    "insurableWagesMinor"
  );
  const ytd = input.ytd ?? {};
  const ytdPensionable = nonNegative(ytd.pensionableWagesMinor ?? 0n, "ytd.pensionableWagesMinor");
  const ytdPlan = nonNegative(
    ytd.pensionPlanContributionMinor ?? 0n,
    "ytd.pensionPlanContributionMinor"
  );
  const ytdPlan2 = nonNegative(
    ytd.pensionPlanSecondContributionMinor ?? 0n,
    "ytd.pensionPlanSecondContributionMinor"
  );
  const isQuebec = pack.jurisdiction === "CA-QC";
  const planRate = isQuebec ? 63_000n : 59_500n;
  const planMaximum = isQuebec ? 447_930n : 423_045n;
  const proratedPlanMaximum = roundDivide(planMaximum * months, 12n);
  const basicExemption = canadianPensionBasicExemption(input.payFrequency);
  const planByPay = roundDivide(max(pensionable - basicExemption, 0n) * planRate, RATE_SCALE);
  const plan = min(planByPay, max(proratedPlanMaximum - ytdPlan, 0n));
  const ympe = roundDivide(7_460_000n * months, 12n);
  const cpp2Subject = max(ytdPensionable + pensionable - max(ytdPensionable, ympe), 0n);
  const plan2Maximum = roundDivide(41_600n * months, 12n);
  const plan2 = min(rate(cpp2Subject, 40_000n), max(plan2Maximum - ytdPlan2, 0n));

  const eiRate = isQuebec ? 13_000n : 16_300n;
  const eiEmployeeMaximum = isQuebec ? 89_570n : 112_307n;
  const ytdEiEmployee = nonNegative(
    ytd.eiEmployeeContributionMinor ?? 0n,
    "ytd.eiEmployeeContributionMinor"
  );
  const eiEmployee = min(rate(insurable, eiRate), max(eiEmployeeMaximum - ytdEiEmployee, 0n));
  const ytdEiEmployer = nonNegative(
    ytd.eiEmployerContributionMinor ?? roundDivide(ytdEiEmployee * 14n, 10n),
    "ytd.eiEmployerContributionMinor"
  );
  const eiEmployerMaximum = isQuebec ? 125_398n : 157_230n;
  const eiEmployer = min(
    roundDivide(eiEmployee * 14n, 10n),
    max(eiEmployerMaximum - ytdEiEmployer, 0n)
  );

  const components: PayrollStatutoryComponent[] = [earning(input.grossPayMinor)];
  addMatchedContribution(components, isQuebec ? "CA_QPP" : "CA_CPP", plan, pensionable, {
    authority: "CRA T4127 chapter 6",
    rate: isQuebec ? "6.30%" : "5.95%",
    annualMaximumMinor: planMaximum.toString(),
    ytdBeforeMinor: ytdPlan.toString(),
    payPeriodBasicExemptionMinor: basicExemption.toString(),
    payPeriodsPerYear: periods.toString()
  });
  addMatchedContribution(components, isQuebec ? "CA_QPP2" : "CA_CPP2", plan2, cpp2Subject, {
    authority: "CRA T4127 chapter 6",
    rate: "4.00%",
    ympeMinor: ympe.toString(),
    annualMaximumMinor: plan2Maximum.toString(),
    ytdBeforeMinor: ytdPlan2.toString()
  });
  components.push(
    deduction(isQuebec ? "CA_EI_QC_EMPLOYEE" : "CA_EI_EMPLOYEE", eiEmployee, insurable, {
      authority: "CRA T4127 chapter 7",
      rate: isQuebec ? "1.30%" : "1.63%",
      annualMaximumMinor: eiEmployeeMaximum.toString(),
      ytdBeforeMinor: ytdEiEmployee.toString()
    }),
    employer(isQuebec ? "CA_EI_QC_EMPLOYER" : "CA_EI_EMPLOYER", eiEmployer, insurable, {
      authority: "CRA T4127 chapter 7",
      multiplier: "1.4 times employee premium",
      annualMaximumMinor: eiEmployerMaximum.toString(),
      ytdBeforeMinor: ytdEiEmployer.toString()
    })
  );

  const diagnostics: Prisma.InputJsonValue[] = [];
  if (isQuebec) {
    const qpipWages = nonNegative(
      input.qpipInsurableWagesMinor ?? input.grossPayMinor,
      "qpipInsurableWagesMinor"
    );
    const ytdQpipEmployee = nonNegative(
      ytd.qpipEmployeeContributionMinor ?? 0n,
      "ytd.qpipEmployeeContributionMinor"
    );
    const ytdQpipEmployer = nonNegative(
      ytd.qpipEmployerContributionMinor ?? 0n,
      "ytd.qpipEmployerContributionMinor"
    );
    const qpipEmployee = min(rate(qpipWages, 4_300n), max(44_290n - ytdQpipEmployee, 0n));
    const qpipEmployer = min(rate(qpipWages, 6_020n), max(62_006n - ytdQpipEmployer, 0n));
    components.push(
      deduction("CA_QPIP_EMPLOYEE", qpipEmployee, qpipWages, {
        authority: "Revenu Quebec TP-1015.F-V 2026-01",
        rate: "0.430%",
        annualMaximumMinor: "44290",
        ytdBeforeMinor: ytdQpipEmployee.toString()
      }),
      employer("CA_QPIP_EMPLOYER", qpipEmployer, qpipWages, {
        authority: "Revenu Quebec TP-1015.F-V 2026-01",
        rate: "0.602%",
        annualMaximumMinor: "62006",
        ytdBeforeMinor: ytdQpipEmployer.toString()
      })
    );
    diagnostics.push({
      code: "CA_QC_INCOME_TAX_NOT_IMPLEMENTED",
      severity: "REGULATED_GATE",
      message:
        "Quebec income tax and employer HSF, labour standards, WSDRF, and CNESST levies are not calculated; do not treat this result as Quebec gross-to-net payroll."
    });
  } else {
    components.push(...calculateAlbertaIncomeTax(input, periods, plan, plan2, eiEmployee));
  }
  return finish(pack, input.grossPayMinor, components, diagnostics);
}

function calculateAlbertaIncomeTax(
  input: PayrollStatutoryCalculationInput,
  periods: bigint,
  cpp: bigint,
  cpp2: bigint,
  ei: bigint
): readonly PayrollStatutoryComponent[] {
  const withholding = input.canadianWithholding ?? {};
  const federalClaimCode: number = withholding.federalClaimCode ?? 1;
  const provincialClaimCode: number = withholding.provincialClaimCode ?? 1;
  const federalClaim = CA_FEDERAL_CLAIM_AMOUNTS_MINOR.at(federalClaimCode);
  const provincialClaim = CA_AB_CLAIM_AMOUNTS_MINOR.at(provincialClaimCode);
  if (federalClaim === undefined || provincialClaim === undefined)
    diagnostic(
      "UNSUPPORTED_TD1_CLAIM_CODE",
      "Only Canadian TD1 claim codes 0 through 10 are supported.",
      {
        federalClaimCode,
        provincialClaimCode
      }
    );
  const wages = nonNegative(
    input.federalIncomeTaxWagesMinor ?? input.grossPayMinor,
    "federalIncomeTaxWagesMinor"
  );
  const additionalCpp = roundDivide(cpp * 100n, 595n) + cpp2;
  const annualTaxable = max(periods * max(wages - additionalCpp, 0n), 0n);
  const projectedBaseCpp = min(roundDivide(periods * cpp * 495n, 595n), 351_945n);
  const projectedEi = min(periods * ei, 112_307n);
  const federalK1 = rate(federalClaim, 140_000n);
  const federalK2 = rate(projectedBaseCpp + projectedEi, 140_000n);
  const employmentCredit = rate(min(periods * wages, 150_100n), 140_000n);
  const federalGrossTax = bracketTax(annualTaxable, CA_FEDERAL_BRACKETS);
  const annualFederal = max(federalGrossTax - federalK1 - federalK2 - employmentCredit, 0n);

  const provincialK1 = rate(provincialClaim, 80_000n);
  const provincialK2 = rate(projectedBaseCpp + projectedEi, 80_000n);
  const supplemental = rate(max(provincialK1 + provincialK2 - 489_600n, 0n), 250_000n);
  const provincialGrossTax = bracketTax(annualTaxable, CA_AB_BRACKETS);
  const annualProvincial = max(provincialGrossTax - provincialK1 - provincialK2 - supplemental, 0n);
  const federal = roundDivide(annualFederal, periods);
  const provincial = roundDivide(annualProvincial, periods);
  const additional = nonNegative(withholding.additionalTaxMinor ?? 0n, "additionalTaxMinor");
  const explanation = {
    authority: "CRA T4127 Option 1",
    annualTaxableIncomeMinor: annualTaxable.toString(),
    cppAdditionalDeductionMinor: additionalCpp.toString(),
    federalClaimCode,
    provincialClaimCode,
    payPeriodsPerYear: periods.toString(),
    scope:
      "Regular periodic employment income only; custom TD1 amounts, claim code E, commission, bonus, retroactive, transfer, and special employment cases are regulated gates."
  } satisfies Prisma.InputJsonObject;
  const components = [
    deduction("CA_FEDERAL_INCOME_TAX", federal, wages, {
      ...explanation,
      annualTaxMinor: annualFederal.toString()
    }),
    deduction("CA_AB_INCOME_TAX", provincial, wages, {
      ...explanation,
      annualTaxMinor: annualProvincial.toString()
    })
  ];
  if (additional > 0n)
    components.push(
      deduction("CA_TD1_ADDITIONAL_TAX", additional, wages, {
        authority: "CRA T4127 T2",
        basis: "employee-requested additional tax per pay period"
      })
    );
  return components;
}

function calculateUnitedStates(
  input: PayrollStatutoryCalculationInput,
  pack: PayrollRulePackDefinition
): PayrollStatutoryCalculation {
  const periods = periodsPerYear(input.payFrequency, "US");
  const wages = nonNegative(input.ficaWagesMinor ?? input.grossPayMinor, "ficaWagesMinor");
  const ytd = input.ytd ?? {};
  const ytdSocialSecurity = nonNegative(
    ytd.socialSecurityWagesMinor ?? 0n,
    "ytd.socialSecurityWagesMinor"
  );
  const socialSecuritySubject = min(wages, max(18_450_000n - ytdSocialSecurity, 0n));
  const socialSecurity = rate(socialSecuritySubject, 62_000n);
  const medicare = rate(wages, 14_500n);
  const ytdMedicareWages = nonNegative(ytd.medicareWagesMinor ?? 0n, "ytd.medicareWagesMinor");
  const additionalMedicareSubject = max(
    ytdMedicareWages + wages - max(ytdMedicareWages, 20_000_000n),
    0n
  );
  const additionalMedicare = rate(additionalMedicareSubject, 9_000n);

  const w4 = input.usW4;
  if (!w4)
    diagnostic(
      "US_W4_REQUIRED",
      "A 2020-or-later Form W-4 input is required for federal withholding.",
      {
        jurisdiction: input.jurisdiction
      }
    );
  if (w4.formYear < 2020)
    diagnostic(
      "US_PRE_2020_W4_UNSUPPORTED",
      "Pre-2020 Form W-4 allowance calculations are not implemented.",
      {
        formYear: w4.formYear
      }
    );
  const fitWages = nonNegative(
    input.federalIncomeTaxWagesMinor ?? input.grossPayMinor,
    "federalIncomeTaxWagesMinor"
  );
  const step2 = w4.step2Checkbox ?? false;
  const standardAdjustment = step2
    ? 0n
    : w4.filingStatus === "MARRIED_FILING_JOINTLY"
      ? 1_290_000n
      : 860_000n;
  const adjustedAnnualWages = max(
    fitWages * periods +
      nonNegative(w4.step4OtherIncomeAnnualMinor ?? 0n, "W-4 Step 4(a)") -
      nonNegative(w4.step4DeductionsAnnualMinor ?? 0n, "W-4 Step 4(b)") -
      standardAdjustment,
    0n
  );
  const brackets = (step2 ? US_STEP2_BRACKETS : US_STANDARD_BRACKETS)[w4.filingStatus];
  const tentativeAnnualFit = usBracketTax(adjustedAnnualWages, brackets);
  const tentativeFitPerPeriod = roundDivide(tentativeAnnualFit, periods);
  const creditsPerPeriod = roundDivide(
    nonNegative(w4.step3CreditsAnnualMinor ?? 0n, "W-4 Step 3"),
    periods
  );
  const fitBeforeExtra = max(tentativeFitPerPeriod - creditsPerPeriod, 0n);
  const fit =
    fitBeforeExtra + nonNegative(w4.extraWithholdingPerPeriodMinor ?? 0n, "W-4 Step 4(c)");

  const futaWages = nonNegative(input.futaWagesMinor ?? input.grossPayMinor, "futaWagesMinor");
  const ytdFuta = nonNegative(ytd.futaWagesMinor ?? 0n, "ytd.futaWagesMinor");
  const futaSubject = min(futaWages, max(700_000n - ytdFuta, 0n));
  const credit = input.usFutaStateCreditRatePpm;
  if (credit !== undefined && (credit < 0n || credit > 54_000n))
    diagnostic("INVALID_FUTA_CREDIT", "FUTA state credit must be between 0 and 5.4%.", {
      creditRatePpm: credit.toString()
    });
  const futaRate = 60_000n - (credit ?? 0n);
  const futa = rate(futaSubject, futaRate);
  const components: PayrollStatutoryComponent[] = [
    earning(input.grossPayMinor),
    deduction("US_FIT", fit, fitWages, {
      authority: "IRS Publication 15-T (2026), Worksheet 1A automated percentage method",
      filingStatus: w4.filingStatus,
      step2Checkbox: step2,
      adjustedAnnualWagesMinor: adjustedAnnualWages.toString(),
      tentativeAnnualWithholdingMinor: tentativeAnnualFit.toString(),
      tentativeWithholdingPerPeriodMinor: tentativeFitPerPeriod.toString(),
      creditsPerPeriodMinor: creditsPerPeriod.toString(),
      withholdingBeforeExtraPerPeriodMinor: fitBeforeExtra.toString(),
      payPeriodsPerYear: periods.toString()
    }),
    deduction("US_SOCIAL_SECURITY_EMPLOYEE", socialSecurity, socialSecuritySubject, {
      authority: "IRS Publication 15 (2026) and SSA 2026 contribution base",
      rate: "6.20%",
      wageBaseMinor: "18450000",
      ytdWagesBeforeMinor: ytdSocialSecurity.toString()
    }),
    employer("US_SOCIAL_SECURITY_EMPLOYER", socialSecurity, socialSecuritySubject, {
      authority: "IRS Publication 15 (2026) and SSA 2026 contribution base",
      rate: "6.20%",
      wageBaseMinor: "18450000",
      ytdWagesBeforeMinor: ytdSocialSecurity.toString()
    }),
    deduction("US_MEDICARE_EMPLOYEE", medicare, wages, {
      authority: "IRS Publication 15 (2026)",
      rate: "1.45%",
      wageBase: "none"
    }),
    employer("US_MEDICARE_EMPLOYER", medicare, wages, {
      authority: "IRS Publication 15 (2026)",
      rate: "1.45%",
      wageBase: "none"
    }),
    deduction("US_ADDITIONAL_MEDICARE_EMPLOYEE", additionalMedicare, additionalMedicareSubject, {
      authority: "IRS Publication 15 (2026)",
      rate: "0.90%",
      withholdingThresholdMinor: "20000000",
      employerMatch: false,
      ytdMedicareWagesBeforeMinor: ytdMedicareWages.toString()
    }),
    employer(credit === undefined ? "US_FUTA_GROSS" : "US_FUTA_NET", futa, futaSubject, {
      authority: "IRS Publication 15 (2026)",
      grossRate: "6.00%",
      federalWageBaseMinor: "700000",
      stateCreditRatePpm: credit?.toString() ?? null,
      warning:
        credit === undefined
          ? "Gross FUTA before state unemployment credit; no eligibility or credit-reduction-state assumption was made."
          : "Net rate uses caller-supplied state credit evidence; state unemployment tax itself is outside this rule pack."
    })
  ];
  const diagnostics: Prisma.InputJsonValue[] = [
    {
      code: "US_STATE_LOCAL_TAXES_NOT_IMPLEMENTED",
      severity: "REGULATED_GATE",
      message:
        "State and local income tax, disability, paid-leave, and unemployment calculations are not included."
    }
  ];
  if (credit === undefined)
    diagnostics.push({
      code: "US_FUTA_STATE_CREDIT_NOT_APPLIED",
      severity: "ACTION_REQUIRED",
      message: "FUTA is reported at the gross 6% rate until evidenced state credit is supplied."
    });
  return finish(pack, input.grossPayMinor, components, diagnostics);
}

function finish(
  pack: PayrollRulePackDefinition,
  grossPayMinor: bigint,
  components: readonly PayrollStatutoryComponent[],
  diagnostics: readonly Prisma.InputJsonValue[]
): PayrollStatutoryCalculation {
  const employeeDeductionsMinor = components.reduce(
    (sum, component) =>
      component.category === "DEDUCTION" ? sum + component.employeeAmountMinor : sum,
    0n
  );
  const employerContributionsMinor = components.reduce(
    (sum, component) =>
      component.category === "EMPLOYER_CONTRIBUTION" ? sum + component.employerAmountMinor : sum,
    0n
  );
  if (employeeDeductionsMinor > grossPayMinor)
    diagnostic("DEDUCTIONS_EXCEED_GROSS", "Employee deductions exceed gross pay.", {
      grossPayMinor: grossPayMinor.toString(),
      employeeDeductionsMinor: employeeDeductionsMinor.toString()
    });
  return {
    rulePack: identity(pack),
    components,
    totals: {
      grossPayMinor,
      employeeDeductionsMinor,
      employerContributionsMinor,
      netPayMinor: grossPayMinor - employeeDeductionsMinor
    },
    explanation: {
      engine: "CLEARLEDGER_PAYROLL_STATUTORY",
      arithmetic: "integer minor units; round-half-up to nearest minor unit",
      deterministic: true,
      calculationComplete: diagnostics.length === 0,
      sourceUrls: [...pack.sourceUrls],
      diagnostics: [...diagnostics]
    }
  };
}

function identity(pack: PayrollRulePackDefinition): PayrollRulePackIdentity {
  return {
    id: pack.id,
    version: pack.version,
    jurisdiction: pack.jurisdiction,
    effectiveFrom: pack.effectiveFrom,
    ...(pack.effectiveTo ? { effectiveTo: pack.effectiveTo } : {}),
    sourceHash: pack.sourceHash
  };
}

function selectRulePack(jurisdiction: string, payDate: string): PayrollRulePackDefinition {
  const packs = PAYROLL_STATUTORY_RULE_PACKS.filter(
    (candidate) =>
      candidate.jurisdiction === jurisdiction &&
      candidate.effectiveFrom <= payDate &&
      (!candidate.effectiveTo || payDate <= candidate.effectiveTo)
  );
  const pack = packs.at(-1);
  if (!pack)
    diagnostic(
      "UNSUPPORTED_JURISDICTION_OR_DATE",
      "No statutory rule pack supports this jurisdiction and pay date.",
      {
        jurisdiction,
        payDate,
        supported: PAYROLL_STATUTORY_RULE_PACKS.map((candidate) => ({
          jurisdiction: candidate.jurisdiction,
          effectiveFrom: candidate.effectiveFrom,
          effectiveTo: candidate.effectiveTo ?? null
        }))
      }
    );
  return pack;
}

function validateCommonInput(input: PayrollStatutoryCalculationInput): void {
  const parsedDate = Date.parse(`${input.payDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.payDate) ||
    Number.isNaN(parsedDate) ||
    new Date(parsedDate).toISOString().slice(0, 10) !== input.payDate
  )
    diagnostic("INVALID_PAY_DATE", "payDate must be a valid ISO calendar date (YYYY-MM-DD).", {
      payDate: input.payDate
    });
  nonNegative(input.grossPayMinor, "grossPayMinor");
}

/** T4127 Table 6.1 C values, expressed in cents for regular pay periods. */
function canadianPensionBasicExemption(frequency: PayrollFrequency): bigint {
  const exemptions: Record<PayrollFrequency, bigint> = {
    ANNUAL: 350_000n,
    SEMIANNUAL: 175_000n,
    QUARTERLY: 87_500n,
    MONTHLY: 29_166n,
    SEMIMONTHLY: 14_583n,
    BIWEEKLY: 13_461n,
    WEEKLY: 6_730n,
    DAILY: 1_458n
  };
  return exemptions[frequency];
}

function periodsPerYear(frequency: PayrollFrequency, country: "CA" | "US"): bigint {
  const periods: Record<PayrollFrequency, bigint> = {
    ANNUAL: 1n,
    SEMIANNUAL: 2n,
    QUARTERLY: 4n,
    MONTHLY: 12n,
    SEMIMONTHLY: 24n,
    BIWEEKLY: 26n,
    WEEKLY: 52n,
    DAILY: country === "CA" ? 240n : 260n
  };
  return periods[frequency];
}

function earning(amount: bigint): PayrollStatutoryComponent {
  return {
    code: "GROSS_PAY",
    category: "EARNING",
    employeeAmountMinor: amount,
    employerAmountMinor: 0n,
    subjectWagesMinor: amount,
    explanation: { basis: "caller-supplied gross pay" }
  };
}

function deduction(
  code: string,
  amount: bigint,
  subjectWagesMinor: bigint,
  explanation: Prisma.InputJsonObject
): PayrollStatutoryComponent {
  return {
    code,
    category: "DEDUCTION",
    employeeAmountMinor: amount,
    employerAmountMinor: 0n,
    subjectWagesMinor,
    explanation
  };
}

function employer(
  code: string,
  amount: bigint,
  subjectWagesMinor: bigint,
  explanation: Prisma.InputJsonObject
): PayrollStatutoryComponent {
  return {
    code,
    category: "EMPLOYER_CONTRIBUTION",
    employeeAmountMinor: 0n,
    employerAmountMinor: amount,
    subjectWagesMinor,
    explanation
  };
}

function addMatchedContribution(
  components: PayrollStatutoryComponent[],
  code: string,
  amount: bigint,
  subjectWagesMinor: bigint,
  explanation: Prisma.InputJsonObject
): void {
  components.push(
    deduction(`${code}_EMPLOYEE`, amount, subjectWagesMinor, explanation),
    employer(`${code}_EMPLOYER`, amount, subjectWagesMinor, explanation)
  );
}

function bracketTax(amount: bigint, brackets: readonly RateBracket[]): bigint {
  const bracket = [...brackets].reverse().find((candidate) => amount >= candidate.thresholdMinor)!;
  return max(rate(amount, bracket.ratePpm) - bracket.constantMinor, 0n);
}

function usBracketTax(amount: bigint, brackets: readonly UsRateBracket[]): bigint {
  const bracket = [...brackets].reverse().find((candidate) => amount >= candidate.thresholdMinor)!;
  return bracket.baseTaxMinor + rate(amount - bracket.thresholdMinor, bracket.ratePpm);
}

function usBrackets(
  rows: readonly (readonly [thresholdMinor: bigint, baseTaxMinor: bigint, ratePpm: bigint])[]
): readonly UsRateBracket[] {
  return rows.map(([thresholdMinor, baseTaxMinor, ratePpm]) => ({
    thresholdMinor,
    baseTaxMinor,
    ratePpm
  }));
}

function rate(amount: bigint, ratePpm: bigint): bigint {
  return roundDivide(amount * ratePpm, RATE_SCALE);
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("roundDivide denominator must be positive");
  if (numerator < 0n) return -roundDivide(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function max(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function nonNegative(value: bigint, field: string): bigint {
  if (value < ZERO)
    diagnostic("NEGATIVE_PAYROLL_INPUT", `${field} cannot be negative.`, {
      field,
      value: value.toString()
    });
  return value;
}

function diagnostic(code: string, message: string, detail: Prisma.InputJsonValue): never {
  throw new PayrollStatutoryDiagnosticError(code, message, detail);
}
