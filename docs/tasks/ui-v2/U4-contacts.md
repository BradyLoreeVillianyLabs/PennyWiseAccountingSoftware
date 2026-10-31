# U4 — Contacts landing (customers, vendors, CRM)

- **Engine:** Codex · **Wave:** 2 · **Slot:** 11 · **Branch:** `ui/contacts`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §3 (Contacts row)
- **Owns:** `src/workspaces/contacts.js`, its partial, `styles/contacts.css`, `e2e/contacts.*.spec.ts`.
  CRM and calendar code under `projects-workspace` stays in place; link to it and embed the CRM tab.

## Deliverables (flag on)

- **KPIs:** Customers owing, Vendors owed, New this month.
- **Segment tabs:** Customers / Vendors / All. The CRM activity view is a tab, not a separate rail item.
- **List and inspector:** the inspector shows balance, open documents, last activity, and the actions
  New invoice, New bill and Log activity.
- Receive the customer form moved from Sales and the vendor form from Expenses. Coordinate the node move
  with those streams through issues, then move the nodes; do not recreate them.

## Acceptance

- New contact in ≤ 3 clicks.
- Every classic customer, vendor and CRM spec passes with the flag off and on.
- ≤ 12 visible buttons.
- Update the research matrix module `crm-contacts-projects-and-time`.
