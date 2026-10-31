# I9 online payments for local installs — completion report

Date: 2026-09-12  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`

## Result

The local-install own-account payment increment is implemented and packaged in
a separate supervised beta candidate. Stripe and Square use durable provider-
hosted payment links; PayPal remains the owner-supplied static-link/manual path.
The durable link is attached to the current invoice document, is reissued only
after the previous active link is deactivated, and is settled through the same
exact-money accounting and idempotency path as hosted checkout.

The frozen `0.14.0.15` installer and the existing `0.14.0.16` candidate were not
modified.

## Implementation

- Added own-account payment credentials and durable `PaymentLink` persistence,
  tenant RLS, grants, indexes, and the two migrations ending at migration 129.
- Added official Stripe and Square SDK adapters with exact minor-unit handling,
  idempotency, one-completion limits, status polling, fee capture, and safe
  deactivation. Provider errors are sanitized before they cross the API.
- Added account save/list, durable-link create/list, polling, invoice-PDF
  regeneration, and the scheduled I6 polling job.
- Added public-document URL safety checks that reject loopback, private,
  link-local, local-domain, credential-bearing, and malformed payment URLs.
- Added the owner-facing account and durable-link controls in the web payment
  workspace.
- Added an explicit 30-second integration hook timeout. The prior 10-second
  default was too tight for the full Windows disposable-database suite.

## Evidence

- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed, including Prisma generation, web assets, API, and all
  workspace packages.
- `pnpm test`: passed — 18 native tests, 7 web tests, 9 shared tests, 35
  accounting-core tests, and 280 API tests.
- Own-account provider emulator tests: 2/2 passed against the real installed
  Stripe and Square SDK clients.
- Focused API tests after the I9 changes: 21/21 passed.
- I9 disposable vertical integration: 1/1 passed. It creates an organization,
  posts an invoice, saves an emulated Stripe account, creates and replays a
  durable link, renders its PDF, polls a paid status, posts one payment, and
  proves a second poll does not duplicate it.
- Focused Phase 11: 12/12 passed. Focused Phase 12: 21/21 passed.
- Browser I9 smoke: 1/1 passed on a fresh disposable database, including
  narrow, tablet, desktop, forced-colors, console-error, accessibility, and
  performance contract checks.

The full 48-file integration suite was run twice. Both runs reached 46/48 files
and 253/255 tests. The two failures were intermittent `Can't reach database
server at localhost:5433` errors from the local disposable PostgreSQL service;
the affected Phase 10, Phase 11, Phase 12, and demo-company suites pass when
run alone, and the container is currently healthy. This is not reported as a
clean full-suite pass.

## Installer candidate

Transfer folder:

`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.17`

Files:

- `PennyWise-Beta-04-Setup.exe`
- `PennyWise-Beta-04-Setup.exe.sha256`
- `START-HERE.txt`

Installer size: 273,147,408 bytes  
SHA-256: `33d6e448445f78dbe6ebb32616abaa793be2d27bb83eb5e73019e329e666ed82`  
Signature: valid, `CN=PennyWise Accounting QA`  
Beta slot: 04

The setup embeds the QA certificate, Microsoft-signed VC++ x64 runtime,
PostgreSQL, application, and one offline activation. It has not been installed
on a fresh Windows 10/11 host in this session. The folder's `START-HERE.txt`
contains the hash check and the supervised test checklist.

## Remaining gates

No live Stripe/Square/PayPal provider acceptance, clean-machine install,
external accounting acceptance, or real customer email acceptance is claimed.
PayPal dynamic own-account links remain intentionally out of scope. The
installer is ready for supervised transfer testing, not public release.
