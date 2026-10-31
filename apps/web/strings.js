const MESSAGES = Object.freeze({
  "invoice.title": "New invoice",
  "invoice.subtitle":
    "Add the essentials, then open the exact customer preview when you are ready.",
  "invoice.detailsHeading": "Create an invoice",
  "invoice.customer": "Customer",
  "invoice.product": "Product or service",
  "invoice.addCustomer": "+ Add customer",
  "invoice.addProduct": "+ Add product or service",
  "invoice.quantity": "Quantity",
  "invoice.unitPrice": "Unit price (invoice currency)",
  "invoice.discount": "Discount (invoice currency)",
  "invoice.issueDate": "Issue date",
  "invoice.currency": "Invoice currency",
  "invoice.createDraft": "Create draft & review",
  "invoice.appearance": "Branding and document style (optional)",
  "invoice.previewHeading": "Exact customer preview",
  "invoice.printPreview": "Print preview",
  "invoice.previewEmpty":
    "Create the draft to render the exact invoice your customer will receive.",
  "invoice.find": "Find invoices",
  "invoice.findPlaceholder": "Invoice number, customer, or status",
  "invoice.downloadVisible": "Download visible",
  "invoice.creditNote": "Credit note",
  "creditNote.title": "Issue a credit note",
  "creditNote.description":
    "This creates and posts a full credit against the selected invoice. It does not move money.",
  "creditNote.issueDate": "Issue date",
  "creditNote.reason": "Reason",
  "creditNote.fullCredit": "Credit the full remaining invoice amount",
  "creditNote.createAndPost": "Create and post credit note",
  "creditNote.cancel": "Cancel",
  "creditNote.creating": "Creating credit note…",
  "creditNote.chooseInvoice": "Choose an invoice to credit first.",
  "creditNote.source": "Invoice to credit",
  "creditNote.posted": "Credit note posted. The invoice and receivables were updated.",
  "app.serviceUnavailable": "The service is unavailable.",
  "app.requestFailed": "Request failed.",
  "invoice.draftCreated":
    "Draft created. Review the exact customer preview before posting or sending it."
});

export function t(key, variables = {}) {
  const template = MESSAGES[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(variables, name) ? String(variables[name]) : match
  );
}

export function applyCatalog(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (!key) return;
    element.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (!key) return;
    for (const attribute of element.getAttribute("data-i18n-attr")?.split(",") ?? [])
      element.setAttribute(attribute.trim(), t(key));
  });
}

export function catalogKeys() {
  return Object.keys(MESSAGES);
}
