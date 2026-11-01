/**
 * One headline figure on a landing page or Home. See README.md for the shared rules.
 *
 * @param {object} props
 * @param {string} props.label Short metric name, for example "Outstanding".
 * @param {string} props.value Preformatted value. Format money through money.js first.
 * @param {string} [props.comparison] Preformatted comparison, for example "▲ 12% vs last month".
 * @param {SVGElement | null} [props.sparkline] A chart from charts.js.
 * @param {() => void} [props.onSelect] Opens the filtered list behind this figure.
 * @returns {DocumentFragment} Empty until U1 implements the component.
 */
export function KpiCard(props) {
  void props;
  return document.createDocumentFragment();
}
