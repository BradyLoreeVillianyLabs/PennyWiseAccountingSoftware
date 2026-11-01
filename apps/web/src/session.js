// Sign-in, organization and company selection, and loading the active organization's data.

import { api, jsonRequest, redirectToAuth } from "./api.js";
import { preferredScrollBehavior } from "./lib/browser.js";
import {
  beginContextualCreation,
  cancelContextualCreation,
  closeContextualAccountDialog,
  createContextualAccount,
  openQuickCreateDialog,
  restoreQuickProductDraft,
  submitQuickCreate
} from "./lib/contextual-creation.js";
import { initializeBrowserFormDrafts } from "./lib/forms.js";
import { showError, showNotice } from "./lib/notices.js";
import { loadProductAnalyticsConsent } from "./lib/product-analytics.js";
import { activeRoleIs, formatRole } from "./lib/roles.js";
import { registerWorkspaceCalls } from "./lib/workspace-calls.js";
import {
  leftNavigationState,
  ownerWorkspaceIsEnabled,
  renderLeftNavigation,
  setLeftNavigationOpen,
  syncLeftNavigationState
} from "./nav.js";
import { closeAllHeaderDisclosures, navigateTo, workspaceIds } from "./shell.js";
import {
  activeWorkspaceId,
  contextualCreationParentState,
  contextualCreationState,
  controlledShareMode,
  elements,
  identity,
  localIdentityEmail,
  ownerWorkspaceMode,
  runtimeCapabilities,
  setActiveWorkspaceId,
  setContextualCreationParentState,
  setContextualCreationState,
  setIdentity,
  setLocalIdentityEmail,
  setOrganizationMemberships,
  setRuntimeCapabilities,
  setSetup,
  setWorkflowPreferencesState,
  setup
} from "./state.js";
import { loadBankFeedPanel, loadBanking } from "./workspaces/banking.js";
import { loadContracts } from "./workspaces/contracts.js";
import { loadPurchases } from "./workspaces/expenses.js";
import { loadFixedAssets } from "./workspaces/fixed-assets.js";
import {
  initializeDashboardAmountPrivacy,
  loadHomeDashboard,
  restoreDashboardPreferences
} from "./workspaces/home.js";
import { loadIntegrations } from "./workspaces/integrations.js";
import { loadInventory } from "./workspaces/inventory.js";
import { loadMembers } from "./workspaces/members.js";
import { loadPayments } from "./workspaces/payments.js";
import { loadPayroll } from "./workspaces/payroll.js";
import { loadPlanning } from "./workspaces/planning.js";
import { loadPortability } from "./workspaces/portability.js";
import { loadProjects, openPlanningTab, planningTabFromHash } from "./workspaces/projects.js";
import { loadReports } from "./workspaces/reports.js";
import { industryPresetIsReady, loadSales } from "./workspaces/sales.js";
import { loadSetup, refreshSetupState, setStep, showSetupStep } from "./workspaces/setup.js";
import { loadAccountant } from "./workspaces/taxes.js";

let companyDeleteState = null;
let invoiceFirstRunOrganization = null;
let sessionLoadSequence = 0;
const blankCompanyTemplateOption = "__new_blank_company__";
let companyMemberships = [];
export const localIdentityEnabled =
  !controlledShareMode && ["localhost", "127.0.0.1"].includes(window.location.hostname);

registerWorkspaceCalls({ loadSession, showWorkspaceNavigation });

export function initSession() {
  elements["sign-in"].addEventListener("click", () => {
    if (controlledShareMode) return;
    redirectToAuth("sign-in");
  });
  elements.recover.addEventListener("click", () => {
    if (controlledShareMode) return;
    redirectToAuth("recover");
  });
  elements["local-identity-form"].addEventListener("submit", useLocalIdentity);
  elements["sign-out"].addEventListener("click", signOut);
  elements["organization-form"].addEventListener("submit", createOrganization);
  elements["invoice-first-run-form"]?.addEventListener("submit", completeInvoiceFirstRun);
  elements["invoice-first-run-full-setup"]?.addEventListener("click", continueWithFullSetup);
  elements["invoice-first-run-form"]
    ?.querySelectorAll('[name="workspaceProfile"]')
    .forEach((input) => input.addEventListener("change", syncInvoiceFirstRunChoice));
  elements["invoice-first-run-form"]?.elements.province?.addEventListener(
    "change",
    syncInvoiceFirstRunProvince
  );
  document
    .querySelectorAll("[data-create-demo-company]")
    .forEach((button) => button.addEventListener("click", createDemoCompany));
  elements["select-organization"].addEventListener("click", selectOrganization);
  elements["organization-select"].addEventListener("change", syncOrganizationSelectLabel);
  elements["select-company"].addEventListener("click", selectCompany);
  elements["company-select"].addEventListener("change", handleCompanySelectChange);
  elements["company-create-form"].addEventListener("submit", createCompanyFromProfile);
  elements["company-management-list"].addEventListener("click", deleteCompanyFromProfile);
  elements["company-edit-form"].addEventListener("submit", saveCompanyFromProfile);
  elements["delete-current-company"].addEventListener("click", deleteCurrentCompany);
  elements["manage-companies"].addEventListener("click", () => openCompanyManagement("create"));
  elements["open-company-create"].addEventListener("click", () => openCompanyManagement("create"));
  elements["company-delete-confirmation"].addEventListener("input", syncCompanyDeleteConfirmation);
  elements["company-delete-form"].addEventListener("submit", submitCompanyDeleteConfirmation);
  elements["company-delete-dialog"].addEventListener("close", closeCompanyDeleteDialog);
  elements["contextual-account-form"].addEventListener("submit", createContextualAccount);
  elements["contextual-account-dialog"].addEventListener("close", closeContextualAccountDialog);
  elements["quick-create-form"].addEventListener("submit", submitQuickCreate);
  elements["quick-create-account-back"]?.addEventListener("click", () => {
    const parent = contextualCreationParentState;
    if (!parent) return;
    setContextualCreationState(parent);
    setContextualCreationParentState(null);
    openQuickCreateDialog("product", parent.typedValue ?? "");
    restoreQuickProductDraft(parent.quickProductDraft);
  });
  elements["quick-create-dialog"].addEventListener("close", () => {
    if (contextualCreationState?.kind === "account") {
      setContextualCreationState(contextualCreationParentState);
      setContextualCreationParentState(null);
    }
    if (
      contextualCreationState?.kind === "customer" ||
      contextualCreationState?.kind === "product" ||
      contextualCreationState?.kind === "vendor" ||
      contextualCreationState?.kind === "project"
    )
      setContextualCreationState(null);
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof globalThis.Element)) return;
    const button = target.closest("[data-contextual-create]");
    if (button instanceof globalThis.HTMLButtonElement) {
      const row = button.closest(".invoice-line-row");
      const itemInput = row?.querySelector('[data-line-field="item"]');
      if (itemInput) button.dataset.contextualTypedValue = itemInput.value.split(" | ")[0].trim();
      beginContextualCreation(button);
    }
  });
  document
    .querySelectorAll("[data-cancel-contextual-create]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        cancelContextualCreation(button.dataset.cancelContextualCreate)
      )
    );
  elements["cancel-contextual-tax-code"].addEventListener("click", () =>
    cancelContextualCreation("tax-code")
  );
  elements["local-identity-form"].hidden = !localIdentityEnabled;
  elements["local-test-account-picker"].hidden = !localIdentityEnabled;
  if (localIdentityEnabled) {
    const localIdentityEmailInput = elements["local-identity-form"].elements.email;
    elements["local-test-account-picker"]
      .querySelectorAll("[data-local-test-email]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          localIdentityEmailInput.value = button.dataset.localTestEmail ?? "";
          localIdentityEmailInput.focus();
        });
      });
  }
}

async function useLocalIdentity(event) {
  event.preventDefault();
  setLocalIdentityEmail(new FormData(event.currentTarget).get("email").trim().toLowerCase());
  sessionStorage.setItem("clearledger_local_identity", localIdentityEmail);
  await loadSession();
}

export async function loadSession() {
  const sessionLoad = ++sessionLoadSequence;
  elements["session-loading"].hidden = false;
  elements["signed-out"].hidden = true;
  const response = await api("/v1/auth/session", {}, true);
  // A local tester can select an identity while the anonymous boot request is
  // still in flight. Do not allow that older response to clear the active
  // organization after the newer session has already succeeded.
  if (sessionLoad !== sessionLoadSequence) return;
  if (!response.ok) {
    elements["session-loading"].hidden = true;
    if (controlledShareMode) {
      elements["controlled-share-loading"].dataset.state = "error";
      elements["controlled-share-title"].textContent = "Test company could not be opened";
      elements["controlled-share-message"].textContent =
        "Refresh this page. If the problem continues, ask the PennyWise Accounting owner to restart your protected share.";
    }
    showSignedOut();
    return;
  }
  const session = await response.json();
  setIdentity(session.identity);
  setRuntimeCapabilities({
    betaRuntime: session.runtimeCapabilities?.betaRuntime === true,
    emailDelivery: session.runtimeCapabilities?.emailDelivery === true,
    hostedPayments: session.runtimeCapabilities?.hostedPayments === true
  });
  applyRuntimeCapabilities();
  elements["session-loading"].hidden = true;
  elements.identity.textContent = identity.email;
  elements["sign-out"].hidden = false;
  elements["organization-toolbar"].hidden = false;
  elements["appearance-menu"].hidden = false;
  elements["signed-out"].hidden = true;
  elements.workspace.hidden = false;
  await Promise.all([loadOrganizations(), loadDemoCompanyCapability()]);
  if (sessionLoad !== sessionLoadSequence) return;
  if (identity.activeOrganizationId) {
    await loadProductAnalyticsConsent();
    await loadCompanies();
    await loadActiveOrganizationData();
    showWorkspaceNavigation();
  } else {
    elements["workspace-navigation"].hidden = true;
    elements["workspace-subnavigation"].hidden = true;
  }
}

function applyRuntimeCapabilities() {
  elements["sales-delivery-boundary"].hidden = runtimeCapabilities.emailDelivery;
  elements["payment-provider-boundary"].hidden = runtimeCapabilities.hostedPayments;
  elements["hosted-payment-settings-section"].hidden = !runtimeCapabilities.hostedPayments;
  elements["connect-payment-account"].hidden = !runtimeCapabilities.hostedPayments;
  elements["disconnect-payment-account"].hidden = !runtimeCapabilities.hostedPayments;
  elements["refund-submit"].textContent = runtimeCapabilities.hostedPayments
    ? "Initiate provider refund"
    : "Record refund already paid";
}

async function loadOrganizations() {
  const response = await api("/v1/organizations");
  if (!response.ok) return showError(response);
  const organizations = (await response.json()).organizations;
  setOrganizationMemberships(organizations);
  const storedOrganizationId = sessionStorage.getItem("clearledger_active_organization");
  if (
    !identity.activeOrganizationId &&
    storedOrganizationId &&
    organizations.some((organization) => organization.organizationId === storedOrganizationId)
  ) {
    identity.activeOrganizationId = storedOrganizationId;
  }
  // sessionStorage is per tab, so a new browser, a new tab or a cleared session
  // left a multi-business member with no active organization at all. Fall back to
  // the business they last opened on this device before treating them as adrift.
  if (!identity.activeOrganizationId) {
    const remembered = readRememberedOrganizationId();
    if (
      remembered &&
      organizations.some((organization) => organization.organizationId === remembered)
    ) {
      const switchResponse = await api(
        "/v1/organizations/switch",
        jsonRequest({ organizationId: remembered })
      );
      if (switchResponse.ok) {
        identity.activeOrganizationId = remembered;
        sessionStorage.setItem("clearledger_active_organization", remembered);
      }
    }
  }
  if (!identity.activeOrganizationId && organizations.length === 1) {
    const organizationId = organizations[0].organizationId;
    const switchResponse = await api("/v1/organizations/switch", jsonRequest({ organizationId }));
    if (!switchResponse.ok) return showError(switchResponse);
    identity.activeOrganizationId = organizationId;
    sessionStorage.setItem("clearledger_active_organization", organizationId);
    rememberOrganizationId(organizationId);
  }
  const hasActiveOrganization = Boolean(identity.activeOrganizationId);
  const organizationOptions = organizations.map((organization) => {
    const option = document.createElement("option");
    option.value = organization.organizationId;
    option.textContent = `${organization.displayName} | ${formatRole(organization.role)}`;
    option.title = option.textContent;
    option.selected = organization.organizationId === identity.activeOrganizationId;
    return option;
  });
  if (!hasActiveOrganization && organizations.length > 0) {
    // Without a placeholder every option is unselected and the control renders
    // blank, saying nothing about what it is for.
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a business";
    // Not `disabled`: a disabled option renders in the platform GrayText colour,
    // which on this canvas read as an empty control. selectOrganization() already
    // ignores an empty value, so the placeholder is inert without being greyed.
    placeholder.selected = true;
    organizationOptions.unshift(placeholder);
  }
  elements["organization-select"].replaceChildren(...organizationOptions);
  syncOrganizationSelectLabel();
  elements["settings-menu"].hidden = organizations.length === 0;
  renderOrganizationChooser(organizations, hasActiveOrganization);
  elements["organization-actions"].hidden = hasActiveOrganization;
  // Create/join is the right landing state only for someone with no business at
  // all. A member with existing businesses gets the chooser instead.
  elements["organization-actions"].open = !hasActiveOrganization && organizations.length === 0;
  elements["membership-admin"].hidden = !identity.activeOrganizationId;
}

async function loadCompanies() {
  const response = await api("/v1/organizations/current/companies");
  if (!response.ok) return showError(response);
  companyMemberships = (await response.json()).companies ?? [];
  const storedCompanyId = sessionStorage.getItem("clearledger_active_company");
  const activeCompany =
    companyMemberships.find((company) => company.id === identity.activeCompanyId) ??
    companyMemberships.find((company) => company.id === storedCompanyId) ??
    companyMemberships.find((company) => company.active) ??
    companyMemberships[0];
  if (activeCompany) identity.activeCompanyId = activeCompany.id;
  const select = elements["company-select"];
  const blankTemplate = document.createElement("option");
  blankTemplate.value = blankCompanyTemplateOption;
  blankTemplate.textContent = "＋ New blank company";
  blankTemplate.title = "Start a separate company from a clean template";
  select.replaceChildren(
    ...companyMemberships.map((company) => {
      const option = document.createElement("option");
      option.value = company.id;
      option.textContent = `${company.displayName} | ${company.baseCurrency} | ${formatRole(company.role)}`;
      option.title = `${company.legalName} — ${option.textContent}`;
      option.selected = company.id === identity.activeCompanyId;
      return option;
    }),
    blankTemplate
  );
  select.disabled = companyMemberships.length === 0;
  elements["select-company"].disabled = companyMemberships.length === 0;
  syncCompanySelectLabel();
  renderCompanyManagement();
}

function renderCompanyManagement() {
  const list = elements["company-management-list"];
  const form = elements["company-create-form"];
  const editForm = elements["company-edit-form"];
  if (!list || !form || !editForm) return;
  const canManage = activeRoleIs("OWNER", "ADMIN");
  form.querySelectorAll("input, button").forEach((control) => {
    control.disabled = !canManage;
  });
  const activeCompany = companyMemberships.find(
    (company) => company.id === identity.activeCompanyId
  );
  editForm.hidden = !activeCompany;
  editForm.querySelectorAll("input, button").forEach((control) => {
    control.disabled = !canManage;
  });
  if (activeCompany) {
    for (const field of ["legalName", "displayName", "baseCurrency", "timezone", "locale"]) {
      const control = editForm.elements[field];
      if (control) control.value = activeCompany[field] ?? "";
    }
    const deleteButton = elements["delete-current-company"];
    deleteButton.disabled = !canManage || companyMemberships.length <= 1;
    deleteButton.title =
      companyMemberships.length <= 1
        ? "Create another company before deleting this one."
        : "Archive this company and retain its records for audit.";
  }
  list.replaceChildren(
    ...companyMemberships.map((company) => {
      const card = document.createElement("article");
      card.className = "company-management-row";
      const copy = document.createElement("div");
      const heading = document.createElement("h4");
      heading.textContent = company.displayName;
      const details = document.createElement("p");
      details.textContent = `${company.legalName} · ${company.baseCurrency} · ${formatRole(company.role)}${company.active ? " · Open" : ""}`;
      copy.append(heading, details);
      const actions = document.createElement("div");
      actions.className = "company-management-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "secondary-command";
      open.textContent = company.active ? "Open" : "Switch";
      open.disabled = company.active;
      open.addEventListener("click", () => {
        elements["company-select"].value = company.id;
        selectCompany();
      });
      actions.append(open);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary-command";
      edit.textContent = "Edit";
      edit.disabled = !canManage;
      edit.addEventListener("click", () => openCompanyEditor(company.id));
      actions.append(edit);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-command danger-command";
      remove.dataset.deleteCompany = company.id;
      remove.textContent = "Remove";
      remove.disabled = !canManage || companyMemberships.length <= 1;
      remove.title =
        remove.disabled && companyMemberships.length <= 1
          ? "Create another company before removing this one."
          : "Archive this company and retain its records for audit.";
      actions.append(remove);
      card.append(copy, actions);
      return card;
    })
  );
  if (!companyMemberships.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No active companies are available in this workspace.";
    list.append(empty);
  }
}

async function createCompanyFromProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await api(
      "/v1/organizations/current/companies",
      jsonRequest({
        legalName: data.get("legalName"),
        displayName: data.get("displayName"),
        baseCurrency: data.get("baseCurrency"),
        timezone: data.get("timezone"),
        locale: data.get("locale")
      })
    );
    if (!response.ok) return showError(response);
    const result = await response.json();
    form.reset();
    await loadCompanies();
    elements["company-management-status"].textContent = result.company
      ? `${result.company.displayName} was created from the blank template. Select it above and choose Open company.`
      : "Company created.";
    showNotice("Company created.");
  } finally {
    button.disabled = !activeRoleIs("OWNER", "ADMIN");
  }
}

async function saveCompanyFromProfile(event) {
  event.preventDefault();
  const company = companyMemberships.find((item) => item.id === identity.activeCompanyId);
  if (!company) return showNotice("Open a company before saving its details.", true);
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await api(
      `/v1/organizations/current/companies/${encodeURIComponent(company.id)}`,
      jsonRequest(
        {
          legalName: data.get("legalName"),
          displayName: data.get("displayName"),
          baseCurrency: data.get("baseCurrency"),
          timezone: data.get("timezone"),
          locale: data.get("locale")
        },
        "PATCH"
      )
    );
    if (!response.ok) return showError(response);
    const result = await response.json();
    await loadCompanies();
    elements["company-management-status"].textContent =
      `${result.company?.displayName ?? "Company"} was saved.`;
    showNotice("Company saved.");
  } finally {
    button.disabled = !activeRoleIs("OWNER", "ADMIN");
  }
}

function openCompanyEditor(companyId) {
  if (companyId !== identity.activeCompanyId) {
    elements["company-select"].value = companyId;
    void selectCompany();
    return;
  }
  openCompanyManagement("edit");
}

function openCompanyManagement(mode = "edit") {
  const settingsButton = document.querySelector(
    '[data-settings-workspace="setup-workspace"][data-settings-target="profile-form"]'
  );
  if (settingsButton) settingsButton.click();
  else navigateTo("setup-workspace");
  window.setTimeout(() => {
    const target =
      mode === "create" ? elements["company-create-form"] : elements["company-edit-form"];
    target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
    const field = mode === "create" ? target?.elements.legalName : target?.elements.displayName;
    field?.focus();
  }, 0);
}

function handleCompanySelectChange() {
  const select = elements["company-select"];
  if (select.value === blankCompanyTemplateOption) {
    select.value = identity?.activeCompanyId ?? "";
    syncCompanySelectLabel();
    if (!activeRoleIs("OWNER", "ADMIN")) {
      showNotice("Only an owner or administrator can create a company.", true);
      return;
    }
    const form = elements["company-create-form"];
    form.reset();
    form.elements.baseCurrency.value = "CAD";
    form.elements.timezone.value = "America/Edmonton";
    form.elements.locale.value = "en-CA";
    openCompanyManagement("create");
    showNotice("Blank company template ready. Enter its details, then choose Create company.");
    return;
  }
  syncCompanySelectLabel();
}

function openCompanyDeleteDialog(companyId) {
  const company = companyMemberships.find((item) => item.id === companyId);
  if (!company) return;
  if (companyMemberships.length <= 1)
    return showNotice("Create another active company before archiving this one.", true);
  companyDeleteState = { companyId: company.id, displayName: company.displayName };
  elements["company-delete-confirmation-name"].textContent = company.displayName;
  elements["company-delete-confirmation"].value = "";
  elements["company-delete-status"].textContent = "";
  syncCompanyDeleteConfirmation();
  const dialog = elements["company-delete-dialog"];
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  elements["company-delete-confirmation"].focus();
}

function syncCompanyDeleteConfirmation() {
  const state = companyDeleteState;
  const value = elements["company-delete-confirmation"].value;
  elements["company-delete-confirm"].disabled = !state || value !== state.displayName;
}

async function submitCompanyDeleteConfirmation(event) {
  event.preventDefault();
  const state = companyDeleteState;
  if (!state || elements["company-delete-confirm"].disabled) return;
  const button = elements["company-delete-confirm"];
  button.disabled = true;
  elements["company-delete-status"].textContent = "Archiving company…";
  const response = await api(
    `/v1/organizations/current/companies/${encodeURIComponent(state.companyId)}`,
    jsonRequest({ confirmation: state.displayName }, "DELETE")
  );
  if (!response.ok) {
    button.disabled = false;
    return showError(response);
  }
  const result = (await response.json()).result;
  identity.activeCompanyId = result.replacementCompanyId;
  sessionStorage.setItem("clearledger_active_company", result.replacementCompanyId);
  await loadCompanies();
  elements["company-delete-dialog"].close();
  showNotice(`${state.displayName} archived. Its records were retained for audit.`);
}

function closeCompanyDeleteDialog() {
  companyDeleteState = null;
  elements["company-delete-confirmation"].value = "";
  elements["company-delete-status"].textContent = "";
  elements["company-delete-confirm"].disabled = true;
}

async function deleteCompanyFromProfile(event) {
  const button = event.target.closest?.("[data-delete-company]");
  if (!button || button.disabled) return;
  openCompanyDeleteDialog(button.dataset.deleteCompany);
}

async function deleteCurrentCompany(event) {
  const button = event.currentTarget;
  if (button.disabled) return;
  openCompanyDeleteDialog(identity?.activeCompanyId);
}

function syncOrganizationSelectLabel() {
  const select = elements["organization-select"];
  const selectedLabel = select.selectedOptions[0]?.textContent?.trim() || "Choose a business";
  select.title = selectedLabel;
  select.setAttribute("aria-label", `Active business: ${selectedLabel}`);
}

function syncCompanySelectLabel() {
  const select = elements["company-select"];
  const selectedLabel = select.selectedOptions[0]?.textContent?.trim() || "Choose a company";
  select.title = selectedLabel;
  select.setAttribute("aria-label", `Active company: ${selectedLabel}`);
}

function rememberedOrganizationStorageKey() {
  const email = identity?.email?.trim().toLowerCase();
  if (!email) return null;
  return `clearledger_last_organization:${encodeURIComponent(email)}`;
}

function readRememberedOrganizationId() {
  const key = rememberedOrganizationStorageKey();
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rememberOrganizationId(organizationId) {
  const key = rememberedOrganizationStorageKey();
  if (!key) return;
  try {
    window.localStorage.setItem(key, organizationId);
  } catch {
    // Local storage blocked; the tab-scoped sessionStorage entry still applies.
  }
}

function renderOrganizationChooser(organizations, hasActiveOrganization) {
  const chooser = elements["organization-chooser"];
  if (!chooser) return;
  const needsChoice = !hasActiveOrganization && organizations.length > 1;
  chooser.hidden = !needsChoice;
  if (!needsChoice) return;
  elements["organization-chooser-list"].replaceChildren(
    ...organizations.map((organization) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "organization-chooser-item";
      const name = document.createElement("span");
      name.className = "organization-chooser-name";
      name.textContent = organization.displayName;
      const role = document.createElement("span");
      role.className = "organization-chooser-role";
      role.textContent = formatRole(organization.role);
      button.append(name, role);
      button.setAttribute(
        "aria-label",
        `Open ${organization.displayName} as ${formatRole(organization.role)}`
      );
      button.addEventListener("click", () => openOrganization(organization.organizationId));
      item.append(button);
      return item;
    })
  );
}

async function openOrganization(organizationId) {
  if (!organizationId) return;
  const response = await api("/v1/organizations/switch", jsonRequest({ organizationId }));
  if (!response.ok) return showError(response);
  identity.activeOrganizationId = organizationId;
  setWorkflowPreferencesState(null);
  sessionStorage.setItem("clearledger_active_organization", organizationId);
  rememberOrganizationId(organizationId);
  sessionStorage.setItem("clearledger_notice_after_reload", "Organization selected.");
  window.location.reload();
}

async function selectOrganization() {
  await openOrganization(elements["organization-select"].value);
}

async function selectCompany() {
  const companyId = elements["company-select"].value;
  if (!companyId || companyId === identity?.activeCompanyId) return;
  const response = await api(
    "/v1/organizations/current/companies/switch",
    jsonRequest({ companyId })
  );
  if (!response.ok) return showError(response);
  identity.activeCompanyId = companyId;
  sessionStorage.setItem("clearledger_active_company", companyId);
  sessionStorage.setItem("clearledger_notice_after_reload", "Company selected.");
  window.location.reload();
}

async function createOrganization(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/organizations",
    jsonRequest({
      legalName: data.get("legalName"),
      displayName: data.get("displayName")
    })
  );
  if (!response.ok) return showError(response);
  const organization = (await response.json()).organization;
  invoiceFirstRunOrganization = organization;
  identity.activeOrganizationId = organization.id;
  setWorkflowPreferencesState(null);
  sessionStorage.setItem("clearledger_active_organization", organization.id);
  rememberOrganizationId(organization.id);
  event.target.reset();
  await loadOrganizations();
  await loadProductAnalyticsConsent();
  await loadCompanies();
  await loadActiveOrganizationData();
  setActiveWorkspaceId("setup-workspace");
  showWorkspaceNavigation();
  openInvoiceFirstRunDialog();
  showNotice("Organization created.");
}

function openInvoiceFirstRunDialog() {
  const dialog = elements["invoice-first-run-dialog"];
  const form = elements["invoice-first-run-form"];
  if (!dialog || !form || setup?.settings?.setupCompletedAt) return;
  form.reset();
  form.elements.province.value = "AB";
  form.elements.documentLanguage.value = "en-CA";
  elements["invoice-first-run-status"].textContent = "";
  syncInvoiceFirstRunChoice();
  syncInvoiceFirstRunProvince();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function syncInvoiceFirstRunChoice() {
  const form = elements["invoice-first-run-form"];
  const invoiceOnly = form?.elements.workspaceProfile.value === "INVOICING_ONLY";
  const details = elements["invoice-first-run-details"];
  const submit = elements["invoice-first-run-submit"];
  if (details) details.hidden = !invoiceOnly;
  if (submit) submit.hidden = !invoiceOnly;
  if (elements["invoice-first-run-full-setup"]) {
    elements["invoice-first-run-full-setup"].textContent = invoiceOnly
      ? "Continue with full setup"
      : "Start full setup";
  }
  for (const field of Array.from(details?.querySelectorAll?.("input, select") ?? []))
    field.disabled = !invoiceOnly;
}

function syncInvoiceFirstRunProvince() {
  const form = elements["invoice-first-run-form"];
  const isQuebec = form?.elements.province.value === "QC";
  const qstFields = elements["invoice-first-run-qst-fields"];
  if (qstFields) qstFields.hidden = !isQuebec;
  for (const field of Array.from(qstFields?.querySelectorAll?.("input") ?? []))
    field.disabled = !isQuebec;
}

function continueWithFullSetup() {
  const dialog = elements["invoice-first-run-dialog"];
  const form = elements["invoice-first-run-form"];
  if (form) form.reset();
  dialog?.close?.();
  navigateTo("setup-workspace", { scrollToTop: true, refreshData: false });
  showSetupStep("BUSINESS_PROFILE");
  showNotice("Full setup is ready. Complete the guided steps when you are ready.");
}

function invoiceFirstRunStatus(message, isError = false) {
  const status = elements["invoice-first-run-status"];
  if (status) {
    status.textContent = message;
    status.dataset.state = isError ? "error" : "ready";
  }
}

async function invoiceFirstRunRequest(path, options) {
  const response = await api(path, options);
  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    await showError(response);
    invoiceFirstRunStatus(
      `${path} failed: ${body?.error?.message ?? `request returned ${response.status}`}`,
      true
    );
    return null;
  }
  return response;
}

async function completeInvoiceFirstRun(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.workspaceProfile.value !== "INVOICING_ONLY") return continueWithFullSetup();
  if (!form.reportValidity() || !setup || !invoiceFirstRunOrganization) return;
  const submit = elements["invoice-first-run-submit"];
  const fullSetup = elements["invoice-first-run-full-setup"];
  submit.disabled = true;
  fullSetup.disabled = true;
  invoiceFirstRunStatus("Creating your accounting foundation…");
  try {
    const data = new FormData(form);
    const documentLanguage = data.get("documentLanguage");
    const today = new Date().toISOString().slice(0, 10);
    const startDate = `${new Date().getFullYear()}-01-01`;
    const profileResponse = await invoiceFirstRunRequest(
      "/v1/setup/profile",
      jsonRequest(
        {
          version: setup.settings.version,
          legalName: invoiceFirstRunOrganization.legalName,
          displayName: invoiceFirstRunOrganization.displayName,
          businessType: "SERVICE",
          businessAddress: {
            line1: data.get("addressLine1"),
            line2: null,
            city: data.get("city"),
            province: data.get("province"),
            postalCode: data.get("postalCode"),
            country: "CA"
          },
          mailingAddress: null,
          phone: data.get("phone") || null,
          email: data.get("email") || null,
          website: null,
          locale: documentLanguage === "fr-CA" ? "fr-CA" : "en-CA",
          timeZone: "America/Edmonton",
          baseCurrency: "CAD",
          fiscalYearEndMonth: 12,
          fiscalYearEndDay: 31,
          accountingStartDate: startDate,
          primaryColor: setup.settings.primaryColor,
          accentColor: setup.settings.accentColor
        },
        "PATCH"
      )
    );
    if (!profileResponse) return;
    setup.settings = (await profileResponse.json()).settings;

    const presetRequest = jsonRequest({});
    presetRequest.headers["idempotency-key"] =
      `invoice-first-run-general-service-${invoiceFirstRunOrganization.id}`;
    if (!(await invoiceFirstRunRequest("/v1/setup/presets/general-service/apply", presetRequest)))
      return;
    if (!(await invoiceFirstRunRequest("/v1/setup/fiscal-year/initialize", jsonRequest({}))))
      return;

    const registrationRequests = [
      {
        registrationType: "GST_HST",
        jurisdiction: "CA",
        registrationNumber: data.get("gstRegistered") === "on" ? data.get("gstNumber") : null,
        registered: data.get("gstRegistered") === "on",
        effectiveFrom: data.get("gstRegistered") === "on" ? today : null
      }
    ];
    if (data.get("province") === "QC") {
      registrationRequests.push({
        registrationType: "QST",
        jurisdiction: "QC",
        registrationNumber: data.get("qstRegistered") === "on" ? data.get("qstNumber") : null,
        registered: data.get("qstRegistered") === "on",
        effectiveFrom: data.get("qstRegistered") === "on" ? today : null
      });
    }
    for (const registration of registrationRequests)
      if (
        !(await invoiceFirstRunRequest(
          "/v1/setup/tax-registrations",
          jsonRequest(registration, "PUT")
        ))
      )
        return;

    const defaults = setup.defaults;
    const selectedPaymentMethods = data.getAll("paymentMethods");
    const defaultsResponse = await invoiceFirstRunRequest(
      "/v1/setup/defaults",
      jsonRequest(
        {
          version: defaults.version,
          paymentTermsDays: 30,
          invoicePrefix: "INV",
          invoiceNextPlaceholder: "0001",
          estimatePrefix: defaults.estimatePrefix,
          estimateNextPlaceholder: defaults.estimateNextPlaceholder,
          taxCalculationMode: defaults.taxCalculationMode,
          customerNotes: defaults.customerNotes,
          paymentInstructions: defaults.paymentInstructions,
          paymentMethods: selectedPaymentMethods,
          documentLanguage,
          dateFormat: defaults.dateFormat,
          numberFormat: documentLanguage === "fr-CA" ? "fr-CA" : "en-CA",
          showLogo: defaults.showLogo,
          showBusinessNumber: defaults.showBusinessNumber
        },
        "PUT"
      )
    );
    if (!defaultsResponse) return;
    setup.defaults = (await defaultsResponse.json()).defaults;

    await refreshSetupState();
    const preferencesResponse = await invoiceFirstRunRequest(
      "/v1/settings/workflow-preferences",
      {}
    );
    if (!preferencesResponse) return;
    const preferenceState = await preferencesResponse.json();
    const profile = preferenceState.profileDefaults.find((item) => item.key === "INVOICING_ONLY");
    if (!profile) throw new Error("The invoicing-only profile is unavailable.");
    const updatedPreferences = await invoiceFirstRunRequest(
      "/v1/settings/workflow-preferences",
      jsonRequest(
        {
          version: preferenceState.workflowPreferences.version,
          profileKey: "INVOICING_ONLY",
          ownerWorkspaceEnabled: profile.ownerWorkspaceEnabled,
          bankFeedReviewRequired: profile.bankFeedReviewRequired,
          cashPlanningEnabled: profile.cashPlanningEnabled,
          purchaseRequestsEnabled: profile.purchaseRequestsEnabled,
          purchaseApprovalThresholdMinor: profile.purchaseApprovalThresholdMinor.toString(),
          requireSeparatePurchaseApprover: profile.requireSeparatePurchaseApprover,
          customerDepositsEnabled: profile.customerDepositsEnabled,
          progressBillingEnabled: profile.progressBillingEnabled,
          fixedAssetRegisterEnabled: profile.fixedAssetRegisterEnabled,
          payrollSummaryImportEnabled: false
        },
        "PUT"
      )
    );
    if (!updatedPreferences) return;
    setWorkflowPreferencesState(await updatedPreferences.json());

    await refreshSetupState();
    for (const [step, status] of [
      ["BUSINESS_PROFILE", "COMPLETED"],
      ["FISCAL_CURRENCY", "COMPLETED"],
      ["TAX_REGISTRATION", "COMPLETED"],
      ["INDUSTRY_PRESET", "COMPLETED"],
      ["CHART_REVIEW", "COMPLETED"],
      ["OPENING_BALANCES", "SKIPPED"],
      ["BRANDING_DEFAULTS", "COMPLETED"]
    ]) {
      if (!(await setStep(step, status, false))) return;
    }
    await refreshSetupState();
    const completion = await invoiceFirstRunRequest(
      "/v1/setup/complete",
      jsonRequest({ version: setup.settings.version })
    );
    if (!completion) return;

    const logo = form.elements.logo.files?.[0];
    if (logo) {
      if (
        !(await invoiceFirstRunRequest("/v1/setup/logo", {
          method: "POST",
          headers: { "content-type": logo.type },
          body: logo
        }))
      )
        return;
    }
    elements["invoice-first-run-dialog"]?.close?.();
    invoiceFirstRunOrganization = null;
    await loadActiveOrganizationData();
    showWorkspaceNavigation();
    navigateTo("overview-workspace");
    showNotice(
      "Invoicing is ready. Your balanced accounting foundation uses CAD, Net 30, and INV-0001."
    );
  } catch (error) {
    invoiceFirstRunStatus(
      error instanceof Error ? error.message : "Setup could not be completed. Try again.",
      true
    );
  } finally {
    submit.disabled = false;
    fullSetup.disabled = false;
  }
}

async function loadDemoCompanyCapability() {
  const response = await api("/v1/demo-company/capabilities", {}, true);
  const available = response.ok && (await response.json()).demoCompany?.available === true;
  for (const option of document.querySelectorAll("[data-demo-company-option]")) {
    option.hidden = !available;
  }
}

async function createDemoCompany() {
  const buttons = [...document.querySelectorAll("[data-create-demo-company]")];
  const status = document.querySelector(".demo-company-status");
  for (const button of buttons) {
    button.disabled = true;
    button.textContent = "Building demo company…";
  }
  if (status) status.textContent = "Creating isolated sample records and checking the books…";
  try {
    const request = jsonRequest({ templateKey: "canadian-service" });
    request.headers["idempotency-key"] = `demo-company-canadian-service-v1-${identity.id}`;
    const response = await api("/v1/demo-company", request);
    if (!response.ok) return showError(response);
    const result = (await response.json()).demoCompany;
    if (
      !result?.fictional ||
      !result.setupComplete ||
      !result.journalsBalanced ||
      !result.enabledCurrencies?.includes("CAD") ||
      !result.enabledCurrencies?.includes("USD") ||
      !(result.counts?.postedJournals > 0)
    ) {
      showNotice(
        "The demo company was not opened because its setup or accounting checks did not finish.",
        true
      );
      return;
    }
    const switchResponse = await api(
      "/v1/organizations/switch",
      jsonRequest({ organizationId: result.organizationId })
    );
    if (!switchResponse.ok) return showError(switchResponse);
    sessionStorage.setItem("clearledger_active_organization", result.organizationId);
    sessionStorage.setItem(
      "clearledger_notice_after_reload",
      `${result.displayName} is ready with fictional sample data and balanced journals.`
    );
    window.location.reload();
  } finally {
    for (const button of buttons) {
      button.disabled = false;
      button.textContent = "Create demo company";
    }
  }
}

async function loadActiveOrganizationData() {
  restoreDashboardPreferences();
  initializeDashboardAmountPrivacy();
  // Establish the active company's setup state before asking the dashboard for
  // accounting balances. A newly created company intentionally has no control
  // accounts, and its dashboard endpoint correctly rejects balance requests
  // until the chart-of-accounts preset is complete.
  setSetup(null);
  await Promise.allSettled([loadMembers(), loadSetup()]);
  await loadHomeDashboard();
  const startingAccountsReady = industryPresetIsReady();
  if (!startingAccountsReady) {
    // Banking setup is often the first next step for a new owner. Its secure
    // connection boundary must be visible before the chart-of-accounts preset
    // exists, even though transactions and reconciliation are not available yet.
    await loadBankFeedPanel();
    initializeBrowserFormDrafts();
    showNotice("");
    return;
  }
  await Promise.allSettled([
    loadSales(),
    loadPayments(),
    loadPurchases(),
    loadBanking(),
    loadPlanning(),
    loadFixedAssets(),
    loadProjects(),
    loadContracts(),
    loadInventory(),
    loadReports(),
    loadAccountant(),
    loadPayroll(),
    loadPortability(),
    loadIntegrations()
  ]);
  initializeBrowserFormDrafts();
}

async function signOut() {
  const response = await api("/v1/auth/sign-out", jsonRequest({}));
  if (!response.ok) return showError(response);
  const result = await response.json();
  if (result.providerLogoutUrl) window.location.assign(result.providerLogoutUrl);
  else {
    setLocalIdentityEmail(null);
    sessionStorage.removeItem("clearledger_local_identity");
    sessionStorage.removeItem("clearledger_active_organization");
    showSignedOut();
  }
}

export function showSignedOut() {
  setIdentity(null);
  setWorkflowPreferencesState(null);
  setOrganizationMemberships([]);
  companyMemberships = [];
  closeAllHeaderDisclosures();
  elements.identity.textContent = "";
  elements["sign-out"].hidden = true;
  elements["organization-toolbar"].hidden = true;
  elements["organization-actions"].hidden = false;
  elements["organization-actions"].open = false;
  elements["settings-menu"].hidden = true;
  elements["appearance-menu"].hidden = true;
  elements["global-search-menu"].hidden = true;
  elements["task-finder-menu"].hidden = true;
  elements["global-create-menu"].hidden = true;
  elements["workspace-mode-switch"].hidden = true;
  elements["workspace-navigation"].hidden = true;
  syncLeftNavigationState();
  elements["workspace-subnavigation"].hidden = true;
  elements["session-loading"].hidden = true;
  elements["signed-out"].hidden = false;
  elements.workspace.hidden = true;
}

function showWorkspaceNavigation() {
  elements["workspace-navigation"].hidden = false;
  renderLeftNavigation();
  setLeftNavigationOpen(leftNavigationState.open);
  elements["global-search-menu"].hidden = false;
  elements["task-finder-menu"].hidden = false;
  elements["global-create-menu"].hidden = false;
  elements["settings-menu"].hidden = false;
  elements["workspace-mode-switch"].hidden = false;
  const defaultWorkspace =
    ownerWorkspaceMode && ownerWorkspaceIsEnabled() ? "owner-workspace" : "overview-workspace";
  const target = workspaceIds.includes(activeWorkspaceId) ? activeWorkspaceId : defaultWorkspace;
  const planningTab = planningTabFromHash();
  if (planningTab) openPlanningTab(planningTab, { updateHash: false, scroll: false });
  else navigateTo(target, { scrollToTop: false, refreshData: false });
  announceEmailConnectionCallback();
}

function announceEmailConnectionCallback() {
  const url = new URL(window.location.href);
  const provider = url.searchParams.get("email-connection");
  const status = url.searchParams.get("email-connection-status");
  if (!provider || !status) return;
  const label = provider === "GMAIL" ? "Gmail" : "Microsoft email";
  showNotice(
    status === "connected"
      ? `${label} authorization completed. Review the connection in Integrations before using any sending workflow.`
      : `${label} authorization did not complete. No mailbox credential was saved.`
  );
  url.searchParams.delete("email-connection");
  url.searchParams.delete("email-connection-status");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
}
