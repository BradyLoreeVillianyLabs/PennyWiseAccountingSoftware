/** Pure suggestions only. Callers must supply tenant-scoped, eligible open invoices. */
export interface DepositInvoiceCandidate {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly payerAliases: readonly string[];
  readonly reference: string;
  readonly outstandingMinor: bigint;
}

export interface DepositMatchSuggestion {
  readonly invoiceIds: readonly string[];
  readonly allocationAmountsMinor: readonly string[];
  readonly customerId: string;
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
  readonly reasons: readonly string[];
  readonly amountMatches: boolean;
  readonly requiresConfirmation: true;
}

function nameKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function containsPaymentReference(text: string, reference: string): boolean {
  const compactReference = reference.replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase("en-CA");
  const compactText = text.replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase("en-CA");
  if (!compactReference || compactReference.length < 4) return false;
  // Banks commonly remove punctuation during export. Compare compact forms,
  // then enforce token boundaries so REF-12 cannot match REF-123.
  if (!compactText.includes(compactReference)) return false;
  const escaped = reference.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text) ||
    new RegExp(`(?<![\\p{L}\\p{N}])${compactReference}(?![\\p{L}\\p{N}])`, "iu").test(compactText)
  );
}

export function suggestDepositInvoices(
  deposit: {
    readonly amountMinor: bigint;
    readonly sender: string | null;
    readonly message: string;
  },
  invoices: readonly DepositInvoiceCandidate[]
): readonly DepositMatchSuggestion[] {
  if (deposit.amountMinor <= 0n) return [];
  const eligible = invoices.filter((invoice) => invoice.outstandingMinor > 0n);
  const sender = nameKey(deposit.sender ?? "");
  const exactAmountCount = eligible.filter(
    (invoice) => invoice.outstandingMinor === deposit.amountMinor
  ).length;
  const exactName = (invoice: DepositInvoiceCandidate) =>
    Boolean(sender) &&
    [invoice.customerName, ...invoice.payerAliases].some((name) => nameKey(name) === sender);
  const similarName = (invoice: DepositInvoiceCandidate) => {
    const tokens = sender.split(" ").filter((token) => token.length >= 3);
    return (
      tokens.length >= 2 &&
      [invoice.customerName, ...invoice.payerAliases].some((name) => {
        const candidate = new Set(nameKey(name).split(" "));
        return tokens.filter((token) => candidate.has(token)).length >= 2;
      })
    );
  };
  const suggestions: DepositMatchSuggestion[] = [];
  for (const invoice of eligible) {
    const reference = containsPaymentReference(deposit.message, invoice.reference);
    const amountMatches = invoice.outstandingMinor === deposit.amountMinor;
    if (!reference && !amountMatches) continue;
    const nameMatches = exactName(invoice);
    suggestions.push({
      invoiceIds: [invoice.id],
      allocationAmountsMinor: [deposit.amountMinor.toString()],
      customerId: invoice.customerId,
      amountMatches,
      confidence: !amountMatches
        ? "LOW"
        : reference || (nameMatches && exactAmountCount === 1)
          ? "HIGH"
          : nameMatches || similarName(invoice)
            ? "MEDIUM"
            : "LOW",
      reasons: [
        reference ? "exact-reference" : "reference-unavailable-or-unmatched",
        amountMatches ? "exact-amount" : "reference-amount-mismatch",
        ...(nameMatches ? ["exact-customer-or-alias"] : []),
        ...(amountMatches && exactAmountCount > 1 ? ["ambiguous-amount"] : [])
      ],
      requiresConfirmation: true
    });
  }
  // Bounded pair search: avoid exponential subset matching on large ledgers.
  const byCustomerAmount = new Map<string, Map<bigint, DepositInvoiceCandidate[]>>();
  for (const invoice of eligible) {
    const amounts =
      byCustomerAmount.get(invoice.customerId) ?? new Map<bigint, DepositInvoiceCandidate[]>();
    byCustomerAmount.set(invoice.customerId, amounts);
    const remainder = deposit.amountMinor - invoice.outstandingMinor;
    for (const other of amounts.get(remainder) ?? []) {
      if (suggestions.length >= 200) break;
      const references =
        containsPaymentReference(deposit.message, invoice.reference) &&
        containsPaymentReference(deposit.message, other.reference);
      suggestions.push({
        invoiceIds: [other.id, invoice.id],
        allocationAmountsMinor: [
          other.outstandingMinor.toString(),
          invoice.outstandingMinor.toString()
        ],
        customerId: invoice.customerId,
        amountMatches: true,
        confidence: references ? "HIGH" : exactName(invoice) ? "MEDIUM" : "LOW",
        reasons: [
          "exact-combined-amount",
          ...(references ? ["both-references"] : []),
          ...(exactName(invoice) ? ["exact-customer-or-alias"] : [])
        ],
        requiresConfirmation: true
      });
    }
    const sameAmount = amounts.get(invoice.outstandingMinor) ?? [];
    if (sameAmount.length < 200) sameAmount.push(invoice);
    amounts.set(invoice.outstandingMinor, sameAmount);
  }
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return suggestions
    .sort(
      (a, b) =>
        rank[a.confidence] - rank[b.confidence] ||
        Number(b.reasons.includes("exact-reference")) -
          Number(a.reasons.includes("exact-reference")) ||
        a.invoiceIds.join().localeCompare(b.invoiceIds.join())
    )
    .slice(0, 200);
}
