// CRM contacts and activity. The markup stays in the `projects-workspace` CRM tab.

import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { commandButton, option, row } from "../lib/dom.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import {
  planningRelatedItemLabel,
  registerWorkspaceCalls,
  renderProjectWorkItemSelects
} from "../lib/workspace-calls.js";
import {
  customerContacts,
  customerContactsById,
  customers,
  elements,
  identity,
  setCustomerContacts
} from "../state.js";

let crmTimeline = [];

registerWorkspaceCalls({ loadCustomerRelationship, loadWorkItemContacts });

export function initContacts() {
  elements["crm-customer-select"].addEventListener("change", () => {
    void loadCustomerRelationship();
  });
  elements["crm-contact-form"].addEventListener("submit", saveCrmContact);
  elements["cancel-crm-contact-edit"].addEventListener("click", resetCrmContactForm);
  elements["crm-activity-form"].addEventListener("submit", createCrmActivity);
  elements["refresh-crm-timeline"].addEventListener("click", loadCustomerRelationship);
}

function crmCustomerId() {
  return String(elements["crm-customer-select"].value || "");
}

function populateCrmCustomerSelect() {
  const select = elements["crm-customer-select"];
  const current = select.value;
  select.replaceChildren(
    ...customers
      .filter((customer) => customer.active)
      .map((customer) =>
        option(customer.id, `${customer.customerNumber} | ${customer.displayName}`)
      )
  );
  if ([...select.options].some((entry) => entry.value === current)) select.value = current;
  else if (select.options.length) select.value = select.options[0].value;
}

async function loadCustomerRelationship() {
  if (!identity?.activeOrganizationId || !elements["customer-relationships-panel"]) return;
  populateCrmCustomerSelect();
  const customerId = crmCustomerId();
  if (!customerId) {
    setCustomerContacts([]);
    crmTimeline = [];
    renderCrmContacts();
    renderCrmTimeline();
    return;
  }
  const [contactsResponse, timelineResponse] = await Promise.all([
    api(`/v1/customers/${customerId}/contacts`, {}, true),
    api(`/v1/customers/${customerId}/timeline`, {}, true)
  ]);
  if (!contactsResponse.ok || !timelineResponse.ok) {
    if (contactsResponse.status !== 403 && timelineResponse.status !== 403)
      showError(!contactsResponse.ok ? contactsResponse : timelineResponse);
    return;
  }
  setCustomerContacts((await contactsResponse.json()).contacts);
  crmTimeline = (await timelineResponse.json()).timeline;
  customerContactsById.set(customerId, customerContacts);
  renderCrmContacts();
  renderCrmActivityContacts();
  renderCrmTimeline();
  renderProjectWorkItemSelects();
}

function renderCrmContacts() {
  elements["crm-contacts"].replaceChildren(
    ...(customerContacts.length
      ? customerContacts.map((contact) => {
          const actions = document.createElement("div");
          actions.className = "table-command-group";
          if (contact.active) {
            actions.append(commandButton("Edit", () => editCrmContact(contact)));
            actions.append(commandButton("Archive", () => archiveCrmContact(contact)));
          }
          return row([
            contact.name,
            contact.role || "—",
            [contact.email, contact.telephone].filter(Boolean).join(" · ") || "—",
            contact.active ? "Active" : "Archived",
            actions
          ]);
        })
      : [row(["No contacts yet.", "", "", "", ""])])
  );
}

function renderCrmActivityContacts() {
  const select = elements["crm-activity-form"].elements.contactId;
  const current = select.value;
  select.replaceChildren(
    option("", "No specific contact"),
    ...customerContacts
      .filter((contact) => contact.active)
      .map((contact) => option(contact.id, contact.name))
  );
  if ([...select.options].some((entry) => entry.value === current)) select.value = current;
}

function renderCrmTimeline() {
  elements["crm-timeline-summary"].textContent = crmTimeline.length
    ? `${crmTimeline.length} relationship record(s) shown. Activity history is retained; scheduled items can be updated from Schedule.`
    : "No relationship activity has been recorded for this client.";
  elements["crm-timeline"].replaceChildren(
    ...(crmTimeline.length
      ? crmTimeline.map((entry) =>
          row([
            new Date(entry.occurredAt).toLocaleString(),
            formatRole(entry.activityType || entry.entryType),
            entry.title,
            entry.detail || "—",
            entry.status ? formatRole(entry.status) : "Recorded",
            planningRelatedItemLabel(
              entry.source.relatedResourceType,
              entry.source.relatedResourceId
            ) || "Client activity"
          ])
        )
      : [row(["No activity yet.", "", "", "", "", ""])])
  );
}

function editCrmContact(contact) {
  const form = elements["crm-contact-form"];
  form.elements.contactId.value = contact.id;
  form.elements.version.value = String(contact.version);
  form.elements.name.value = contact.name;
  form.elements.role.value = contact.role || "";
  form.elements.email.value = contact.email || "";
  form.elements.telephone.value = contact.telephone || "";
  form.elements.preferredChannel.value = contact.preferredChannel || "";
  form.elements.notes.value = contact.notes || "";
  elements["crm-contact-form-heading"].textContent = "Edit contact";
  elements["save-crm-contact"].textContent = "Save contact";
  elements["cancel-crm-contact-edit"].hidden = false;
  form.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
}

function resetCrmContactForm() {
  const form = elements["crm-contact-form"];
  form.reset();
  form.elements.contactId.value = "";
  form.elements.version.value = "";
  elements["crm-contact-form-heading"].textContent = "Contact";
  elements["save-crm-contact"].textContent = "Add contact";
  elements["cancel-crm-contact-edit"].hidden = true;
}

async function saveCrmContact(event) {
  event.preventDefault();
  const customerId = crmCustomerId();
  if (!customerId) return showNotice("Choose a client before adding a contact.", true);
  const form = event.currentTarget;
  const data = new FormData(form);
  const contactId = String(data.get("contactId") || "");
  const payload = {
    name: data.get("name"),
    role: String(data.get("role") || "") || null,
    email: String(data.get("email") || "") || null,
    telephone: String(data.get("telephone") || "") || null,
    preferredChannel: String(data.get("preferredChannel") || "") || null,
    notes: String(data.get("notes") || "") || null,
    ...(contactId ? { version: Number(data.get("version")) } : {})
  };
  const response = await api(
    contactId ? `/v1/customer-contacts/${contactId}` : `/v1/customers/${customerId}/contacts`,
    jsonRequest(payload, contactId ? "PATCH" : "POST")
  );
  if (!response.ok) return showError(response);
  resetCrmContactForm();
  await loadCustomerRelationship();
  showNotice(contactId ? "Contact updated." : "Contact added.");
}

async function archiveCrmContact(contact) {
  if (!window.confirm(`Archive ${contact.name}? Existing activity history will be retained.`))
    return;
  const response = await api(
    `/v1/customer-contacts/${contact.id}/archive`,
    jsonRequest({ version: contact.version }, "POST")
  );
  if (!response.ok) return showError(response);
  await loadCustomerRelationship();
  showNotice("Contact archived; relationship history retained.");
}

async function createCrmActivity(event) {
  event.preventDefault();
  const customerId = crmCustomerId();
  if (!customerId) return showNotice("Choose a client before recording activity.", true);
  const form = event.currentTarget;
  const data = new FormData(form);
  const relatedType = String(data.get("relatedResourceType") || "");
  const relatedId = String(data.get("relatedResourceId") || "");
  if (relatedType && !relatedId)
    return showNotice("Enter the related record ID or choose None.", true);
  const happenedAt = String(data.get("happenedAt") || "");
  const response = await api(
    `/v1/customers/${customerId}/activities`,
    jsonRequest({
      activityType: data.get("activityType"),
      category: String(data.get("category") || "") || null,
      subject: String(data.get("subject") || "") || null,
      body: data.get("body"),
      happenedAt: happenedAt ? new Date(happenedAt).toISOString() : new Date().toISOString(),
      contactId: String(data.get("contactId") || "") || null,
      relatedResourceType: relatedType || null,
      relatedResourceId: relatedId || null
    })
  );
  if (!response.ok) return showError(response);
  form.reset();
  setDefaultCrmActivityDate();
  await loadCustomerRelationship();
  showNotice("Client activity recorded without creating accounting entries.");
}

function setDefaultCrmActivityDate() {
  const input = elements["crm-activity-form"]?.elements.happenedAt;
  if (!input || input.value) return;
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  input.value = now.toISOString().slice(0, 16);
}

async function loadWorkItemContacts() {
  const customerId = String(elements["project-work-item-form"].elements.customerId.value || "");
  const contactSelect = elements["project-work-item-form"].elements.contactId;
  const current = contactSelect.value;
  if (!customerId) {
    contactSelect.replaceChildren(option("", "No contact"));
    return;
  }
  let contacts = customerContactsById.get(customerId);
  if (!contacts) {
    const response = await api(`/v1/customers/${customerId}/contacts`, {}, true);
    if (!response.ok) return showError(response);
    contacts = (await response.json()).contacts;
    customerContactsById.set(customerId, contacts);
  }
  contactSelect.replaceChildren(
    option("", "No contact"),
    ...contacts
      .filter((contact) => contact.active)
      .map((contact) => option(contact.id, contact.name))
  );
  if ([...contactSelect.options].some((entry) => entry.value === current))
    contactSelect.value = current;
}
