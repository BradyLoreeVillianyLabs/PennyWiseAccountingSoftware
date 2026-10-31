# Receipt and supplier-invoice capture

ClearLedger's capture workflow keeps the original receipt or supplier invoice in the existing organization-scoped document store, runs a deterministic local extraction pass, and sends the result to the existing evidence inbox. It does not create a second document subsystem or a direct-to-ledger posting path.

## Processing contract

The persisted `CaptureReview` status remains the review and authorization boundary used by the application:

| Local extraction state            | Meaning                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CAPTURED`                        | Original retained; no extraction metadata is present (for older or manually-created captures).                            |
| `PROCESSING`                      | Reserved for an asynchronous worker implementation; the current bounded path completes processing in the upload request.  |
| `NEEDS_REVIEW`                    | One or more values, quality checks, source layers, or accounting validations need a human decision.                       |
| `VALIDATED`                       | The local text-layer fields and arithmetic checks are internally consistent. This is not approval or posting eligibility. |
| `FAILED`, `REJECTED`, `DUPLICATE` | Explicit failure or disposition values recorded in extraction evidence when the relevant workflow reaches them.           |

`POSTED` is intentionally not inferred by extraction. Conversion creates exactly one editable, non-posting bill or immediate-expense draft through `PurchaseService`; later approval and posting remain governed by the existing accounting services.

## Supported local formats

- `text/plain`: deterministic label extraction.
- `application/pdf`: embedded PDF text extraction is attempted first. The original PDF is always retained. Image-only PDFs are sent to review with `PDF_TEXT_LAYER_MISSING`.
- `image/png`, `image/jpeg`, and `image/webp`: signature and bounded-dimension checks are applied. The current beta records the original and explicit quality/OCR review reasons. A raster OCR model is not bundled in this build, so images never appear validated from an absent OCR engine.

The first field set is deliberately summary-level: document type, supplier, supplier tax/registration identifier, invoice number, invoice and due dates, CAD/USD currency, subtotal, discount, shipping, tip, GST/HST, PST, QST, tax total, total, and supported paid/unpaid evidence. Each candidate includes its normalized value, confidence, extraction method, evidence text, and an empty source-region list when the source format has no coordinate layer.

## Safety and privacy

- Uploads continue to use existing signature validation, file-size limits, malware scanner, organization-scoped storage keys, checksum uniqueness, and authorization checks.
- Extraction is pure local code with `networkAccess: NONE`; it has no cloud OCR, AI, analytics, telemetry, mutable model download, or runtime credential.
- Money parsing uses integer minor units and deterministic half-up handling; arithmetic mismatches, ambiguous dates, missing currency, missing totals, and unreadable values become review reasons.
- Supplier resolution, account categorization, tax treatment, period locks, journal balancing, and posting are not guessed from text. Reviewers must use the existing purchase draft controls.
- `POST /v1/capture-reviews/:captureReviewId/process` reprocesses retained bytes with an optimistic version check and an audit event. Repeated conversion remains protected by the existing capture conversion uniqueness and idempotency boundary.

## Manual verification

1. Start the local API and web application with the repository's normal development command.
2. Open Purchases -> Evidence inbox and upload a synthetic text invoice containing `Currency: CAD`, `Subtotal`, `GST/HST`, and `Total`.
3. Open **Preview source**. Confirm the local processing state, candidate fields, confidence, and review reasons appear beside the original source.
4. Correct any fields in the existing draft form, approve the evidence, and explicitly create one bill or immediate-expense draft. Confirm the UI says the draft is not posted.
5. Upload a synthetic PNG or an image-only PDF. Confirm it remains `NEEDS_REVIEW` with an explicit local OCR/text-layer reason and cannot be converted until a reviewer confirms the draft fields.

## Current limitation and extension point

This build does not claim raster OCR accuracy. A future local OCR adapter can implement the same extraction result contract (`text`, `regions`, field confidence, quality checks, engine/version, and review reasons) after a reproducible fixture benchmark, pinned model checksum, license review, CPU/memory measurement, and packaging review. Until then, the fail-closed text-layer path is the only path that can report `VALIDATED`.

## CPU smoke measurement

On the local Node runtime used for this build, 1,000 synthetic 12.4 KB text-layer documents completed in 187.208 ms (0.18721 ms/document). The sampled process heap peaked at 6,832,312 bytes. The compiled extractor is 15,598 bytes and adds no runtime dependency or model artifact. These figures describe deterministic text parsing only; they are not raster-OCR accuracy or production capacity claims.
