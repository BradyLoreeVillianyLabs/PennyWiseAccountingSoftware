// Currency and exchange-rate controls shared by sales, payments, and purchases.

import { api, jsonRequest } from "../api.js";
import { option } from "./dom.js";
import { showError, showNotice } from "./notices.js";
import { formatRole } from "./roles.js";
import { loadMultiCurrencySettings, renderMultiCurrencySettings } from "./workspace-calls.js";
import {
  bills,
  customers,
  elements,
  invoices,
  multiCurrencySettingsRequestSequence,
  multiCurrencyState,
  setMultiCurrencyEnabledLocally,
  setMultiCurrencySettingsRequestSequence,
  setMultiCurrencyState,
  setup,
  vendors
} from "../state.js";

let invoiceRateSuggestion = null;

function currencyOptions() {
  const baseCurrency = multiCurrencyState?.baseCurrency ?? "CAD";
  // Keep the foreign choice visible before the setting is enabled. Selecting it
  // is the guided entry point; confirmation performs the versioned settings write.
  if (!multiCurrencyState?.enabled) return [...new Set([baseCurrency, "USD"])];
  return [...new Set([baseCurrency, "CAD", "USD"])];
}

export function replaceCurrencyOptions(select, preferredCurrency) {
  const previous = preferredCurrency || select.value || multiCurrencyState?.baseCurrency || "CAD";
  const currencies = currencyOptions();
  select.replaceChildren(...currencies.map((currency) => option(currency, currency)));
  select.value = currencies.includes(previous) ? previous : currencies[0];
}

export async function handleContextualCurrencyChoice(select, source) {
  const baseCurrency = multiCurrencyState?.baseCurrency ?? setup?.settings?.baseCurrency ?? "CAD";
  const selected = select.value?.trim().toUpperCase();
  if (!selected || selected === baseCurrency || multiCurrencyState?.enabled) return;
  const confirmed = window.confirm(
    `Enable CAD and USD accounting now? This adds ${selected} as an enabled transaction currency and requires an explicit dated rate before a foreign document can be saved. You can turn the setting off again until the first foreign document is posted.`
  );
  if (!confirmed) {
    select.value = baseCurrency;
    if (source === "invoice") renderInvoiceCurrencyControls();
    return;
  }
  select.disabled = true;
  const current = multiCurrencyState;
  if (!current) {
    select.disabled = false;
    return;
  }
  const response = await api(
    "/v1/settings/multi-currency",
    jsonRequest(
      {
        version: current.version,
        enabled: true,
        rateMode: "MANUAL",
        currencies: [...new Set([current.baseCurrency, "CAD", "USD"])]
      },
      "PUT"
    )
  );
  select.disabled = false;
  if (!response.ok) {
    select.value = baseCurrency;
    return showError(response);
  }
  // A first-load GET may still be in flight. Invalidate it before applying this
  // newer write so an older disabled snapshot cannot roll the UI back.
  setMultiCurrencySettingsRequestSequence(multiCurrencySettingsRequestSequence + 1);
  setMultiCurrencyState((await response.json()).multiCurrency);
  setMultiCurrencyEnabledLocally(multiCurrencyState.enabled);
  if (setup?.settings) setup.settings.version = multiCurrencyState.version;
  renderMultiCurrencySettings();
  if (source === "invoice") {
    select.value = selected;
    renderInvoiceCurrencyControls();
  }
  showNotice(
    "Multi-currency is enabled. Review the dated rate before saving the foreign document."
  );
}

export function formatRateSnapshot(rate) {
  const numerator = BigInt(rate.numerator);
  const denominator = BigInt(rate.denominator);
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return `${whole.toString()} ${rate.baseCurrency}`;
  const precision = 8n;
  const fraction = ((remainder * 10n ** precision) / denominator)
    .toString()
    .padStart(Number(precision), "0")
    .replace(/0+$/, "");
  return `${whole.toString()}.${fraction} ${rate.baseCurrency}`;
}

function renderRateSelect(select, { currency, date, purposes }) {
  const baseCurrency = multiCurrencyState?.baseCurrency ?? "CAD";
  const previous = select.value;
  if (currency === baseCurrency) {
    select.replaceChildren(option("", `Not required for ${baseCurrency}`));
    select.disabled = true;
    select.required = false;
    return;
  }
  const matchingRates = (multiCurrencyState?.rates ?? []).filter(
    (rate) =>
      rate.transactionCurrency === currency &&
      rate.baseCurrency === baseCurrency &&
      purposes.includes(rate.purpose) &&
      (!date || rate.effectiveAt.slice(0, 10) === date)
  );
  select.replaceChildren(
    option(
      "",
      date
        ? `Choose a ${purposes.map(formatRole).join(" or ")} rate dated ${date}`
        : "Choose the transaction date first"
    ),
    ...matchingRates.map((rate) =>
      option(
        rate.id,
        `${rate.effectiveAt.slice(0, 10)} | 1 ${rate.transactionCurrency} = ${formatRateSnapshot(rate)} | ${formatRole(rate.purpose)}`
      )
    )
  );
  select.disabled = false;
  select.required = true;
  if (matchingRates.some((rate) => rate.id === previous)) select.value = previous;
}

export function renderInvoiceCurrencyControls(event) {
  const form = elements["invoice-form"];
  let preferred = form.elements.currency.value;
  if (event?.target?.name === "customerId") {
    preferred =
      customers.find((customer) => customer.id === form.elements.customerId.value)
        ?.defaultCurrency ?? preferred;
  }
  replaceCurrencyOptions(form.elements.currency, preferred);
  renderRateSelect(form.elements.fxRateSnapshotId, {
    currency: form.elements.currency.value,
    date: form.elements.issueDate.value,
    purposes: ["TRANSACTION"]
  });
  renderInvoiceInlineRate();
}

export function renderInvoiceInlineRate() {
  const panel = elements["invoice-inline-rate"];
  const form = elements["invoice-form"];
  if (!panel || !form) return;
  const isForeign = form.elements.currency.value !== (multiCurrencyState?.baseCurrency ?? "CAD");
  panel.hidden = !isForeign || !multiCurrencyState?.enabled;
  if (!panel.hidden && invoiceRateSuggestion) {
    elements["invoice-use-suggested-rate"].hidden = false;
  } else if (elements["invoice-use-suggested-rate"]) {
    elements["invoice-use-suggested-rate"].hidden = true;
  }
}

export async function suggestInvoiceRate() {
  const form = elements["invoice-form"];
  const status = elements["invoice-inline-rate-status"];
  const panel = elements["invoice-inline-rate"];
  const currency = form.elements.currency.value;
  const baseCurrency = multiCurrencyState?.baseCurrency ?? "CAD";
  if (currency === baseCurrency || !multiCurrencyState?.enabled) return;
  const date = form.elements.issueDate.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    status.textContent = "Choose the invoice date before checking a rate.";
    return showNotice(status.textContent, true);
  }
  const button = elements["invoice-suggest-rate"];
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  status.textContent = "Checking the latest published Bank of Canada observation...";
  const response = await api(
    `/v1/settings/multi-currency/rate-suggestion?date=${encodeURIComponent(date)}&transactionCurrency=${encodeURIComponent(currency)}`
  );
  button.disabled = false;
  button.removeAttribute("aria-busy");
  if (!response.ok) {
    invoiceRateSuggestion = null;
    renderInvoiceInlineRate();
    status.textContent =
      "No rate was applied. Enter a documented rate in Settings, then return to this invoice.";
    return showError(response);
  }
  const { suggestion } = await response.json();
  invoiceRateSuggestion = suggestion;
  panel.hidden = false;
  elements["invoice-use-suggested-rate"].hidden = false;
  status.textContent = `${suggestion.series} observed ${suggestion.observationDate}: 1 ${currency} = ${suggestion.rate} ${baseCurrency} (requested ${date}). Nothing has been applied.`;
}

export async function useSuggestedInvoiceRate() {
  const form = elements["invoice-form"];
  const status = elements["invoice-inline-rate-status"];
  const suggestion = invoiceRateSuggestion;
  if (!suggestion) return;
  const response = await api(
    "/v1/settings/multi-currency/rates",
    jsonRequest(
      {
        transactionCurrency: form.elements.currency.value,
        rate: suggestion.rate,
        effectiveAt: `${suggestion.requestedDate}T12:00:00.000Z`,
        method: "MANUAL",
        purpose: "TRANSACTION",
        sourceReference: suggestion.sourceReference
      },
      "POST"
    )
  );
  if (!response.ok) return showError(response);
  const { rate } = await response.json();
  invoiceRateSuggestion = null;
  await loadMultiCurrencySettings();
  form.elements.fxRateSnapshotId.value = rate.id;
  renderRateSelect(form.elements.fxRateSnapshotId, {
    currency: form.elements.currency.value,
    date: form.elements.issueDate.value,
    purposes: ["TRANSACTION"]
  });
  form.elements.fxRateSnapshotId.value = rate.id;
  elements["invoice-use-suggested-rate"].hidden = true;
  status.textContent = `Rate snapshot ${rate.effectiveAt.slice(0, 10)} is selected for this invoice. Review it before saving.`;
  showNotice("Bank of Canada rate snapshot created and selected.");
}

export function renderManualPaymentCurrencyControls() {
  const form = elements["manual-payment-form"];
  const invoice = invoices.find((item) => item.id === form.elements.invoiceId.value);
  replaceCurrencyOptions(
    form.elements.currency,
    invoice?.currency ?? multiCurrencyState?.baseCurrency ?? "CAD"
  );
  renderRateSelect(form.elements.fxRateSnapshotId, {
    currency: form.elements.currency.value,
    date: form.elements.paymentDate.value,
    purposes: ["ACTUAL_SETTLEMENT", "TRANSACTION"]
  });
}

export function renderBillCurrencyControls(event) {
  const form = elements["bill-form"];
  let preferred = form.elements.currency.value;
  if (event?.target?.name === "vendorId") {
    preferred =
      vendors.find((vendor) => vendor.id === form.elements.vendorId.value)?.defaultCurrency ??
      preferred;
  }
  replaceCurrencyOptions(form.elements.currency, preferred);
  renderRateSelect(form.elements.fxRateSnapshotId, {
    currency: form.elements.currency.value,
    date: form.elements.issueDate.value,
    purposes: ["TRANSACTION"]
  });
}

export function renderBillPaymentCurrencyControls() {
  const form = elements["bill-payment-form"];
  const bill = bills.find((item) => item.id === form.elements.billId.value);
  replaceCurrencyOptions(
    form.elements.currency,
    bill?.currency ?? multiCurrencyState?.baseCurrency ?? "CAD"
  );
  renderRateSelect(form.elements.fxRateSnapshotId, {
    currency: form.elements.currency.value,
    date: form.elements.paymentDate.value,
    purposes: ["ACTUAL_SETTLEMENT", "TRANSACTION"]
  });
}

export function renderRevaluationRateControls() {
  const form = elements["fx-revaluation-form"];
  const date = form.elements.valuationDate.value;
  const baseCurrency = multiCurrencyState?.baseCurrency ?? "CAD";
  const previous = form.elements.rateSnapshotId.value;
  const rates = (multiCurrencyState?.rates ?? []).filter(
    (rate) =>
      rate.transactionCurrency !== baseCurrency &&
      rate.baseCurrency === baseCurrency &&
      rate.purpose === "CLOSING" &&
      (!date || rate.effectiveAt.slice(0, 10) === date)
  );
  form.elements.rateSnapshotId.replaceChildren(
    option("", date ? `Choose a closing rate dated ${date}` : "Choose the valuation date first"),
    ...rates.map((rate) =>
      option(
        rate.id,
        `${rate.transactionCurrency}/${rate.baseCurrency} | ${formatRateSnapshot(rate)}`
      )
    )
  );
  if (rates.some((rate) => rate.id === previous)) form.elements.rateSnapshotId.value = previous;
}

export function renderAllCurrencyControls() {
  replaceCurrencyOptions(elements["customer-form"].elements.defaultCurrency);
  replaceCurrencyOptions(elements["vendor-form"].elements.defaultCurrency);
  replaceCurrencyOptions(elements["bank-account-form"].elements.currency);
  renderInvoiceCurrencyControls();
  renderManualPaymentCurrencyControls();
  renderBillCurrencyControls();
  renderBillPaymentCurrencyControls();
  renderRevaluationRateControls();
}
