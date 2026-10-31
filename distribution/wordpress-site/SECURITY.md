# Website Package Security Notes

## Implemented controls

- The plugin has no account system, analytics, advertising, telemetry, remote scripts, or file-upload form.
- No remote JavaScript, CSS, font, image, or paid dependency is embedded by default.
- Administrative configuration requires WordPress `manage_options` capability and the Settings API nonce.
- Activation creates landing, support, and community drafts, never unreviewed public pages, and never overwrites existing page content.
- Product bugs and suspected-security reports use separate administrator-only, non-queryable, non-REST post types and are excluded from ordinary WordPress exports. Community submissions are pending by default; only published entries are rendered, and private-contact metadata is never rendered publicly.
- All three forms require a WordPress nonce, include a honeypot, use a salted hash of the request address for a short-lived rate limit, accept bounded plain text, reject oversized requests and file submissions, and accept no attachments by design. Security intake has a stricter limit and requires a private contact and safe-data acknowledgement.
- Public release and document links must use HTTPS on this site or a subdomain; URL credentials are rejected.
- The download is fail closed: it is enabled only when the versioned ZIP URL, exact sibling `.zip.sha256` URL, and a 64-character hexadecimal SHA-256 are present. Media-selected pairs are also checked against the stored ZIP bytes before saving.
- JavaScript reads only the displayed checksum and copies it after an explicit visitor action.
- Uninstall removes plugin settings but intentionally preserves bug, security, and community records for administrator review and retention decisions.

## Administrator responsibilities

- Do not store credentials, tester identities, accounting data, access tokens, provider secrets, or private screenshot content in plugin settings.
- Keep WordPress core, the active theme, and plugins current; use unique administrator credentials and multifactor authentication where available.
- Configure HTTPS and verify the domain before publishing.
- Use a trusted, versioned HTTPS host for the app archive. Do not expose the local ClearLedger API as a download host.
- Rebuild and republish the checksum after every byte-level archive change.
- Review private product/security reports and pending community feedback regularly. Remove unnecessary personal or accounting data, reject unsafe public submissions, and apply an explicit retention policy appropriate for the site.
- Test the native suspected-security form with fictional data before publishing `/clearledger-support/`. Treat the administrator-only WordPress inbox as private but not end-to-end encrypted. Never route suspected vulnerabilities to public issues, comments, forums, or an invented address.
- Preview the page after changing themes; a WordPress theme can alter surrounding navigation, typography, and privacy behavior outside this plugin's scope.

## Incident response

If the public archive URL, checksum file, hash, WordPress administrator account, download host, or site integrity is in doubt, clear the release files in **Settings > ClearLedger Beta** immediately. This disables both public download buttons while leaving the explanatory page available. Publish a new versioned archive and checksum only after investigating and validating the replacement.
