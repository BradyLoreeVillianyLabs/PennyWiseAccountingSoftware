# UI v2 U0 foundations report

U0 splits `apps/web/app.js` and `index.html` into owned files, so Waves 1–4 can run in parallel with
no visible or behavioural change. This report is for the integrator, the owner, and the streams that
build on these files.

## Module map

Paths are under `apps/web/`. Each workspace row owns its `src/workspaces/<name>.js`, its
`src/partials/<name>.html`, and its `styles/<name>.css`, unless the row says otherwise.

| Files                                                        | Owner stream                     |
| ------------------------------------------------------------ | -------------------------------- |
| `app.js`, `index.html` (shell), `src/shell.js`, `src/nav.js` | `shell`                          |
| `src/ui-kit/*`, `src/ui-flags.js`                            | `shell`                          |
| `src/state.js`, `src/api.js`, `src/session.js`, `src/lib/*`  | `shell` (integrator), see note 1 |
| `src/charts.js`                                              | `charts`                         |
| `home`                                                       | `home`                           |
| `sales`, plus `src/partials/sales-dialogs.html`              | `sales`                          |
| `expenses` (the classic `purchases-workspace`)               | `expenses`                       |
| `banking`                                                    | `banking`                        |
| `contacts` (no partial, see note 2)                          | `contacts`                       |
| `taxes` (the classic `accountant-workspace`)                 | `taxes`                          |
| `reports`                                                    | `reports`                        |
| `pos`                                                        | `ext-1`                          |
| `inventory`                                                  | `ext-2`                          |
| `projects`                                                   | `ext-3`                          |
| `contracts`                                                  | `ext-4`                          |
| `fulfilment`                                                 | `ext-5`                          |
| `planning`                                                   | `ext-6`                          |
| `fixed-assets`                                               | `ext-7`                          |
| `payroll`                                                    | `ext-8`                          |
| `integrations`, `payments`                                   | `ext-9`                          |
| `portability`                                                | `ext-10`                         |
| `owner`, `setup`, `members`, `help`, `about`                 | `shell` (integrator), see note 1 |

1. `04_MULTI_AGENT_ARCHITECTURE.md` §3 does not list these paths, so they default to the integrator
   until that table is extended.
2. The classic app has no contacts section. Per `U4-contacts.md`, the CRM markup stays in the
   `projects-workspace` CRM tab, so `src/workspaces/contacts.js` holds the CRM code and U4 adds its
   own partial.

## How the split works

- **Startup.** Modules only declare. `app.js` is 90 lines and calls each `init…()` in the original
  order, then loads the session.
- **Shared state.** The 42 values written from more than one module have setters. Reads stay verbatim
  through live bindings.
- **Across workspaces.** Workspaces never import each other. Calls use 80 same-named forwarders in
  `src/lib/workspace-calls.js`, so call sites are unchanged. `navigateTo(workspaceId, options)` in
  `src/shell.js` wraps `activateWorkspace`. `verify-assets.mjs` enforces this and rejects import
  cycles.
- **Markup.** `index.html` is a 1,408-line shell. The build replaces each `<!-- @partial name -->`
  line. Prettier skips partials because they are spliced byte for byte.

## Evidence

The suite was already failing before U0, so "same as baseline" is the meaningful test here, and the
checks below go further than the suite does. All runs used commit `f0a9876` against the baseline
`ba12340`. The two later commits change only documentation, metrics, and screenshots.

### Moved code

| Check                                 | Result                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| 1,081 functions                       | 995 token-identical; 86 reverse exactly to the original; 0 unexplained  |
| 484 top-level statements              | All match the original                                                  |
| 222 declarations                      | 221 identical; `leftNavigationDefinitions` differs only by the new data |
| Assembled `index.html`                | Byte-identical to the baseline                                          |
| Minified HTML, parsed in Chrome       | Same DOM, unmasked: `isEqualNode` true, 5,155 elements each             |
| Built `styles.css`                    | Byte-identical to the baseline                                          |
| Frozen paths, manifests, and lockfile | No diff                                                                 |

### Running app

Both builds ran against one API and one fictional demo company.

| Check                           | Baseline vs U0                                    | Baseline vs itself |
| ------------------------------- | ------------------------------------------------- | ------------------ |
| Rendered DOM, every workspace   | 27 of 27 snapshots identical (2.86 million chars) | 25–26 of 27        |
| Event listeners                 | 804 vs 804 at startup; all 540 target/event pairs | Same               |
| Same-event listener order       | 0 differences                                     | 0 differences      |
| Runtime errors                  | 0 vs 0                                            | 0                  |
| Screenshots, 10 per run, 3 runs | At most 1 image differs, by 3 pixels              | Same flicker       |

The DOM comparison masks generated IDs, clock values, the audit log, and transient loading attributes,
because those differ between two runs of the same build.

### Test suites

| Gate                 | Result on U0              | Note                                                  |
| -------------------- | ------------------------- | ----------------------------------------------------- |
| `lint`, `typecheck`  | Pass                      |                                                       |
| `db:validate`        | Pass                      |                                                       |
| `test:research`      | Pass                      |                                                       |
| `test:accessibility` | Pass                      |                                                       |
| `test:performance`   | Pass                      | 1,182,677 bytes, 32,323 under budget                  |
| `format:check`       | **Fails**                 | Only `PB0_FIRST_COMMIT_INVENTORY.md`, covered by #35  |
| `pnpm test`          | **Fails**: API 291 of 292 | Caused by U0, see Open items. Web tests pass 7 of 7   |
| `test:integration`   | **Fails**: 256 of 257     | Not caused by U0, see below                           |
| `test:e2e`           | **Fails**: 30 / 28 / 127  | Passed / failed / skipped. Baseline was 31 / 27 / 127 |
| `measure-ui --check` | Passes after `wave-0`     | Failed before it on `cssLines`, see Open items        |

- **`test:integration`.** `recurring-invoice-materialization` hard-codes a monthly schedule from
  2026-09-10 and expects one draft. Since 2026-10-10 two are due. U0 has no diff under `apps/api/`.
- **`test:e2e`.** 184 of 185 outcomes match the baseline. The exception is
  `[edge] keyboard path: record a manual payment`, which hit the API limit of 120 report requests per
  10 minutes one test earlier than in the baseline run. Run on its own with a fresh API, it passes on
  both builds, in 2 of 2 runs each.
- **Failure messages.** 26 of the 27 shared failures have the same first error. `i9` fails on both
  builds in every run, but it can stop at either of two steps because of the race in Open items.

`.ui-v2-stream.ps1` points to port 5433, the Docker test database, which was not running. These runs
used a private PostgreSQL 17 cluster on that port, created from the same URL, so no existing server
was touched.

## Deliberate differences

- **HTML minifier.** `build-assets.mjs` now removes whitespace between attributes. The baseline was
  34 bytes under the 1.215 MB budget, and the split adds about 6.4 KB. This saves about 39.8 KB
  without changing the budget.
- **Packaging.** The Docker and public-beta inputs gain `src/` and `styles/`. They also gain
  `strings.js`, which `app.js` already imported but those lists had omitted.
- **Listener order.** The `hashchange` listener now registers before the help panel's `resize`
  listener on `window`. These are different events, so they cannot interact.
- **Commits.** The JS split is one commit rather than one per workspace. It was generated from the
  baseline and checked as a whole, because partial splits would need temporary forwarders for
  everything not yet moved. The generator is not part of this change.
- **Tier name.** `02_TARGET_UX_SPEC.md` §1 says `tier: "utility"`, while the U0 task and `U1-shell.md`
  say `"admin"`. This branch uses `"admin"`.

## Open items

- **`apps/api` test.** `catalog-mapping-service.test.ts:44` reads `apps/web/app.js` as text and fails.
  U0 forbids a diff under `apps/api/`, so it is unchanged. The one-line fix is on issue #1, waiting for
  an owner decision.
- **Failing specs.** The 27 baseline failures need their own issue, because `test:e2e` stays red after
  #35. U0 changed no spec.
- **Product bug, not caused by U0.** After first-run setup, `src/session.js:977-980` closes the dialog,
  loads company data for several seconds, then re-activates the default workspace. Anything the user
  opened in between is replaced by Overview. This is the race behind the `i9` variation.
- **Research matrix.** Request for the `research` stream: record this module split under
  `table-grid-and-workspace-experience`. U0 adds no user-facing workflow.
- **`measure-ui.mjs`.** `cssLines` counts one line per empty stylesheet because `readAll` joins with a
  newline. Request for the `qa` stream: skip empty files.
- **Historical script.** `docs/tasks/product-gap-program/evidence/route-diff.mjs` still reads only
  `app.js` and `index.html`. No gate runs it.
- **Board.** `BOARD.md` listed `clearledger_test_foundations`, while the stream tooling creates
  `clearledger_test_u0_foundations`. The board now uses the real name.
