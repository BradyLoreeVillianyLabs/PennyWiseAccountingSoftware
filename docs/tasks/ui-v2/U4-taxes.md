# U4 — Taxes landing (GST/HST and remittances)

- **Engine:** Codex · **Wave:** 2 · **Slot:** 12 · **Branch:** `ui/taxes`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §3 (Taxes row, GST/HST budget)
- **Owns:** `src/workspaces/taxes.js`, its partial, `styles/taxes.css`, `e2e/taxes.*.spec.ts`.
  The accountant tax tools in `accountant-workspace` are untouched and reachable via "Accountant tools".

## Deliverables (flag on)

- **KPIs:** Next return and its due date, Estimated owing, Last filed.
- **Filing calendar:** periods based on the configured filing frequency (annual, quarterly or monthly) and
  payroll remittance dates, from `/v1/ui/tax-calendar`. Due items feed the Home attention queue.
- **Pipeline:** Open period → Review → Filed → Paid. "Prepare return" opens the existing GST/HST summary
  in the TaskPanel with "Mark filed". Any existing filing and payment recording is reused, not rewritten.
- Show plain-language explanations with the CRA term as a subtitle.

## Acceptance

- Click budget: prepare GST/HST in ≤ 4 clicks from the Home attention row.
- The tax amounts shown equal the existing GST/HST report (contract test).
- No change to tax calculation code.
- Update the research matrix module `tax-and-compliance`.
