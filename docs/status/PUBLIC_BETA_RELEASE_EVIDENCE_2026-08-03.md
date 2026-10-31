# Public beta release-evidence status

Date: 2026-08-03 (America/Edmonton)

Status: CANDIDATE ENGINEERING EVIDENCE RECORDED; FINAL ARTIFACT AND RELEASE DRILLS OPEN

The distributable evidence packet is maintained in
`distribution/public-beta/RELEASE_EVIDENCE.md`, with operator-facing constraints in
`distribution/public-beta/KNOWN_LIMITATIONS.md`.

Confirmed on the isolated release database:

- PostgreSQL 17.10;
- clean deployment of all 72 repository migrations;
- 29 integration files and 184 tests through the repository integration harness; and
- 17 of 17 focused new-boundary tests.

The source-reduced image build and source-artifact inspection passed. An isolated
loopback compose smoke also passed migration, web, API health/OpenAPI, unauthenticated
access rejection, no host-published API port, non-root users, and read-only root
filesystems. This evidence is an engineering result, not security, accounting, tax,
legal, accessibility, provider, or platform certification.

The exact ZIP SHA-256, SBOM SHA-256, runtime image ID/digest, image-tar hash, and UTC
creation time are intentionally not recorded here because they exist only after final
assembly. The builder writes them to the generated release manifest/checksum artifacts.
A build with `verificationSkipped: true` is not publishable.

Open release work is the final post-merge browser/release gate, current-image
restart/backup/restore/update/uninstall drills, production-dependency audit, and human
keyboard/screen-reader/zoom/contrast/reduced-motion UAT. No professional or provider
approval is represented.
