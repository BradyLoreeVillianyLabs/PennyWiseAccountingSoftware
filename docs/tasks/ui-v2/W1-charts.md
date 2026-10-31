# Wave 1 — charts.js (dependency-free SVG charts)

- **Engine:** Antigravity · **Wave:** 1 · **Slot:** 3 · **Branch:** `ui/charts`
- **Contract:** [README.md#agent-contract](README.md#agent-contract) · **Spec:** 02 §2, §4, §5 · **Owns:**
  `apps/web/src/charts.js`, `apps/web/styles/charts.css`, `apps/web/e2e/charts.*.spec.ts`

## Deliverables

Implement the U0 stub signatures in `charts.js`: `sparkline`, `bar` (with optional overlaid net line),
`stackedBar`, `line` and `waterfall` (cash flow).

- **Pure functions.** Data in, `SVGElement` out, built with `document.createElementNS`. No `innerHTML`
  strings, no inline `style` attributes (CSP), no libraries.
- **Inputs:** money arrives as **bigint minor units** or preformatted strings. Scale with `Number()` only to
  compute geometry; never display those numbers directly. Labels use `money.js` formatters.
- **Accessibility:**
  - every chart gets `role="img"`, an `aria-label` summary sentence, and a sibling visually hidden
    `<table>` fallback (helper `chartTable()`);
  - colour is never the only signal; use pattern fills, which also keep grayscale print readable;
  - support the high-contrast and dark tokens.
- **Drill-down:** every bar, segment or point accepts an `onSelect(datum)` callback so reports can open
  the same table rows.
- **Responsive:** use the `viewBox`; correct at 1366×768 and at 200% zoom. Empty, zero and negative data
  must render a sensible empty or zero state.
- Add a demo page reachable only in development (or a Playwright fixture page) rendering every chart type
  with edge-case data.

## Acceptance

- `e2e/charts.render.spec.ts` covers:
  - each chart type with normal, empty, single-point and negative data;
  - an axe scan with no violations;
  - a visual screenshot baseline.
- `metrics.json` `visuals.chartElements` > 0 after merge (the demo/fixture counts).
- Gate C self-check: screenshots attached at 1366×768 and 1920×1080 in light, dark and high-contrast themes.
