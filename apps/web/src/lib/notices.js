// User-facing status messages.

import { elements } from "../state.js";
import { t } from "../../strings.js";

export async function showError(response) {
  const body = await response.json().catch(() => null);
  showNotice(body?.error?.message ?? t("app.requestFailed"), true);
}

export function showNotice(message, isError = false) {
  elements.notice.textContent = message;
  elements.notice.dataset.state = message ? (isError ? "error" : "success") : "idle";
  elements.notice.setAttribute("role", isError ? "alert" : "status");
  elements.notice.setAttribute("aria-live", isError ? "assertive" : "polite");
  if (isError) elements.notice.focus();
}
