# U8 — Usability verification

- **Owner:** Human (facilitator) · **Support:** GitHub Copilot prepares scripts and tallies results · **Wave:** 4

## Protocol

- **Participants:** 5 business owners and 5 bookkeepers, ideally including some who do not know PennyWise.
- **Tasks:** the 7 daily jobs in 02 §3, in random order, on a seeded demo company (`corepack pnpm demo:seed-full`
  into a disposable database).
- **Conditions:** classic layout vs UI v2 (counterbalanced); think-aloud; no help from the facilitator.
- **Record per task:**
  - time on task;
  - success or failure;
  - errors;
  - clicks;
  - a 1–5 ease rating (SEQ);
  - and, at the end, the SUS questionnaire.
- Use `docs/status/UI_V2_U8_SESSIONS.csv` (one row per participant × task) and summarize in
  `docs/status/UI_V2_U8_REPORT.md`.

## Pass criteria (03 "Measurable targets")

- ≥ 30% faster median time on task than the classic baseline.
- Zero critical findings (a task that cannot be completed, or wrong money shown).
- If either fails, file fix issues and repeat with new participants.

## After passing

- The owner flips the default (UI v2 on for new installs, opt-in for upgrades), releases beta 0.15 with
  the classic-layout fallback, and records completion in `docs/status/CURRENT_PHASE.md`.
