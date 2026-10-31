# North American tax and marketplace-remittance controls

Status: **review-only commerce evidence and mapping controls are implemented.**
Automated tax filing, jurisdiction determination, and tax payment remain unavailable.

This is an operational control document, not tax, legal, or accounting advice. A business
must confirm its registrations, nexus, taxable products/services, customer destination,
exemptions, marketplace terms, and return requirements with the applicable authority or
qualified advisor.

Provider setup and payload handling are specified in [Commerce provider setup](COMMERCE_PROVIDER_SETUP.md)
and [Commerce provider payloads](COMMERCE_PROVIDER_PAYLOADS.md). Those documents require
`MANUAL_REVIEW` until rate-level mapping and remitter evidence are complete.

## Official provider evidence

Use provider documentation to understand what a payload or report contains; do not turn a
provider tax line into a universal remittance conclusion. The official references for this
control are [WooCommerce tax setup](https://woocommerce.com/document/setting-up-taxes-in-woocommerce/),
[WooCommerce Tax](https://woocommerce.com/document/woocommerce-shipping-and-tax/woocommerce-tax/),
[WooCommerce orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/),
[WooCommerce webhooks](https://woocommerce.com/document/webhooks/),
[Etsy payments and ledger](https://developers.etsy.com/documentation/tutorials/payments/),
[Etsy Canadian remittance guidance](https://help.etsy.com/hc/en-us/articles/6633345416215-What-Does-Etsy-Remit-to-Canadian-Tax-Authorities?segment=selling),
and [Etsy U.S. sales-tax and fee guidance](https://help.etsy.com/hc/articles/360000343968?segment=selling).
They are evidence sources, not legal advice and not a guarantee that a marketplace remits
every tax for every seller, order, product, jurisdiction, or fee.

## PennyWise Accounting behavior today

WooCommerce and Etsy imports remain non-posting source evidence. When an imported order
contains tax, PennyWise Accounting requires all of the following before the event can be marked
reviewed:

1. a mapping for **every observed provider tax rate or label** to a PennyWise Accounting
   tax code;
2. a per-rate remittance override in `taxRemittanceMappings`, keyed by provider rate ID or
   stable provider label, with value `SELLER`, `MARKETPLACE`, or `REVIEW_REQUIRED`;
3. a reconciled provider order/payout/tax-report trail that supports each override.

`REVIEW_REQUIRED` is the default. It creates the blocking
`TAX_REMITTANCE_CONFIRMATION_REQUIRED` finding. A tax map that omits an observed rate
creates `TAX_RATE_MAPPING_REQUIRED`. PennyWise Accounting never infers that Etsy, WooCommerce,
Stripe, or any other payment provider remits a tax merely because a tax amount appeared
in an order payload.

The per-rate overrides are retained with the versioned connector mapping and normalized
evidence. They do **not** create a journal, a sales-tax liability, a return, a payment, or
a filing. That is intentional until jurisdictional calculation and a separately accepted
filing workflow exist.

### Per-tax remittance overrides and aggregate responsibility

`taxRemittanceMappings` is the authoritative override map for imported tax components:

```json
{
  "provider-rate-id-1": "SELLER",
  "province-tax-label": "MARKETPLACE",
  "unclassified-provider-tax": "REVIEW_REQUIRED"
}
```

Keys are the provider tax rate ID when supplied, otherwise the stable provider rate/label
preserved by normalization. Values are limited to `SELLER`, `MARKETPLACE`, and
`REVIEW_REQUIRED`. Do not use a single order-level switch to overwrite these component
decisions.

The normalized aggregate `taxRemittanceResponsibility` is derived from the components:

| Component result                                                                              | Aggregate responsibility |
| --------------------------------------------------------------------------------------------- | ------------------------ |
| Every observed component is `SELLER`                                                          | `SELLER`                 |
| Every observed component is `MARKETPLACE`                                                     | `MARKETPLACE`            |
| Components contain both `SELLER` and `MARKETPLACE`, with every component resolved             | `MIXED`                  |
| Any component is `REVIEW_REQUIRED`, or a provider aggregate cannot be allocated to components | `REVIEW_REQUIRED`        |

For `MIXED`, preserve the complete `taxRemittanceByComponent` map alongside the aggregate;
never collapse the order to one remitter. Etsy tax presented only as an aggregate amount,
without enough component/rate evidence to separate seller-remitted and marketplace-remitted
parts, remains `REVIEW_REQUIRED` even when Etsy documentation describes remittance for some
qualifying transactions. Obtain a report or other transaction-level evidence before review.

## How to choose the remitter

| Evidence situation                                                                 | Per-component PennyWise Accounting selection | Required operator evidence                                                                                                                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The seller is registered/required to collect and remit for the sale.               | `SELLER`                                     | Registration/nexus review, destination/product tax treatment, exact tax-rate mapping, and return/reconciliation procedure.                                  |
| The marketplace is legally collecting and remitting the tax for the specific sale. | `MARKETPLACE`                                | Marketplace order/settlement/tax report showing the tax as remitted, jurisdiction/date/product applicability, and reconciliation to the marketplace payout. |
| The order or report does not prove the treatment for a component.                  | `REVIEW_REQUIRED`                            | Do not mark the event reviewed. Obtain the jurisdictional and platform evidence first.                                                                      |

For a marketplace-remitted amount, the future accounting workflow must preserve the gross
sale, the tax collected/remitted by the marketplace, fees, and net payout as separately
reconcilable facts. It must not book the marketplace-remitted amount as a seller tax
liability without an explicit accounting policy and evidence. For a seller-remitted amount,
the future workflow must create a reviewable tax-liability and return/reconciliation trail.
Neither future behavior is released by the current review-only connector.

## Etsy controls

Etsy's seller guidance describes automatic calculation, collection, and remittance of U.S.
sales tax for qualifying orders under applicable marketplace-facilitator laws, and its
Canadian guidance describes circumstances in which Etsy collects and remits GST/HST, QST,
and provincial taxes. The legal treatment still depends on the specific seller status,
destination, product, order, tax ID, date, and tax type. Use `MARKETPLACE` only after
matching the Etsy order and settlement/report evidence to that exact transaction; do not
apply that choice to direct sales, non-covered jurisdictions, fees, or a different tax
type by default.
[Etsy's U.S. seller guidance](https://help.etsy.com/hc/articles/360000343968?segment=selling)
and [Etsy's Canadian tax guidance](https://help.etsy.com/hc/en-us/articles/6633345416215-What-Does-Etsy-Remit-to-Canadian-Tax-Authorities?segment=selling)
are operator evidence sources, not a substitute for the seller's own registration review.

Etsy may also collect VAT/GST/HST on some buyer transactions or seller fees. A fee tax is
not automatically the same as the sales tax on the goods sold. Keep sales-tax, platform-fee
tax, customs/import tax, and income-tax withholding as separate evidence categories. This
is why PennyWise Accounting requires rate-level mapping rather than a single generic marketplace tax
switch.

## WooCommerce controls

WooCommerce is a storefront and can be configured with many different tax and payment
arrangements. A Woo tax line demonstrates what the store supplied; it does not establish
the legal remitter. Normally a merchant using its own WooCommerce checkout must assess
seller obligations, while a third-party marketplace/facilitator arrangement may alter the
answer for some sales. Configure each observed Woo rate and choose `SELLER` or
`MARKETPLACE` only from the merchant's actual evidence.

The Woo adapter preserves exact order/revision evidence, requires a reviewed tax map,
deduplicates poll/webhook identity, and never creates tax entries on its own. See the
[WooCommerce webhook guide](https://woocommerce.com/document/webhooks/) for delivery
configuration and retain an accepted live fixture before any production claim. WooCommerce
Core tax configuration demonstrates how the store calculated or displayed a tax line; it
does not by itself establish the legal remitter.

## United States

U.S. sales tax is state- and often local-jurisdiction specific. Marketplace-facilitator
rules and economic-nexus thresholds vary by state. The Streamlined Sales Tax marketplace
guidance expressly cautions that state definitions and reporting treatments can differ; a
single national Etsy/Woo setting cannot establish a seller's liability.
[Marketplace facilitator guidance](https://www.streamlinedsalestax.org/for-businesses/marketplace-facilitator)

Before a U.S. seller tax workflow can be enabled, PennyWise Accounting needs all of these as
versioned, reviewable data:

- nexus/registration status by state and effective date;
- destination-based state, county, city, and special-district rate sourcing;
- product/service taxability, exemptions, resale certificates, shipping treatment, and
  marketplace-facilitator exceptions;
- return cadence, due-date calendar, filing credentials, payment approval, receipt storage,
  correction/amendment support, and a completed reconciliation to the general ledger;
- independently tested boundary cases for marketplace/direct sales, refunds, partial
  refunds, discounts, shipping, tax-inclusive pricing, and changed jurisdiction rules.

Until that exists, PennyWise Accounting can organize tax evidence and block uncertain commerce events;
it must not call itself an automated U.S. sales-tax engine or filing service. The IRS notes
that collected state/local sales tax required to be paid over is not business income, which
reinforces the need to preserve tax separately from revenue in a future posted workflow.
[IRS Publication 334](https://www.irs.gov/publications/p334)

## Canada

Canada's GST/HST treatment depends on the type and place of supply. For goods, delivery or
shipping destination commonly determines the province; services and intangibles have their
own rules. The CRA's current guidance also shows that a zero-rated supply is not simply a
taxable sale at a guessed provincial rate.
[CRA GST/HST place-of-supply guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html)

Before Canadian sales tax becomes automated, PennyWise Accounting needs effective-dated GST/HST/PST/QST
registrations, destination/product classification, place-of-supply logic, exemptions,
marketplace treatment, filing cadence, and return/reconciliation evidence. An Etsy seller
should not treat the platform's remittance of one applicable tax or fee as proof that every
GST/HST/PST/QST obligation is settled.

## Operating checklist

1. Save the relevant marketplace order export, payment/settlement report, and tax report.
2. Verify the buyer destination, product/service category, seller registration/nexus, and
   marketplace-facilitator treatment for that sale.
3. Map the precise provider rate ID or unique provider label to the approved PennyWise Accounting tax
   code.
4. Set `taxRemittanceMappings` for every provider rate ID/label. Leave a component
   `REVIEW_REQUIRED` if the evidence is incomplete; confirm the derived aggregate is
   `MIXED` when resolved components contain both seller and marketplace responsibility.
5. Re-run the connector sync so staged evidence is renormalized under the new mapping.
6. Reconcile gross sales, tax, marketplace fees, refunds, and payout before any accounting
   conversion is authorized.
7. Retain the tax report and decision evidence for the return/review process.

## Automated coverage

- Unit coverage verifies exact provider tax-rate completeness, per-rate overrides, derived
  `MIXED` responsibility, and blocking `REVIEW_REQUIRED` outcomes.
- WooCommerce and Etsy connector tests verify signed/provider evidence retains each override
  in `taxRemittanceByComponent` and the derived aggregate responsibility.
- Connector integration coverage verifies mapping version changes re-normalize staged
  evidence, remain replay-safe, and still create zero accounting entries.

The control deliberately fails closed rather than making a tax remittance assertion from
ambiguous marketplace data.
