# U3 — Expenses landing (purchases, bills, receipts)

- **Engine:** Codex · **Wave:** 2 · **Slot:** 9 · **Branch:** `ui/expenses`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §3 (Expenses row, click budgets)
- **Owns:** `src/workspaces/expenses.js` (the classic `purchases-workspace`), its partial, `styles/expenses.css`,
  and `e2e/expenses.*.spec.ts`. Keep the `purchases-workspace` id and its `data-workspace-target`.

## Deliverables (flag on)

- **KPIs:** Bills due in 7 days, Overdue bills, Spent 30d, Receipts to review.
- **Pipeline:** Receipt inbox → Draft bill → Awaiting payment → Paid.
- **List and inspector:** the receipt and bill list with an inspector showing the attachment preview.
- **Task panel:** "New expense" drops a receipt, then sets category and saves. Bill entry and bill
  payment also live here. Inline vendor quick-create.
- **Bulk pay:** Due 7d → select → Pay.
- **Rename the label only:** "Payables & purchases" becomes "Expenses". Ids are unchanged.

## Acceptance

- Click budgets:
  - enter an expense or receipt in ≤ 5 clicks;
  - pay bills in ≤ 4 clicks.
- ≤ 12 visible buttons. The existing AP, bill and receipt specs pass with the flag off and on.
- Update the research matrix module `purchases-expenses-and-accounts-payable`.
