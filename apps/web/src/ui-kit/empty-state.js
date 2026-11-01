/**
 * What to show when data is missing, for example "No bank account connected yet." Use this rather
 * than a zero amount.
 *
 * @param {object} props
 * @param {string} props.message What is missing.
 * @param {{ label: string, onAction: () => void }} [props.action] The one next step.
 * @returns {DocumentFragment} Empty until U1 implements the component.
 */
export function EmptyState(props) {
  void props;
  return document.createDocumentFragment();
}
