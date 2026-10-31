# Panel review of the prompt pack — 2026-09-11

The same five-person panel (accountant, product designer, accessibility specialist,
engineering lead, owner advocate) re-examined every claim and design choice in this pack
against primary sources and the source code. This file records what was checked, what
changed, and why. Nothing in `clearledger-src` was modified; only files in this pack were
edited.

## Summary

| Verdict                                                                 | Count |
| ----------------------------------------------------------------------- | ----- |
| **Confirmed**, with sharper evidence                                    | 8     |
| **Corrected** — the claim or instruction was wrong or would have failed | 9     |
| **New findings** added to the pack                                      | 5     |
| **Refined** — design choices changed after debate                       | 4     |

The three corrections that mattered most would each have produced a broken feature:

1. **Pay links in PDFs (I9).** Stripe Checkout Sessions and PayPal order links expire,
   within 24 hours and 3 hours respectively. Links printed on invoices must be durable
   Payment Links.
2. **Microsoft mailbox SMTP presets (I4).** Password SMTP no longer works for Outlook.com
   personal accounts, and is disabled by default for Microsoft 365 from the end of
   December 2026. Microsoft accounts must use the existing OAuth mailbox connection.
3. **Late fees (I8).** A monthly rate printed without an annual equivalent caps
   recoverable interest at 5 % a year under the federal Interest Act.

## Verdicts, claim by claim

### Code and product claims

| #   | Claim (where)                                                               | Verdict       | Evidence                                                                                                                                                                                                                                                                                                                                                                 | Change                                       |
| --- | --------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1   | Payment webhooks are fire-and-forget and swallow errors (ASSESSMENT R2, I6) | **Corrected** | Only production mode defers processing with `setImmediate` and keeps the failure "for replay" (`payment-service.ts:812-828`). Other modes process inline. Installed builds set `NODE_ENV=development` (`launcher.cjs:724`), so they run inline. Nothing replays deferred failures.                                                                                       | R2 and I6 rewritten.                         |
| 2   | Payment-receipt emails                                                      | **New**       | `processPendingReceiptEmails` (`payment-outbox-worker.ts:78`) has no caller outside tests, so queued receipts are never sent by a worker.                                                                                                                                                                                                                                | Added to I6 and R2.                          |
| 3   | Outbound webhooks only go out via the manual dispatch route (R3)            | **Confirmed** | `processPendingDeliveries` is called only from `app.ts:2006`.                                                                                                                                                                                                                                                                                                            | None.                                        |
| 4   | Description-only lines might need a new "default sales account" (X3, D9)    | **Corrected** | A line with no product falls back to an optional line account, then the system `sales` account (`invoice-calculation.ts:108-116`). The public line schema accepts no account (`schemas.ts:924-933`).                                                                                                                                                                     | X3 simplified; no API change needed.         |
| 5   | Tax on description-only lines                                               | **New**       | Without a product, the tax code comes only from the request, so a line without one posts **no tax** (`invoice-calculation.ts:106-107`).                                                                                                                                                                                                                                  | X3 must show and default the tax code (G14). |
| 6   | Price-prefill citation (X1)                                                 | **Corrected** | The invoice form fills "Unit price (invoice currency)" with the product's base-currency price, whatever the invoice currency (`app.js:8060-8062`). The earlier citation `8080-8082` is a second form.                                                                                                                                                                    | X1 task 8 fixed; G13 added.                  |
| 7   | Invoices meet Canadian requirements                                         | **New**       | The renderer prints "Business number" only (`invoice-render-service.ts:149, 542`); stored tax registrations (`schema.prisma:1851-1853`) are not printed. The CRA requires the GST/HST number on invoices of $100 or more for the buyer's input tax credits. No document-language handling was found, and Quebec's Charter s.57 requires French invoices to be available. | G12; D12; I1 and I2 tasks added.             |
| 8   | The invoice screen sends one line; free-text payment instructions exist     | **Confirmed** | `app.js:9159-9192`; `invoice-render-service.ts:335-336, 713`.                                                                                                                                                                                                                                                                                                            | None.                                        |

### Competitor claims

| #   | Claim (where)                                                              | Verdict                     | Evidence                                                                                                                                                                                                                                | Change                                                       |
| --- | -------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 9   | The list of QuickBooks features lost with multicurrency (DECISIONS Part A) | **Corrected**               | Intuit's own article confirms: irreversible; one currency per contact; QuickBooks Payments, Bill Pay and Commerce are incompatible; the cash-flow planner is switched off. The other items came from third parties and community posts. | Part A now separates Intuit's list from unconfirmed reports. |
| 10  | Xero multi-currency is plan-gated                                          | **Confirmed, made precise** | xero.com/ca: only Premium ($80/month after the promotion) includes "Use multiple currencies".                                                                                                                                           | Part A updated.                                              |
| 11  | Xero calculates unrealised gains when a report is run                      | **Confirmed**               | Xero Central: unpaid invoices and bills are valued "at today's exchange rate", and reports reflect the latest figures when run.                                                                                                         | Source added.                                                |
| 12  | Xero's aged-report currency icon                                           | **Confirmed, extended**     | There is an icon with a rate popover, rates are listed in a footer, and the footer can be hidden, which also removes it from exports.                                                                                                   | Part A updated; X2 already covers the pattern.               |
| 13  | Over 90 % rate reporting as important (Software Advice)                    | **Confirmed, precise**      | 93 % (income statement and balance sheet) and 91 % (financial reporting) rated critical or high, from 1,700+ verified reviews, January 2025–January 2026.                                                                               | Part B updated.                                              |

### Technical and regulatory claims

| #   | Claim (where)                                                             | Verdict              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Change                                                                                                                            |
| --- | ------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `Intl.NumberFormat` can format exact decimal strings (X1)                 | **Confirmed**        | MDN: strings are formatted at their exact value in current engines. Older specifications parsed them as Number, so X1 keeps its fallback.                                                                                                                                                                                                                                                                                                                                      | None.                                                                                                                             |
| 15  | One-click Bank of Canada rate (D4, X1, M3)                                | **Strengthened**     | CRA Folio S5-F4-C1 accepts the Bank of Canada rate, among other reputable sources, as the spot rate. The Bank publishes indicative daily averages by 16:30 ET each business day. _(The count was corrected in `VERIFICATION-LEDGER.md`: 24 listed, 27 series in the daily group.)_                                                                                                                                                                                             | D4 and M3 note the timing and the tax fit.                                                                                        |
| 16  | Revaluation justified by IAS 21 (D5, M1)                                  | **Strengthened**     | ASPE Section 1651, the standard most Canadian private businesses use, adjusts foreign monetary items to the balance-sheet-date rate, with gains and losses in net income.                                                                                                                                                                                                                                                                                                      | D5 defaults to a year-end prompt, with monthly optional; M1 writes its ADR against ASPE first.                                    |
| 17  | SMTP presets for Gmail, Outlook and Microsoft 365 with app passwords (I4) | **Corrected**        | Outlook.com personal accounts have required modern authentication for third-party apps since 16 September 2024, with no app passwords. Exchange Online disables password SMTP by default at the end of December 2026, with final removal to be announced in 2027. Gmail app passwords still work with 2-Step Verification; Workspace ended plain-password SMTP on 14 March 2025. The PennyWise SMTP client supports only `AUTH PLAIN` (`smtp-email-provider.ts:190, 397-400`). | I4 task 2 rewritten: Microsoft via the existing OAuth mailbox connection; `AUTH LOGIN` added; vendor verification gates recorded. |
| 18  | Provider pay links in PDFs (I9)                                           | **Corrected**        | Stripe Checkout Sessions expire within 30 minutes to 24 hours. Payment Links are permanent until deactivated, support a one-payment limit, and copy their metadata to sessions. PayPal orders expire after 3 hours in `CREATED` by default. Square payment links don't expire until deleted.                                                                                                                                                                                   | I9 task 3 rewritten around durable links.                                                                                         |
| 19  | "Zero-fee" e-Transfer, and reference-based matching (C1)                  | **Partly corrected** | Receiving is reported free at major banks, but the sender may pay $1.00–$1.50 from a business account (third-party comparison). Exports usually include the sender name; only some include the message.                                                                                                                                                                                                                                                                        | C1 wording and matching rules changed; payer aliases added.                                                                       |
| 20  | Late fees as "% per period" (I8)                                          | **Strengthened**     | Interest Act s.4: interest expressed per month, or per any period under a year, needs an express annual rate; otherwise it is capped at 5 % a year. The case cited involved an invoice at 1.5 % a month.                                                                                                                                                                                                                                                                       | I8 requires annual-rate wording and agreed terms.                                                                                 |

### Design choices

| #   | Choice (where)                                                                  | Verdict                 | Evidence                                                                                                                                                      | Change                                                                                   |
| --- | ------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 21  | `=` marks exact posted amounts (D2, X1)                                         | **Refined**             | Designer and accessibility specialist: a bare `=` reads as arithmetic, and screen readers say "equals".                                                       | Use the word "Booked"; keep `≈`, with an accessible name of "approximately".             |
| 22  | The quick-create dialog grows for "More options", and nests one level (D10, X3) | **Refined**             | NN/g: modals suit short, focused tasks; use nonmodal panels when the user needs the screen behind. Stacked modals disorient keyboard and screen-reader users. | "More options" opens a side panel; nested creation becomes a step with "Back".           |
| 23  | A custom job-lease table (I6)                                                   | **Refined**             | pg-boss creates its schema at start unless `migrate: false` is set, which clashes with the restricted runtime database role.                                  | I6 records pg-boss as considered; a lease table created by migration remains the choice. |
| 24  | D1 money-display rule                                                           | **Confirmed, extended** | Quebec's Charter s.57 affects document language; the reader's locale differs from the owner's.                                                                | The document context now formats in the document's language (X1, D12).                   |

## Where the panel disagreed

**Late fees.**

- The owner advocate wants them.
- The accountant warns that they are unenforceable without agreed terms and an annual rate.
- **Resolution:** keep them off by default, add the Interest Act wording, and leave it an
  owner decision.

**Microsoft 365 SMTP.**

- Engineering proposed shipping SMTP for Microsoft 365 until December 2026.
- The owner advocate and accountant objected: new users would configure something that
  soon stops working.
- **Resolution:** OAuth first. SMTP is allowed for Microsoft 365 only with an explicit
  warning.

**PayPal in I9.**

- Engineering would drop it, because its links expire.
- The owner advocate notes customers ask for PayPal.
- **Resolution:** PayPal works through the owner's static link (I3) now. A durable
  API-generated link is added only after the Invoicing API share link's lifetime is
  verified.

## Still unverified — flagged, not relied on

_(Resolved later on 2026-09-11 in `VERIFICATION-LEDGER.md`. The Xero statistic is now
attributed to a November 2025 survey of 1,191 customers. The e-Transfer fee is confirmed by
Scotiabank for itself and its partner banks. The QST format is confirmed by secondary
sources. The Microsoft dates were softened. The PayPal share-link lifetime stays open, and
I9 tests it.)_

- **Xero's "70 % found the homepage easier" statistic** is vendor-published.
- **The e-Transfer fee comparison** comes from biller.ca, a third party. Check the banks'
  own fee schedules before any marketing claim.
- **The lifetime of the PayPal Invoicing API share link** (`send_to_recipient: false`) was
  not found in the documentation.
- **Review timelines** for Google sensitive-scope verification and Microsoft publisher
  verification are vendor processes. They are recorded as gates, not dates.
- **The QST number format** (10 digits, `TQ`, 4 digits) is to be confirmed from Revenu
  Québec.

## Files changed by this review

| File                                           | Change                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `DECISIONS-currency-reporting-workflow.md`     | D2, D4, D5 and D10 refined; D12 added; Part A, B and C corrections; new sources. |
| `ASSESSMENT.md`                                | R2 corrected; G12–G14 added.                                                     |
| `I1-invoicing-only-mode.md`                    | Capture tax registration numbers and document language.                          |
| `I2-invoice-composer-and-finalize.md`          | Print registration numbers; French and bilingual documents.                      |
| `I4-invoice-delivery-on-local-installs.md`     | Provider-specific sign-in; `AUTH LOGIN`; verification gates.                     |
| `I6-background-job-runner.md`                  | Webhook context corrected; receipt emails; library note.                         |
| `I8-overdue-follow-up-and-statements.md`       | Interest Act disclosure.                                                         |
| `I9-online-payments-for-local-installs.md`     | Durable Payment Links; PayPal handling; balance changes.                         |
| `C1-zero-fee-etransfer-loop.md`                | Fee wording, matching signals, payer aliases.                                    |
| `M1-foreign-corrections.md`                    | ASPE 1651 as the primary standard.                                               |
| `M3-multi-currency-reporting-and-documents.md` | Bank of Canada timing; year-end revaluation default.                             |
| `X1-money-display-and-currency-views.md`       | Prefill citation, "Booked" label, document language.                             |
| `X3-inline-creation-and-line-editor.md`        | `sales` account fallback, tax-code default, side panel and step nesting.         |
| `README.md`                                    | Review link and two new owner decisions.                                         |

## Sources added in this review

**Microsoft:**

- [Updated Exchange Online SMTP AUTH Basic Authentication deprecation timeline](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835)
- [Outlook.com basic authentication](https://support.microsoft.com/en-us/office/outlook-and-other-apps-are-unable-to-connect-to-outlook-com-when-using-basic-authentication-f4202ebf-89c6-4a8a-bec3-3d60cf7deaef)
- [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)

**Google:**

- [Transition from less secure apps to OAuth](https://support.google.com/a/answer/14114704?hl=en)
- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

**Stripe:**

- [How Checkout works](https://docs.stripe.com/payments/checkout/how-checkout-works)
- [Create a payment link](https://docs.stripe.com/api/payment-link/create)
- [Payment Links customization](https://docs.stripe.com/payment-links/customize?dashboard-or-api=api&locale=en-GB)

**PayPal:**

- [Orders API — standard use cases](https://developer.paypal.com/api/rest/integration/orders-api/api-use-cases/standard)
- [Invoicing customization](https://developer.paypal.com/docs/invoicing/customize/)

**Square:**

- [CreatePaymentLink](https://developer.squareup.com/reference/square/checkout-api/create-payment-link)
- [Do payment links expire?](https://community.squareup.com/t5/Payments-Troubleshooting/Do-payment-links-expire/m-p/384704)

**Canadian law and tax:**

- [Interest Act s.4 summary](https://www.isthatlegal.ca/index.php?name=interest.interest-act-4)
- [McCarthy Tétrault on annual-rate disclosure](https://www.mccarthy.ca/en/insights/publications/return-normalcy-annualizing-formulas-interest-rate-disclosure)
- [CRA Income Tax Folio S5-F4-C1](https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/series-5-international-residency-folio-4-foreign-currency/income-tax-folio-s5-f4-c1-income-tax-reporting-currency.html)
- [CRA input tax credits](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html)
- [Charter of the French Language (CanLII)](https://www.canlii.org/en/qc/laws/stat/cqlr-c-c-11/latest/cqlr-c-c-11.html)
- [Norton Rose Fulbright — doing business in Quebec](https://www.nortonrosefulbright.com/en/knowledge/publications/38625c3d/doing-business-in-quebec-language-legislation)

**Bank of Canada:**

- [Daily exchange rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/)
- [Valet API how-to](https://www.bankofcanada.ca/valet-api-how-to/)

**Accounting standard:**

- [BDO — ASPE Section 1651](https://www.bdo.ca/insights/accounting-knowledge-center/aspe/section-1651-foreign-currency-translation)

**Browser support:**

- [MDN — `Intl.NumberFormat.format`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/format)
- [Can I use — string decimal formatting](https://caniuse.com/mdn-javascript_builtins_intl_numberformat_format_number_parameter-string_decimal)

**Competitors:**

- [Xero Canada pricing](https://www.xero.com/ca/pricing-plans/)
- [Xero — Unrealised gains and losses report](https://central.xero.com/0/article/Unrealised-gains-and-losses-report)
- [Xero idea — aged-report foreign currency footer](https://productideas.xero.com/forums/967133-reports-tax/suggestions/45418840-aged-payable-receivable-report-foreign-currency)
- [Intuit — multicurrency](https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US)
- [Software Advice — selection criteria](https://www.softwareadvice.com/resources/accounting-software-selection-criteria/)

**e-Transfer:**

- [biller.ca — Interac e-Transfer fees 2026](https://biller.ca/blog/interac-e-transfer-fees-2026) (third party)
- [RBC business fees](https://www.rbcroyalbank.com/business/pdf/services_fees.pdf)
- [Zera Books — Scotiabank statement format](https://www.zerabooks.com/banks/scotiabank-statement-converter) (third party)

**UX and libraries:**

- [NN/g — modal and nonmodal dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/)
- [pg-boss](https://timgit.github.io/pg-boss/)
