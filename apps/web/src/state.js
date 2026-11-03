// Shared state and the element registry. Reads use live bindings; writes go through the exported setters.

import { applyCatalog } from "../strings.js";

export const roles = [
  "ADMIN",
  "ACCOUNTANT",
  "BOOKKEEPER",
  "SALES",
  "PURCHASES",
  "INVENTORY",
  "READ_ONLY"
];
export let contextualCreationState = null;
export let paymentInstructionSettings = null;
export let multiCurrencySettingsRequestSequence = 0;
export let multiCurrencyEnabledLocally = false;
export const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);
applyCatalog();
export const controlledShareMode =
  document.documentElement.dataset.runtimeMode === "controlled-share";
export let identity = null;
export let runtimeCapabilities = {
  betaRuntime: false,
  emailDelivery: false,
  hostedPayments: false
};
export let localIdentityEmail = sessionStorage.getItem("clearledger_local_identity");
export let setup = null;
export let workflowPreferencesState = null;
export let multiCurrencyState = null;
export let organizationMemberships = [];
export let teamMembers = [];
export let accounts = [];
export let activePreviewInvoice = null;
export let contracts = [];
export let customers = [];
export let invoices = [];
export let estimates = [];
export let payments = [];
export let vendors = [];
export let bills = [];
export let purchaseRequests = [];
export let projects = [];
export let projectWorkItems = [];
export let customerContacts = [];
export const customerContactsById = new Map();
export let budgets = [];
export let fixedAssets = [];
export let bankTransactions = [];
export let currentReconciliation = null;
export let products = [];
export let activeInvoiceDraft = null;
export let contextualCreationParentState = null;
export let inventoryLocations = [];
export let currentReportState = null;
export const ownerWorkspaceModeStorageKey = "pennywise_owner_workspace_mode_v1";
export let ownerWorkspaceMode =
  window.localStorage.getItem(ownerWorkspaceModeStorageKey) !== "false";
export let activeWorkspaceId =
  sessionStorage.getItem("clearledger_active_workspace") ||
  (ownerWorkspaceMode ? "owner-workspace" : "overview-workspace");
export let calendarEvents = [];
export let spreadsheetEntryState = { form: null, columns: [], rows: [] };

export function setContextualCreationState(value) {
  return (contextualCreationState = value);
}

export function setPaymentInstructionSettings(value) {
  return (paymentInstructionSettings = value);
}

export function setMultiCurrencySettingsRequestSequence(value) {
  return (multiCurrencySettingsRequestSequence = value);
}

export function setMultiCurrencyEnabledLocally(value) {
  return (multiCurrencyEnabledLocally = value);
}

export function setIdentity(value) {
  return (identity = value);
}

export function setRuntimeCapabilities(value) {
  return (runtimeCapabilities = value);
}

export function setLocalIdentityEmail(value) {
  return (localIdentityEmail = value);
}

export function setSetup(value) {
  return (setup = value);
}

export function setWorkflowPreferencesState(value) {
  return (workflowPreferencesState = value);
}

export function setMultiCurrencyState(value) {
  return (multiCurrencyState = value);
}

export function setOrganizationMemberships(value) {
  return (organizationMemberships = value);
}

export function setTeamMembers(value) {
  return (teamMembers = value);
}

export function setAccounts(value) {
  return (accounts = value);
}

export function setActivePreviewInvoice(value) {
  return (activePreviewInvoice = value);
}

export function setContracts(value) {
  return (contracts = value);
}

export function setCustomers(value) {
  return (customers = value);
}

export function setInvoices(value) {
  return (invoices = value);
}

export function setEstimates(value) {
  return (estimates = value);
}

export function setPayments(value) {
  return (payments = value);
}

export function setVendors(value) {
  return (vendors = value);
}

export function setBills(value) {
  return (bills = value);
}

export function setPurchaseRequests(value) {
  return (purchaseRequests = value);
}

export function setProjects(value) {
  return (projects = value);
}

export function setProjectWorkItems(value) {
  return (projectWorkItems = value);
}

export function setCustomerContacts(value) {
  return (customerContacts = value);
}

export function setBudgets(value) {
  return (budgets = value);
}

export function setFixedAssets(value) {
  return (fixedAssets = value);
}

export function setBankTransactions(value) {
  return (bankTransactions = value);
}

export function setCurrentReconciliation(value) {
  return (currentReconciliation = value);
}

export function setProducts(value) {
  return (products = value);
}

export function setActiveInvoiceDraft(value) {
  return (activeInvoiceDraft = value);
}

export function setContextualCreationParentState(value) {
  return (contextualCreationParentState = value);
}

export function setInventoryLocations(value) {
  return (inventoryLocations = value);
}

export function setCurrentReportState(value) {
  return (currentReportState = value);
}

export function storeOwnerWorkspaceMode(value) {
  return (ownerWorkspaceMode = value);
}

export function setActiveWorkspaceId(value) {
  return (activeWorkspaceId = value);
}

export function setCalendarEvents(value) {
  return (calendarEvents = value);
}

export function setSpreadsheetEntryState(value) {
  return (spreadsheetEntryState = value);
}
