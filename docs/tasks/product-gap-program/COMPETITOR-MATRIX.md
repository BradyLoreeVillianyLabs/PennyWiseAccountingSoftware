# Competitor features, reviews, and what PennyWise can't do yet

Researched 2026-09-11. Evidence grades and full source links are in
`VERIFICATION-LEDGER.md`, section D. "PennyWise today" is taken from the source code,
not from marketing documents.

## 1. Snapshots

| Product               | Known for                                | Reviewers like                                                                                                                                      | Reviewers dislike                                                                                                                                                                        |
| --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QuickBooks Online** | Industry standard; accountants know it   | Access anywhere; payment processing; mobile invoicing and receipt capture                                                                           | Support; frequent interface changes (forced Modern View and invoice redesign); weak inventory and barcoding; bank-feed problems; slow reports on large files; irreversible multicurrency |
| **Xero**              | Clean everyday accounting; app ecosystem | Ease of use; integrations; reporting                                                                                                                | No inbound phone support on standard plans; price; only two tracking categories; multi-currency only on Premium ($80/month in Canada); report-time FX revaluation                        |
| **FreshBooks**        | Service businesses and freelancers       | Easy invoicing; time tracking; proposals with e-signature; retainers; client portal                                                                 | Client caps (Lite has 5); $10 per extra user; no accountant access on Lite; duplicate bank imports; declining support                                                                    |
| **Wave**              | Free invoicing                           | Free unlimited invoices and estimates; recurring invoices on the free tier                                                                          | Bank feeds, receipt scanning and automatic reminders now paid (Pro $19/month); Wave branding on free invoices; support                                                                   |
| **Zoho Books**        | Broad features, free plan                | Customer portal; retainer invoices; automatic reminders; integrations                                                                               | Support; accounts blocked "for security reasons"; 1 GB storage; weaker mobile app                                                                                                        |
| **Sage Accounting**   | Simple small-business books              | Unlimited quotes and invoices; time savings                                                                                                         | Price increases; slowness; bank disconnects; multi-currency on higher tier                                                                                                               |
| **Square Invoices**   | Free invoicing for trades                | Free unlimited invoices, estimates and **contracts with e-signature**; **deposits**; up to 12 **milestones** (Plus)                                 | Limited customization; processing fees                                                                                                                                                   |
| **Jobber**            | Field-service businesses                 | **Client Hub** (request work, approve, pay); **signature on quote approval**; deposits on quotes; automated follow-ups; mobile apps rated 4.8 (iOS) | Per-user pricing can pass $600/month; weak reporting; follow-ups only on higher plans                                                                                                    |
| **Invoice2go**        | Mobile invoicing                         | Mobile ease; on-the-go payments                                                                                                                     | Plan caps (Starter: 2 invoices/month); automatic upgrades; **invoices not reaching inboxes**; cancellation difficulty                                                                    |

## 2. Category-wide lessons

| Pattern customers **like**                           | PennyWise response                                  |
| ---------------------------------------------------- | --------------------------------------------------- |
| Invoice from a phone on site                         | P1 (phone access), then R1 (optional relay)         |
| Customers approve, sign and pay online               | P2 (signature), I9 (durable pay links), R1 (portal) |
| Deposits and milestone payments                      | P3                                                  |
| Automatic follow-ups                                 | I8                                                  |
| Automatic exchange rates, and seeing both currencies | X1, D4 (one-click Bank of Canada rate)              |
| Quick setup, simple screens                          | I1, I2, X3                                          |

| Pattern customers **dislike**                          | PennyWise response                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Poor support                                           | In-app help and diagnostics exist (Phase 16); X4 requires consistent help placement (WCAG 3.2.6). Support staffing is an **owner operations decision**. |
| Price rises, plan gating, per-user and per-client caps | Local install, no user or client caps, multi-currency on every plan (owner pricing decision D-07)                                                       |
| Forced redesigns that slow people down                 | D11: opt-in redesigns, keystroke measurement, nothing removed                                                                                           |
| Invoices that don't arrive                             | I4 sends from the owner's own mailbox, which avoids a third-party sender; delivery states stay truthful                                                 |
| Bank-feed disconnects                                  | B2-3 (Flinks); file import always remains; show last-sync status                                                                                        |
| Slow reports on large data                             | X2 performance budget                                                                                                                                   |
| Weak inventory (QuickBooks)                            | PennyWise strength: U4 exposes the existing depth                                                                                                       |

## 3. Capability register — every gap, and what happens to it

**Legend:**

- ✅ PennyWise has it.
- ◐ Partial.
- ❌ Missing.
- Disposition points to the prompt or owner action that closes the gap.

| #   | Capability                                         | Competitors with it                                      | PennyWise today                                    | Disposition                                                                                                                                     |
| --- | -------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Multi-line invoice with free-text lines            | All                                                      | ❌ UI is one line (API supports it)                | **X3**                                                                                                                                          |
| 2   | Create a missing item or customer from the invoice | Xero, Zoho, Wave, QuickBooks                             | ◐ Navigates away                                   | **X3**                                                                                                                                          |
| 3   | Email invoices                                     | All                                                      | ❌ Off on installed builds                         | **I4**                                                                                                                                          |
| 4   | Payment instructions and methods on the invoice    | All                                                      | ◐ Free text only                                   | **I3**                                                                                                                                          |
| 5   | Online card payment                                | All                                                      | ❌ Platform-only; loopback links                   | **I9**                                                                                                                                          |
| 6   | Automatic payment reminders                        | Zoho, FreshBooks, Jobber, Square, Wave Pro               | ❌                                                 | **I8**                                                                                                                                          |
| 7   | Recurring invoices that run                        | All                                                      | ❌ Plans only                                      | **I6 → I7**                                                                                                                                     |
| 8   | Customer statements                                | QuickBooks, Zoho, Xero                                   | ◐ API, no screen                                   | **I5 / I8**                                                                                                                                     |
| 9   | Void, credit note, edit draft                      | All                                                      | ◐ API, no screen                                   | **I5**                                                                                                                                          |
| 10  | Quote or contract e-signature                      | Square, Jobber, FreshBooks                               | ❌                                                 | **P2**                                                                                                                                          |
| 11  | Deposits and retainers applied to invoices         | Square, Jobber, Zoho, FreshBooks                         | ◐ Non-posting requests                             | **P3**                                                                                                                                          |
| 12  | Milestone or progress payments                     | Square (Plus), FreshBooks                                | ◐ Non-posting plans                                | **P3**                                                                                                                                          |
| 13  | Mobile app or phone access                         | All                                                      | ❌ Loopback-only install                           | **P1**, **R1**                                                                                                                                  |
| 14  | Customer portal (view, approve, pay)               | Jobber, FreshBooks, Zoho                                 | ❌ Needs hosting                                   | **R1** (design); local installs use PDFs and pay links                                                                                          |
| 15  | "Invoice viewed" tracking                          | Most cloud tools                                         | ❌ Needs hosting                                   | **R1**; deliberately no tracking pixels                                                                                                         |
| 16  | Online booking                                     | Jobber                                                   | ❌                                                 | **Excluded** for now: needs hosting (R1) and is outside accounting scope                                                                        |
| 17  | Card on file, autopay                              | Jobber, FreshBooks, Square                               | ❌                                                 | **Later**, after I9                                                                                                                             |
| 18  | Pay by bank (EFT/PAD)                              | QuickBooks, Square, FreshBooks                           | ◐ e-Transfer and EFT instructions                  | **I3**, **C1**; Stripe pre-authorized debit later, in I9's follow-up                                                                            |
| 19  | Automatic bank feeds                               | QuickBooks, Xero, Zoho, Wave Pro                         | ◐ File import; Plaid gated                         | **B2-3** (Flinks)                                                                                                                               |
| 20  | Receipt capture and OCR                            | QuickBooks, Xero, Wave Pro                               | ◐ Capture inbox; OCR in progress                   | **B2-5**; phone capture needs **P1**                                                                                                            |
| 21  | Payroll                                            | QuickBooks, Wave, Xero                                   | ◐ Native CA-AB draft engine                        | **B2-4**                                                                                                                                        |
| 22  | Sales-tax report                                   | All                                                      | ✅ H5 landed; filing register remains              | H5 "remaining work" (existing task)                                                                                                             |
| 23  | GST/HST number printed on invoices                 | All Canadian tools                                       | ❌ Business number only                            | **I1 / I2** (D12)                                                                                                                               |
| 24  | French interface                                   | QuickBooks (English and French)                          | ❌ English only                                    | **P5**                                                                                                                                          |
| 25  | French documents                                   | QuickBooks                                               | ❌                                                 | **I2** (D12)                                                                                                                                    |
| 26  | Custom fields                                      | Square (Plus); Xero (2 tracking categories, a complaint) | ❌ No model                                        | **P4**                                                                                                                                          |
| 27  | Custom roles                                       | QuickBooks Enterprise                                    | ◐ Fixed roles                                      | **Later**: QuickBooks gap review, Phase 3                                                                                                       |
| 28  | Job and class dimensions                           | QuickBooks Desktop                                       | ◐ Projects without posting dimensions              | **Later**: QuickBooks gap review, Phase 2                                                                                                       |
| 29  | Time tracking and mileage to invoice               | FreshBooks, Jobber, QuickBooks                           | ◐ Tracked, not billed                              | **C2**                                                                                                                                          |
| 30  | AI assistant (categorize, predict pay dates)       | QuickBooks, Xero                                         | ◐ Explainable Books Health; rule suggestions (API) | **C3** and **U2** (rule suggestions UI). No large language model posts to the books by default; revisit only with an owner decision on privacy. |
| 31  | Multi-currency                                     | QuickBooks, Xero (top plan), Zoho, Sage (higher tier)    | ◐ CAD/USD                                          | **X1**, **M1–M4**                                                                                                                               |
| 32  | Accountant collaboration                           | QuickBooks, Xero                                         | ✅ Roles and workbench                             | **C4** adds a handover package                                                                                                                  |
| 33  | Inventory, barcodes, POS                           | QuickBooks (weak), Zoho                                  | ◐ Deep API, partial UI                             | **U4**                                                                                                                                          |
| 34  | Security settings UI (sessions, API keys)          | All                                                      | ◐ API only                                         | **U3**                                                                                                                                          |
| 35  | Record maintenance (edit and archive everything)   | All                                                      | ◐ API only for many records                        | **U1**, **U2**                                                                                                                                  |
| 36  | Accessible, bilingual, responsive interface        | Varies                                                   | ◐ Contrast and text size, no automated checks      | **X4**, **P5**                                                                                                                                  |
| 37  | SMS reminders                                      | Jobber                                                   | ❌                                                 | **Excluded**: cost and consent rules; email first                                                                                               |

## 4. Advantages to protect

### X1 status (2026-09-12)

The CAD/USD currency increment now has symbol-based app display, ISO-coded customer
documents, plain-decimal visible-table exports, explicit currency/base-amount columns,
in-context enablement, and an inline reviewed-rate path. The remaining multi-currency
gaps are foreign corrections, banking, reporting/aging, and currency breadth (M1-M4).

- **Inventory depth.** It is a named weakness for QuickBooks, and a strength here.
- **Multi-currency not plan-gated,** with posted, reviewed revaluation rather than
  report-time revaluation.
- **No user or client caps,** and data on the owner's own computer, with verified backups.
- **Invoices sent from the owner's own mailbox.** Competitor emails sometimes don't arrive.
- **Immutable, explainable books,** including the "what this did to your books" panel
  (I2).
