# U0 — Foundations (module split, no visible change)

- **Engine:** Claude Code (integrator) · **Wave:** 0 (runs alone) · **Slot:** 1 · **Branch:** `ui/u0-foundations`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 03_REVISION_PLAN.md (U0 row), 04 §3

## Why

`apps/web/app.js` (≈27.6k lines) and `index.html` (≈10.2k lines) are single files, so no two agents can
work in parallel. U0 splits them into per-owner files **without changing behaviour**, so Waves 1–4 can run
concurrently.

## Facts to rely on (verified)

- `apps/web/scripts/build-assets.mjs` bundles `app.js` with esbuild (`bundle: true, format: "esm"`) into
  `dist/app.js`, and `serve.mjs` serves `dist/`. ES-module `import`s from `apps/web/src/**` therefore need no
  new tooling. `index.html` is copied as one file, so HTML partials must be assembled at build time.
- Navigation definitions: `leftNavigationDefinitions`, `ownerNavigationKeys`, `primaryWorkspaceGroups`, and
  `desktopNavigationWorkspaceIds` near `app.js` lines 900–1035.
- `WorkflowPreferences` is a typed Prisma model (frozen). The UI v2 flag is therefore localStorage only.

## Deliverables

1. `apps/web/src/` module tree; `app.js` becomes a thin entry that imports these modules:
   - `state.js` (shared state, element registry), `api.js` (fetch helpers), `nav.js` (nav definitions and
     rendering), `shell.js` (workspace switching, layout)
   - `workspaces/<name>.js`, one per workspace (home, sales, purchases→expenses, banking, contacts/crm,
     tax/accountant, reports, plus every extended workspace)
   - Move code verbatim; prefer moving whole functions. Shared helpers go to `src/lib/*.js`.
2. HTML partials in `apps/web/src/partials/<workspace>.html`, assembled into `index.html` by a build step
   added to `scripts/build-assets.mjs`. Keep `index.html` as the shell source with `<!-- @partial name -->`
   markers. `verify-assets.mjs` must still pass, and the dev and test flow (`run-browser-tests.mjs`) must
   use the assembled file.
3. `apps/web/src/ui-flags.js` exporting `isUiV2Enabled()` and `setUiV2Enabled(bool)`, backed by
   localStorage key `pennywise_ui_v2_v1`, default `false`. Nothing reads it yet except the stubs.
4. `apps/web/src/ui-kit/` with **documented stubs** (signature, props, empty render) for KpiCard, Pipeline,
   ListInspector, TaskPanel, AttentionQueue and EmptyState. Also add `apps/web/src/ui-kit/README.md`, which
   is the props contract every Wave 2 stream codes against (see 02 §2–§3).
5. `apps/web/src/charts.js` stub exporting `sparkline`, `bar`, `stackedBar`, `line`, `waterfall` and
   `chartTable` with documented signatures (Antigravity implements them in Wave 1).
6. Add `tier: "primary" | "more" | "admin"` and `featureKey` to each `leftNavigationDefinitions` entry.
   Data only; rendering is unchanged.
7. `apps/web/styles/` folder with an empty `<module>.css` per workspace, imported or concatenated by the
   build. `styles.css` keeps all existing rules (moving rules is U7's job).

## Acceptance

- **Zero behaviour change:**
  - all existing Playwright specs pass unmodified (`corepack.cmd pnpm test:e2e`);
  - `test:accessibility` and `test:performance` stay green;
  - `corepack.cmd pnpm check` stays green.
- `node scripts/ui-v2/measure-ui.mjs --check` passes; `largestJsFileLines` drops sharply.
- No diff under `packages/` or `apps/api/`.
- `docs/status/UI_V2_U0_REPORT.md` lists the module map: file → owner stream (matching 04 §3).
- Afterwards, run `node scripts/ui-v2/measure-ui.mjs --write wave-0` and commit `metrics.json`.

## Method hints

- Work in small commits (one workspace per commit) and run the targeted e2e spec after each.
- Avoid circular imports: workspaces import from `state`/`api`/`lib`/`ui-kit`, never from each other.
  Cross-workspace navigation goes through a `shell.navigateTo(workspaceId, options)` call.
