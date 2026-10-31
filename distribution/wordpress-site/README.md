# ClearLedger WordPress Public-Beta Site Package

This directory contains an isolated WordPress plugin for the ClearLedger public-beta marketing and download page at `typewritingmonkeys.com`. It does not modify or embed the ClearLedger application and it cannot run the Node.js/PostgreSQL service inside WordPress.

## Contents

- `clearledger-public-beta-site/`: uploadable plugin source;
- `design-reference/`: generated visual design references used for implementation review; these are not packaged into the plugin;
- `tools/validate-wordpress-package.ps1`: static, security, PHP, JavaScript, and ZIP checks;
- `build-wordpress-package.ps1`: reproducible package builder;
- `dist/`: generated ZIP, checksum, and validation evidence.
- `LIVE_SITE_READINESS.md`: verified WordPress.com deployment state and the remaining launch checklist.

## Build

From this directory in PowerShell:

```powershell
.\build-wordpress-package.ps1
```

The builder validates the source, lints PHP in a pinned read-only PHP container, creates the versioned ZIP named from the plugin header (currently `dist/PennyWise-Accounting-Site-1.4.2.zip`), validates the archive, and writes `dist/SHA256SUMS.txt` plus `dist/VALIDATION.txt`. Docker must be running for the pinned PHP lint.

For a disposable real-WordPress activation/render/uninstall drill after building:

```powershell
.\tools\wordpress-container-smoke.ps1
```

The drill uses isolated, uniquely named Docker resources, cleans them in `finally`, and writes `dist/WORDPRESS_RUNTIME_SMOKE.txt`. It does not start a public web server or control a browser.

## WordPress installation

1. Back up the WordPress site.
2. Open **Plugins > Add New Plugin > Upload Plugin**.
3. Upload the current versioned ZIP from `dist/`, install, and activate it.
4. Open **Settings > ClearLedger Beta**.
5. Activation creates draft landing, support, and community pages without replacing existing content. Review the `[clearledger_beta]`, `[clearledger_support]`, and `[clearledger_community]` pages and select the active theme's full-width or no-sidebar template where needed.
6. Test the native product-bug and suspected-security forms using fictional data. They stay in separate administrator-only **Tools > ClearLedger bugs** and **Tools > ClearLedger security** screens, have no public query/REST route, and never appear on the community board.
7. Moderate community submissions under **Tools > ClearLedger feedback**. New entries are pending; publish only content safe for a public page. Optional contact details remain private metadata.
8. Preview desktop and mobile layouts, keyboard navigation, focus visibility, external links, form success/error states, moderation, and the checksum copy action.
9. Publish the release links only after the final app ZIP and sibling `.zip.sha256` pass release gates and a separate download verifies against the displayed SHA-256.

WordPress.com paid-plan capabilities and limits can change. Confirm the current official plugin-upload instructions before installation: <https://wordpress.com/support/plugins/install-a-plugin/>.

## Release-hosting boundary

The plugin accepts the final app archive from WordPress Media or a same-domain HTTPS publisher. The live site currently reports a 2 GB single-file upload limit and a 6 GB Personal-plan storage allowance, but current usage, archive size, and WordPress file-type handling must still be checked at release time. The download host must:

- provide HTTPS;
- remain on `typewritingmonkeys.com` or one of its subdomains;
- preserve the file byte-for-byte so its SHA-256 remains stable;
- not require embedding credentials in the public URL;
- support the final archive size and expected tester volume;
- allow replacing a release with a new versioned URL instead of mutating an existing file silently.

Keep ClearLedger bound to localhost by default. A remote test must use the documented controlled-share method; the website must never link directly to a development API or unauthenticated tunnel.

## Content and claim boundary

The landing page deliberately avoids customer counts, testimonials, certifications, filing guarantees, autonomous-accounting claims, live-provider claims, and unsupported currencies. It describes WooCommerce/Etsy as a guarded evidence and review workflow, not silent accounting automation. The website states the beta limitations in plain language and makes the download fail closed until the versioned ZIP, checksum file, and hash agree.

Before every public update, compare the page to the app release manifest and remove or revise any feature whose evidence is not included in that release.
