// Fetch helpers for the PennyWise API.

import { showNotice } from "./lib/notices.js";
import { identity, localIdentityEmail } from "./state.js";
import { t } from "../strings.js";

export function redirectToAuth(flow) {
  const returnTo = new URL("/", window.location.href).toString();
  window.location.assign(`/api/v1/auth/${flow}?returnTo=${encodeURIComponent(returnTo)}`);
}

export function api(path, options = {}, quiet = false) {
  const headers = new Headers(options.headers);
  if (localIdentityEmail) {
    headers.set("x-clearledger-user-email", localIdentityEmail);
    headers.set("x-clearledger-user-name", localIdentityEmail);
  }
  // Local development identity is header-backed. Restore the last explicit
  // local selection before the first session response arrives so a reload
  // cannot leave the UI authenticated but context-less. Controlled shares do
  // not use this fallback: their server injects the mapped tester context.
  const activeOrganizationId =
    identity?.activeOrganizationId ??
    (localIdentityEmail ? sessionStorage.getItem("clearledger_active_organization") : null);
  const activeCompanyId =
    identity?.activeCompanyId ??
    (localIdentityEmail ? sessionStorage.getItem("clearledger_active_company") : null);
  if (activeOrganizationId) headers.set("x-clearledger-organization-id", activeOrganizationId);
  if (activeCompanyId) headers.set("x-clearledger-company-id", activeCompanyId);
  return fetch(`/api${path}`, { credentials: "include", ...options, headers }).catch(() => {
    if (!quiet) showNotice(t("app.serviceUnavailable"));
    return new Response(null, { status: 503 });
  });
}

export function jsonRequest(body, method = "POST") {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
