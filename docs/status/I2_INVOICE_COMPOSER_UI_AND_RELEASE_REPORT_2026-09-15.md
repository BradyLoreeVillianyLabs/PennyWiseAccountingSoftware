# I2 invoice composer UI and release-candidate report — 2026-09-15

## Result

The invoice and estimate composers now have an essentials-first layout for fast
data entry. The customer and line editors remain in the primary flow; optional
FX, message, terms, payment-method, branding, and preview sections are
collapsed until requested. Preview no longer competes with the editor or
obscures fields.

This is a new source increment and requires a new installer candidate. The
previously tested 0.14.0.22 installer remains unchanged.

## Delivered

- Added a short, owner-editable estimate number at creation time. Automatic
  numbers use the organization estimate prefix and locked sequence; custom
  values are validated, duplicate-safe, and immutable after creation.
- Kept legal invoice numbers server-assigned at finalization and removed
  internal UUIDs from customer-facing draft headers, rows, email subjects, and
  previews. Draft documents display `DRAFT`.
- Added a compact estimate-number guidance/status treatment and matching
  invoice draft-number status.
- Added controlled customer-facing formatting for notes, terms, branding,
  instructions, and signature text: headings, bullets, bold, italic, and inline
  code are supported; raw HTML is escaped and never executed.
- Added print-safe invoice template variations and three quick picks: Signature,
  Studio, and Ledger. Existing saved template keys remain compatible.
- Made invoice/estimate preview explicitly optional and opened only by the
  preview action; the preview still uses the exact rendered document path.
- Added focused tests for sequence concurrency, custom estimate numbers,
  duplicate rejection, immutable updates, UUID-free drafts, escaping, rich text,
  and PDF output.

## Verification

- `corepack pnpm --filter @clearledger/api exec vitest run src/invoice-documents.test.ts` — 16/16 passed.
- `corepack pnpm --filter @clearledger/api run typecheck` — passed.
- `corepack pnpm --filter @clearledger/web run test` — 7/7 passed.
- `corepack pnpm --filter @clearledger/web run build` — passed.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm --filter @clearledger/api run lint` — passed.
- `corepack pnpm test:research` — passed for 21 modules.
- Fresh disposable integration database: 3/3 Phase 17 sales tests passed,
  including concurrent estimate allocation and custom-number validation.
- Regular Playwright fallback smoke passed for description-only invoice lines,
  missing-product handling, and the essentials-first composer flow. The browser
  connector was unavailable in this session.
- Visual QA used a generated reference concept plus fresh screenshots of the
  composer and opened preview; both were inspected and the preview showed
  `DRAFT` without an internal UUID.

## Research alignment

The competitive translation is recorded in
[COMPETITIVE_RESEARCH_MATRIX.md](../COMPETITIVE_RESEARCH_MATRIX.md). The main
reference points were QuickBooks guidance for estimates, form customization,
and transaction numbering. PennyWise adopts the useful parts—fast entry,
short estimate sequences, deliberate form styles, and visible preview—without
introducing unrestricted HTML or changing immutable legal invoice numbering.

## Remaining release boundary

The new candidate still requires the normal supervised clean Windows 10/11
install and first-run acceptance on a physical test machine. This report does
not claim that evidence. The installer build below is self-contained and uses
the existing free QA certificate and beta activation slot; no paid signing key,
Docker, Node.js, PostgreSQL, Redis, or external account is required on the
test machine.
