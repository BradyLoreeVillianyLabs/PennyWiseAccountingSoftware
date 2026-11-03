/**
 * The status steps above a landing list. Each count is a link that sets the list filter.
 *
 * @param {object} props
 * @param {Array<{ key: string, label: string, count: number }>} props.steps Steps in workflow order.
 * @param {string} [props.activeKey] The step whose filter is applied.
 * @param {(key: string) => void} props.onSelect Called with the chosen step's key.
 * @returns {DocumentFragment} Empty until U1 implements the component.
 */
export function Pipeline(props) {
  void props;
  return document.createDocumentFragment();
}
