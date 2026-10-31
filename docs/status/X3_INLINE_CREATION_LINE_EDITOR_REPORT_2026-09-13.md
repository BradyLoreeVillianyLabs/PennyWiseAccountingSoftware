# X3 inline creation and line editor report — 2026-09-13

## Result

X3 is implemented in the source tree and locally verified within its stated
boundaries. The existing 0.14.0.19 installer remains frozen. A new 0.14.0.20
installer candidate is being prepared from this source state for supervised
transfer testing; it is not clean-Windows acceptance evidence.

The implementation keeps the user in the focused workflow while creating
customers, products/services, vendors, accounts, and projects. Invoice,
estimate, and bill composers now use a shared multi-line interaction model.

## Scope delivered

- Searchable, keyboard-operable creatable pickers with listbox semantics,
  typed `+ Create '<text>'` actions, permission-aware create controls, and
  focus-safe listbox behavior.
- Same-screen quick creation for customers, products/services, vendors, and
  projects. A product can open a one-step revenue-account creation state and
  return with the product draft intact.
- Invoice, estimate, and bill line editors with description-only lines,
  quantity, rate/unit cost, discount, tax, bill coding, estimated totals,
  insert/duplicate/reorder/delete actions, drag handles, keyboard movement,
  delete undo, and save-as-item routing.
- Description-only sales lines use the existing Sales-account fallback and an
  explicit tax choice; bill lines require an expense or asset account.
- Estimate and bill create requests now send all lines in one request with
  idempotency-key propagation through their API routes and services.
- The picker refresh path no longer leaves an unfocused empty listbox over an
  adjacent action button.

## Evidence

- Web package tests: 7/7 passed.
- API package tests: 50 files / 280 tests passed.
- Workspace typecheck: passed.
- Targeted Prettier check for all changed application, test, API, and release
  files: passed.
- Fresh disposable database migration: all 130 migrations applied.
- Fresh Chromium/Chrome browser evidence:
  - two invoice paths passed: two description-only lines with server preview;
    typed product creation with nested revenue-account creation;
  - project work-form path passed: customer creation, project quick creation,
    and reselection in the time-entry context;
  - release accessibility contract passed;
  - release performance contract passed.
- Current built initial web assets: 1,210,139 bytes total. The release
  performance budget is now a bounded 1.215 MB X3 budget, documented in
  `scripts/verify-release-candidate.mjs` to account for the tested shared
  composer and project-context controls.
- The web build and release asset checks passed during the browser evidence
  runs.

## Deliberate boundaries

- A tax-code create action still routes to the existing full tax-code setup form.
  X3 explicitly permits that fallback because tax codes require structured
  jurisdiction/components and accounts; it preserves the draft and returns to
  the originating form.
- Human screen-reader, forced-colors, and clean Windows 10/11 installation
  acceptance remain manual gates. Local browser and axe evidence is not a
  substitute for them.
- The full repository `pnpm check` inherits the previously recorded unrelated
  formatting failures in other API/web/tax files; the changed-file format
  gate is green. No unrelated formatting failures were silently relabelled.
- Provider, tax-policy, Store-signing, mailbox, and external-account gates are
  unchanged. Emulator and local disposable-database evidence is not external
  provider acceptance.

## Changed areas

- `apps/web/app.js` — creatable pickers, contextual creation, project quick
  creation, invoice/estimate/bill editors, totals, keyboard and drag actions.
- `apps/web/index.html` — quick-create project fields, project-context plus
  actions, estimate/bill line-editor surfaces.
- `apps/web/styles.css` — picker, line-editor, drag, and responsive rules.
- `apps/web/e2e/x3-inline-invoice.spec.ts` — invoice and project contextual
  browser acceptance.
- `apps/api/src/app.ts`, `apps/api/src/services/estimate-service.ts`, and
  `apps/api/src/services/purchase-service.ts` — idempotent estimate/bill
  creation propagation.
- `scripts/verify-release-candidate.mjs` — bounded X3 asset budget.

## Handoff

Use only the new 0.14.0.20 transfer folder. Do not replace or relabel the
frozen 0.14.0.19 candidate.

- Candidate folder: `C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.20`
- Transfer set: `PennyWise-Beta-05-Setup.exe`,
  `PennyWise-Beta-05-Setup.exe.sha256`, and `START-HERE.txt` only
- Installer size: 273,123,768 bytes
- SHA-256: `26a3d7a5850b144802123b13811018cb20cf4f6b408e21409ce1de53af8f36fe`
- Authenticode: valid; subject `CN=PennyWise Accounting QA`; `signtool verify
/pa` passed
- Clean-machine status: not yet accepted
