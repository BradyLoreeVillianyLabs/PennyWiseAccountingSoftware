# WD5 — Secrets in launcher logs and Support Diagnostics bundles

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** native (`launcher.cjs`, `native-operations.cjs`)
**Effort:** S
**Severity:** Medium (security)
**Depends on:** WD2, which edits the same files.

## Why

### Verified evidence

- **Two old log lines hold a plaintext password.** `launcher.log` lines 87 and 97
  (2026-09-06T22:56:14Z and 23:05:26Z) contain the runtime database role password, from
  `RUN psql.exe … -v runtime_password=<value>`. The build that wrote them predates
  `redactedCommandArgs` (`launcher.cjs:258-265`). Every later line shows `[REDACTED]`, but the
  two old lines are still in the file.
- **Support Diagnostics only redacts current values.**
  - `collectDiagnostics` (`native-operations.cjs:678-718`) copies the last 2,000 log lines into
    a ZIP on the Desktop for the tester to send.
  - It passes them through `redact()` (`native-operations.cjs:666-676`), which replaces only the
    values currently in `runtime-secrets.json`, plus emails, PostgreSQL URLs and the data-root
    path.
  - `redact()` has no rule for `key=value` secrets in general, and none for bearer tokens.
  - So a secret whose value has changed or appears in another form goes out in the bundle.
- **The launcher and Diagnostics redact with separate rules,** in two places that can drift
  apart.

### Hypothesis

Other paths may also log secrets: setup logs, pino request logs, `provision-beta.cjs` and the
Inno script.

## Tasks

1. **Write the tests first, with synthetic secrets only.** Build a Diagnostics bundle from a temp
   log that contains:

   - an unredacted `runtime_password=` value that isn't among the current secrets;
   - `token=…`, `client_secret=…`, `Authorization: Bearer …` and a `postgresql://user:pass@…`
     URL.

   Assert that none of these values survive. The first two cases should fail today.

2. **Use one redaction helper.** Move the key-pattern rule into a shared module that both
   `launcher.cjs` and `native-operations.cjs` require, add a bearer-token rule, and include the
   module in the SEA and MSIX staging steps.
3. **Scrub existing logs once.** At launcher start, if `launcher.log` contains a secret-named
   `key=value` that isn't redacted:
   - rewrite the file with those values replaced, using a temp file and a rename;
   - log "Removed N legacy secret values from launcher.log.";
   - leave every other line byte-identical;
   - make a second run a cheap no-op.
4. **Sweep for other leaks.**
   - Check the setup logs written by `Setup.cs`, pino request and error logs (does any route or
     hook log headers or bodies?), `provision-beta.cjs` and `PennyWiseBeta.iss`.
   - Fix only clear leaks, and list the rest in the report.
5. **Document how to rotate the password.** Find out how the runtime role password could be
   rotated. `configure-runtime-role.sql` runs on every start with the value from
   `runtime-secrets.json`. Describe safe rotation steps for the owner in the report. Don't
   rotate anything yourself.

## Constraints

- Follow the README's shared rules. Never print, copy, hash or compare the value in lines 87 and
  97, and never open `runtime-secrets.json`. Read `launcher.log` only through a masking filter.
- Use synthetic secrets in every test and fixture.

## Acceptance criteria

- The new redaction and scrub tests fail before the fix and pass after it. Existing native tests
  still pass.
- The scrub leaves non-secret lines byte-identical, and a second run is a no-op.
- Lint and the format check pass.

## Owner actions to include in the report

- Start PennyWise once after this ships, so the legacy lines are scrubbed.
- Rotate the runtime role password using the steps from task 5.
- Treat any Diagnostics bundle sent before this fix as possibly containing that password.
