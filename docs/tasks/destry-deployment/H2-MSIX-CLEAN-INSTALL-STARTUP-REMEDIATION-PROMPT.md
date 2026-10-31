# H2 MSIX clean-install and startup remediation prompt

> **Historical MSIX-only prompt.** Do not use this as the default beta delivery
> task. The active H2 handoff is the direct Inno candidate documented in
> `docs/status/H2_INNO_SELF_SIGNED_BETA_CANDIDATE_2026-09-08.md`. Reopen this
> prompt only if the owner explicitly authorizes renewed MSIX/Store work.

Use this prompt only while H2 is the active phase in
`docs/status/CURRENT_PHASE.md`.

---

You are working at the ClearLedger repository root:

```text
C:\Users\EmceeHax\Desktop\clearledger-src
```

Your objective is to make the PennyWise MSIX wrapper install and start reliably
on a fresh Windows 11 x64 system, then prepare only a versioned QA candidate
whose evidence is sufficient for the H2 clean-machine drill. Correct every
reproducible wrapper, packaging, build, signing, first-run, PostgreSQL-runtime,
backup-task, and compilation failure found within this scope.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/status/CURRENT_PHASE.md`
4. `docs/tasks/destry-deployment/H2-installable-package-acceptance.md`
5. `docs/status/H7_PACKAGED_DATABASE_INIT_ACCESS_DENIED_REPORT_2026-09-06.md`
6. `docs/status/H2_PACKAGE_ACCEPTANCE_EVIDENCE_TEMPLATE_2026-09-05.md`
7. `distribution/windows-native/Build-PennyWiseMsix.ps1`
8. `distribution/windows-native/launcher.cjs`
9. `distribution/windows-native/native-operations.cjs`
10. `distribution/windows-native/native-operations.test.mjs`

## Non-negotiable outcome

The next candidate must support this sequence without a developer toolchain,
Docker, Node, PostgreSQL, or a previous PennyWise install on the target machine:

1. Administrator manually imports the supplied QA certificate only for the
   controlled QA test.
2. A non-developer installs the signed MSIX normally.
3. PennyWise launches from Start and completes first-run setup.
4. Its private PostgreSQL runtime initializes, starts, migrates, and serves the
   loopback API and web application.
5. A backup destination can be configured, and the Scheduled Task is valid.
6. Restart, second launch, backup, restore, upgrade, and uninstall can proceed
   to the H2 evidence drill.

Do not claim that this outcome is verified until a genuinely clean Windows 11
machine performs it. Build-machine evidence is useful but is not a substitute.

## Audit and repair loop

1. Reproduce from the newest versioned QA candidate. Capture only redacted,
   relevant evidence: package version, event IDs, exit codes, process paths,
   health responses, and safe launcher-log excerpts. Never print or commit
   passwords, runtime secrets, tokens, `.env`, backup contents, or customer data.
2. Classify the failure before editing: build/compile, package composition,
   signing/trust, MSIX identity/process boundary, launcher lifecycle,
   PostgreSQL child process, migration, backup-task XML, upgrade, or test-harness
   issue.
3. Inspect the existing implementation and Windows/MSIX primary documentation
   before changing a packaging or process-boundary contract. Record a material
   decision in an ADR or the completion report.
4. Make the smallest safe fix. Preserve PostgreSQL 17, the bundled binary set,
   loopback-only networking, immutable accounting data, and existing local data.
   Do not delete, reset, or overwrite a user data directory to obtain a test
   result. Use a disposable Windows account, VM, or explicitly disposable test
   data for clean-state verification.
5. Add a focused regression test for every corrected wrapper failure. Tests must
   cover the actual boundary when possible, not merely search source text.
6. Run the relevant checks after each repair. At minimum:

   ```powershell
   node --test distribution\windows-native\native-operations.test.mjs
   corepack pnpm test:research
   corepack pnpm --filter @clearledger/web build
   corepack pnpm --filter @clearledger/api build
   ```

   Run formatting, syntax checks, and the required H2 lifecycle script as well.
   Report any unavailable check or unsupported formatter exactly; never convert a
   skipped check into a pass.

7. Build a new four-part version candidate with
   `Build-PennyWiseMsix.ps1 -SelfSign`. Never rebuild a published or failed
   candidate under the same version. Verify the sibling SHA-256, signature,
   package identity, manifest contents, and the QA certificate artifact.
8. Install the candidate only after its build process has exited and released the
   archive. Launch it through `shell:AppsFolder` so it has package identity.
   Verify the private PostgreSQL executable path, database readiness, migrations,
   API health, and web health. Stop test processes cleanly before an upgrade.
9. Update the H2 evidence template to name only the final candidate. Mark failed
   candidates as internal and never offer them for client testing.

## Known findings to resolve or re-verify

- H7 fixed packaged `initdb.exe -> postgres.exe` access denial by staging a
  hash-verified runtime in private local data. Preserve manifest validation,
  BOM-safe JSON, tamper recovery, and launcher secret redaction.
- The H7 final `.9` candidate reached local API and web HTTP 200, but H2 found a
  scheduled-backup failure: `schtasks.exe` rejects the generated XML as malformed
  with `one root element`. Diagnose and fix this before declaring a client test
  package ready.
- Confirm all `pg_ctl` start/stop paths, scheduled backup wrapper paths,
  backup/restore tools, shutdown behavior, existing-data upgrades, and failure
  dialogs operate with MSIX package identity and without hanging on inherited
  pipes.
- Confirm the build does not import a QA certificate or modify Windows trust.
  Certificate trust is a manual controlled-QA action after signing.

## Boundaries

- Do not read, log, modify, or expose `.env`.
- Do not bypass Defender, Smart App Control, AppLocker, SRP, execution policy,
  signing, firewall, or MSIX security controls.
- Do not add a developer prerequisite to the client machine.
- Do not change providers, tax logic, accounting behavior, database schema, or
  product UI unless a narrowly necessary wrapper boundary requires it and the
  H2 task expressly permits it.
- Do not mark H2 complete merely because a package builds or a build-machine run
  succeeds. The clean-machine evidence table remains controlling.

## Required handoff

Write a concise report in `docs/status/` containing:

- every reproduced failure and its root cause;
- each changed file and regression coverage;
- final candidate path, size, SHA-256, signer, and certificate path;
- exact checks run and their outcomes;
- clean-machine evidence completed versus still required;
- an explicit deliverability verdict.

If a clean Windows 11 machine is unavailable, leave the applicable H2 rows
**UNVERIFIED**, provide exact manual steps, and state that the package is not
deliverable to the client yet.
