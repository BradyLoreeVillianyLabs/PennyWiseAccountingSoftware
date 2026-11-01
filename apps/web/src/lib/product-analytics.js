// Consent-aware product analytics.

import { api, jsonRequest } from "../api.js";
import { showError } from "./notices.js";
import { activeRoleIs } from "./roles.js";
import { elements, identity } from "../state.js";

let productAnalyticsConsent = false;

export function trackProductEvent(eventType) {
  if (!identity?.activeOrganizationId || !globalThis.crypto?.randomUUID || !productAnalyticsConsent)
    return;
  void api(
    "/v1/product-events",
    jsonRequest({ clientEventId: globalThis.crypto.randomUUID(), eventType, eventVersion: 1 }),
    true
  ).catch(() => undefined);
}

export async function loadProductAnalyticsConsent() {
  const checkbox = elements["product-analytics-consent"];
  const note = elements["product-analytics-consent-note"];
  const canManageConsent = activeRoleIs("OWNER", "ADMIN");
  productAnalyticsConsent = false;
  checkbox.checked = false;
  checkbox.disabled = !canManageConsent;
  note.textContent = canManageConsent
    ? "Organization owners and admins can enable or withdraw this optional setting."
    : "Your organization owner or admin controls this optional setting for all members.";
  const response = await api("/v1/product-analytics/consent", {}, true);
  if (!response.ok) return;
  const consent = (await response.json()).consent;
  productAnalyticsConsent = consent?.enabled === true;
  checkbox.checked = productAnalyticsConsent;
}

export async function setProductAnalyticsConsent(enabled) {
  const checkbox = elements["product-analytics-consent"];
  checkbox.disabled = true;
  try {
    const response = await api("/v1/product-analytics/consent", jsonRequest({ enabled }), true);
    if (!response.ok) {
      checkbox.checked = productAnalyticsConsent;
      return showError(response);
    }
    const consent = (await response.json()).consent;
    productAnalyticsConsent = consent?.enabled === true;
    checkbox.checked = productAnalyticsConsent;
    if (productAnalyticsConsent) trackProductEvent("PRODUCT_ANALYTICS_OPTED_IN");
  } finally {
    checkbox.disabled = !activeRoleIs("OWNER", "ADMIN");
  }
}
