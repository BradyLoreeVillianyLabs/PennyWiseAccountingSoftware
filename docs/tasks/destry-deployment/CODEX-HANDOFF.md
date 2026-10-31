# What to hand to Codex — 2026-09-05

A split of the remaining Destry Workwear work between this session and Codex,
with the exact files to paste. `AGENTS.md` still requires the owner to record a
task as the active phase in `docs/status/CURRENT_PHASE.md` before Codex runs it,
one phase per session.

## Current controlling continuation — 2026-09-08

This update controls the package work below. Do **not** resume H2 from the older
MSIX `.13` candidate or treat its build-machine evidence as a clean-machine pass.
The owner's current authorized H2 artifact is the direct, self-contained Inno
Setup beta at:

`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.15`

Transfer only its three files: `PennyWise-Beta-02-Setup.exe`, matching `.sha256`,
and `START-HERE.txt`. The signed executable is version `0.14.0.15`, BETA_20 slot
02, and has SHA-256
`7f0d0a6ae0c17ab1092dfd5db99ed3558c3b9be76d0b49ef191b3f9b88b84211`.

What is already verified for this exact candidate:

- stable Inno Setup 6.7.3 compiled the setup; its Authenticode signature is
  valid under `CN=PennyWise Accounting QA`;
- the exact staged payload provisioned slot 02 in a disposable local profile,
  copied its private PostgreSQL runtime, applied migrations, and returned HTTP
  200 from API and web;
- direct backup produced a matching checksum; the generated scheduled-task
  wrapper calls the installed backup executable rather than a `WindowsApps`
  path; controlled shutdown removed the runtime state, lock, PostgreSQL process,
  and test task;
- `node --test distribution/windows-native/native-operations.test.mjs` passed
  14/14;
- owner field reports confirm this exact EXE installed and launched on fresh
  Windows 11, continued to work after reboot, and installed successfully on a
  second independent Windows system from the removable-drive transfer folder. See the
  [field report](../../status/H2_CLEAN_INSTALL_FIELD_REPORT_2026-09-08.md);
  detailed prompt and host metadata were not captured.

What remains H2 work, and must be reported as unverified or deferred until run:
captured prompt wording and host metadata, Windows update, disk-full handling,
interruption, second launch, second-beta upgrade, unattended backup,
cross-machine restore (deferred by the owner), corrupt-backup refusal, and
uninstall. The self-signed QA route permits supervised UAC and SmartScreen
acceptance after the hash check; it does not permit disabling Windows security or
preinstalling dependencies as a workaround.

Read [the current candidate report](../../status/H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md)
and [the direct-installer evidence template](../../status/H2_DIRECT_INNO_ACCEPTANCE_EVIDENCE_TEMPLATE_2026-09-08.md),
then the transfer folder's `START-HERE.txt`, before touching the artifact. Keep
0.14.0.15 frozen. Claude's pending product-gap work belongs in a later second
beta, not this transfer folder. A later update for this same participant reuses
the issued slot-02 activation. For a different tester, operationally issue and
track an unused slot, but do not claim the current offline package prevents
copying: slot 02 has been reported to work on two systems. Every repair gets a
later four-part version and a new evidence record.

## Hand to Codex, in this order

### 1. `H1` remaining work — the shipping increment

Paste `H1-fulfilment-operator-ui.md`. Its header says a first implementation has
landed and must not be rebuilt; the "Remaining work" section at the foot is the
task. In short:

- shipment create → quote → purchase → void, driven from the fulfilment
  workspace against `/v1/invoices/:id/shipment` and `/v1/shipments/:id/*`;
- short-pick handling (`/v1/picking-slips/:id/short-pick`);
- order status through the loop (converted / picked / shipped) derived from
  existing data, not a new column;
- the commerce and shipping entries in `docs/COMPETITIVE_RESEARCH_MATRIX.md`.

The care point: `shipmentPurchaseSchema` requires `confirmed: true`, a service
code, the quoted cost and currency, and an **expense account, paying account,
method and date**. Buying postage records an expense, so this needs real account
pickers and a confirmation that states exactly what will be posted. It is the one
place in this workspace where an action writes to the books, and it must look
like it.

### 2. `H5` — tax configuration and a filable tax report

Paste `H5-tax-configuration-and-remittance.md`, with
`ACCOUNTING-DESIGN.md` as its context.

This is the highest-value accounting gap. PennyWise's tax engine is already
correct — components carry a jurisdiction and their own payable account, the
journal credits each one separately and refuses to post without them — but there
is **no screen to create a tax code**, so a Canadian seller cannot express "GST to
the CRA account, PST to the BC account". Every provincial remittance depends on
it. The tax report also returns a single aggregate with no jurisdiction grouping,
so GST/HST and PST returns cannot be prepared from it.

Both are reachable without new tax logic: the calculation, versioning, provenance
and posting rules exist and are tested, and the report already reads the
per-component snapshot it needs.

### 3. `H2` — package acceptance

Paste `H2-installable-package-acceptance.md`. Needs a Windows machine that has
never seen this project. Codex can prepare and script it, but the verdict has to
come from a real run — an untested path must be marked unverified, not described
as working.

### 4. `H3` — first run and migration

Paste `H3-destry-first-run-and-migration.md`. Blocked until the owner supplies the
real business data and store credentials, **and until `H5` lands** — the chart of
accounts and tax codes in `ACCOUNTING-DESIGN.md` cannot be configured without it. The rule that matters: **never post to
make a number match** — an unbalanced trial balance is a reported discrepancy, not
a plug entry.

### 5. `H4` — the handoff kit

Paste `H4-client-handoff-kit.md`. Consumes `H2`/`H3` (and `D6` if it has run).
Every document must be written from a recorded run, not from the source.

`D6-go-live-drill.md` remains valid and unchanged; run it before `H4` if it has
not already happened.

## Keep with this session

- **`D3` (the dashboard pack's CSS consolidation)** — six dead declarations are
  already removed and verified. The remaining half gathers the _winning_
  breakpoint rules into the owner section; it is pure relocation of live rules
  across six media queries where specificity and source order both decide the
  winner, so it was deliberately deferred rather than attempted before a client
  handoff. A verified cascade index now documents which rule wins in each
  viewport band, and a 30-row baseline exists to verify a relocation against.
  Note the phase-letter collision: this is _not_ this program's `D3`.

## Already done — do not redo

| Work                               | State                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H1` first implementation          | Workspace, navigation, order queue, preflight review, convert/reject, picking, carrier panels, styles, review-boundary spec                       |
| Dashboard review pack `D1`–`D8`    | Implemented and verified; see `codex-dashboard-pack/RESULTS.md` in the release bundle                                                             |
| Left-navigation new-key visibility | Fixed — new destinations were permanently invisible to anyone who had customised their rail                                                       |
| Mobile bottom navigation bar       | Fixed — transparent background, unreadable labels, overlapping labels, content hidden behind the fixed bar                                        |
| Browser-test database reuse guard  | Added — reusing a populated test database now fails fast with an explanation instead of a page of false failures                                  |
| F4 / F5 / F7                       | Fixed — `run-browser-tests.mjs` exits 0; the flaky WebKit spec is quarantined with evidence; the verifier's mode flags now actually select a mode |
| `ACCOUNTING-DESIGN.md`             | New — chart of accounts, tax codes, the sale-to-ledger workflow, CA/US cases, and the screen gaps, each with file/line evidence                   |

## Things that will waste Codex's time if not said

1. **The e2e specs need an empty database every run.** They use fixed identities
   (`phase14-<project>@example.test`), so a reused database makes a dozen specs
   fail on a hidden `#organization-form`. The script now detects this and fails
   fast with an explanation. Create a fresh database (name still matching
   `clearledger*_test`) per run.
2. **`run-browser-tests.mjs` now exits 0** — F4 is fixed. It runs the
   accessibility and performance contracts; the security contract stays in
   `pnpm test:security` and `pnpm test:release`, where it rejects a local `.env`
   as it should. A non-zero exit now means something real.
3. **`release-candidate.spec.ts:21` is quarantined on `mobile-webkit`** (F5). It
   failed at nine different assertions across runs of identical code, including
   on code predating this work. It still runs on chrome, edge, firefox and
   mobile-chrome. Do not un-skip it without splitting it into focused tests.
4. **The verifier's mode flags were broken and are now fixed** (F7). `--security`
   previously matched no branch, so `pnpm test:security`, `test:accessibility`
   and `test:performance` were **green without running their checks**. They now
   execute — expect `test:security` to fail on any machine with a local `.env`,
   which is correct.
