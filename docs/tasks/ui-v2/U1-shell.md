# U1 — Shell: one navigation layer

- **Engine:** Claude Code · **Wave:** 1 · **Slot:** 2 · **Branch:** `ui/shell`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §1, §5 · **Owns:**
  `src/shell.js`, `src/nav.js`, `src/ui-kit/*`, the shell partial, and the tokens section of `styles.css`

## Deliverables (when `isUiV2Enabled()`)

1. Hide the top `workspace-navigation` bar. Do not delete it; classic mode still uses it.
2. A 7-item primary rail (Home, Sales, Expenses, Banking, Contacts, Taxes, Reports) driven by `tier`.
   Show a **More** flyout for `tier: "more"`, and put `tier: "admin"` items under ⚙.
3. **Settings → Features** toggles keyed by `featureKey`. Off hides the item from More but keeps deep links.
   Fold the Business/Accountant mode switch into two presets of these toggles.
4. Global **+ New** button with Ctrl+N: a menu of invoice, expense, bill, payment received, customer,
   vendor and journal entry (accountant preset only).
5. **Ctrl+K task finder** over every nav destination, every report, and the "+ New" actions.
6. Move utility controls (zoom, layout customizer, dock) into the ⋯ menu.
7. Implement the ui-kit components declared in U0 (KpiCard, Pipeline, ListInspector, TaskPanel,
   AttentionQueue, EmptyState), with keyboard and screen-reader support and a short demo e2e.
8. A "Switch back to classic layout" link in Settings and a "Try the new layout" banner in classic mode.

## Acceptance

- ≤ 10 visible rail items in the default (owner) preset (`railItemsOwnerMode` in metrics).
- Every classic destination is reachable in ≤ 2 clicks or through Ctrl+K. Test this with
  `e2e/shell.reachability.spec.ts`, which iterates every `data-workspace-target`.
- With the flag off, the UI is unchanged: all existing specs pass.
- Update the research matrix entry for **navigation-settings-appearance-and-owner-mode**.
