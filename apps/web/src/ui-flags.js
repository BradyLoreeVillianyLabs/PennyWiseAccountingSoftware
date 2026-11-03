// UI v2 feature flag. Kept in localStorage because the typed WorkflowPreferences model is frozen.
const uiV2StorageKey = "pennywise_ui_v2_v1";

export function isUiV2Enabled() {
  try {
    return window.localStorage.getItem(uiV2StorageKey) === "true";
  } catch {
    return false;
  }
}

export function setUiV2Enabled(enabled) {
  try {
    window.localStorage.setItem(uiV2StorageKey, String(Boolean(enabled)));
  } catch {
    // Without browser storage the classic layout stays active.
  }
}
