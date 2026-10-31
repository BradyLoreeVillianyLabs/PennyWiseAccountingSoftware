# PennyWise Accounting beta source target

This repository is the source of truth for the PennyWise Accounting beta.

- Source root: this folder (`ClearLedger-Codex-Ready`). The legacy package and database
  namespace remain deliberately unchanged during beta stabilization.
- Stable Windows entry point: `..\PennyWise-Accounting-Beta` is a junction to this folder
  when the beta access bootstrap has been installed.
- Development test database: the loopback PostgreSQL instance on port `55432` only.
- Remote beta shares: `infrastructure/beta/pennywise-controlled-shares.json` is the
  non-secret source of truth. Its passwords and connector encryption key are stored under
  the signed-in Windows user's `%LOCALAPPDATA%\PennyWiseAccounting\beta` directory,
  protected with Windows EFS when available and otherwise a user-only NTFS ACL.

Do not run build, test, installer, or tunnel commands from
`C:\Users\ancho\ClearLedger-release-stale`: it is not a workspace and has no package
manifest. The Windows installer is a later acceptance artifact, not the beta test target.

The controlled beta task deliberately manages only the `pennywise*` LocalXpose domains and
local ports `3100` through `3401`. It never starts, stops, or routes QBWooBridge.
