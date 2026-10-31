# Wave 1 — Research lane (competitive research matrix)

- **Engine:** GitHub Copilot `research` agent · **Wave:** 1, then on request · **Branch:** `ui/research`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Owns:** `docs/COMPETITIVE_RESEARCH_MATRIX.md`

AGENTS.md requires an updated research record before any module changes. This lane pre-fills those
records so Wave 2 streams are not blocked.

## Deliverables

For each module below, update its record with: the observed workflow in QuickBooks Online, Xero,
FreshBooks, Wave, Zoho Books and Sage (cite primary docs); the PennyWise translation (from 02); deliberate
exclusions; and acceptance coverage (the stream's e2e spec names).

- navigation-settings-appearance-and-owner-mode (U1)
- reporting-budgeting-and-insights (Home, charts, Reports)
- sales-invoicing-estimates-and-payments
- purchases-expenses-and-accounts-payable
- banking-reconciliation-and-cashflow
- crm-contacts-projects-and-time
- tax-and-compliance (include CRA GST/HST filing frequencies and payroll remittance schedules, primary sources)
- table-grid-and-workspace-experience

Reuse `docs/pennywise/declutter/UX_RESEARCH_FINDINGS.md`; do not re-research what is already cited there.
Never copy proprietary wording or assets.

## Acceptance

- `corepack.cmd pnpm test:research` passes.
- One PR into `ui/integration`.
- Later Wave 2 requests arrive as comments on this stream's issue.
