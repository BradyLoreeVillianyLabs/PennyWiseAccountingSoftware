# PennyWise Accounting website readiness

Status updated on 2026-08-10 (America/Edmonton).

## Public-site status

- The public root at `https://typewritingmonkeys.com/` was checked in a fresh browser session. It currently renders the WordPress.com **“A bright idea, coming soon”** page, not the PennyWise Accounting landing page.
- No authenticated WordPress administrator session, upload, activation, checkout configuration, or page publication was performed during this update.
- Therefore the public site is **not launched** and must not be described as having a live PennyWise download, Stripe checkout, or founder offer.

## Validated upload artifact

The local, uploadable release candidate is:

- `dist/PennyWise-Accounting-Site-1.4.2.zip`
- SHA-256: `5fe8ccedadb07dadf5e4a70741989ed8e305ed72e860a82ef67fd05657f0bd86`

It was rebuilt from the reviewed source and passed:

- static package, security, PHP, and JavaScript validation;
- explicit public-status checks for live-bank-feed, payroll, direct-deposit, filing/remittance, marketplace-tax, and commerce-posting boundaries;
- source-to-ZIP SHA-256 parity for every packaged file;
- WordPress stub smoke; and
- a disposable activation/render/uninstall drill on WordPress `7.0.3` and MariaDB `11.4`.

The package deliberately fails closed until a same-site HTTPS Windows archive, its exact sibling checksum file, and matching SHA-256 are configured. Its Stripe call to action accepts only an owner-configured Stripe-hosted Checkout URL; it does not receive card data or store Stripe credentials.

## Public wording now enforced

The landing page accurately presents PennyWise as review-first bookkeeping with manual bank-statement import/reconciliation and WooCommerce/Etsy evidence import. It explicitly states that:

- live bank feeds and a released statutory payroll service are not available;
- direct deposit, CRA filing/remittance, ROE/T4 submission, and unsupported jurisdictional payroll are unavailable;
- Etsy marketplace-tax responsibility is not inferred automatically; and
- commerce evidence does not automatically post to the ledger.

The product cards also describe reviewer-controlled local catalog creation and approved inventory thumbnails without representing WooCommerce Core as a universal payout or processor-fee source.

## Required owner actions before launch

1. Back up the WordPress site and upload **only** `PennyWise-Accounting-Site-1.4.2.zip`.
2. Activate it, review the three draft shortcode pages, and retain the existing site until the previews are approved.
3. Configure a final versioned x64 installer, exact sibling checksum, installation/limitations/privacy links, screenshot(s), final founder terms, and an owner-created Stripe-hosted Checkout URL if checkout is to be enabled.
4. Test the configured download from a separate browser, verify its SHA-256, exercise the fictional-data-only bug/security/community forms, and review desktop/mobile keyboard flows.
5. Publish the pages, then use the WordPress.com launch control only after the download, checkout, and legal/operational review are complete.

## Historical evidence

Earlier notes in this repository described a WordPress.com check from 2026-08-03 and older plugin versions. They are retained in source history only and are not current deployment evidence. The current public status is the unlaunched page above; the current local artifact is 1.4.2.
ver
