# D6 Destry Workwear go-live drill — engineering report

Date: 2026-09-02  
Repository: `C:\Users\EmceeHax\Desktop\clearledger-src`  
Authorization: D6 was recorded as the sole active Destry Workwear deployment
phase in `docs/status/CURRENT_PHASE.md` after the D5 report.

## Result

**The D6 engineering runbook and evidence controls are complete, but go-live
acceptance is not complete.** The repository now has an ordered cutover runbook,
a redacted evidence-ledger template, and a validator that refuses unsupported
PASS claims. The available local automated checks pass. The required real-store,
clean/disposable-machine, physical-device, and non-developer evidence could not be
performed in this environment and is explicitly left unverified.

This is an intentional evidence stop. No live Destry Workwear data, credentials,
provider responses, customer information, labels, or screenshots were copied into
the repository, and no production cutover was attempted.

## Implemented D6 surface

- `docs/D6_GO_LIVE_RUNBOOK.md` gives the owner an ordered store-preparation,
  read-only connection, review/import, tax, opening-balance, end-to-end order,
  backup/restore, lifecycle-drill, human-acceptance, cutover, rollback, and weekly
  operating procedure. It marks the point of no return and the stop conditions.
- `scripts/verify-d6-evidence.mjs` validates the exact 15-drill evidence set,
  rejects duplicate/unknown drills, secret-like fields, and PASS entries without
  evidence reference, operator, environment, and timestamp. `--require-complete`
  is available only for the final owner evidence file and does not manufacture
  evidence.
- `scripts/verify-d6-evidence.test.mjs` covers a valid unverified ledger, missing
  PASS evidence, duplicate IDs, and secret-like fields.
- `docs/status/D6_DRILL_EVIDENCE_TEMPLATE.json` is a sanitized 0/15 starting
  ledger. `docs/COMPETITIVE_RESEARCH_MATRIX.md` adds the D6 go-live module record
  with WooCommerce, PostgreSQL, and owner-acceptance references.

## Verified local evidence

| Check                                      | Result                                                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D6 evidence validator tests                | **Passed: 3 tests.**                                                                                                                                                                         |
| Evidence template validation               | **Passed structurally: 0/15 drills currently PASS.** The command states that unverified/not-run entries are not passes.                                                                      |
| Backup/restore database drill              | **Passed:** dev PostgreSQL was archived and restored into disposable `clearledger_restore_verify_d6_20260902`; 112 migrations were present; the exact target was dropped after verification. |
| Full PostgreSQL integration                | **Passed: 42 files, 242 tests**, including D2-D5 and concurrency/tenant/accounting checks.                                                                                                   |
| Full workspace unit/general suite          | **Passed:** native 8, web 6, shared 9, accounting-core 35, API 220 tests.                                                                                                                    |
| Root typecheck                             | **Passed:** repository and web E2E TypeScript checks.                                                                                                                                        |
| API/database builds                        | **Passed** for `@clearledger/api` and `@clearledger/db` TypeScript builds.                                                                                                                   |
| Web asset build and accessibility contract | **Passed:** verified/minified assets and release accessibility contract.                                                                                                                     |
| Source-only lint                           | **Passed** with generated clients and archived review snapshot excluded.                                                                                                                     |
| Prisma schema validation                   | **Passed** with the development `DATABASE_URL` supplied.                                                                                                                                     |
| Competitive research verifier              | **Passed:** 21 PennyWise module baselines.                                                                                                                                                   |
| D6 touched-file formatting                 | **Passed.** Repository-wide format remains open on 13 pre-existing/shared files and `pnpm-lock.yaml`.                                                                                        |

## Required acceptance evidence still open

All entries in the sanitized template remain `UNVERIFIED` because local fixture
tests are not substitutes for D6’s required real-store and human drill:

- no owner-approved, read-only WooCommerce key or live `destryworkwear.com`
  connection was supplied; the known 2026-09-01 catalog discrepancy remains an
  owner action (three `/shop/` products, two public Store API products, no SKUs);
- catalog import timing, tax-to-the-cent comparison, opening-balance agreement,
  and the complete real order → invoice → pick/pack → label → shipment trace were
  not run;
- packaged Windows backup/restore, restart, upgrade-over-install, uninstall with
  data preserved, physical PDF/ZPL print, and Store/signing acceptance require a
  clean supported Windows machine and verified artifacts;
- refund and post-posting cancellation drills require an owner-approved test store
  or provider environment; short-pick is locally fixture-covered but was not
  performed as the owner’s machine drill; and
- a non-developer has not completed the owner scripts unaided, including keyboard,
  screen-reader, 200% zoom, high-contrast, and reduced-motion passes.

The normal Prisma generation path remains blocked in this working tree by the
locked Windows native engine rename (`EPERM`). The D5-generated client workaround
was used for local verification; no owner process was terminated. This and the
repository-wide format warnings keep the aggregate `pnpm check` open.

## Owner completion procedure

On a disposable machine, follow `docs/D6_GO_LIVE_RUNBOOK.md`, replace only the
corresponding template entries with sanitized evidence, and run:

```powershell
corepack pnpm test:d6:evidence -- <redacted-evidence.json> --require-complete
```

Then attach the release/package hashes, migration and report reconciliation, test
store/key revocation record, lifecycle logs, and human UAT/accessibility record to
the owner’s protected evidence location. The owner decides whether to cross the
cutover point; this report grants no production authorization.

## Stop condition

D6 engineering work stops here pending the external evidence above. D1-D5 open
provider, tax, clean-machine, Store, physical-printer, rollback, and production
gates remain open. No subsequent deployment phase is authorized or required by
this report.
