# Local receipt and supplier-invoice capture

Status: implemented vertical slice 2026-08-07

## Handoff objective

Extend ClearLedger's existing CaptureReview, document storage, evidence review, and PurchaseService conversion workflow into a privacy-first local receipt and supplier-invoice intake path. Preserve organization isolation, immutable source checksums, explicit human review, exact money handling, and the existing draft/posting controls. Do not introduce a parallel document or ledger subsystem, cloud OCR, LLM, telemetry, or runtime model downloads.

## Delivered

- Secure upload now validates the existing signature and scan gates, then enforces image dimension/pixel and PDF page limits before storage.
- `LocalCaptureExtractionService` extracts a bounded field set from plain text and embedded PDF text using deterministic regex and BigInt minor-unit arithmetic. Raster images remain explicitly `NEEDS_REVIEW` because this beta does not bundle a raster OCR model.
- Extraction evidence records engine/version, `networkAccess: NONE`, field confidence/method/evidence, validation issues, quality checks, and a fail-closed `autoPostEligible: false` marker inside the immutable capture evidence JSON.
- `POST /v1/capture-reviews/:captureReviewId/process` reprocesses retained bytes with optimistic versioning and returns the existing result on a safe retry. Processing is audited and remains tenant-scoped.
- The Evidence inbox and source-to-draft dialog show processing state, candidate fields, confidence, warnings, and local reprocessing alongside the original source. Draft conversion remains explicit, idempotent, and non-posting.
- Conversion evidence now carries extraction provenance into the linked purchase result.

## Explicit limitation

No raster OCR engine or model is claimed in this release. Adding one requires a reproducible synthetic-fixture benchmark, pinned model checksum and license notice, CPU/memory/size measurements, and a packaging review. Until that work is completed, an image or image-only PDF cannot reach `VALIDATED` and cannot silently influence posted books.

## Verification evidence

- API unit suite: 32 files, 168 tests passed.
- Local extraction focused suite: 5 tests passed.
- Capture/project integration: 2 tests passed, including upload, local processing, retry, duplicate checksum, and tenant-safe content.
- Capture conversion integration: 3 tests passed, including extraction provenance and idempotent draft conversion.
- Formatting, lint, repository typecheck, database schema validation, build, release verifier, and Chrome release-candidate browser smoke all passed.
- CPU smoke (synthetic text parser): 1,000 12.4 KB documents in 187.208 ms (0.18721 ms/document), sampled heap peak 6,832,312 bytes, compiled extractor 15,598 bytes, and no model/runtime dependency added.
