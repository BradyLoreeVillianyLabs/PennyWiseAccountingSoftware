// Editable line state shared by invoices, estimates, and bills.

import { setup } from "../state.js";

export let invoiceLineCounter = 0;
export let invoiceLineState = [createInvoiceLine()];
export let estimateLineState = [createInvoiceLine()];
export let billLineState = [createInvoiceLine()];

export function setInvoiceLineState(value) {
  return (invoiceLineState = value);
}

export function setEstimateLineState(value) {
  return (estimateLineState = value);
}

export function setBillLineState(value) {
  return (billLineState = value);
}

export function createInvoiceLine(values = {}) {
  invoiceLineCounter += 1;
  const defaultTaxCode = (setup?.taxCodes ?? []).find(
    (taxCode) => taxCode.isDefault || taxCode.defaultForSales
  );
  return {
    productItemId: "",
    description: "",
    quantity: "1",
    unitPriceMinor: "",
    discountMinor: "0",
    taxCodeId: defaultTaxCode?.id ?? "",
    ...values,
    id: values.id ?? `invoice-line-${Date.now()}-${invoiceLineCounter}`
  };
}
