// Dependency-free SVG charts. U0 declares the signatures; the Wave 1 charts stream implements them.
//
// Shared rules for every chart (docs/tasks/ui-v2/W1-charts.md):
// - Each function returns an element built with document.createElementNS, or null while stubbed.
// - A datum's `value` is bigint minor units or a preformatted string. Scale with Number() only to
//   compute geometry, and format every displayed amount through money.js.
// - `options.label` is the summary sentence used for role="img" and aria-label.
// - `options.onSelect(datum)` runs when a bar, segment, or point is chosen.

/**
 * @param {Array<{ label: string, value: bigint | string }>} data Points in display order.
 * @param {{ label: string }} options
 * @returns {SVGElement | null}
 */
export function sparkline(data, options) {
  void data;
  void options;
  return null;
}

/**
 * @param {Array<{ label: string, value: bigint | string, net?: bigint | string }>} data Bars, each
 *   with an optional `net` value for the overlaid net line.
 * @param {{ label: string, onSelect?: (datum: object) => void }} options
 * @returns {SVGElement | null}
 */
export function bar(data, options) {
  void data;
  void options;
  return null;
}

/**
 * @param {Array<{ label: string, segments: Array<{ label: string, value: bigint | string }> }>} data
 * @param {{ label: string, onSelect?: (datum: object) => void }} options
 * @returns {SVGElement | null}
 */
export function stackedBar(data, options) {
  void data;
  void options;
  return null;
}

/**
 * @param {Array<{ label: string, value: bigint | string }>} data Points in display order.
 * @param {{ label: string, onSelect?: (datum: object) => void }} options
 * @returns {SVGElement | null}
 */
export function line(data, options) {
  void data;
  void options;
  return null;
}

/**
 * @param {Array<{ label: string, value: bigint | string, total?: boolean }>} data Steps in order; a
 *   `total` step is drawn from zero, as cash-flow opening and closing balances are.
 * @param {{ label: string, onSelect?: (datum: object) => void }} options
 * @returns {SVGElement | null}
 */
export function waterfall(data, options) {
  void data;
  void options;
  return null;
}

/**
 * Builds the visually hidden table that sits beside a chart as its text alternative.
 *
 * @param {Array<{ label: string, value: bigint | string }>} data
 * @param {{ caption: string, columns: string[] }} options
 * @returns {HTMLTableElement | null}
 */
export function chartTable(data, options) {
  void data;
  void options;
  return null;
}
