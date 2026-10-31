# WD0 — Triage a workflow symptom

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** read-only until step 4, then whichever lane the symptom belongs to
**Effort:** S per symptom
**Input:** the launch line gives:

- the symptom;
- when it happened, in local time;
- the build;
- the workflow: launch, close, update, backup, restore, activation, diagnostics, sign-in, or an
  in-app workflow such as finalizing an invoice.

If any of these is missing, ask once, then continue with what you have.

## Goal

Turn a symptom into a proven root cause and a ready-to-run fix prompt. **WD0 doesn't fix
anything.**

## Tasks

1. **Pin the build and the timeline.**
   - Get the installed version with
     `Get-AppxPackage -Name TypeWritingMonkeys.PennyWiseAccounting`, or from the Inno uninstall
     key for an Inno install.
   - Convert the reported time to UTC. The machine runs at UTC−6 in September and October.
   - Pull the `launcher.log` lines from 15 minutes before to 5 minutes after, through the
     secret-masking filter in the README's shared rule 2. The API's pino JSON lines are in the
     same file, carrying `reqId`, `route`, `statusCode` and `classification`.
   - List every FATAL and every non-2xx `http.security_outcome` in that window.
2. **Map the path.**
   - Trace from the entry point to the line that fails, citing `file:line`. The entry point is a
     launcher mode in `launcher.cjs` (`executableMode`, `runMode`, `main`), an API route in
     `apps/api/src/app.ts`, or a UI action in `apps/web/app.js`.
   - List every file, process, port and scheduled task the path touches.
3. **Write one to three hypotheses.** For each one, name the evidence that would confirm it and
   the evidence that would refute it. Collect that evidence without writing anything.
4. **Reproduce in isolation.** Pick the lightest harness that shows the failure:

   - native code: `node:test` with a temp data root, like
     `distribution/windows-native/native-operations.test.mjs` (it supports `.cmd` fixtures in
     place of PostgreSQL tools);
   - API behaviour: vitest against the isolated database on port 55432, guarded by
     `scripts/require-isolated-test-database.test.mjs`;
   - UI flows: Playwright (`corepack pnpm test:e2e`);
   - packaged behaviour: a disposable profile built on
     `distribution/public-beta/qa/Test-PennyWiseInstalledFirstRun.ps1`. Keep its pre-seeded
     `backup-config.json`, which stops the run from registering the owner's real nightly task.

   Show the repro failing.

5. **Report and stop.** Write `docs/status/WD0_TRIAGE_<yyyy-mm-dd>_<slug>.md` with:
   - the symptom and its UTC timeline;
   - the root cause, marked confirmed, likely or unknown, with evidence;
   - the repro command and its output;
   - the files a fix would change, and the risk to books, tenancy, security or migrations;
   - if a fix is warranted, a draft `WD<n>` prompt in the same format as WD1. Leave the "Run
     after" lane to the owner.

## Constraints

- Follow the README's shared rules.
- Make no source changes. A new test file under a test folder is allowed only if step 4 needs
  it, and the report must say so.

## Acceptance criteria

- The repro fails for the stated reason, or the report explains why the symptom couldn't be
  reproduced.
- Every claim in the report is marked as evidence or hypothesis.
