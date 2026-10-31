# S5 — Measure the outcome, so the sales claim is true

Commercial-readiness prompt. Prepared, not authorized: record it in
`docs/status/CURRENT_PHASE.md` before starting.

## Why

Competitors sell on outcomes, not features. Intuit states publicly that its customers "get
paid five days sooner and are 10% more likely to be paid in full", and that its agents save
roughly 12 hours a month. Those are the claims a buyer compares PennyWise against.

PennyWise currently has **no way to state any equivalent number**, which leaves it selling
on feature lists — the weakest ground, and the one where an incumbent always wins.

It also already has the pieces: a consent-aware, threshold-based product-analytics service
that keeps data local and privacy-safe.

## Tasks

1. **Define the measures, computed from the ledger, locally:**

   - **Time to first invoice** — from first run to first finalized invoice.
   - **Time from finalize to sent** — how quickly invoices actually go out.
   - **Days to payment** — median, per customer and overall, from finalize to full
     allocation.
   - **Paid within terms** — percentage, with the trend.
   - **Reminder effect** — days to payment for invoices that received a reminder against
     those that did not, with sample sizes shown.
   - **Correction rate** — voids and credit notes per hundred invoices, as a quality signal.

2. **Owner-facing panel: "How this is working for you."** Plain language, with the
   arithmetic on display, and honest suppression when the sample is too small to mean
   anything. Never show a number the data can't support.

3. **Voluntary, anonymous benchmark export.** Opt-in, reviewed on screen before it leaves
   the machine, containing **no customer names, no amounts tied to a party, and no personal
   information** — only aggregate measures and counts. The owner can see the exact file.

4. **A methodology document** in `docs/`, stating for each measure: the definition, the
   population, exclusions, and the minimum sample. A claim PennyWise makes in marketing must
   be reproducible from this document.

5. **Honest statistics.** The reminder comparison is observational, not an experiment.
   Label it that way, and never call it causal.

## Constraints

- **Opt-in only.** Nothing leaves the machine without the owner's explicit action.
- **No tracking pixels, no covert beacons, no third-party analytics.**
- Personal information never appears in an export: assert it in a test.
- Suppress any metric below its minimum sample instead of publishing a noisy one.
- These figures are derived from posted ledger data, never recomputed from documents.

## Acceptance criteria

- Every measure is computed on the seeded demo company, and the numbers reconcile by hand.
- Small-sample suppression works, and says why.
- The benchmark export passes an automated check proving it contains no personal data or
  party-identifying amounts.
- The methodology document is published, and each metric in the UI links to its definition.
- With analytics consent withheld, nothing is collected and the panel still works locally.

## Standard rules

- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.
- Meet the Definition of Done in `HANDOFF-BUILD-PLAN.md` section 6.
- Keep LF endings; rebuild web assets; there is no git, so list every changed file.
