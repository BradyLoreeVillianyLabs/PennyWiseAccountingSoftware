/**
 * Provider boundary for regulated payroll side effects.
 *
 * Payroll calculation and review are native capabilities. Moving funds and
 * submitting statutory filings are separate accountable stages and must not be
 * inferred from a configured bank account or a posted payroll run. This
 * contract gives the UI and release evidence one stable, non-secret way to
 * describe those gates while the provider adapters are still scaffolded.
 */

export type PayrollProviderCapability = "directDeposit" | "taxFiling";
export type PayrollProviderGateStatus = "PROVIDER_REQUIRED" | "READY";

export interface PayrollProviderGate {
  readonly capability: PayrollProviderCapability;
  /** Remains false until an approved provider adapter is implemented and accepted. */
  readonly enabled: false;
  readonly status: PayrollProviderGateStatus;
  readonly providerConfigured: false;
  readonly providerApproved: false;
  readonly blockers: readonly string[];
  readonly requiredEvidence: readonly string[];
}

export interface PayrollProviderGates {
  readonly directDeposit: PayrollProviderGate;
  readonly taxFiling: PayrollProviderGate;
}

const DIRECT_DEPOSIT_BLOCKERS = Object.freeze([
  "PAYROLL_DIRECT_DEPOSIT_ADAPTER_NOT_IMPLEMENTED",
  "PAYROLL_DIRECT_DEPOSIT_PROVIDER_NOT_APPROVED",
  "PAYROLL_DIRECT_DEPOSIT_BANK_ACCEPTANCE_NOT_VERIFIED"
] as const);

const DIRECT_DEPOSIT_EVIDENCE = Object.freeze([
  "provider contract and supported jurisdictions",
  "tenant-bound encrypted credential and consent record",
  "idempotent submission with provider acknowledgement",
  "reconciliation and failure/retry evidence",
  "legally reviewed beta acceptance on a disposable account"
] as const);

const TAX_FILING_BLOCKERS = Object.freeze([
  "PAYROLL_TAX_FILING_ADAPTER_NOT_IMPLEMENTED",
  "PAYROLL_TAX_FILING_PROVIDER_NOT_APPROVED",
  "PAYROLL_TAX_FILING_JURISDICTION_PACK_NOT_ACCEPTED"
] as const);

const TAX_FILING_EVIDENCE = Object.freeze([
  "provider or government endpoint contract and jurisdiction coverage",
  "tenant-bound encrypted credential and filing consent record",
  "idempotent submission with durable receipt",
  "amendment, rejection, retry, and reconciliation evidence",
  "legally reviewed fixtures and remittance acceptance"
] as const);

function gate(
  capability: PayrollProviderCapability,
  blockers: readonly string[],
  requiredEvidence: readonly string[]
): PayrollProviderGate {
  return Object.freeze({
    capability,
    enabled: false,
    status: "PROVIDER_REQUIRED",
    providerConfigured: false,
    providerApproved: false,
    blockers,
    requiredEvidence
  });
}

/** Return a stable, non-secret provider readiness contract. */
export function payrollProviderGates(): PayrollProviderGates {
  return Object.freeze({
    directDeposit: gate("directDeposit", DIRECT_DEPOSIT_BLOCKERS, DIRECT_DEPOSIT_EVIDENCE),
    taxFiling: gate("taxFiling", TAX_FILING_BLOCKERS, TAX_FILING_EVIDENCE)
  });
}
