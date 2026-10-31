# ClearLedger Public Beta Distribution

This folder is the assembly source for the downloadable public beta. The release
builder produces a source-reduced runtime archive; this folder itself is not the
downloadable product and must not be published as a substitute for a verified archive.

The final archive must contain:

- a pinned ClearLedger runtime image or equivalent compiled runtime;
- a localhost-only application configuration and persistent PostgreSQL data volume;
- guided Windows start, stop, secret-preserving update, backup, restore, export, and
  uninstall commands;
- an optional, fixed-company, Basic-Authentication-protected Loclx beta-share launcher
  that leaves the owner's local web session intact;
- the beta licence, privacy summary, security contact, release evidence, known
  limitations, version manifest, third-party notices, SBOM, and SHA-256 checksums;
- no TypeScript source, tests, source maps, repository history, development fixtures,
  provider credentials, customer data, or operational QBWooBridge material.

Each installation generates its own constrained database-login, webhook, connector,
and payment signing/encryption secrets. The packaged API connects through an
unprivileged `NOINHERIT` member of the migration-created runtime role, verifies that
boundary on startup, and refuses beta-runtime startup when application guards are
absent or weak. Update and restore preserve the exact values with the data they protect.

## Protection model

A web application cannot be made impossible to inspect: browser HTML, CSS, and
JavaScript are necessarily delivered to the tester, and a determined user can inspect
a local container. The release therefore uses layered, honest protection:

1. ship compiled/minified or otherwise source-reduced runtime artifacts;
2. retain copyright and licence restrictions on redistribution, resale, hosted use,
   reverse engineering, and derivative products to the extent permitted by law;
3. publish versioned SHA-256 metadata from the official HTTPS site so altered copies
   are distinguishable; add a cryptographic release signature only after the owner has
   established and protected a public signing identity;
4. exclude secrets and centralise any future commercial entitlement on a server the
   distributor controls;
5. preserve easy organization export so product protection never becomes data lock-in.

Do not add destructive DRM, hidden data access, remote deletion, or a dependency on an
always-available licence server to this free beta.

## Release boundary

The public beta is suitable for informed, supervised evaluation and may be used for
real bookkeeping only after the tester has reviewed `KNOWN_LIMITATIONS.md`, configured
backups, retained source records, and agreed with their accounting professional on the
workflows they will rely on. It is not a tax-filing, payroll-remittance, audit-opinion,
or professional-advice service.

Before publication, read `RELEASE_EVIDENCE.md`, complete every open final-archive drill,
and run the full program in
`docs/tasks/PUBLIC_BETA_COMPLETION_PROGRAM_2026-08-03.md` and record the resulting
archive and SBOM hashes. The release-owner legal/privacy review is recorded as passed in
`RELEASE_EVIDENCE.md`; that sign-off does not replace the remaining engineering,
provider, or hosted-operations gates.

Maintainers can run the isolated final-artifact lifecycle gate from the repository:

```powershell
.\distribution\public-beta\qa\Test-PublicBetaPackageLifecycle.ps1 `
  -PackageZip .\distribution\public-beta\output\ClearLedger-Public-Beta-<version>.zip
```

It requires Docker and an authenticated Loclx CLI, chooses a unique Compose project and
temporary subdomain, uses only caller-selected loopback ports, validates the sibling
ZIP checksum, and preserves unrelated containers and Loclx processes.

## Optional Windows MSI wrapper

After the verified ZIP and sibling `.sha256` exist, maintainers can create a per-user
Windows installer with `scripts\Build-ClearLedgerMsi.ps1`. The repository pins WiX in
`.config\dotnet-tools.json`; restore it explicitly with `dotnet tool restore`, then pass
the verified ZIP with `-PackageZip`. The MSI installs under Local AppData and adds Start,
Diagnose, Backup, and uninstall Start Menu shortcuts. It never installs Docker, packages
no generated secrets, and does not call Docker or delete Docker data during MSI removal.
See `distribution\public-beta\msi\README.md` for the exact commands and release caveats.
