# U3 — Banking landing

- **Engine:** Codex · **Wave:** 2 · **Slot:** 10 · **Branch:** `ui/banking`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §3 (Banking row, click budgets)
- **Owns:** `src/workspaces/banking.js`, its partial, `styles/banking.css`, `e2e/banking.*.spec.ts`

## Deliverables (flag on)

- **KPIs:** Cash across accounts, To review, Unreconciled since, Last import.
- **Pipeline:** Import → Review/match → Categorized → Reconciled.
- **Review mode:** a keyboard-first list. The suggested match or category is preselected and **Enter
  accepts**. Arrow keys move between rows; `E` edits in the inspector; `S` splits; `X` excludes. Show a
  progress counter.
- **Reconcile:** opens in the TaskPanel against the statement balance. The existing reconciliation logic
  is unchanged.
- **Import:** CSV, OFX and QFX through one "Import" primary action with a drop target.

## Acceptance

- Click budget: categorize a bank transaction with ≤ 1 keystroke per transaction (10-line fixture).
- ≤ 12 visible buttons. The existing import, match and reconcile specs pass with the flag off and on.
- Update the research matrix module `banking-reconciliation-and-cashflow`.
