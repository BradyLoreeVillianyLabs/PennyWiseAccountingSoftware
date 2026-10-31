# Phases 17–18 Foundation Report

Date: 2026-07-25

## Delivered

- Tenant-scoped estimate drafts with fail-closed lifecycle transitions.
- Versioned estimate acceptance and idempotent conversion into one linked draft
  invoice. Conversion copies commercial and tax evidence and creates no journal.
- Secure customer-facing estimate links with opaque tokens, expiry/revocation,
  HTML previews, and customer accept/decline actions. Responses remain
  non-posting until an authorized user converts the accepted estimate.
- Recurring schedule persistence with timezone, interval, pause, resume, and end
  controls.
- Customer-linked projects with optimistic versioning and status controls.
- Time entries with rate snapshots, exact amount calculation, approval, and
  non-posting behavior.
- Mileage drafts and human-review capture/OCR records with duplicate checks,
  confidence evidence, and review versioning.

## Evidence

- `src/phase17-sales-automation.integration.test.ts`: passing end-to-end
  estimate acceptance, conversion, replay, and zero-journal assertions.
- `src/phase18-projects.integration.test.ts`: passing project, time, mileage,
  capture, and zero-journal assertions.
- Formatting, lint, typecheck, build, API tests, and Prisma validation pass.

## Remaining work before phase acceptance

Estimate PDF/email delivery, deposits/retainers/progress billing,
collections and statements, invoice conversion UI, project profitability/WIP,
time-to-invoice conversion, OCR storage/scanning adapters, offline PWA behavior,
and full mobile/accessibility evidence remain open.
