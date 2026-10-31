# H2 self-contained beta installer candidate

> **Superseded as the current transfer candidate.** Keep this report as evidence
> for the earlier MSIX route, but do not distribute its `.13` artifact or use it
> for new H2 acceptance evidence. The controlling direct Inno candidate is
> [`H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md`](H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md).

Result: working local installer candidate; clean-Windows acceptance remains open.

## Artifact

The test-machine handoff is
`C:\Users\EmceeHax\Desktop\PennyWise-TestMachine-0.14.0.13\PennyWise-Beta-02-Setup.exe`.
Size: 512,088,864 bytes. SHA-256:
`312a1610c7a4499b9f22c6e5351c4b76d16d904ccae978a34a0841f400d1690d`.
Its signature is valid on the build machine, with signer
`CN=PennyWise Accounting QA`. The self-contained EXE includes MSIX, Microsoft-signed
VC++ x64 runtime, the public QA certificate, and participant 02 activation.

Embedded MSIX: `PennyWise-Accounting-0.14.0.13-x64.msix`, SHA-256
`0aa816795be0756c58ce7512d78495b81abeb52c2a539648903e129b7d977f1e`.
Versions `.11` and `.12` are superseded internal candidates. Historical packages
remain frozen. Only the Desktop handoff folder is intended for this test machine.

The twenty signed participant activations and issuer key are retained outside
the repository in `%LOCALAPPDATA%\PennyWiseBetaIssuer`. Only installers 01 and 02
have been built for the final version: 01 belongs to the owner's existing
installation; 02 belongs to the test machine. The other eighteen activations
are issued and retained but their setup executables are not yet built, following
the owner's direction to focus on one usable test-machine installer.

## Repairs and evidence

- Full repository `corepack pnpm check` completed with exit zero: formatting,
  lint, type checking, schema/research validation, unit tests, all 242 integration
  tests across 42 files, and the complete workspace build passed.
- Hash comparison of all 375 API/web payload entries in `.12` and `.13` found
  them identical. The final package contains no `.env`, PFX, or issuer-private-key
  payload.
- Setup provisions the signed activation with a hash-verified temporary copy
  of the bundled Node runtime. Direct execution of a helper inside WindowsApps
  from the external setup process was denied and is no longer used.
- Setup launches by registered application identity using Windows
  `IApplicationActivationManager`, rather than executing an arbitrary file in
  WindowsApps. Owner setup 01 installed `.13`, activated, launched, reached API
  and web HTTP 200, and exited zero. Setup log ends in `PASS`.
- Actual setup 02 installed/upgraded and activated under fresh standard-user
  `PennyWiseQA12`, with exit zero using `--unattended --no-launch`.
  Starting an MSIX application under that secondary-logon process was rejected
  by Windows with `0x80070520` (no interactive logon session); this is not claimed
  as a successful standard-user first launch.
- The installed `.12` app initialized an isolated empty data directory,
  generated runtime secrets, deployed all 112 migrations, and returned HTTP 200
  for API and web. This used the owner Windows account on the build machine,
  with fixture backup configuration to avoid altering its real scheduled task.
  The same API/web payload is retained in `.13`; `.13` changes registered app
  activation and task naming/launching.
- Eight Chromium browser scenarios passed against that actual packaged app,
  covering the owner release flow, demo company, calendar, task finder, tax code
  configuration, and fulfilment including purchase/void. An initial Chrome run
  passed seven scenarios and failed the fulfilment test because its fixture
  database URL was not supplied. Providing the isolated database to the harness
  resolved the test setup failure. No live carrier was used.
- The in-app browser integration timed out. The existing repository Playwright
  tests supplied the rendered validation. No frontend product code was changed.
- Native tests passed, including provisioning refusal for a different participant,
  unchanged identity on reinstall, backup/restore, and local runtime verification.
  A real two-cluster PostgreSQL recovery drill recovered documents and encryption
  keys while preserving destination credentials/activation and rejecting corruption.
- Per-user backup task names avoid collisions between Windows accounts. The new
  standard user successfully registered its own task without administrator rights.
  Task execution now uses registered app activation.
- One demo integration scenario took 35.6 seconds for two full seeds and exceeded
  the default 30-second test timeout. With all assertions unchanged it passed;
  that scenario now has a bounded 90-second budget.
- No database migration or accounting rule was added or changed.

## Limits

Windows Sandbox was enabled with no forced restart; Windows reported a required
reboot and the sandbox could not be exercised in this session. No reboot of the
owner's active machine was forced. An untouched Windows 11 system, Windows update
cycle, disk-full fault, and interactive standard-user first launch remain unverified.
Windows may show normal administrator, SmartScreen, or runtime-restart prompts.
The self-signed beta path is not Store signing or public-release acceptance.

Offline participant kits remove activation exchanges, but copying a whole kit
can clone its preissued identity. The ledger limits issuance to twenty slots;
it is not an online global hardware counter. Nightly same-PC recovery copies
are identified honestly and do not protect against physical disk failure.
