# U7 — Density and polish

- **Engines:** Antigravity (audit; browser agent) → Claude Code (fixes) · **Wave:** 4 · **Slot:** 14 ·
  **Branch:** `ui/polish`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §5, `docs/pennywise/UI_QUALITY_BAR.md`

## Step 1 — audit (Antigravity)

Walk every flag-on page at 1366×768, 1920×1080, 200% zoom, dark and high contrast. Produce
`docs/status/UI_V2_U7_AUDIT.md` with one row per finding: page, screenshot, rule broken (quality bar or 02 §5),
and suggested fix. Check in particular:

- exactly one primary button per view;
- consistent spacing and type tokens;
- empty states everywhere;
- keyboard paths and focus order;
- truncated labels;
- leftover classic chrome.

## Step 2 — fixes (Claude Code)

- Fix the audit findings.
- Move module rules from `styles.css` into `styles/<module>.css`.
- Delete dead CSS only where the selector provably has no match in either the classic or v2 markup.
- Remove nothing that classic mode uses.

## Acceptance

- The `UI_QUALITY_BAR.md` checklist passes.
- `size.cssLines` is ≤ the baseline in `metrics.json`.
- `node scripts/ui-v2/measure-ui.mjs --write wave-4`.
- Full release suite: `corepack.cmd pnpm check`, `test:e2e`, `test:accessibility`, `test:performance`.
- An installer build smoke-installs on a clean Windows 11 machine.
