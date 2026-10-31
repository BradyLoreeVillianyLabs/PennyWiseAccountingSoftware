# Owner accounting evidence acceptance

Date: 2026-08-02

Decision: ACCEPTED FOR THE RELEASED CAD/USD SOFTWARE BOUNDARY

The project owner removed the mandatory external-accountant approval gate and
directed that a ClearLedger accounting model may be released when its automated
acceptance evidence passes. This is a product-governance decision, not a
representation that an accountant, tax authority, marketplace, or provider has
endorsed ClearLedger.

The owner also reports that professional accountants are actively reviewing
and advising on this build from the current workstation, with additional
product-workflow input from a former Intuit employee. This report records that
advisory context without claiming a named attestation, CPA engagement, Intuit
review, certification, or endorsement.

## Evidence required to lift an accounting model gate

The relevant suite must prove, as applicable:

- exact integer/rational arithmetic and deterministic rounding;
- balanced atomic journals and immutable posted evidence;
- linked correction/reversal behavior and closed-period enforcement;
- source-to-ledger and report reconciliation;
- transaction/base currency evidence and realized/unrealized FX behavior;
- organization isolation and default-deny authorization;
- replay safety, idempotency, and concurrency behavior;
- migration, rollback refusal after adoption, and restore compatibility; and
- explicit rejection of unsupported currencies or workflows.

Passing an unrelated or partial suite does not open a boundary. A provider
workflow additionally requires live provider fixtures and order-to-payout-to-
bank reconciliation because simulated connector data cannot prove provider
behavior.

## Accepted evidence on this revision

On 2026-08-02 the combined identity, demo-company, CAD/USD accounting,
multi-currency safety, commerce inbox, and native connector boundary set passed
6 files and 35 database-backed tests. The complete repository gate also passed
formatting, lint, TypeScript, Prisma validation, 113 package/application tests,
all 27 integration files with 175 PostgreSQL-backed tests, and every build. It
proves the released manual-rate CAD/USD invoice, receipt, bill, payment,
foreign-cash, realized FX, revaluation, reversal, tenancy, and fail-closed
boundaries.

The browser release flow then passed on Chrome, Edge, Firefox, mobile Chrome,
and mobile WebKit, including first-company setup and deterministic fictional
demo creation. The accessibility, traceability, hygiene, and browser performance
contracts passed. Eight matrix cases are intentionally skipped where a test is
defined only for the primary Chrome project; seven applicable browser cases
passed.

Accordingly, absence of an accountant signature no longer blocks the released
manual-rate CAD/USD model. Organization owners remain responsible for choosing
the correct functional currency, rates, tax settings, filing treatment, and
period-close policy for their own entity. ClearLedger must continue to disclose
that automated checks are not professional or tax advice.

WooCommerce and Etsy automatic posting are not opened by this decision. Their
fixture-backed adapters remain non-posting until provider-specific golden tests
and live order/refund/fee/tax/payout/bank reconciliation pass.
