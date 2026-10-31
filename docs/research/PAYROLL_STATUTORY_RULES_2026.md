# Payroll statutory rules research and implementation (2026)

Research verified against primary sources on 2026-08-03. This document records the
authoritative inputs, implementation boundary, filing/export implications, and external
software evaluation for the isolated deterministic calculator in
`apps/api/src/services/payroll-statutory-service.ts`.

This is engineering evidence, not tax or legal advice. A production payroll release still
requires professional review, government conformance testing where available, controlled
rule-pack updates, and jurisdiction-specific operational procedures.

## Implemented contract

`PayrollStatutoryCalculator.calculate(input)` is pure and synchronous. It does no I/O, does
not read the clock, and uses `bigint` minor units with round-half-up arithmetic. It returns:

- a versioned, date-effective `rulePack` identity and source-manifest hash;
- earning, employee deduction, and employer contribution components with subject wages and
  structured explanations;
- gross pay, employee deductions, employer contributions, and net pay totals; and
- structured diagnostics for excluded regulated calculations.

The three 2026 packs are `CA-AB`, `CA-QC`, and `US-FEDERAL`. A date outside 2026 or an
unknown jurisdiction fails closed with `PayrollStatutoryDiagnosticError`.

`sourceHash` is SHA-256 of the rule pack's ordered `sourceUrls`, joined by a single LF and
encoded as UTF-8. It identifies the source manifest, not a downloaded government-page
snapshot. The rule pack version identifies the implemented constants and formulas.

## Canada and Alberta

The controlling source is the CRA's [current-year T4127 index](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html),
which identifies the 123rd edition effective 2026-07-01 and the 122nd edition effective
2026-01-01. Alberta values did not change in the July edition, so version `2026.2` applies
for the full 2026 calendar year. The detailed formula source is [T4127, 122nd edition](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html).

Implemented for regular periodic salary/wages:

- CPP: $74,600 YMPE, $85,000 YAMPE, $3,500 annual basic exemption, 5.95% CPP rate,
  $4,230.45 maximum, and 4% CPP2 rate with a $416 maximum. Per-period basic exemptions use
  the two-decimal values in T4127 Table 6.1.
- EI outside Quebec: 1.63% employee premium to $1,123.07, with the ordinary employer share
  at 1.4 times the employee premium to $1,572.30.
- Federal income tax: T4127 Option 1, 2026 federal brackets, constants, claim-code table
  values 0-10, base CPP/EI credits, the $1,501 Canada employment amount, and TD1 additional
  tax.
- Alberta income tax: T4127 Option 1, 2026 Alberta brackets, constants, claim-code table
  values 0-10, base CPP/EI credits, and the Alberta supplementary tax-credit calculation.

The official [2026 T4032-AB tables](https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-ab-1-26e.pdf)
are used as an independent fixture. For weekly pay in the $682-$686 band and claim code 1,
the printed lookup is $40.75 federal and $15.95 Alberta; the calculator's exact Option 1
result at $685 is $40.86 and $15.94. The small difference is expected because T4032 groups a
wage band, while the formula uses the exact wage.

Not implemented: custom TD1 dollar amounts, claim code E, reduced-at-source authorizations,
bonuses, commissions, gratuities, retroactive pay, transfers, irregular periods, pensions,
non-resident cases, taxable-benefit classification, CPP election/exemption edge cases, or
special EI rates. These require additional typed inputs and official fixtures before use.

## Quebec

The controlling Quebec source is Revenu Quebec's [TP-1015.F-V, 2026-01](https://www.revenuquebec.ca/en/online-services/forms-and-publications/current-details/tp-1015-f-v/),
supplemented by its [principal changes for 2026](https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/employers-principal-changes-for-2026/).

Implemented:

- QPP at 6.30% to $4,479.30, plus second additional QPP at 4% between the $74,600 YMPE and
  $85,000 YAMPE to $416, with equal employee and employer amounts;
- Quebec EI at 1.30% to $895.70, with ordinary employer share at 1.4 times the employee
  premium to $1,253.98; and
- QPIP on maximum insurable earnings of $103,000: employee 0.430% to $442.90 and employer
  0.602% to $620.06. Revenu Quebec also publishes these figures on its [QPIP rate page](https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/calculating-source-deductions-and-contributions/qpip-premiums/maximum-insurable-earnings-and-premium-rate/).

Revenu Quebec's [gratuities and retroactive pay example](https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/calculating-source-deductions-and-contributions/special-cases-source-deductions-and-employer-contributions/gratuities-and-retroactive-pay/)
provides an independent regular-wage fixture: $515 weekly produces $28.21 of QPP before the
separately paid gratuity.

Quebec provincial income tax and the HSF, labour standards, WSDRF, and CNESST employer
levies are deliberately not calculated. Every Quebec result contains a regulated-gate
diagnostic and `calculationComplete: false`; consumers must not present its `netPayMinor` as
complete Quebec net pay. HSF cannot be inferred from a paycheque alone: the 2026 rate varies
by employer sector and total associated worldwide payroll, and special exemptions apply.
Revenu Quebec's [2026 HSF table](https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/calculating-source-deductions-and-contributions/employer-contribution-to-the-health-services-fund/total-payroll-threshold-and-health-services-fund-contribution-rate/)
shows 1.25%, 1.65%, formula-based intermediate rates, or 4.26%, depending on those facts.

## United States federal

Federal income-tax withholding implements Worksheet 1A and both annual percentage tables
from [IRS Publication 15-T (2026)](https://www.irs.gov/publications/p15t) for Forms W-4 from
2020 or later. Inputs cover filing status, Step 2 checkbox, annual Step 3 credits, Steps 4(a)
and 4(b), and Step 4(c) extra withholding. The engine follows the worksheet sequence,
including separate per-period division of tentative withholding and Step 3 credits.

[IRS Publication 15 (2026)](https://www.irs.gov/publications/p15) and the SSA's [2026
contribution base](https://www.ssa.gov/OACT/cola/cbb.html) support:

- Social Security at 6.2% each for employee and employer on wages to $184,500;
- Medicare at 1.45% each with no wage limit;
- employee-only Additional Medicare withholding at 0.9% after the employer's $200,000
  withholding threshold; and
- FUTA at 6% on the first $7,000 of wages.

FUTA state credit eligibility and credit-reduction-state status are external facts. Without
an evidenced caller-supplied credit, the component is explicitly `US_FUTA_GROSS` at 6%. A
supplied credit is restricted to 0%-5.4% and produces `US_FUTA_NET`. State and local income
tax, state unemployment, disability, and paid-leave programs are not calculated and are
always reported as a regulated gate.

Not implemented: pre-2020 W-4 allowances, nonresident-alien adjustments, tipped wages,
household/agricultural/railroad employment, third-party sick pay, group-term life special
timing, state/local rules, and employment classifications/exemptions.

## Filing and export implications

Calculation output is not a filed return. Future exporters should consume immutable posted
pay-run snapshots rather than recalculate historical payroll.

- Canada: [T4001](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html)
  requires employers to deduct, remit, and report payroll amounts, and T4 returns are due by
  the last day of February following the calendar year. CRA requires electronic filing when
  more than five slips are filed. Custom file exports must follow the current [CRA XML
  specifications](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/xml-specs.html)
  and include the applicable T619 transmittal record.
- Quebec: more than five RL slips of the same type must use an online method under Revenu
  Quebec's [filing-method table](https://www.revenuquebec.ca/en/businesses/rl-slips-and-summaries/filing-rl-slips-and-summaries/methods-for-filing-rl-slips-and-summaries-based-on-number-of-slips-and-summaries/).
  A production design needs separate RL-1/RLZ-1 data and reconciliation, not only federal T4
  output.
- United States: Form 941 is generally quarterly; Form 940 is the annual FUTA return; W-2/W-3
  report annual employee wages. The [2026 W-2/W-3 instructions](https://www.irs.gov/instructions/iw2w3)
  apply the aggregate 10-information-return e-file threshold. SSA publishes the official
  [2026 EFW2/EFW2C specifications](https://www.ssa.gov/employer/EFW2%26EFW2C.htm), Publications
  42-007 and 42-014.

Export work must include schema-version pinning, validation against government XSD/record
specifications, deterministic control totals, amendment/cancellation flows, submission
receipt storage, and reconciliation to the payroll liability ledger. No filing or remittance
API is included in this calculator.

## Open-source component and licence evaluation

No third-party payroll code was copied or linked. The local engine was derived from the
official statutory publications above.

| Project        | Primary project evidence                                        | Licence  | Decision                                                                                                                                                                |
| -------------- | --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payroll Engine | [Project overview](https://payrollengine.org/About/)            | MIT      | Permissive, but the current .NET/SQL Server and C# scripting architecture is a poor runtime fit for this TypeScript/Postgres service. Keep as a design reference only.  |
| Frappe HRMS    | [Official repository](https://github.com/frappe/hrms)           | GPL-3.0  | Broad HR/payroll product in Python/Frappe. Do not embed or copy; runtime and copyleft boundaries are unsuitable for this isolated engine.                               |
| OpenFisca      | [Official licence page](https://openfisca.org/doc/license.html) | AGPL-3.0 | Strong rules-as-code concepts, but network copyleft and Python runtime make direct incorporation inappropriate without a separate legal/product decision. No code used. |

## Release gates

Before enabling any jurisdiction for production paycheques:

1. Obtain payroll-domain and legal review of every supported case and exclusion.
2. Add exact fixtures covering bracket boundaries, all claim/W-4 variants, annual caps,
   employee starts/stops, taxable benefits, special payments, and government reference
   calculators.
3. Store immutable input/output snapshots with rule-pack identity and audit provenance.
4. Add a controlled rule-pack update and rollback process with dual-run variance reports.
5. Implement liability posting, remittance reconciliation, year-end exports, amendments,
   and filing acknowledgement retention before claiming filing support.
6. Fail closed whenever required employee, employer, province/state, YTD, or exemption facts
   are absent.
