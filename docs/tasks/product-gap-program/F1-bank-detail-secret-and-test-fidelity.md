# F1 — Fail closed on bank-detail encryption, and fix two test-fidelity gaps

Defect-repair increment inside the authorized product-gap continuation. It is small, and
it is best done before I4, because I3 already stores customer bank details.

Source of these findings: independent verification of Wave 0 and I1–I5 on 2026-09-11,
recorded in `docs/status/CLAUDE_VERIFICATION_2026-09-11.md`.

## 1. Bank details must never be encrypted with a known constant

**What happens now.** `apps/api/src/services/payment-instruction-service.ts` builds its
protector like this:

```ts
this.protector = new AesPaymentAccountProtector(
  environmentValueOrDefault(
    process.env.PAYMENT_ACCOUNT_ENCRYPTION_SECRET,
    "development-payment-account-encryption-secret"
  )
);
```

There is no guard in the service, and `environmentValueOrDefault` simply returns the
fallback.

**Where it is already safe.** Installed builds are protected. `assertBetaRuntimeSecrets`
requires `PAYMENT_ACCOUNT_ENCRYPTION_SECRET` at 32 characters or more when
`CLEARLEDGER_BETA_RUNTIME=true`, and the launcher supplies it.

**Where it is not.** `NODE_ENV=production` with no Stripe or PayPal configured has no
requirement at all: `apps/api/src/index.ts` ties that secret only to provider
configuration. I3 stores customer bank transit and account numbers, so in that
configuration they are encrypted with a constant published in this repository. The same
fallback exists in `apps/api/src/services/payment-service.ts`.

**Tasks.**

1. Refuse to store or reveal EFT bank details when no real secret is configured. Fail
   closed with a clear error code and message that tells the owner which environment
   variable to set. Reading non-bank methods, such as e-Transfer or cheque, should keep
   working.
2. Require the secret at startup whenever the runtime is production or beta, rather than
   only when a payment provider is configured. Keep development ergonomics: a blank value
   in a plain development run may still fall back, but it must log a clear warning.
3. Apply the same decision to `payment-service.ts`, so both paths agree.
4. Cover it with tests: storing bank details without a secret is refused; with a secret it
   round-trips; and an existing record encrypted under the development fallback produces a
   readable error rather than silent corruption.
5. Record the boundary in `docs/SECURITY_AND_COMPLIANCE.md`, and note any migration
   guidance for a deployment that already saved details under the fallback.

**Constraints.** Never log or export the secret or the decrypted values. Do not weaken the
existing masking. This must not change what an issued document snapshot already contains.

## 2. The accessibility error-state scan drives a hidden legacy field

`apps/web/e2e/accessibility-quality.spec.ts` fills `input[name="unitPriceMinor"]` to
produce its "error" state. That input now lives inside
`<div class="legacy-invoice-controls" aria-hidden="true">` with `tabindex="-1"`
(`apps/web/index.html`), the compatibility shim X3 kept for older specs.

Nothing double-submits, because `invoiceDraftPayloadFromForm()` builds lines from
`invoiceLineState`. But the scanned "error" state is not the error state a real user
reaches.

**Tasks.**

1. Point the error-state scan at a real validation failure in the line editor, for example
   a negative rate or a missing description, and confirm the notice the user actually sees.
2. Re-record the baseline only if the fingerprints legitimately change, and say so in the
   report.

## 3. Retire the legacy invoice controls when the specs no longer need them

The `legacy-invoice-controls` block exists only so older browser specs keep passing.

**Tasks.**

1. List the specs that still depend on those field names.
2. Migrate them to the line editor.
3. Delete the block, and confirm the X4 suites and the release-candidate spec still pass.

If any spec genuinely still needs it, keep the block and record why in the report, rather
than deleting coverage.

## Acceptance criteria

- Storing EFT details without a configured secret is refused, and the refusal is tested.
- Production and beta startup require the secret; a development run warns.
- The accessibility error state comes from a real validation failure.
- The legacy block is removed, or its remaining dependency is documented.
- The standard quality gate passes, and the report states which suites ran.

## Standard rules

- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- Meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` section 6.
- Keep LF line endings. Run `verify-assets.mjs` and `build-assets.mjs` after web edits.
- There is no git: list every changed file in the completion report.
