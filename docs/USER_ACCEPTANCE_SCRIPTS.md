# Controlled Beta User-Acceptance Scripts

Use a disposable organization and test-mode provider credentials only. Never connect an
operational WooCommerce/Etsy store, bank, payment account, or email account during an
unsupervised beta test. Record the ClearLedger version, role, date, browser, request ID,
expected result, actual result, and reproducible steps. Remove personal, financial,
payroll, provider-secret, and customer information before using the in-product bug link.

## Fresh installation and identity

1. On a supported 64-bit Windows test computer, verify the published ZIP SHA-256, extract
   the archive, read `BETA_LICENSE.txt` and `KNOWN_LIMITATIONS.md`, and run
   `Start-ClearLedger.ps1` from PowerShell.
2. Confirm that Docker starts a private database and that only the web interface is bound
   to `127.0.0.1:3000`. Open `http://localhost:3000`.
3. Enter a disposable test email and create a company with a long display name. Complete
   the fiscal year-end, start/end dates, currency, tax, and workflow-preset steps using
   the clickable date controls.
4. Restart ClearLedger and confirm that the same local identity, company, and setup state
   remain available.

Expected: there is no `OIDC_UNAVAILABLE` error in the local beta; an email address is not
treated as a public-internet authentication claim; the long company name remains readable
in the company selector; another organization is not visible without membership.

## Guided first-use and demo company

1. Open Getting Started, search the Help index, and dock Help beside the workspace on a
   desktop-sized browser.
2. Follow one recommended action into its destination, return Home, and confirm that the
   three-pane dashboard still prioritizes financial indicators, exceptions, Books Health,
   and frequent actions rather than large introductory copy.
3. Create the fully configured fictional demo company once. Explore its invoice, bill,
   bank, inventory, project, report, calendar, and commerce-review examples.
4. Change dashboard tile visibility, order, density, and one appearance theme. Reload and
   confirm that the organization-specific choices persist.

Expected: Help remains usable beside the dashboard; planned/demo records are visibly
different from posted facts; configurable tiles never change accounting; the demo can be
identified as fictional everywhere it matters.

## Navigation, hierarchy, and responsive menus

1. At a desktop width, inspect Home, Sales, Purchases, Banking, Reports, Projects, Tools,
   and Integrations. Confirm that destinations through Integrations are visible before
   opening More.
2. Activate Business and Accountant in turn. Confirm that the selected mode and selected
   destination have a non-colour-only active state and sufficient text contrast in every
   supplied theme.
3. Open New and More near every edge of the viewport, at 200 percent zoom, and after
   reducing the browser height. Confirm that each menu remains inside the viewport and is
   not clipped by a card or forced into a small internal scrolling box.
4. Repeat at a phone-sized viewport with keyboard focus and the responsive navigation.

Expected: titles, section headings, cards, links, menu items, primary commands, and plain
text are visually distinct; menus do not escape the browser; focus remains visible.

## Owner-Operator

Create an organization, complete setup, add a customer and service invoice, post it, send a document, and review dashboard totals. Expected: each saved record appears only in the active organization and the invoice posts a balanced AR, revenue, and tax journal. Ask: were the setup labels, status messages, and next actions understandable?

## Bookkeeper

Create a vendor bill, record a partial bill payment, import a bank statement, match the payment, and complete a zero-difference reconciliation. Expected: AP, bank, and reconciliation status agree; rerunning the same import does not duplicate rows. Ask: were matching explanations and reconciliation evidence sufficient?

## Receipt and bill evidence reviewer

1. Upload one fictional receipt and one fictional supplier bill. Confirm that the original
   image or PDF remains visible beside the proposed draft fields and can also be downloaded.
2. Before review approval and while the file scan is not Clean, confirm that draft creation
   is unavailable. Approve Clean evidence, reopen it, and explicitly select the only valid
   target: Bill draft for bill evidence or Immediate expense draft for receipt evidence.
3. Compare vendor, reference or invoice number, dates, payment method or terms, category,
   amount, and review note with the source. Create the draft and confirm the linked-result
   state says DRAFT, Not posted, and zero accounting entries.
4. Double-activate the completion command, retry after a simulated lost response, reload,
   and repeat from another session. Confirm that the completion command stays disabled and
   the same linked draft is shown instead of creating another record.
5. Repeat using keyboard only, at 200 percent zoom, and at a phone-sized viewport. Confirm
   the source preview, explicit target choice, validation errors, and linked result remain
   readable and operable without horizontal page overflow.

Expected: only Approved plus Clean evidence can create a draft; the operator chooses the
target explicitly; each capture produces exactly one linked, non-posting purchase draft;
stale, unsafe, mismatched, duplicate, and validation failures remain visible and create no
journal or second draft.

## Accountant

Run trial balance, balance sheet, P&L, tax, AR, and AP reports; inspect a journal trace; close a period; then create a correction through the allowed reversal workflow. Expected: all reports reconcile, posted lines remain immutable, and closed-period posting is rejected. Ask: could the evidence support a month-end review?

## Invoice Payer

Open a supplied public invoice link in a private browser window, begin a test-mode payment, and view the resulting receipt. Expected: no organization data beyond the invoice is exposed, duplicate payment requests do not create another receipt, and no real card data is stored by ClearLedger. Ask: were payment status and receipt content clear?

## Inventory User

Configure an inventory product and location, receive stock, sell it through an invoice, perform a transfer and a documented adjustment, then record a valid return. Expected: quantity and weighted-average value reconcile to inventory control and insufficient stock is blocked. Ask: were quantities, locations, and reasons easy to verify?

## Spreadsheet migration reviewer

1. Export a disposable sample from a previous system and upload a supported CSV or XLSX.
2. In the visual mapper, map source columns to ClearLedger fields, inspect representative
   values and warnings, save a profile, and run Preview and Dry run before Commit.
3. Test leading-zero identifiers, exact decimal amounts, duplicate rows, an unmapped
   required field, and a formula cell with and without a cached result.
4. Re-upload the same content under the same source and then under a different source.

Expected: the mapper never requires raw JSON; active content, unsafe archives, missing
formula results, and malformed files fail closed; committing is explicit and replay-safe;
the control reconciliation identifies every imported or rejected row.

## CAD/USD owner and bookkeeper

1. In a CAD-base disposable company, enable USD and record a dated, reviewed USD/CAD rate
   with source evidence.
2. Create and post a USD invoice, receive a partial USD payment, and inspect the CAD-base
   journal and remaining foreign balance. Repeat with a USD vendor bill/payment.
3. At period end, prepare and post a closing-rate revaluation, then verify its linked
   next-period reversal and realized-FX evidence when the item settles.
4. Attempt an unsupported currency, a foreign manual journal, and a foreign workflow not
   named in `CAD_USD_OPERATOR_GUIDE.md`.

Expected: source and CAD-base amounts remain exact and traceable; documents retain USD;
financial statements remain CAD; supported FX journals balance; every unsupported path
fails before an accounting entry is created.

## Invoice designer and customer document

1. Upload a disposable company logo and configure typography, colour, spacing, and each
   premium invoice theme.
2. Create a multi-line, multi-page draft with tax, discounts, payment instructions, CAD
   and USD examples, and preview it before posting.
3. Compare the exact preview with the generated PDF at normal and 200 percent zoom. Post
   and issue the invoice, then change the active design and retrieve the issued document.

Expected: preview and PDF agree on content, pagination, totals, tax, currency, logo, and
typography; issued snapshots remain reproducible after later template changes; unsafe or
oversized logos are rejected.

## Commerce catalog and inventory reviewer

1. Use the deterministic commerce demo first, or separately supplied credentials for a
   disposable WooCommerce/Etsy test store. Poll catalog/listing data into review without
   creating accounting.
2. Inspect variant identifiers, SKU, GTIN, manufacturer/part number, name, description,
   and image metadata. Review ranked candidate evidence for exact and near matches.
3. Confirm one suggestion, reject another, and create one new local product. Verify that
   fuzzy SKU/name/description evidence never confirms itself.
4. Configure an inventory policy, stage observed and desired quantities, simulate a
   provider failure/conflict, retry it, and reconcile the final observed state.

Expected: WooCommerce, Etsy, demo, spreadsheet, and future sources use the same bounded
matcher; exact identifiers rank above fuzzy evidence; ties are stable; images are never
matching authority; inventory shows observed, desired, pending, failed, and conflicted
states; review creates zero journals.

## Project, calendar, and planning reviewer

1. Create a project with a customer, start/end dates, budget, billing method, and long
   description. Add time, mileage, a receipt capture, tasks, a milestone, and a reminder.
2. Link dependencies, change a task status, and inspect month/list calendar views for
   project dates, tasks, milestones, invoices, and bills.
3. Use keyboard-only navigation and the accessible table/list alternative. Narrow the
   date/filter range and verify source links.
4. Compare a 13-week forecast and budget with posted actuals, then change a forecast
   assumption.

Expected: calendar movement and planning changes create no accounting; dependencies and
dates validate; planned/projected values stay visibly non-authoritative; formal reports
continue to use posted records only.

## Editable accounting workpaper

1. Create an unposted manual-journal workpaper with at least four debit/credit lines,
   descriptions, an effective date, and a review note.
2. Save it, reload, add/remove/reorder lines, correct the amounts in place, and verify
   that no journal exists yet. Cancel a separate draft and confirm that it cannot post.
3. Post the completed balanced workpaper once, repeat the same request, and then attempt
   to edit the posted result or post into a closed period.

Expected: draft editing does not create correction noise; exactly one immutable journal
is created by the explicit post; replay is idempotent; closed-period and post-edit
attempts fail; reports include the posted journal but exclude the workpaper beforehand.

## Controlled trusted sharing

1. Keep the owner's local session open. Run `node scripts/pennywise-beta-access.mjs init --install-task --start`;
   it starts only the configured loopback
   shares and stores access credentials outside the repository. Do not expose ordinary local
   web/API ports.
2. From a remote private browser, open the tester's `https://pennywise*.loclx.io/` URL and
   authenticate with the privately supplied pair. Confirm that only the selected fresh company
   is available and that the demo company is an explicit option rather than the automatic landing company.
3. Stop sharing with `node scripts/pennywise-beta-access.mjs stop`, then verify that the remote URL no
   longer reaches PennyWise while the owner's local session, data, desktop bridge, and unrelated
   LocalXpose processes still work.

Expected: sharing is additive, fixed to one test identity/company, protected by HTTPS and
server-side Basic Authentication, auto-recovering while the test host is signed in, and removable
without stopping or altering unrelated LocalXpose or integration-service processes.

## Feedback, recovery, and exit

1. Open the in-product bug path and the public community path. Confirm that private bug
   details are not posted to the public board and that community submissions await
   moderation. Do not submit secrets or customer data.
2. Run `Backup-ClearLedger.ps1`, record the backup checksum, make a visible disposable
   change, and restore into the documented isolated drill. Confirm the restored control
   totals before replacing any active beta data.
3. Run diagnostics, stop/start, and the documented update/rollback drill. Finally run
   uninstall with data preserved; use destructive data removal only on a verified
   disposable installation.

Expected: feedback paths disclose their privacy boundary; a valid backup restores with
matching control totals; integrity/secret checks fail closed; uninstall does not silently
delete the database or files.
