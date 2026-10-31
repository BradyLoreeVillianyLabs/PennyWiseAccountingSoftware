# C4 — A verifiable period package for the accountant

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`

**Files:**

- `organization-portability-service.ts`
- `phase10-report-service.ts`: the report exports
- `accountant-service.ts`
- `journal-service.ts`: manual-journal drafts
- `fixed-asset-service.ts`
- `apps/web/app.js`, `apps/web/index.html`

**Closes:** differentiator C4 in `ASSESSMENT.md` section 5
**Effort:** M
**Depends on:** nothing hard. U2 is recommended, because its CSV exports and ledger browser
are reused.

## Why this can beat competitors

- **A local-install business still has an accountant.** Cloud products solve that by
  inviting the accountant into the app; a local install can't do that easily.
- **So hand over something better:** one reproducible, checksummed package that ties out,
  plus a safe way to bring the accountant's adjustments back.
- **The QuickBooks gap review asks for it.** It names an accountant "engagement package"
  as a gap (`docs/QUICKBOOKS_DESKTOP_FEATURE_GAP_REVIEW_2026-08-13.md`, "Accountant
  collaboration").

**Before building:** verify how comparable products export year-end data for accountants,
and record it in the research matrix.

## Tasks

1. **"Prepare package for my accountant"** in the accountant or reports area. The user
   chooses a fiscal year or period. The package contains:
   - trial balance, general ledger detail, profit and loss, and balance sheet, as CSV and
     printable PDF where the renderers exist;
   - AR and AP aging at period end;
   - the GST/HST summary and workpaper for the period, using existing tax reports;
   - bank-reconciliation reports for every account;
   - the fixed-asset register, and the manual and adjusting journals;
   - an audit-event CSV for the period;
   - an attachments index, with the attachments themselves optional (size warning);
   - `manifest.json` with the organization, period, generation time, period-close status,
     and the **SHA-256 of every file**;
   - a `README.txt` for the accountant, explaining what each file is.
2. **Tie-out checks,** run before the package is produced:

   - The TB balances.
   - GL detail sums to the TB.
   - AR/AP aging equals the control accounts.
   - Every bank account is reconciled to the period end, or listed as an exception.

   Failures appear in a "before you send" list; they don't block the package, but they are
   recorded in the manifest.

3. **Reproducibility.** The same period and data must produce byte-identical files. Only
   `generatedAt` in the manifest may differ; exclude it from a stated "content hash".
4. **Import back:** a CSV template for the accountant's adjusting entries. Importing it
   creates **manual-journal drafts** in the accountant workbench for owner review. **Never
   posts.** Validation errors are reported per row.
5. **Delivery:** download the ZIP, or send it through I4 as an attachment, subject to a
   size limit.

## Constraints

- **Figures come from the ledger** and the existing report services. Nothing is recomputed
  in the package builder.
- **Permissions:** generating the package requires report and export permissions. The
  audit CSV requires accountant permissions.
- **Secrets:** no secrets or bank credentials anywhere in the package. The I3 bank details
  appear only if the owner opts in.

## Acceptance criteria

- **Reproducible build (integration):** generating twice produces identical per-file
  hashes, and the manifest hashes verify.
- **Tie-outs:** they pass on the full demo company (`scripts/seed-full-demo-company.mjs`).
  A deliberately unreconciled account appears as an exception.
- **Import back:** a sample adjustment CSV creates drafts only, the ledger is unchanged, and
  a bad row is reported.
- **E2E:** generate the package → the ZIP downloads → the manifest lists every file.

## Out of scope

- Accountant accounts or logins.
- File formats from other vendors (QBX, QBA and similar).

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
