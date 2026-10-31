# Public beta download publisher

This publisher is for the ClearLedger owner, not beta testers. After the final release
builder has produced and verified the archive, run:

```powershell
node .\scripts\serve-public-beta-download.mjs
```

It binds to `127.0.0.1:8787`, recomputes and verifies the archive SHA-256 before
listening, serves only the exact versioned ZIP and checksum, supports resumable GET/HEAD
downloads, limits concurrent transfers, and exposes a non-sensitive `/health` result.
It does not serve a directory, source tree, backup, database, or credentials.

Point an authenticated Loclx Pro HTTPS tunnel or another managed HTTPS reverse proxy at
this loopback listener, then configure the WordPress ClearLedger site package with the
resulting exact `/downloads/ClearLedger-Public-Beta-<version>.zip` and `.sha256` URLs.
Keep the origin loopback-only and apply the tunnel provider's access, bandwidth, abuse,
and monitoring controls. Do not reuse the accounting application/API tunnel as a public
download origin.

Optional environment values are `CLEARLEDGER_DOWNLOAD_HOST` (keep loopback unless a
reviewed proxy design requires otherwise), `CLEARLEDGER_DOWNLOAD_PORT`, and
`CLEARLEDGER_DOWNLOAD_CONCURRENCY` (1 through 100).
