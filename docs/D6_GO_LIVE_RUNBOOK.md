# Destry Workwear go-live drill and cutover runbook

Status: D6 engineering runbook, not a production authorization. Run this on a
disposable Windows installation with a disposable company until every evidence
gate is directly recorded. Never use the owner's live books as a test target.

## Evidence rules

- Record only version, timestamps, sanitized organization/order/shipment IDs,
  result, request IDs, and log/checksum paths. Do not copy customer names,
  addresses, emails, order payloads, credentials, labels, screenshots with live
  data, or provider secrets into the repository.
- Use a WooCommerce REST key for a dedicated user with the smallest `read`
  permission. Record only the key ID, store root, expiry, and revocation owner.
- Keep the connector in `MANUAL_REVIEW`. No catalog, order, stock, tax, invoice,
  payment, shipment, or journal is posted automatically by synchronization.
- Before any real record is entered, complete a backup and verified restore on
  the same disposable installation. A failed drill is a stop condition.
- Maintain `docs/status/D6_DRILL_EVIDENCE_TEMPLATE.json` as the evidence shape.
  Validate a redacted evidence file with:

  ```powershell
  corepack pnpm test:d6:evidence -- <path-to-redacted-evidence.json>
  ```

  `--require-complete` is only for the final owner evidence file. The validator
  rejects PASS entries without an evidence reference, operator, environment, and
  timestamp; it never converts `UNVERIFIED` or `NOT_RUN` into PASS.

## 1. Store preparation — stop before connection

Owner actions in WooCommerce:

1. Confirm HTTPS, WordPress REST reachability, WooCommerce REST v3, timezone,
   currency, tax settings, and the store root.
2. Add a SKU to every product and every variation. Confirm stock management is
   enabled per variation and record a count date and counting owner.
3. Reconcile the observed 2026-09-01 discrepancy before importing: three products
   appeared on `/shop/`, two were returned by the public Store API, and no SKUs
   were present. Do not guess which catalog is authoritative.
4. Create a dedicated read-only REST key under a dedicated WordPress user. Test
   catalog, variation, order, refund, and status reads only. Confirm revocation
   and expiry ownership. Never put the key or secret in evidence.

If SKU coverage, variation stock management, catalog scope, or key scope is not
confirmed, set `store-preparation` to `BLOCKED` and stop.

## 2. Disposable installation and backup gate

On a clean/disposable Windows machine:

1. Verify the release ZIP/MSIX SHA-256, read `BETA_LICENSE.txt` and
   `KNOWN_LIMITATIONS.md`, and install only the identified candidate.
2. Run the package's prerequisite check and start it from PowerShell. Confirm the
   web interface is loopback-only and the private database is healthy.
3. Create a disposable company and complete setup. Do not connect WooCommerce or
   enter live records yet.
4. Choose a second volume or approved synced folder. Run the packaged Backup
   operation and retain the archive checksum outside the installation volume.
5. Run Restore into an isolated disposable installation or use the repository
   verifier for a database-only drill:

   ```powershell
   $env:BACKUP_RESTORE_SOURCE_DATABASE_URL = '<source URL>'
   $env:BACKUP_RESTORE_TARGET_DATABASE_URL = '.../clearledger_restore_verify_<run>'
   corepack pnpm db:backup:verify
   ```

   The target must use the `clearledger_restore_verify_*` name. Confirm migration
   history, login, organization visibility, report totals, and document checksums.
   If restore fails, preserve the failure evidence and stop; do not connect the
   store.

## 3. Connect and import in review mode

1. Create the installation ticket with company, store, environment, bounded first
   sync window, API version, requested permission, callback/retention decisions,
   mapping owner, tax owner, and rollback owner.
2. Enter the credential through the encrypted connector store. Confirm the UI and
   logs do not reveal it. Keep authority policy `MANUAL_REVIEW`.
3. Poll a narrow catalog window. Inspect product and variation identifiers, SKU,
   GTIN/part number when present, name, description, image metadata, stock policy,
   and redacted provider evidence. Record elapsed time and item counts only.
4. Approve matches one at a time. Create local inventory items with explicit
   account mapping and the default location. Ingest only approved images.
5. Poll a bounded order window. Review tax, fee, payment, refund, and settlement
   evidence without creating accounting entries. Revoke the read-only key if the
   connection test is complete and the owner requires a pause.

Rollback: disable the connector, revoke the key, preserve the redacted evidence,
and leave all staged observations in review. Do not delete or rewrite source
evidence to make a count agree.

## 4. Tax and opening-balance reconciliation

1. Record Canadian GST/HST and provincial registration numbers, effective dates,
   remitter responsibility, and approved tax codes. Map every observed WooCommerce
   rate through import rules. PennyWise makes no QST or Revenu Québec completeness
   claim; unresolved Quebec treatment remains blocking.
2. Compare one staged sample order's store-calculated tax to PennyWise to the cent.
   Resolve currency, rounding, shipping-tax, discount, and remittance differences
   before posting.
3. In the Switching Centre, migrate in this order: chart of accounts, contacts,
   products, opening balances, open AR, open AP, and opening inventory quantities.
   Preview and dry-run each file before commit; use source identifiers and exact
   minor units.
4. Reconcile and retain sanitized totals for trial balance, AR, AP, and inventory
   control against the previous system. Any difference is a stop, not an
   adjustment made solely to force agreement.

Rollback: do not commit the next import batch. For an atomic batch failure, use
the documented batch rollback and retain the failed batch evidence. Never use a
production database reset as rollback.

## 5. One complete order trace

Use one owner-approved test order or a disposable store order. Record only
sanitized IDs and minor-unit totals:

1. Receive it into the commerce inbox and retain the provider revision.
2. Review the customer, lines, SKU mapping, address, taxes, discounts, and exact
   provider totals. Convert explicitly to one DRAFT invoice.
3. Compare the draft to the provider order and post deliberately. Verify the
   balanced revenue/tax/AR journal and inventory/COGS movement.
4. Generate the bin-ordered picking slip. Pick and pack; a short pick creates a
   review item and does not silently change stock.
5. Quote a carrier service. Show carrier, service, and quoted cost; purchase only
   after explicit confirmation on the operator-owned carrier account.
6. Retrieve the carrier PDF or ZPL label, print through the browser, record
   tracking, and record the carrier's void answer if tested. Verify the linked
   shipping expense, sale, inventory movement, and final control totals.

Rollback: before posting, reject the review or leave the draft. After posting,
use the existing reversal/credit/refund workflow; never edit the posted invoice,
journal, inventory movement, or shipment history in place.

## 6. Required drills

Record each result in the evidence ledger:

- backup and restore: packaged operation plus the guarded repository verifier;
- restart: stop/start and confirm identity, company, documents, and pending state;
- upgrade: install a higher verified package over the disposable install and confirm
  identity, data, backup settings, migrations, and recovery point;
- uninstall: choose the documented data-preserving option, confirm data remains,
  and do not use `-DeleteData` until a separate verified archive exists;
- refund: use a provider/test-mode refund and verify review evidence and exact
  accounting treatment without real payment credentials;
- short pick: confirm a count-review record and unchanged stock until approval;
- cancellation after posting: confirm a later order revision is review-required
  and does not mutate the posted invoice automatically;
- run `Test-PennyWiseMsixLifecycle.ps1` or
  `Test-PublicBetaPackageLifecycle.ps1` only with explicit verified artifacts and
  on the clean machine. Their script output is not a substitute for first-launch,
  physical, human, or Store evidence.

For every failure, set the corresponding status to `FAIL`, preserve the failure
description, and stop the sequence. Do not continue to cutover.

## 7. Human acceptance

A non-developer follows `docs/USER_ACCEPTANCE_SCRIPTS.md` unaided in the disposable
company. The same person repeats the relevant journeys keyboard-only, with a
screen reader, at 200% zoom, high contrast, and reduced motion. Record browser,
Windows version, role, date, task result, and sanitized issue references. A
developer running the scripts is not this evidence.

## 8. Cutover point and rollback

The point of no return is owner approval after all of these exist: verified backup
and restore, reconciled trial balance/AR/AP/inventory totals, resolved store SKU and
stock discrepancy, approved tax mapping, successful disposable end-to-end trace,
revocable read-only key plan, and completed human acceptance. Before that point,
disconnect/revoke and discard only disposable data. After that point, freeze store
changes, take and verify the final backup, enable only the approved connector mode,
and retain the cutover evidence.

If cutover fails: disable/revoke the connector, stop new imports, preserve the
last verified backup and evidence, and return operations to the previous system.
Restore only into an isolated target first; obtain owner/controller approval before
any production restore. Do not delete the previous system or claim a successful
cutover from a partial import.

## Weekly operating routine

Review connector health and failed/replayed events; inspect catalog/SKU and stock
conflicts; review unmapped taxes and customs gaps; reconcile orders, refunds, fees,
AR, AP, inventory control, shipping expenses, and trial balance; verify backup age,
checksum, destination availability, and restore ownership; review audit/review
queues; and record any credential expiry or revocation action. Keep unresolved
items in `MANUAL_REVIEW`.
