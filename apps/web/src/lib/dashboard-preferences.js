// Default Home dashboard preferences.

export const dashboardTilePreferences = [
  {
    key: "summary",
    targetId: "home-business-summary",
    label: "Business summary"
  },
  {
    key: "attention",
    targetId: "home-attention-section",
    label: "Needs attention"
  },
  { key: "cash", targetId: "home-cash-section", label: "Cash & tax" },
  {
    key: "booksHealth",
    targetId: "books-health-card",
    label: "Books Health"
  },
  {
    key: "quickActions",
    targetId: "home-quick-actions",
    label: "Quick actions"
  },
  {
    key: "gettingStarted",
    targetId: "home-getting-started",
    // Renamed from "Getting started": the help panel already owns that name, and
    // two surfaces with the same label on one screen is what finding A5 describes.
    label: "Setup checklist"
  },
  // The Business center is a navigation surface, not a financial indicator, so it
  // sits last by default and is hideable like any other tile. Listing it here is
  // what lets applyDashboardPreferences move it inside the dashboard grid, below
  // the figures it used to push off the screen.
  {
    key: "businessCenter",
    targetId: "home-command-center",
    label: "Business center"
  }
];
// Version 2 added the businessCenter tile. Stored version 1 preferences are
// re-normalized so the new tile appears instead of being silently dropped.
export const dashboardPreferenceVersion = 2;
export let dashboardPreferences = defaultDashboardPreferences();

export function setDashboardPreferences(value) {
  return (dashboardPreferences = value);
}

export function defaultDashboardPreferences() {
  return {
    version: dashboardPreferenceVersion,
    layout: "balanced",
    tiles: dashboardTilePreferences.map((tile) => ({
      key: tile.key,
      visible: true,
      size: "standard"
    }))
  };
}
