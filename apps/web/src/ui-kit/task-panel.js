/**
 * The right-side panel or full-height drawer for create and edit tasks. It never opens inline
 * above a list.
 *
 * @param {object} props
 * @param {string} props.title The task's heading.
 * @param {HTMLElement} props.content The form. Existing forms move in; they are not recreated.
 * @param {boolean} [props.open] Whether the panel is showing.
 * @param {() => void} props.onClose Called when the panel closes, returning focus to its opener.
 * @returns {DocumentFragment} Empty until U1 implements the component.
 */
export function TaskPanel(props) {
  void props;
  return document.createDocumentFragment();
}
