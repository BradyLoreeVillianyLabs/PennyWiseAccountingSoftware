# U3 — Sales landing

- **Engine:** Codex · **Wave:** 2 · **Slot:** 8 · **Branch:** `ui/sales`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §3 (skeleton, Sales row, click budgets)
- **Owns:** `src/workspaces/sales.js`, `src/partials/sales.html`, `styles/sales.css`, `e2e/sales.*.spec.ts`

## Deliverables (flag on)

- **KPIs:** Outstanding, Overdue, Paid 30d, Avg days to pay.
- **Pipeline:** Estimate → Draft → Sent → Overdue → Paid. Counts are links that filter the list.
- **List and inspector:** a dense list (25 rows, keyboard navigation, search, one chip row, bulk "Send
  reminders"). The inspector shows a summary, the next-step button, activity, attachments and "More ▾".
- **Task panel:** the invoice composer opens in the right-side TaskPanel, not inline. Classes,
  multi-currency, custom numbering and tax overrides sit under "More options". "Add new customer" is an
  inline quick-create inside the panel.
- **Move the customer and product forms off this page:** customers go to Contacts and products to a More →
  Products entry. Move the existing nodes; do not recreate them.
- **Primary action:** New invoice. Everything else goes under ⋯.

## Acceptance

- Click budgets (Playwright, using `e2e/support/click-budget.ts`):
  - create and send an invoice in ≤ 6 clicks on one screen;
  - record a payment received in ≤ 4 clicks.
- ≤ 12 visible buttons on the landing (`landing-density.ts`).
- Existing invoice, estimate and payment specs pass unchanged with the flag off **and** on.
- Update the research matrix module `sales-invoicing-estimates-and-payments`.
