=== PennyWise Accounting Launch Site ===
Contributors: typewritingmonkeys
Tags: clearledger, accounting, public-beta, download
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.4.2
License: Proprietary beta distribution package

A privacy-conscious PennyWise Accounting launch site with guarded downloads, separate private bug/security intake, and moderated feedback.

== Description ==

This private-upload plugin renders the PennyWise Accounting beta website through landing, support, and community shortcodes.

It includes:

* a polished responsive product page;
* careful, non-automatic migration guidance;
* accurate CAD/USD, accounting, project, inventory, tax, import, and commerce boundaries;
* an honest illustrative product preview, replaceable with sanitized release screenshots;
* a fail-closed download button that requires a same-site HTTPS archive, its sibling `.sha256` file, and a valid SHA-256;
* an optional, owner-configured hosted Stripe Checkout founder CTA that accepts only `buy.stripe.com` or `checkout.stripe.com` HTTPS URLs and never collects payment credentials in WordPress;
* checksum-copy and verification instructions;
* beta safety, known limitations, privacy, and non-sensitive bug-reporting guidance;
* a dedicated `[clearledger_support]` page with separate administrator-only, non-REST product-bug and suspected-security inboxes;
* a `[clearledger_community]` board where every submission is pending until an administrator publishes it and optional contact information never appears publicly;
* no analytics, advertising, cookies, remote fonts, remote scripts, or paid dependencies.

This plugin presents and links to PennyWise Accounting. It does not run the PennyWise Node.js/PostgreSQL application inside WordPress.

== Installation ==

1. In WordPress, open Plugins > Add New Plugin > Upload Plugin.
2. Select `PennyWise-Accounting-Site-1.4.2.zip`, choose Install Now, and activate it.
3. Open Settings > PennyWise Launch. Internal option and shortcode names remain unchanged for upgrade compatibility.
4. Activation creates **draft** landing, support, and community pages. Existing pages are never overwritten. Review all three drafts before publishing.
5. Test the separate product-bug and suspected-security forms with fictional data. Review them under Tools > PennyWise bugs and Tools > PennyWise security.
6. Review community submissions under Tools > PennyWise feedback. Nothing appears on the public board until an administrator publishes it; private-contact fields are never rendered publicly.
7. Preview desktop and mobile layouts before publishing.
8. When the tested Windows package is ready, upload the versioned x64 MSIX and its exact sibling `.msix.sha256` file to this site or a same-domain HTTPS publisher, save both links and hash, and verify the downloaded bytes from a separate browser session.
9. To enable hosted founder checkout, paste only the final Stripe-hosted Checkout URL into **Founder checkout URL**. Leave it blank to preserve the manual private-support fulfilment flow. Optionally add an HTTPS founder-terms URL; never enter Stripe keys, payment details, customer records, or other secrets.

== Safe configuration ==

Only public display values belong in the plugin settings. Never paste credentials, API tokens, tester details, customer information, provider secrets, tax identifiers, invoices, or other accounting data.

The download button remains disabled unless:

* the archive and checksum URLs are absolute HTTPS on this site or a subdomain;
* their filenames are the exact `PennyWise-Accounting-<version>-x64.msix` and `.msix.sha256` pair; and
* the checksum is exactly 64 hexadecimal characters.

When both files are selected from WordPress Media, the plugin also hashes the stored MSIX and refuses to publish a mismatched checksum. Public forms accept bounded plain text only, reject oversized requests and file submissions, use WordPress nonces, a honeypot, and a hashed transient rate limit, and accept no attachments. Do not treat those controls as a substitute for an upstream web-application firewall on a high-traffic public site.

Suspected-security reports are stored separately, are visible only to WordPress administrators, have no public query or REST route, and are excluded from ordinary WordPress exports. This storage is not end-to-end encrypted. Reporters must use only fictional or data they own and must never submit live credentials, customer records, financial documents, or malware.

Screenshot URLs must be HTTPS. Use demo-only images with no personal, financial, or credential data.

The optional founder checkout CTA is rendered only when its configured URL is HTTPS, credential-free, has a non-empty path, and uses exactly `buy.stripe.com` or `checkout.stripe.com`. Checkout opens on Stripe; the site owner remains responsible for manual founder eligibility confirmation and fulfilment through private support.

== Frequently Asked Questions ==

= Can WordPress run PennyWise Accounting? =

No. This plugin is the marketing and download surface. The public-beta archive runs the application separately on a supported computer with its own Node.js/PostgreSQL runtime.

= What information do the forms store? =

The support page stores product bugs and suspected-security reports in separate administrator-only record types. The community form stores a pending moderation record; only an administrator-approved title, display name, category, and message become public. Private contact information is never rendered publicly. The plugin adds no analytics, advertising, tracking calls, or file uploads.

= Why is the download button disabled? =

The paired same-site HTTPS archive URL, `.sha256` URL, and published archive hash are required. This prevents an unfinished or unverifiable release link from being shown as ready.

= Can I publish this to the WordPress.org plugin directory? =

This package was prepared for private upload to the project owner's WordPress site. It has not been prepared or licensed for WordPress.org directory submission.

== Changelog ==

= 1.4.2 =
* Make WooCommerce and Etsy evidence boundaries provider-specific: WooCommerce Core is not presented as a universal payout or processor-fee source, and no commerce record posts automatically.
* Add package-validation checks that require the uploaded ZIP to match the reviewed source and retain the public-status boundary text.

= 1.4.1 =
* Add a clear public-beta status for live bank feeds, statutory payroll, direct deposit, filing, remittance, and jurisdictional payroll: they are not released capabilities.
* Clarify that commerce catalog images and local-item creation are reviewer-controlled, and that marketplace tax-remittance responsibility is not inferred automatically.
* Make the searchable capability guide explicitly cover inventory thumbnails and regulated-service limits.

= 1.4.0 =
* Rebrand the public product surface to PennyWise Accounting while retaining internal upgrade-compatible identifiers.
* Present a no-card 30-day trial followed by the first 1,000 completed Founder purchases at C$99 one time; a trial does not reserve Founder availability.
* Clarify that Stripe-hosted checkout confirms payment and that tax remittance, statutory payroll, live bank feeds, and autonomous commerce posting remain outside the beta boundary.

= 1.2.0 =
* Add a searchable, long-form capability index covering invoices, payables, migration, inventory, tax, currency, commerce review, POS, CRM, calendar, workbench navigation, auditability, and beta boundaries.
* Add the original experimental founder-offer presentation; version 1.4.0 supersedes its count and terms with the first 1,000 completed Stripe purchases and released PennyWise Accounting updates.
* Align the code-native product preview with the current ClearLedger navigation and keep the interface claims review-first.

= 1.3.0 =
* Add an optional owner-configured hosted Stripe Checkout CTA for the founder offer, restricted to the approved Stripe Checkout domains.
* Add an optional HTTPS founder-terms link and retain manual fulfilment, private-support, and no-credentials boundaries.

= 1.1.1 =
* Add native suspected-security intake with a separate administrator-only, non-queryable, non-REST, non-exportable inbox.
* Require bounded plain text, a private follow-up contact, a safe-data acknowledgement, nonce, honeypot, request/file rejection, and a stricter rate limit.
* Remove the external security-intake dependency while keeping vulnerability reports separate from product bugs and community feedback.

= 1.1.0 =
* Add fail-closed Media Library selection and byte-for-byte ZIP/checksum validation.
* Add private, administrator-only product-bug intake without attachments.
* Add a moderated community board with pending-by-default submissions and private contact separation.
* Create landing, support, and community drafts without overwriting existing pages.

= 1.0.2 =
* Suppress the active block theme's outer header and footer only on ClearLedger shortcode pages, preventing placeholder theme content from appearing beside the beta site.

= 1.0.1 =
* Keep landing and support shortcodes full-width inside constrained WordPress block themes.
* Prevent the viewport-wide presentation from creating a horizontal page scrollbar.

= 1.0.0 =

* Initial private-upload package.
