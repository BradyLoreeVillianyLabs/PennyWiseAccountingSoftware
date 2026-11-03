// Entry point. Modules only declare; this file runs startup in order.

import { showNotice } from "./src/lib/notices.js";
import { fillRoleSelect } from "./src/lib/roles.js";
import { initNavigation } from "./src/nav.js";
import { initSession, loadSession, localIdentityEnabled, showSignedOut } from "./src/session.js";
import { initShell, initShellLayout, restoreDisplayPreferences } from "./src/shell.js";
import { controlledShareMode, elements, localIdentityEmail } from "./src/state.js";
import "./src/workspaces/about.js";
import { initBanking } from "./src/workspaces/banking.js";
import { initContacts } from "./src/workspaces/contacts.js";
import { initContracts } from "./src/workspaces/contracts.js";
import { initExpenses } from "./src/workspaces/expenses.js";
import { initFixedAssets } from "./src/workspaces/fixed-assets.js";
import { initFulfilment } from "./src/workspaces/fulfilment.js";
import {
  filterHelpTopics,
  initHelp,
  renderGuidedTour,
  syncDashboardHelpPanel
} from "./src/workspaces/help.js";
import { initHome } from "./src/workspaces/home.js";
import { completeEtsyOAuthFromCallback, initIntegrations } from "./src/workspaces/integrations.js";
import { initInventory } from "./src/workspaces/inventory.js";
import { initMembers } from "./src/workspaces/members.js";
import { initOwner } from "./src/workspaces/owner.js";
import { initPayments } from "./src/workspaces/payments.js";
import { initPayroll } from "./src/workspaces/payroll.js";
import { initPlanning } from "./src/workspaces/planning.js";
import {
  initPortability,
  renderImportSourceGuide,
  renderImportTemplateGuidance,
  setMigrationStep
} from "./src/workspaces/portability.js";
import { initPos } from "./src/workspaces/pos.js";
import { initProjects } from "./src/workspaces/projects.js";
import { initReports } from "./src/workspaces/reports.js";
import { initSales } from "./src/workspaces/sales.js";
import { initSetup } from "./src/workspaces/setup.js";
import { initTaxes } from "./src/workspaces/taxes.js";

// Bind every workspace before the first render or session load.
initShellLayout();
initSession();
initMembers();
initSetup();
initContracts();
initOwner();
initPos();
initSales();
initPayments();
initExpenses();
initProjects();
initContacts();
initPlanning();
initFixedAssets();
initBanking();
initInventory();
initReports();
initPayroll();
initTaxes();
initPortability();
initIntegrations();
initNavigation();
initShell();
initHome();
initHelp();
initFulfilment();

restoreDisplayPreferences();
renderGuidedTour();
filterHelpTopics();
syncDashboardHelpPanel();
renderImportSourceGuide();
renderImportTemplateGuidance();
setMigrationStep(0);
fillRoleSelect(elements["invitation-form"].elements.role);
// A brand-new local browser has no identity yet. Avoid a guaranteed 401 while
// the local identity form is available; it also removes a race with a user
// selecting that identity during page boot. Controlled shares and signed-in
// browsers still initialize their session immediately.
if (controlledShareMode || localIdentityEmail || !localIdentityEnabled) await loadSession();
else showSignedOut();
await completeEtsyOAuthFromCallback();
const noticeAfterReload = sessionStorage.getItem("clearledger_notice_after_reload");
if (noticeAfterReload) {
  sessionStorage.removeItem("clearledger_notice_after_reload");
  showNotice(noticeAfterReload);
}
