import { describe, expect, it } from "vitest";
import { payrollProviderGates } from "./payroll-provider-gates.js";

describe("payroll provider gates", () => {
  it("keeps direct deposit and filing fail-closed until provider evidence exists", () => {
    const gates = payrollProviderGates();

    expect(gates.directDeposit).toMatchObject({
      capability: "directDeposit",
      enabled: false,
      status: "PROVIDER_REQUIRED",
      providerConfigured: false,
      providerApproved: false
    });
    expect(gates.directDeposit.blockers).toEqual(
      expect.arrayContaining([
        "PAYROLL_DIRECT_DEPOSIT_ADAPTER_NOT_IMPLEMENTED",
        "PAYROLL_DIRECT_DEPOSIT_PROVIDER_NOT_APPROVED"
      ])
    );
    expect(gates.directDeposit.requiredEvidence.length).toBeGreaterThanOrEqual(4);

    expect(gates.taxFiling).toMatchObject({
      capability: "taxFiling",
      enabled: false,
      status: "PROVIDER_REQUIRED",
      providerConfigured: false,
      providerApproved: false
    });
    expect(gates.taxFiling.blockers).toEqual(
      expect.arrayContaining([
        "PAYROLL_TAX_FILING_ADAPTER_NOT_IMPLEMENTED",
        "PAYROLL_TAX_FILING_JURISDICTION_PACK_NOT_ACCEPTED"
      ])
    );
    expect(gates.taxFiling.requiredEvidence.length).toBeGreaterThanOrEqual(4);
  });

  it("does not expose credentials or mutable provider configuration", () => {
    const serialized = JSON.stringify(payrollProviderGates());
    expect(serialized).not.toMatch(/secret|token|password/i);
  });
});
