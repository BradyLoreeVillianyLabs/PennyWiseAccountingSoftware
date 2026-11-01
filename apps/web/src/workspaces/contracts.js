// Contracts (`contracts-workspace`).

import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { escapeHtml, option } from "../lib/dom.js";
import { showError, showNotice } from "../lib/notices.js";
import { formatRole } from "../lib/roles.js";
import {
  formatOwnerDate,
  ownerWorkspaceEmpty,
  registerWorkspaceCalls,
  renderOwnerWorkspace
} from "../lib/workspace-calls.js";
import { navigateTo } from "../shell.js";
import {
  contracts,
  customers,
  elements,
  estimates,
  identity,
  projects,
  setContracts
} from "../state.js";

let contractTemplates = [];
let activeContract = null;

registerWorkspaceCalls({ loadContracts, openContract });

export function initContracts() {
  elements["refresh-contracts"].addEventListener("click", () => void loadContracts());
  elements["new-contract-draft"].addEventListener("click", resetContractDraft);
  elements["contract-form"].addEventListener("submit", saveContractDraft);
  elements["contract-starter-select"].addEventListener("change", resetContractDraft);
  elements["mark-contract-ready"].addEventListener("click", markContractReady);
  elements["print-contract"].addEventListener("click", printContractDraft);
  elements["contracts-list"].addEventListener("click", handleContractListAction);
}

export async function loadContracts({ selectedContractId = activeContract?.id } = {}) {
  if (!identity?.activeOrganizationId) return;
  const [templatesResponse, contractsResponse] = await Promise.all([
    api("/v1/contracts/templates", {}, true),
    api("/v1/contracts", {}, true)
  ]);
  if (!templatesResponse.ok || !contractsResponse.ok) {
    const unavailable =
      templatesResponse.status === 403 || contractsResponse.status === 403
        ? "Contracts are not available for your current role."
        : "Contracts could not be loaded. Refresh and try again.";
    renderContractsUnavailable(unavailable);
    return;
  }
  const templateResult = await templatesResponse.json();
  const contractResult = await contractsResponse.json();
  contractTemplates = [
    ...(templateResult.starters ?? []).map((template) => ({
      ...template,
      sourceType: "starter",
      optionValue: `starter:${template.key}`
    })),
    ...(templateResult.templates ?? []).map((template) => ({
      ...template,
      sourceType: "company",
      optionValue: `company:${template.id}`
    }))
  ];
  setContracts(contractResult.contracts ?? []);
  const contractId =
    selectedContractId && contracts.some((contract) => contract.id === selectedContractId)
      ? selectedContractId
      : null;
  activeContract = contractId ? await fetchContract(contractId) : null;
  renderContracts();
  renderOwnerWorkspace();
}

function renderContractsUnavailable(message) {
  contractTemplates = [];
  setContracts([]);
  activeContract = null;
  elements["contracts-list"].replaceChildren(ownerWorkspaceEmpty(message));
  elements["contract-template-source"].textContent = message;
  elements["contract-preview"].textContent = message;
  const form = elements["contract-form"];
  for (const control of form.elements) control.disabled = true;
  elements["contract-save-status"].textContent = "Unavailable";
}

function renderContracts() {
  renderContractTemplateOptions();
  renderContractList();
  renderContractEditor();
}

function renderContractTemplateOptions() {
  const select = elements["contract-starter-select"];
  const selected = activeContract
    ? activeContract.templateId
      ? `company:${activeContract.templateId}`
      : activeContract.templateKey
        ? `starter:${activeContract.templateKey}`
        : select.value
    : select.value;
  select.replaceChildren(
    option("", "Choose a starter document"),
    ...contractTemplates.map((template) => option(template.optionValue, template.title))
  );
  if (contractTemplates.some((template) => template.optionValue === selected))
    select.value = selected;
}

function selectedContractTemplate() {
  return (
    contractTemplates.find(
      (template) => template.optionValue === elements["contract-starter-select"].value
    ) ?? null
  );
}

function renderContractList() {
  const list = elements["contracts-list"];
  if (!contracts.length) {
    list.replaceChildren(
      ownerWorkspaceEmpty("No saved agreements yet. Choose a starter and create a draft.")
    );
    return;
  }
  list.replaceChildren(
    ...contracts.map((contract) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "contract-list-item";
      button.dataset.contractId = contract.id;
      button.setAttribute("aria-current", String(contract.id === activeContract?.id));
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      const status = document.createElement("span");
      title.textContent = contract.title;
      detail.textContent = `${formatRole(contract.status)} · updated ${formatOwnerDate(contract.updatedAt)}`;
      status.className = "status-pill";
      status.textContent = contract.unresolvedVariables?.length
        ? `${contract.unresolvedVariables.length} required field${contract.unresolvedVariables.length === 1 ? "" : "s"}`
        : "Complete";
      button.append(title, detail, status);
      return button;
    })
  );
}

function renderContractEditor() {
  const form = elements["contract-form"];
  const source = activeContract ?? selectedContractTemplate();
  const isDraft = activeContract?.status === "DRAFT";
  const isNew = !activeContract;
  elements["contract-starter-select"].disabled = Boolean(activeContract);
  renderContractReferenceSelects();
  form.elements.contractId.value = activeContract?.id ?? "";
  form.elements.title.value = activeContract?.title ?? "";
  form.elements.jurisdiction.value = activeContract?.jurisdiction ?? source?.jurisdiction ?? "";
  form.elements.content.value = activeContract?.content ?? "";
  form.elements.content.disabled = !isDraft;
  form.elements.customerId.disabled = !isNew;
  form.elements.projectId.disabled = !isNew;
  form.elements.estimateId.disabled = !isNew;
  form.elements.title.disabled = Boolean(activeContract && !isDraft);
  form.elements.jurisdiction.disabled = Boolean(activeContract && !isDraft);
  elements["contract-editor-heading"].textContent = activeContract
    ? activeContract.title
    : "Create a work agreement";
  elements["contract-save-status"].textContent = activeContract
    ? `${formatRole(activeContract.status)} · v${activeContract.version}`
    : source
      ? "Ready to create a draft"
      : "Choose a starter";
  elements["save-contract-draft"].textContent = activeContract ? "Save draft" : "Create draft";
  elements["save-contract-draft"].disabled = Boolean(activeContract && !isDraft) || !source;
  elements["mark-contract-ready"].hidden = !isDraft;
  elements["print-contract"].hidden = !activeContract;
  const acknowledgement = elements["contract-review-acknowledgement"];
  acknowledgement.hidden = !isDraft;
  form.elements.legalReviewAcknowledged.disabled = !isDraft;
  form.elements.legalReviewAcknowledged.checked = Boolean(
    activeContract?.legalReviewAcknowledgedAt
  );
  renderContractVariableFields(activeContract?.variableSchema ?? []);
  renderContractSource(source);
  elements["contract-preview"].textContent =
    activeContract?.renderedText ??
    (source
      ? "Create the draft to apply company, customer, job, and estimate details before reviewing the text."
      : "Choose a starter and create a draft to see the print-ready preview.");
}

function renderContractReferenceSelects() {
  const form = elements["contract-form"];
  const values = {
    customerId: activeContract?.customerId ?? form.elements.customerId.value,
    projectId: activeContract?.projectId ?? form.elements.projectId.value,
    estimateId: activeContract?.estimateId ?? form.elements.estimateId.value
  };
  form.elements.customerId.replaceChildren(
    option("", "No customer selected"),
    ...customers.map((customer) =>
      option(customer.id, `${customer.customerNumber ?? "Customer"} · ${customer.displayName}`)
    )
  );
  form.elements.projectId.replaceChildren(
    option("", "No job selected"),
    ...projects.map((project) =>
      option(project.id, `${project.projectNumber ?? "Job"} · ${project.name}`)
    )
  );
  form.elements.estimateId.replaceChildren(
    option("", "No estimate selected"),
    ...estimates.map((estimate) =>
      option(
        estimate.id,
        `${estimate.estimateNumber ?? estimate.provisionalIdentifier} · ${estimate.customerName}`
      )
    )
  );
  form.elements.customerId.value = values.customerId ?? "";
  form.elements.projectId.value = values.projectId ?? "";
  form.elements.estimateId.value = values.estimateId ?? "";
}

function renderContractVariableFields(definitions) {
  const container = elements["contract-variable-fields"];
  if (!definitions.length) {
    container.replaceChildren(
      ownerWorkspaceEmpty(
        activeContract
          ? "This agreement has no additional variable fields. Review the draft wording before marking it ready."
          : "Create a draft to load company, customer, job, payment, and schedule fields."
      )
    );
    return;
  }
  const editable = activeContract?.status === "DRAFT";
  container.replaceChildren(
    ...definitions.map((definition) => {
      const label = document.createElement("label");
      label.className = "contract-variable-field";
      label.textContent = definition.label;
      const input = document.createElement("input");
      input.name = `contractVariable:${definition.key}`;
      input.type = definition.kind === "date" ? "date" : "text";
      input.maxLength = 4000;
      input.required = definition.required;
      input.disabled = !editable;
      input.value = activeContract?.variableValues?.[definition.key] ?? "";
      if (definition.kind === "money") {
        input.inputMode = "decimal";
        input.placeholder = "0.00";
      }
      const requirement = document.createElement("small");
      requirement.textContent = definition.required ? "Required before review" : "Optional";
      label.append(input, requirement);
      return label;
    })
  );
}

function renderContractSource(source) {
  const sourcePanel = elements["contract-template-source"];
  const sourceLink = elements["contract-source-link"];
  sourcePanel.replaceChildren();
  sourceLink.hidden = true;
  sourceLink.removeAttribute("href");
  if (!source) {
    sourcePanel.textContent = "Choose a starter to see its source guidance.";
    return;
  }
  const heading = document.createElement("strong");
  const detail = document.createElement("span");
  heading.textContent = source.title ?? "Selected agreement";
  detail.textContent = source.sourceLabel ?? "Company document";
  sourcePanel.append(heading, detail);
  if (source.sourceUrl) {
    sourceLink.href = source.sourceUrl;
    sourceLink.hidden = false;
  }
}

function contractVariableValuesFromForm() {
  const values = {};
  for (const definition of activeContract?.variableSchema ?? []) {
    const input = elements["contract-form"].elements[`contractVariable:${definition.key}`];
    values[definition.key] = String(input?.value ?? "").trim();
  }
  return values;
}

async function saveContractDraft(event) {
  event.preventDefault();
  const form = elements["contract-form"];
  const source = selectedContractTemplate();
  const title = form.elements.title.value.trim();
  const jurisdiction = form.elements.jurisdiction.value.trim();
  const wasEditing = Boolean(activeContract);
  let response;
  if (activeContract) {
    response = await api(
      `/v1/contracts/${activeContract.id}`,
      jsonRequest(
        {
          version: activeContract.version,
          title: title || undefined,
          content: form.elements.content.value.trim(),
          jurisdiction: jurisdiction || null,
          variableValues: contractVariableValuesFromForm()
        },
        "PATCH"
      )
    );
  } else {
    if (!source) return showNotice("Choose a contract starter before creating a draft.", true);
    response = await api(
      "/v1/contracts",
      jsonRequest({
        ...(source.sourceType === "starter"
          ? { starterKey: source.key }
          : { templateId: source.id }),
        ...(title ? { title } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
        customerId: form.elements.customerId.value || null,
        projectId: form.elements.projectId.value || null,
        estimateId: form.elements.estimateId.value || null,
        variableValues: {}
      })
    );
  }
  if (!response.ok) return showError(response);
  const contract = (await response.json()).contract;
  await loadContracts({ selectedContractId: contract.id });
  showNotice(wasEditing ? "Contract draft saved." : "Contract draft created.");
}

async function markContractReady() {
  if (!activeContract || activeContract.status !== "DRAFT") return;
  const form = elements["contract-form"];
  if (!form.elements.legalReviewAcknowledged.checked) {
    return showNotice(
      "Confirm the legal and jurisdictional review acknowledgement before continuing.",
      true
    );
  }
  const response = await api(
    `/v1/contracts/${activeContract.id}/ready`,
    jsonRequest({ version: activeContract.version, legalReviewAcknowledged: true })
  );
  if (!response.ok) return showError(response);
  const contract = (await response.json()).contract;
  await loadContracts({ selectedContractId: contract.id });
  showNotice("Contract marked ready for review. It was not sent or signed automatically.");
}

async function fetchContract(contractId) {
  const response = await api(`/v1/contracts/${contractId}`, {}, true);
  if (!response.ok) {
    if (response.status !== 404) await showError(response);
    return null;
  }
  return (await response.json()).contract;
}

async function openContract(contractId) {
  navigateTo("contracts-workspace", { scrollToTop: false, refreshData: false });
  const contract = await fetchContract(contractId);
  if (!contract) return;
  activeContract = contract;
  renderContracts();
  document.getElementById("contract-form")?.scrollIntoView({
    behavior: preferredScrollBehavior(),
    block: "start"
  });
}

function handleContractListAction(event) {
  const button = event.target.closest("[data-contract-id]");
  if (!(button instanceof globalThis.HTMLButtonElement)) return;
  void openContract(button.dataset.contractId);
}

function resetContractDraft() {
  activeContract = null;
  const sourceValue = elements["contract-starter-select"].value;
  const form = elements["contract-form"];
  form.reset();
  if (sourceValue) elements["contract-starter-select"].value = sourceValue;
  renderContractList();
  renderContractEditor();
}

function printContractDraft() {
  if (!activeContract?.renderedText) {
    showNotice("Create or open a contract before printing.", true);
    return;
  }
  const frame = document.createElement("iframe");
  frame.className = "contract-print-frame";
  frame.title = `${activeContract.title} print view`;
  // The srcdoc is assembled exclusively from escaped title and rendered text.
  // Allowing scripts lets the browser honor the print call; no script content
  // is interpolated into the generated document.
  frame.sandbox = "allow-same-origin allow-modals allow-scripts";
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(activeContract.title)}</title><style>body{font-family:Arial,sans-serif;color:#172b4d;line-height:1.48;margin:28px}pre{font:inherit;white-space:pre-wrap}h1{font-size:18px;margin:0 0 18px}@page{margin:15mm}</style></head><body><h1>${escapeHtml(activeContract.title)}</h1><pre>${escapeHtml(activeContract.renderedText)}</pre></body></html>`;
  frame.addEventListener("load", () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    globalThis.setTimeout(() => frame.remove(), 1200);
  });
  document.body.append(frame);
}
