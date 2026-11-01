// Calls that cross a workspace boundary. Workspaces never import each other, so a workspace
// registers what others need here, and callers import the forwarder of the same name. Forwarders
// resolve at call time, so module load order does not matter.

const handlers = {};

export function registerWorkspaceCalls(calls) {
  Object.assign(handlers, calls);
}

function workspaceCall(name) {
  return (...args) => handlers[name](...args);
}

export const applyWorkflowVisibility = workspaceCall("applyWorkflowVisibility");
export const beginContextualCreation = workspaceCall("beginContextualCreation");
export const calendarTypeLabel = workspaceCall("calendarTypeLabel");
export const clampBulkEntryWindowToViewport = workspaceCall("clampBulkEntryWindowToViewport");
export const dashboardMoney = workspaceCall("dashboardMoney");
export const documentLineEditor = workspaceCall("documentLineEditor");
export const documentLinePriceForProduct = workspaceCall("documentLinePriceForProduct");
export const documentLineState = workspaceCall("documentLineState");
export const filterHelpTopics = workspaceCall("filterHelpTopics");
export const finalizeInvoice = workspaceCall("finalizeInvoice");
export const formatConnectorStatus = workspaceCall("formatConnectorStatus");
export const formatConnectorTime = workspaceCall("formatConnectorTime");
export const formatOwnerDate = workspaceCall("formatOwnerDate");
export const invoicePriceForProduct = workspaceCall("invoicePriceForProduct");
export const keepPlatformWindowsInView = workspaceCall("keepPlatformWindowsInView");
export const loadAccounts = workspaceCall("loadAccounts");
export const loadBanking = workspaceCall("loadBanking");
export const loadCalendar = workspaceCall("loadCalendar");
export const loadContracts = workspaceCall("loadContracts");
export const loadCustomerRelationship = workspaceCall("loadCustomerRelationship");
export const loadEvidenceInbox = workspaceCall("loadEvidenceInbox");
export const loadFixedAssets = workspaceCall("loadFixedAssets");
export const loadFulfilment = workspaceCall("loadFulfilment");
export const loadHomeDashboard = workspaceCall("loadHomeDashboard");
export const loadIntegrations = workspaceCall("loadIntegrations");
export const loadInventory = workspaceCall("loadInventory");
export const loadMultiCurrencySettings = workspaceCall("loadMultiCurrencySettings");
export const loadOwnerWorkspace = workspaceCall("loadOwnerWorkspace");
export const loadPayments = workspaceCall("loadPayments");
export const loadPayroll = workspaceCall("loadPayroll");
export const loadPos = workspaceCall("loadPos");
export const loadProjects = workspaceCall("loadProjects");
export const loadPurchases = workspaceCall("loadPurchases");
export const loadReports = workspaceCall("loadReports");
export const loadSales = workspaceCall("loadSales");
export const loadSession = workspaceCall("loadSession");
export const loadWorkItemContacts = workspaceCall("loadWorkItemContacts");
export const minorIsNonZero = workspaceCall("minorIsNonZero");
export const navigateTo = workspaceCall("navigateTo");
export const openBulkEntryWindow = workspaceCall("openBulkEntryWindow");
export const openContract = workspaceCall("openContract");
export const openDashboardEditor = workspaceCall("openDashboardEditor");
export const openHelpDestination = workspaceCall("openHelpDestination");
export const openInvoicePaymentDialog = workspaceCall("openInvoicePaymentDialog");
export const openPlanningTab = workspaceCall("openPlanningTab");
export const ownerWorkspaceEmpty = workspaceCall("ownerWorkspaceEmpty");
export const planningRelatedItemLabel = workspaceCall("planningRelatedItemLabel");
export const planningTabFromHash = workspaceCall("planningTabFromHash");
export const previewInvoice = workspaceCall("previewInvoice");
export const readScopedDashboardPreference = workspaceCall("readScopedDashboardPreference");
export const refreshSetupState = workspaceCall("refreshSetupState");
export const refreshTaxCodeComponentAccounts = workspaceCall("refreshTaxCodeComponentAccounts");
export const renderBillDuplicateWarning = workspaceCall("renderBillDuplicateWarning");
export const renderDashboard = workspaceCall("renderDashboard");
export const renderDocumentLineEditor = workspaceCall("renderDocumentLineEditor");
export const renderFixedAssetSelects = workspaceCall("renderFixedAssetSelects");
export const renderGuidedTour = workspaceCall("renderGuidedTour");
export const renderInvoiceLineEditor = workspaceCall("renderInvoiceLineEditor");
export const renderInvoicePaymentMethodOptions = workspaceCall("renderInvoicePaymentMethodOptions");
export const renderMultiCurrencySettings = workspaceCall("renderMultiCurrencySettings");
export const renderOwnerWorkspace = workspaceCall("renderOwnerWorkspace");
export const renderPayrollAccountOptions = workspaceCall("renderPayrollAccountOptions");
export const renderProjectSelects = workspaceCall("renderProjectSelects");
export const renderProjectWorkItemSelects = workspaceCall("renderProjectWorkItemSelects");
export const renderProjectWorkItems = workspaceCall("renderProjectWorkItems");
export const renderPurchaseSelects = workspaceCall("renderPurchaseSelects");
export const renderSalesSelects = workspaceCall("renderSalesSelects");
export const renderTaxCodeList = workspaceCall("renderTaxCodeList");
export const reportMoneyText = workspaceCall("reportMoneyText");
export const resetDashboardPreferences = workspaceCall("resetDashboardPreferences");
export const resolveGuidedTourFromState = workspaceCall("resolveGuidedTourFromState");
export const reviewCapture = workspaceCall("reviewCapture");
export const runSelectedReport = workspaceCall("runSelectedReport");
export const showSetupStep = workspaceCall("showSetupStep");
export const showWorkspaceNavigation = workspaceCall("showWorkspaceNavigation");
export const syncDashboardHelpPanel = workspaceCall("syncDashboardHelpPanel");
export const syncDocumentLineStateFromDom = workspaceCall("syncDocumentLineStateFromDom");
export const syncInvoiceLineStateFromDom = workspaceCall("syncInvoiceLineStateFromDom");
export const syncPlanningTabs = workspaceCall("syncPlanningTabs");
export const writeScopedDashboardPreference = workspaceCall("writeScopedDashboardPreference");
