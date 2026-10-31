# H5 — Tax code configuration, and a tax report that can be filed from

> **Status: tasks 1–6 landed on 2026-09-05**, plus the report export and
> shipping revenue separation. The tax code screen, the
> save-time refusal of a component without a payable account, the pre-save
> preview of the accounts a sale will credit, the report's per-authority
> grouping and its table in the reports screen all exist, with an e2e spec.
> **Do not rebuild them.** What remains is listed under "Remaining work" at the
> foot of this file. The rest of the document is the specification they were
> built against.

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/tasks/destry-deployment/ACCOUNTING-DESIGN.md` — the design this implements
4. `apps/api/src/services/company-setup-service.ts:335-400` — `createTaxCodeVersion`
5. `apps/api/src/services/tax-calculation-service.ts:190-240` — the snapshot shape
6. `apps/api/src/services/invoice-service.ts:1095-1107` — how tax posts
7. `apps/api/src/services/phase10-report-service.ts:757-930` — `taxReport`
8. `packages/db/prisma/schema.prisma` — `TaxCode`, `TaxCodeVersion`, `TaxComponent`, `Account`
9. `docs/COMPETITIVE_RESEARCH_MATRIX.md` — tax entries

## Exact intention

PennyWise's tax engine is already right. A tax code has components; each
component carries a jurisdiction and its own payable account; the invoice journal
credits each component to that account and **refuses to post** if one is missing;
and every posted line keeps a snapshot of the whole decision with its source.

None of it is reachable. `POST /v1/setup/tax-codes/versions` has no screen —
`apps/web/` contains zero references to `tax-code`, `tax-component` or
`payableAccount`, and Setup → Tax records only a registration number. So a
Canadian seller cannot express "GST 5% to the CRA account, PST 7% to the BC
account", which is the mechanism the whole design depends on.

The second half: the tax report returns one aggregate reconciled against a single
control account, with no grouping by jurisdiction — even though every line's
snapshot already carries `components[].jurisdiction` and
`components[].payableAccountId`. Destry files GST/HST with CRA and PST with a
province on different schedules and cannot do it from this report.

Make both usable. Add no tax logic: the calculation, versioning, provenance and
posting rules already exist and are tested.

## Boundary conditions

- **No tax advice, and no rates in code.** The screen collects rates from the
  operator and requires the source name, URL and retrieval date the API already
  demands. Ship no preset rate table: rates change, and a stale hardcoded rate
  posted to a customer invoice is a liability.
- **Never let a tax code post to an unset account.** `invoice-service.ts:1101`
  already throws; the screen must make it impossible to save a component without
  a payable account rather than let the operator discover it at posting time.
- Versions are immutable and effective-dated with no overlap. Editing a rate
  creates a **new version**; it never rewrites a posted decision.
- `ZERO_RATED` and `EXEMPT` are not interchangeable — zero-rated preserves input
  tax credits, exempt does not. The UI must make the difference legible, not
  offer them as two similar words in a dropdown.
- Money stays in bigint minor units; rates are decimals with the schema's
  precision (`Decimal(9,6)`). Never a JavaScript `number`.

## Tasks

### 1. A tax code screen

In the Setup workspace beside the existing tax registration step, or in Company
settings — follow whichever the existing pattern makes natural.

- List existing tax codes with their current effective version, treatment, and
  the components with their jurisdictions and rates.
- Create a code: code, name, treatment, calculation mode.
- Add components: name, jurisdiction, rate, recoverable percent, **payable
  account**, recoverable account. The account fields are selects over the
  organization's accounts, filtered to plausible types.
- Effective from / to, with the API's overlap rule surfaced before submit rather
  than as a 409.
- Source name, source URL, retrieved date — required, because the API requires
  them and because a rate without a source is not auditable.
- A new version of an existing code, pre-filled from the current one.

### 2. Show what a code will do before it is used

Before saving, show the accounts a sale using this code would credit — component
by component. The operator is configuring double-entry consequences through a
form about percentages; make the consequence visible.

### 3. Group the tax report by jurisdiction

`taxReport` (`phase10-report-service.ts:757`) already reads every line's
`taxSnapshot`. Add a grouping over `components[].jurisdiction` and
`components[].payableAccountId`, giving per-jurisdiction collected, recoverable
and net figures, and reconcile **each group against its own payable account**
rather than only the single `tax-payable` control.

Keep the existing aggregate fields; add the breakdown. Do not change what the
existing numbers mean.

Note the constraint: `@@unique([organizationId, companyId, systemPurpose])` means
only one account can be the `tax-payable` control, so `isReconciled` today proves
only that the control account agrees. Once grouped, report reconciliation per
jurisdiction and say plainly which account each group was checked against.

### 4. Surface it in the report screen

The tax report UI shows the new breakdown as a table per jurisdiction with its
account, so a GST/HST return and a PST return can each be prepared from it.

### 5. Product default tax code

`ProductItem.defaultTaxCodeId` (`schema.prisma:2146`) drives the fallback in
`invoice-calculation.ts:99` and has no UI at all. Add it to the product forms
beside the existing `incomeAccountId` select.

### 6. Tests and documentation

- API and UI tests for: creating a code with two components posting to two
  accounts; a sale using it producing a journal that credits both; the overlap
  rule; and a component saved without a payable account being refused.
- A test asserting the report's per-jurisdiction totals sum to the existing
  aggregate — the breakdown must not disagree with the total.
- Update the tax entries in `docs/COMPETITIVE_RESEARCH_MATRIX.md` with the
  interaction contract.

## Constraints

- No new tax calculation. No change to `tax-calculation-service.ts` maths, to
  posting, or to the snapshot shape.
- No schema change should be needed. If one seems necessary, stop and report why.
- Vanilla JS and hand-written CSS matching the file's idiom; add styles in their
  own commented section.

## Acceptance criteria

- A non-developer can create `CA-BC` with a GST component posting to GST/HST
  payable and a PST component posting to PST payable — British Columbia, with
  sources recorded, without an API client.
- A sale using that code produces a balanced journal crediting both accounts, and
  the invoice's tax snapshot records both components.
- Saving a component with no payable account is refused in the form.
- The tax report shows per-jurisdiction collected/recoverable/net with the
  account each was reconciled against, and the groups sum to the aggregate.
- A product's default tax code can be set from the product form.
- `corepack pnpm lint`, `typecheck`, and the browser suite on a **fresh**
  database all pass.

## Out of scope

Rate tables and any tax content. A sales-tax remittance/filing workflow (record
what was filed, clear the liability against a payment) — related and valuable,
but a separate increment; `ACCOUNTING-DESIGN.md` §6 gap 3 describes it. Shipping
revenue separation (gap 4). US nexus determination, which is a decision for
Destry's accountant.

---

## Remaining work

Tasks 5 (product default tax code), the report export, and shipping revenue
separation were all completed on 2026-09-05 — see `ACCOUNTING-DESIGN.md`
"What was built". One item remains.

### A sales-tax filing register

**Correcting the earlier framing in this file:** remitting is _not_ blocked.
`AccountantService.createManualDraft` places no control-account restriction on
journal lines and is gated by `manual-journals:create`, so an accountant records
a remittance as a posted manual journal — debit the authority's payable account,
credit the bank. That is the "authorized accountant action" the `AGENTS.md`
control-account invariant names, and the tax report screen now explains it and
links to the accountant workspace.

What is missing is a **register**: which period was filed, with which authority,
for how much, on what date, and linked to the journal that paid it. Today that
history exists only as journal narrative.

This needs a new model and a migration, so it is a phase of its own rather than
an increment. It should be designed against `docs/ACCOUNTING_POSTING_RULES.md`
and should:

- record a filing per authority per period, with the amount and filing date;
- link it to the posted journal that cleared the liability, rather than posting
  anything itself — the existing manual journal stays the posting path;
- refuse to record a filing for a period that is not closed, or state clearly
  that it does not check;
- never alter a posted journal, and never let a filing record change a figure.

It is convenience and auditability, not capability. It was deliberately not
built alongside the rest: a schema change touching the tax liability story, days
from a client handoff, warrants its own authorized phase.
