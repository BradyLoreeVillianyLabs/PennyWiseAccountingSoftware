/**
 * The "Needs attention" list on Home: at most five rows, ranked by deadline and amount, with one
 * verb per row.
 *
 * @param {object} props
 * @param {Array<{ id: string, message: string, actionLabel: string, onAction: () => void }>} props.items
 *   Rows in display order. Items past the fifth are not shown.
 * @param {string} [props.emptyMessage] Shown when nothing needs attention.
 * @returns {DocumentFragment} Empty until U1 implements the component.
 */
export function AttentionQueue(props) {
  void props;
  return document.createDocumentFragment();
}
