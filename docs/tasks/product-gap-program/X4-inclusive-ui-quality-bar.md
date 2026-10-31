# X4 — Inclusive UI quality bar: measurable, automated, and tested with real people

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Files:** `apps/web/e2e/*`, `playwright.config.mjs`, `package.json` (dev dependency),
`apps/web/app.js`, `apps/web/index.html`, `apps/web/styles.css`, and a new
`docs/pennywise/UI_QUALITY_BAR.md`
**Closes:** G18. It also defines the interface part of the Definition of Done in
`HANDOFF-BUILD-PLAN.md` §6.
**Effort:** Part A is M, and runs in Wave 0. Part B is continuous: a usability round per
wave.
**Depends on:** nothing.

## Context

No interface suits everyone by assertion. It only does when "everyone" is written down as
named needs, and each need has a test that fails when it isn't met.

**What exists today:**

- A high-contrast theme and a text-size setting (`index.html:400, 412`).
- Focus-visible and reduced-motion CSS.
- `aria-live` regions.
- A human accessibility and UAT pass, recorded on 2026-08-19 (`CURRENT_PHASE.md`).

**What's missing:**

- **Automated accessibility tests.** No axe usage exists in `apps/web/e2e`, so nothing
  stops a regression.
- **A French interface** (P5).
- **A shared string catalog,** so new text can be translated.
- **Performance and target-size budgets.**

**What the market says:** forced, slower redesigns are among the category's loudest
complaints (DECISIONS, D11).

## The bar

1. **WCAG 2.2 Level AA,** including the new A and AA criteria:

   - 2.4.11 Focus Not Obscured (Minimum)
   - 2.5.7 Dragging Movements
   - 2.5.8 Target Size (Minimum): at least 24×24 CSS px, or adequate spacing
   - 3.2.6 Consistent Help
   - 3.3.7 Redundant Entry
   - 3.3.8 Accessible Authentication (Minimum)

   (4.1.1 Parsing is removed in 2.2.)

2. **Keyboard:** every task is completable without a pointer. Focus order is logical, and
   Escape closes dialogs and panels.
3. **Screen readers:**
   - **NVDA with Chrome or Edge on Windows,** because the installed build opens the default
     browser.
   - **VoiceOver with Safari on iOS,** for the phone path (P1).
4. **Reflow and zoom:**
   - no two-dimensional scrolling at 320 CSS px width, except inside data tables that
     scroll on their own;
   - usable at 400 % zoom;
   - text spacing overrides don't break the layout.
5. **Forced colors** (Windows High Contrast) keep every control and state visible.
   **Reduced motion** is honoured.
6. **Responsiveness:** Interaction to Next Paint of 200 ms or less at the 75th percentile,
   on the reference build machine, for the key screens.
7. **Language:**
   - Plain language on owner screens, with accounting terms explained by an in-place
     glossary tip.
   - Error messages say what happened, why, and how to fix it.
   - All new text goes through the string catalog (Part A), ready for French (P5).
8. **Touch:** at least 44×44 px targets on layouts meant for tablets and phones (POS,
   scanning, P1 flows).

## Who "everyone" means

| Persona                                     | Needs                                  | Served by                                    |
| ------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| Owner-operator, invoice-only                | Few screens, plain words, no dead ends | I1 profile, X3 empty states, glossary        |
| Bookkeeper                                  | Speed, density, keyboard               | Compact density, shortcuts, X2 tables        |
| Accountant                                  | Traceability, exports                  | Workbench, U2, C4                            |
| Warehouse or POS staff                      | Touch, scanner, gloves                 | 44 px targets, U4 scan flows                 |
| Low-vision user                             | Zoom, contrast                         | Text size, high contrast, reflow             |
| Screen-reader user                          | Structure, names, announcements        | Landmarks, labels, live regions              |
| Motor-impaired user                         | Keyboard or switch, no drag-only       | 2.5.7 alternatives, large targets            |
| Cognitive or attention needs                | One task at a time, no memory load     | 3.3.7 redundant entry, clear steps, autosave |
| French-speaking user (Quebec and elsewhere) | Full French interface and documents    | P5, I2                                       |
| Older user                                  | Larger text, lower pace                | Text size, no timeouts during entry          |

## Part A — tooling (Wave 0)

1. **Automated accessibility scans.**
   - Add `@axe-core/playwright` and a helper that scans a page in each important state:
     empty, filled, error, dialog open, and side panel open.
   - **Fail on new serious or critical violations.** Keep all axe rules enabled.
     Store existing violations as specific fingerprints with screen/state, owner,
     reason, and review date; fail if a new fingerprint appears. Retain raw results.
     A baseline comparison is not permission to claim WCAG conformance.
   - Record a baseline of today's screens as a known-issues list. It must shrink with
     every wave; it may never grow.
2. **Keyboard-only e2e paths** for:
   - first invoice;
   - record payment;
   - credit note;
   - bank match;
   - report drill-down.
3. **Viewport tests:** a reflow test at 320 px, and screenshots at 390, 834 and 1440 px for
   each key screen, attached to the report.
4. **Forced colors:** an emulation run (`forcedColors: 'active'`) with screenshots.
5. **Target size:** a script that lists interactive elements smaller than 24×24 px that lack
   adequate spacing.
6. **Responsiveness:** Report automated Event Timing samples as lab interaction
   measurements, not population p75 INP or a field conformance claim. Record browser,
   hardware, sample count, and unsupported APIs. INP measurement for the key interactions (typing in an invoice line,
   opening a report, filtering a list), recorded against the 200 ms budget.
7. **String catalog.** Add a minimal `t("key")` helper and message file. **All new or
   changed interface text in every later prompt goes through it,** so P5 can translate
   incrementally.
8. **Standard document.** Write `docs/pennywise/UI_QUALITY_BAR.md`, covering:
   - this bar;
   - how to run the checks;
   - the error-message style guide;
   - the glossary component rules;
   - the D11 change-management policy.

## Part B — people (every wave)

1. **Usability testing.** Run a moderated round with **5 participants per persona group**
   that the wave affects (NN/g: small, repeated qualitative rounds). Include at least one
   screen-reader user or keyboard-only user in each round that touches owner screens.
2. **Task scripts with pass criteria**, for example:

   - a first invoice in under 3 minutes, without help;
   - finding an unpaid invoice and recording its payment;
   - fixing a mistaken invoice.

   Report the success rate, time on task, errors, and quotes.

3. **Fix before the next wave.** Fix severe findings before the next wave starts, and list
   deferred findings with owners.
4. **Manual assistive-technology scripts.** Run NVDA and VoiceOver passes of the same
   tasks, and store the results with the completion report.

## Constraints

- **Verify, don't rely on the tool.** Don't suppress axe rules to pass. Record any
  documented exception with a reason and a review date.
- **No colour-only meaning.** No drag-only interactions. No time limits during data entry.
- **No redesign without the D11 steps:** opt-in first, measured, and nothing removed.
- **Never claim conformance the tests don't show.**

## Acceptance criteria

- **axe:** runs in the e2e suite and fails on new serious or critical violations. The
  baseline file is saved in the source tree and listed in the completion report.
- **Keyboard:** all keyboard-only e2e paths pass.
- **Viewports:** the 320 px reflow test passes on the key screens; screenshots at three
  widths and in forced-colors mode are attached.
- **INP:** measured and reported. Any interaction over 200 ms has an issue filed.
- **String catalog:** it exists, and at least the invoice screens use it.
- **Standard document:** `UI_QUALITY_BAR.md` is published.
- **People (Part B):** the usability and assistive-technology reports are human
  acceptance gates. Part A may finish with these explicitly unrun; never fabricate
  participants, screen-reader results, or quotes.

## Out of scope

- Translating the strings. P5 does that.
- Redesigning screens. Each prompt owns its own screens; X4 only measures them.

## Standard rules

- **Authorization:** this prompt is prepared, not authorized. Start only after the owner
  records it as active in `docs/status/CURRENT_PHASE.md` (`AGENTS.md`, "Active-phase
  control").
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`. Accounting integrity,
  tenant isolation and security win every conflict.
- **Competitive research:** review comparable products' primary documentation. Update this
  module's entry in `docs/COMPETITIVE_RESEARCH_MATRIX.md`. Run the full quality gate,
  including `corepack pnpm test:research`.
- **Web edits:**
  - Keep LF line endings.
  - `apps/web/scripts/verify-assets.mjs` asserts exact snippets. Update its expectations
    deliberately; never delete checks to make it pass.
  - Rebuild with `build-assets.mjs`, because `serve.mjs` serves a `dist/` built at boot.
- **No git:** the tree has no version control. List every changed file in the completion
  report.
