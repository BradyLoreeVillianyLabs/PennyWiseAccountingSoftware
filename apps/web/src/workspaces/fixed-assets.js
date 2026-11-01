// Fixed assets (`fixed-assets-workspace`).

import { formatMinor, minorToInput, parseMoneyInput } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { commandButton, moneyFromForm, option, row } from "../lib/dom.js";
import { percentageToMicros } from "../lib/format.js";
import { showError, showNotice } from "../lib/notices.js";
import { activeRoleIs, formatRole } from "../lib/roles.js";
import { applyWorkflowVisibility, registerWorkspaceCalls } from "../lib/workspace-calls.js";
import { refreshContextualSearches } from "../shell.js";
import {
  accounts,
  activeWorkspaceId,
  elements,
  fixedAssets,
  setFixedAssets,
  workflowPreferencesState
} from "../state.js";

let fixedAssetClasses = [];

registerWorkspaceCalls({ loadFixedAssets, renderFixedAssetSelects });

export function initFixedAssets() {
  elements["refresh-fixed-assets"].addEventListener("click", loadFixedAssets);
  elements["fixed-asset-class-form"].addEventListener("submit", createFixedAssetClass);
  elements["fixed-asset-class-form"].elements.defaultBookMethod.addEventListener(
    "change",
    updateFixedAssetClassMethodFields
  );
  elements["fixed-asset-form"].addEventListener("submit", saveFixedAssetDraft);
  elements["fixed-asset-form"].elements.fixedAssetClassId.addEventListener(
    "change",
    updateFixedAssetClassGuidance
  );
  elements["cancel-fixed-asset-edit"].addEventListener("click", resetFixedAssetForm);
}

export async function loadFixedAssets() {
  const enabled = workflowPreferencesState?.workflowPreferences.fixedAssetRegisterEnabled;
  const canRead = activeRoleIs(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES",
    "READ_ONLY"
  );
  if (!enabled || !canRead) {
    fixedAssetClasses = [];
    setFixedAssets([]);
    elements["fixed-assets-workspace"].hidden = true;
    return;
  }

  const [classesResponse, assetsResponse] = await Promise.all([
    api("/v1/fixed-asset-classes"),
    api("/v1/fixed-assets")
  ]);
  if (!classesResponse.ok || !assetsResponse.ok) {
    const failedResponse = !classesResponse.ok ? classesResponse : assetsResponse;
    if (failedResponse.status !== 403) await showError(failedResponse);
    elements["fixed-assets-workspace"].hidden = true;
    return;
  }

  fixedAssetClasses = (await classesResponse.json()).fixedAssetClasses;
  setFixedAssets((await assetsResponse.json()).fixedAssets);
  renderFixedAssetSelects();
  renderFixedAssetClasses();
  renderFixedAssets();
  applyWorkflowVisibility();
  elements["fixed-assets-workspace"].hidden = activeWorkspaceId !== "fixed-assets-workspace";
  refreshContextualSearches();
}

function renderFixedAssetSelects() {
  const classSelect = elements["fixed-asset-form"].elements.fixedAssetClassId;
  const selectedClassId = classSelect.value;
  classSelect.replaceChildren(
    option("", fixedAssetClasses.length ? "Select an asset class" : "Create an asset class first"),
    ...fixedAssetClasses
      .filter((assetClass) => !assetClass.isArchived)
      .map((assetClass) => option(assetClass.id, `${assetClass.code} | ${assetClass.name}`))
  );
  if (fixedAssetClasses.some((assetClass) => assetClass.id === selectedClassId)) {
    classSelect.value = selectedClassId;
  }

  const accountSelects = [
    ["defaultAssetAccountId", "assetAccountId", "ASSET", "Select an asset account"],
    [
      "defaultAccumulatedAccountId",
      "accumulatedDepreciationAccountId",
      "CONTRA_ASSET",
      "Select accumulated depreciation"
    ],
    [
      "defaultDepreciationExpenseId",
      "depreciationExpenseAccountId",
      "EXPENSE",
      "Select depreciation expense"
    ]
  ];
  for (const [classField, assetField, accountType, prompt] of accountSelects) {
    const choices = accounts
      .filter(
        (account) => account.type === accountType && !account.isArchived && !account.isControl
      )
      .map((account) => option(account.id, `${account.code} ${account.name}`));
    replaceFixedAssetAccountOptions(
      elements["fixed-asset-class-form"].elements[classField],
      choices,
      prompt
    );
    replaceFixedAssetAccountOptions(
      elements["fixed-asset-form"].elements[assetField],
      choices,
      "Use class default"
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const assetForm = elements["fixed-asset-form"];
  if (!assetForm.elements.assetId.value) {
    if (!assetForm.elements.acquiredOn.value) assetForm.elements.acquiredOn.value = today;
    if (!assetForm.elements.inServiceOn.value) assetForm.elements.inServiceOn.value = today;
  }
  updateFixedAssetClassMethodFields();
  updateFixedAssetClassGuidance();
}

function replaceFixedAssetAccountOptions(select, choices, prompt) {
  const selected = select.value;
  select.replaceChildren(option("", prompt), ...choices.map((choice) => choice.cloneNode(true)));
  if ([...select.options].some((entry) => entry.value === selected)) select.value = selected;
}

function updateFixedAssetClassMethodFields() {
  const form = elements["fixed-asset-class-form"];
  const usesStraightLine = form.elements.defaultBookMethod.value === "STRAIGHT_LINE";
  for (const name of [
    "defaultBookConvention",
    "defaultUsefulLifeMonths",
    "defaultResidualRatioPercent",
    "defaultAccumulatedAccountId",
    "defaultDepreciationExpenseId"
  ]) {
    const control = form.elements[name];
    control.disabled = !usesStraightLine;
    control.required = usesStraightLine && name !== "defaultResidualRatioPercent";
  }
  if (!usesStraightLine) {
    form.elements.defaultBookConvention.value = "";
    form.elements.defaultUsefulLifeMonths.value = "";
    form.elements.defaultResidualRatioPercent.value = "";
    form.elements.defaultAccumulatedAccountId.value = "";
    form.elements.defaultDepreciationExpenseId.value = "";
  } else {
    if (!form.elements.defaultBookConvention.value)
      form.elements.defaultBookConvention.value = "FULL_MONTH";
    if (!form.elements.defaultUsefulLifeMonths.value)
      form.elements.defaultUsefulLifeMonths.value = "60";
    if (!form.elements.defaultResidualRatioPercent.value)
      form.elements.defaultResidualRatioPercent.value = "0";
  }
}

function updateFixedAssetClassGuidance() {
  const form = elements["fixed-asset-form"];
  const assetClass = fixedAssetClasses.find(
    (candidate) => candidate.id === form.elements.fixedAssetClassId.value
  );
  const guidance = elements["fixed-asset-class-guidance"];
  if (!assetClass) {
    guidance.textContent = "";
    return;
  }

  const accountSummary = [
    `asset ${fixedAssetAccountLabel(assetClass.defaultAssetAccountId)}`,
    `accumulated ${fixedAssetAccountLabel(assetClass.defaultAccumulatedAccountId)}`,
    `expense ${fixedAssetAccountLabel(assetClass.defaultDepreciationExpenseId)}`
  ].join("; ");
  guidance.textContent =
    assetClass.defaultBookMethod === "NONE"
      ? `No book depreciation. Default ${accountSummary}.`
      : `${formatRole(assetClass.defaultBookConvention)} over ${assetClass.defaultUsefulLifeMonths} months; residual ${formatFixedAssetRatio(assetClass.defaultResidualRatioMicros)}; default ${accountSummary}.`;

  const noDepreciation = assetClass.defaultBookMethod === "NONE";
  for (const name of [
    "residualValueMinor",
    "openingAccumulatedDepreciationMinor",
    "openingBalanceDate",
    "remainingUsefulLifeMonths"
  ]) {
    form.elements[name].disabled = noDepreciation;
  }
  if (noDepreciation) {
    form.elements.residualValueMinor.value = "";
    form.elements.openingAccumulatedDepreciationMinor.value = "0";
    form.elements.openingBalanceDate.value = "";
    form.elements.remainingUsefulLifeMonths.value = "";
  } else {
    form.elements.remainingUsefulLifeMonths.max = String(
      assetClass.defaultUsefulLifeMonths ?? 1200
    );
    if (!form.elements.openingAccumulatedDepreciationMinor.value)
      form.elements.openingAccumulatedDepreciationMinor.value = "0";
  }
}

async function createFixedAssetClass(event) {
  event.preventDefault();
  if (!activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT"))
    return showNotice(
      "Only an owner, administrator, or accountant can configure asset classes.",
      true
    );

  const form = event.currentTarget;
  const data = new FormData(form);
  const usesStraightLine = data.get("defaultBookMethod") === "STRAIGHT_LINE";
  let defaultResidualRatioMicros = null;
  if (usesStraightLine) {
    try {
      defaultResidualRatioMicros = percentageToMicros(data.get("defaultResidualRatioPercent"));
    } catch (error) {
      return showNotice(
        error instanceof Error ? error.message : "Enter a valid residual percentage.",
        true
      );
    }
  }
  const defaultUsefulLifeMonths = usesStraightLine
    ? Number(data.get("defaultUsefulLifeMonths"))
    : null;
  if (
    usesStraightLine &&
    (!Number.isInteger(defaultUsefulLifeMonths) ||
      defaultUsefulLifeMonths < 1 ||
      defaultUsefulLifeMonths > 1200)
  ) {
    return showNotice("Useful life must be between 1 and 1,200 months.", true);
  }
  if (!data.get("defaultAssetAccountId"))
    return showNotice("Choose a default asset account.", true);
  if (
    usesStraightLine &&
    (!data.get("defaultAccumulatedAccountId") || !data.get("defaultDepreciationExpenseId"))
  ) {
    return showNotice("Choose accumulated depreciation and depreciation expense accounts.", true);
  }

  const response = await api("/v1/fixed-asset-classes", {
    ...jsonRequest({
      code: data.get("code"),
      name: data.get("name"),
      description: data.get("description") || null,
      defaultBookMethod: data.get("defaultBookMethod"),
      defaultBookConvention: usesStraightLine ? data.get("defaultBookConvention") : null,
      defaultUsefulLifeMonths,
      defaultResidualRatioMicros,
      defaultAssetAccountId: data.get("defaultAssetAccountId"),
      defaultAccumulatedAccountId: usesStraightLine
        ? data.get("defaultAccumulatedAccountId")
        : null,
      defaultDepreciationExpenseId: usesStraightLine
        ? data.get("defaultDepreciationExpenseId")
        : null
    }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  form.reset();
  updateFixedAssetClassMethodFields();
  await loadFixedAssets();
  showNotice("Asset class created for NON-POSTING register use.");
}

function renderFixedAssetClasses() {
  const rows = fixedAssetClasses.map((assetClass) => {
    const mappings = [
      `Asset: ${fixedAssetAccountLabel(assetClass.defaultAssetAccountId)}`,
      `Accumulated: ${fixedAssetAccountLabel(assetClass.defaultAccumulatedAccountId)}`,
      `Expense: ${fixedAssetAccountLabel(assetClass.defaultDepreciationExpenseId)}`
    ].join(" | ");
    return row([
      `${assetClass.code} | ${assetClass.name}`,
      assetClass.defaultBookMethod === "NONE"
        ? "No book depreciation"
        : `${formatRole(assetClass.defaultBookMethod)} | ${formatRole(assetClass.defaultBookConvention)}`,
      assetClass.defaultUsefulLifeMonths
        ? `${assetClass.defaultUsefulLifeMonths} months | ${formatFixedAssetRatio(assetClass.defaultResidualRatioMicros)} residual`
        : "Not depreciated",
      mappings
    ]);
  });
  elements["fixed-asset-classes"].replaceChildren(
    ...(rows.length ? rows : [row(["No asset classes yet.", "", "", ""])])
  );
}

function fixedAssetAccountLabel(accountId) {
  if (!accountId) return "Not mapped";
  const account = accounts.find((candidate) => candidate.id === accountId);
  return account ? `${account.code} ${account.name}` : "Unavailable account";
}

function formatFixedAssetRatio(value) {
  if (value === null || value === undefined) return "0%";
  const micros = BigInt(value);
  const whole = micros / 10_000n;
  const fraction = String(micros % 10_000n)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

function renderFixedAssets() {
  const rows = fixedAssets.map((asset) => {
    const actions = document.createElement("span");
    const canManage = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES");
    const canApprove = activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT");
    actions.append(commandButton("Preview", () => previewFixedAsset(asset)));
    if (asset.status === "DRAFT" && canManage) {
      actions.append(commandButton("Edit", () => editFixedAssetDraft(asset)));
      actions.append(commandButton("Submit", () => transitionFixedAsset(asset, "submit")));
    }
    if (asset.status === "SUBMITTED" && canApprove) {
      actions.append(
        commandButton("Register (non-posting)", () => transitionFixedAsset(asset, "register"))
      );
      actions.append(commandButton("Reject", () => transitionFixedAsset(asset, "reject")));
    }
    if (asset.status === "REJECTED" && canApprove)
      actions.append(commandButton("Revise", () => transitionFixedAsset(asset, "revise")));
    if (["DRAFT", "SUBMITTED", "REJECTED"].includes(asset.status) && canManage)
      actions.append(commandButton("Cancel", () => transitionFixedAsset(asset, "cancel")));

    return row([
      asset.assetNumber,
      `${asset.name} | ${asset.classCode} ${asset.className}`,
      `Acquired ${fixedAssetCalendarDate(asset.acquiredOn)} | In service ${fixedAssetCalendarDate(asset.inServiceOn)}`,
      `${formatMinor(asset.acquisitionCostMinor)} | Residual ${formatMinor(asset.residualValueMinor)}`,
      `${formatRole(asset.status)}${asset.status === "REGISTERED" ? " | Frozen" : ""} | ${formatRole(asset.ledgerTreatment)} | NON-POSTING`,
      actions
    ]);
  });
  elements["fixed-assets"].replaceChildren(
    ...(rows.length ? rows : [row(["No fixed asset drafts yet.", "", "", "", "", ""])])
  );
}

async function saveFixedAssetDraft(event) {
  event.preventDefault();
  if (!activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"))
    return showNotice("Your role can view the register but cannot change asset drafts.", true);

  const form = event.currentTarget;
  const data = new FormData(form);
  const assetId = form.elements.assetId.value;
  const assetClass = fixedAssetClasses.find(
    (candidate) => candidate.id === form.elements.fixedAssetClassId.value
  );
  if (!assetClass) return showNotice("Choose an asset class.", true);

  const acquiredOn = String(data.get("acquiredOn") ?? "");
  const inServiceOn = String(data.get("inServiceOn") ?? "");
  if (!acquiredOn || !inServiceOn || acquiredOn > inServiceOn)
    return showNotice("Acquisition date cannot follow the in-service date.", true);

  const acquisitionCostMinor = moneyFromForm(data, "acquisitionCostMinor");
  if (acquisitionCostMinor === null) return;
  let residualValueMinor;
  const residualInput = String(data.get("residualValueMinor") ?? "").trim();
  if (residualInput) {
    try {
      residualValueMinor = parseMoneyInput(residualInput);
    } catch (error) {
      return showNotice(
        error instanceof Error ? error.message : "Enter a valid residual value.",
        true
      );
    }
  }

  let openingAccumulatedDepreciationMinor = "0";
  if (assetClass.defaultBookMethod !== "NONE") {
    try {
      openingAccumulatedDepreciationMinor = parseMoneyInput(
        String(data.get("openingAccumulatedDepreciationMinor") || "0")
      );
    } catch (error) {
      return showNotice(
        error instanceof Error ? error.message : "Enter valid opening depreciation.",
        true
      );
    }
  }
  const openingBalanceDate =
    assetClass.defaultBookMethod === "NONE"
      ? null
      : String(data.get("openingBalanceDate") || "") || null;
  const remainingUsefulLifeInput =
    assetClass.defaultBookMethod === "NONE"
      ? ""
      : String(data.get("remainingUsefulLifeMonths") || "");
  const remainingUsefulLifeMonths = remainingUsefulLifeInput
    ? Number(remainingUsefulLifeInput)
    : null;
  if (
    (openingBalanceDate === null) !== (remainingUsefulLifeMonths === null) ||
    (BigInt(openingAccumulatedDepreciationMinor) > 0n && !openingBalanceDate)
  ) {
    return showNotice(
      "Opening depreciation requires both an opening balance date and remaining useful life.",
      true
    );
  }
  if (
    remainingUsefulLifeMonths !== null &&
    (!Number.isInteger(remainingUsefulLifeMonths) ||
      remainingUsefulLifeMonths < 1 ||
      remainingUsefulLifeMonths > (assetClass.defaultUsefulLifeMonths ?? 1200))
  ) {
    return showNotice("Remaining useful life must fit within the class useful life.", true);
  }

  const payload = {
    assetNumber: data.get("assetNumber"),
    name: data.get("name"),
    description: data.get("description") || null,
    acquiredOn,
    inServiceOn,
    acquisitionCostMinor,
    ...(residualValueMinor === undefined ? {} : { residualValueMinor }),
    openingAccumulatedDepreciationMinor,
    openingBalanceDate,
    remainingUsefulLifeMonths,
    ledgerTreatment: data.get("ledgerTreatment"),
    sourceReference: data.get("sourceReference"),
    serialNumber: data.get("serialNumber") || null,
    location: data.get("location") || null,
    notes: data.get("notes") || null
  };
  let response;
  if (assetId) {
    response = await api(
      `/v1/fixed-assets/${assetId}`,
      jsonRequest(
        {
          ...payload,
          version: Number(form.elements.version.value),
          assetAccountId: form.elements.assetAccountId.value || null,
          accumulatedDepreciationAccountId:
            form.elements.accumulatedDepreciationAccountId.value || null,
          depreciationExpenseAccountId: form.elements.depreciationExpenseAccountId.value || null
        },
        "PATCH"
      )
    );
  } else {
    const accountMappings = {};
    for (const name of [
      "assetAccountId",
      "accumulatedDepreciationAccountId",
      "depreciationExpenseAccountId"
    ]) {
      if (form.elements[name].value) accountMappings[name] = form.elements[name].value;
    }
    response = await api("/v1/fixed-assets", {
      ...jsonRequest({
        fixedAssetClassId: assetClass.id,
        ...payload,
        ...accountMappings
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID()
      }
    });
  }
  if (!response.ok) return showError(response);
  const message = assetId ? "Asset draft updated." : "NON-POSTING asset draft created.";
  resetFixedAssetForm();
  await loadFixedAssets();
  showNotice(message);
}

function editFixedAssetDraft(asset) {
  if (
    asset.status !== "DRAFT" ||
    !activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES")
  )
    return;
  const form = elements["fixed-asset-form"];
  resetFixedAssetForm();
  const values = {
    assetId: asset.id,
    version: asset.version,
    fixedAssetClassId: asset.fixedAssetClassId,
    assetNumber: asset.assetNumber,
    name: asset.name,
    description: asset.description,
    acquiredOn: fixedAssetCalendarDate(asset.acquiredOn),
    inServiceOn: fixedAssetCalendarDate(asset.inServiceOn),
    acquisitionCostMinor: minorToInput(asset.acquisitionCostMinor),
    residualValueMinor: "",
    openingAccumulatedDepreciationMinor: minorToInput(asset.openingAccumulatedDepreciationMinor),
    openingBalanceDate: asset.openingBalanceDate,
    remainingUsefulLifeMonths: asset.remainingUsefulLifeMonths,
    ledgerTreatment: asset.ledgerTreatment,
    sourceReference: asset.sourceReference,
    assetAccountId: asset.assetAccountId,
    accumulatedDepreciationAccountId: asset.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: asset.depreciationExpenseAccountId,
    serialNumber: asset.serialNumber,
    location: asset.location,
    notes: asset.notes
  };
  for (const [name, value] of Object.entries(values)) {
    if (form.elements[name]) form.elements[name].value = value ?? "";
  }
  form.elements.fixedAssetClassId.disabled = true;
  elements["save-fixed-asset"].textContent = "Save asset draft";
  elements["cancel-fixed-asset-edit"].hidden = false;
  updateFixedAssetClassGuidance();
  form.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  form.elements.assetNumber.focus();
}

function resetFixedAssetForm() {
  const form = elements["fixed-asset-form"];
  form.reset();
  form.elements.assetId.value = "";
  form.elements.version.value = "";
  form.elements.fixedAssetClassId.disabled = false;
  elements["save-fixed-asset"].textContent = "Create asset draft";
  elements["cancel-fixed-asset-edit"].hidden = true;
  renderFixedAssetSelects();
}

function fixedAssetCalendarDate(value) {
  return String(value ?? "").slice(0, 10);
}

async function transitionFixedAsset(asset, action) {
  let reason = null;
  if (action === "register") {
    const reviewNote = window.prompt("Review note (recommended for this NON-POSTING registration)");
    if (reviewNote === null) return;
    reason = reviewNote.trim() || null;
  } else if (["reject", "revise", "cancel"].includes(action)) {
    const enteredReason = window.prompt(`Reason to ${action} this fixed asset (required)`);
    if (enteredReason === null) return;
    reason = enteredReason.trim();
    if (!reason) return showNotice("Enter a reason before continuing.", true);
  }

  const response = await api(`/v1/fixed-assets/${asset.id}/${action}`, {
    ...jsonRequest(
      {
        version: asset.version,
        ...(reason ? { reason } : {})
      },
      "POST"
    ),
    headers: {
      "content-type": "application/json",
      "idempotency-key": globalThis.crypto.randomUUID()
    }
  });
  if (!response.ok) return showError(response);
  const transitioned = (await response.json()).fixedAsset;
  await loadFixedAssets();
  const labels = {
    submit: "submitted for authorized review",
    register: "registered as a NON-POSTING reference",
    reject: "rejected",
    revise: "returned to draft",
    cancel: "cancelled"
  };
  showNotice(`Fixed asset ${labels[action]}.`);
  if (action === "revise") {
    const refreshed = fixedAssets.find((candidate) => candidate.id === transitioned.id);
    if (refreshed) editFixedAssetDraft(refreshed);
  }
}

async function previewFixedAsset(asset) {
  const response = await api(`/v1/fixed-assets/${asset.id}/depreciation-preview`);
  if (!response.ok) return showError(response);
  const preview = (await response.json()).depreciationPreview;
  const calculation = preview.calculation;
  const warnings = preview.accountMappingWarnings.length
    ? preview.accountMappingWarnings.map(formatRole).join(", ")
    : "None";
  elements["fixed-asset-preview"].textContent =
    `NON-POSTING | ${asset.assetNumber} ${asset.name} | ${formatRole(calculation.method)} | ` +
    `Depreciable basis ${formatMinor(calculation.depreciableBasisMinor)} | ` +
    `Opening net book value ${formatMinor(calculation.openingNetBookValueMinor)} | ` +
    `Final net book value ${formatMinor(calculation.finalNetBookValueMinor)} | ` +
    `Account review warnings: ${warnings}`;
  const rows = calculation.schedule.map((line) =>
    row([
      line.period,
      formatMinor(line.depreciationMinor),
      formatMinor(line.accumulatedDepreciationMinor),
      formatMinor(line.netBookValueMinor)
    ])
  );
  elements["fixed-asset-depreciation-schedule"].replaceChildren(
    ...(rows.length ? rows : [row(["No book depreciation schedule.", "", "", ""])])
  );
  elements["fixed-asset-preview-heading"].scrollIntoView({
    behavior: preferredScrollBehavior(),
    block: "start"
  });
  showNotice("NON-POSTING depreciation preview loaded for authorized review.");
}
