# Wave 0 axe baseline — 2026-09-11

The baseline was recorded from the source web build with `@axe-core/playwright`
4.13.0 using the repository Windows browser runner and a fresh disposable
PostgreSQL database. All axe rules remained enabled. The raw per-state results
are attached to the browser run; the checked-in fingerprint file is
`apps/web/e2e/fixtures/axe-baseline.json`.

The baseline contains two known `color-contrast` serious fingerprints:

| State                                       | Target                                                                             | Owner  | Reason                                                                                            | Review date |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- | ----------- |
| signed-out                                  | `.auth-brand > .brand-wordmark > span:nth-child(1)`                                | Web UI | Existing brand treatment needs a contrast-safe colour adjustment.                                 | 2026-09-18  |
| filled, error, dialog-open, side-panel-open | `#workspace-mode-switch > button[data-workspace-mode="accountant"][type="button"]` | Web UI | Existing accountant-mode control needs a contrast-safe colour adjustment across workspace states. | 2026-09-18  |

The state-specific entries are deliberately retained so a later change cannot
make the violation appear in an additional screen state without failing the
new-fingerprint check. New serious or critical findings fail the test. The
baseline does not claim WCAG conformance and does not replace keyboard,
reflow, forced-colors, screen-reader, or moderated usability evidence.

Command used:

```powershell
$env:AXE_UPDATE_BASELINE = "true"
corepack pnpm test:e2e -- apps/web/e2e/accessibility-quality.spec.ts
Remove-Item Env:AXE_UPDATE_BASELINE
```

Result: Chromium passed; non-Chromium projects were skipped by the focused
spec. The repository runner then passed its accessibility and performance
release contracts. The remaining human acceptance gates are unrun.
