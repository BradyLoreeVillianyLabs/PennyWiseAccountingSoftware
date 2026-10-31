# Real OCR for receipt and document capture

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

**Read `docs/tasks/IMPROVE_DOCUMENT_CAPTURE_AP_REVIEW_PROMPT.md` first.** It specifies the
capture-review workflow this codebase already built, and it deliberately treats
avoiding "opaque OCR-style capture" as a design goal — explainable, evidence-linked
suggestions the operator can see and correct, never a black box. That principle does not
change. What changes is the very first step of the pipeline: today, a photographed or
scanned receipt image produces no text at all.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/tasks/IMPROVE_DOCUMENT_CAPTURE_AP_REVIEW_PROMPT.md`
4. `apps/api/src/services/local-capture-extraction-service.ts` — the exact seam to extend
5. `apps/api/src/services/capture-review-conversion-service.ts` (if present) and its tests

## Exact intention

`local-capture-extraction-service.ts` extracts text from a PDF's existing text layer
(`extractPdfText`) via regex, and for any image it appends
`LOCAL_IMAGE_OCR_NOT_CONFIGURED` to the review reasons and returns no text at all
(`extractLocalText`). Every field-extraction, labeling, and confidence-scoring function
downstream (`extractFields`, `assignLabel`, `assignDate`, `confidenceFor`) already exists
and already works — on whatever text it's given. The single missing capability is turning
a photographed or scanned image into text in the first place.

Add real OCR as the missing input to that existing pipeline. Do not rebuild the
suggestion, confidence, labeling, or review logic — it already does its job once it has
real text to work with.

## Research already done — Azure AI Document Intelligence's prebuilt-receipt model

Confirmed directly against Microsoft's own documentation. This is purpose-built for
exactly this input — a photographed or scanned sales receipt — not a generic OCR API
adapted for the job.

- **Model ID:** `prebuilt-receipt`, called through the standard Document Intelligence
  REST API (`analyze` operation), authenticated with the resource's key + endpoint.
- **Free tier (F0)** is real and immediately usable for building and testing: up to two
  pages per document processed at no cost. Paid (S0) removes that limit.
- **Supported input:** JPEG, PNG, PDF, TIFF, BMP, HEIF — covers a phone photo directly.
- **Extracted fields**, each with a confidence score, map directly onto
  `CaptureExtractionField`'s existing shape: `MerchantName`, `MerchantPhoneNumber`,
  `MerchantAddress`, `TransactionDate`, `TransactionTime`, `Total`, `Subtotal`, `Tax`,
  `Tip`, and an `Items` array (name, quantity, unit price, line total per item). This is
  a closer field-for-field match to receipt intake than building a generic-OCR mapping
  layer would be.
- **Try it before writing any code:** Document Intelligence Studio
  (`documentintelligence.ai.azure.com/studio`) lets you upload a real receipt photo and
  see the exact JSON response shape interactively, against your own resource, before
  any adapter code exists.

Reference: [Receipt data extraction](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt),
[receipt model schema](https://github.com/Azure-Samples/document-intelligence-code-samples/blob/main/schema/2024-11-30-ga/receipt.md).

## Boundary conditions

- **This does not relax the review-first design.** OCR output feeds the same
  low-confidence review queue as today, with the same operator approval before anything
  becomes a posting decision. Better input text should raise confidence and reduce the
  review queue's size over time — it must never remove the human step.
- **Offer more than one OCR path, not a single locked-in vendor.** Azure Document
  Intelligence's `prebuilt-receipt` model (see Research above) gives the best accuracy on
  messy photographed receipts with no local compute cost, but sends document images to a
  third party — a real decision for a privacy-conscious customer to make deliberately,
  not one made for them. A local/on-device OCR engine avoids that entirely, at a real
  accuracy and latency cost on handwriting or poor photos. Build a pluggable interface
  (mirroring how `bank-feed-adapter-config.ts` and `payment-provider.ts` already select
  between adapters) and implement the Azure adapter first — it can be built and tested
  today against a real free-tier resource; leave the local-engine adapter as a second,
  clearly scoped follow-on behind the same interface.
- **An organization chooses, explicitly, per the existing consent pattern this codebase
  already uses for connectors and telemetry.** No document image leaves the
  organization's control to a cloud OCR vendor without that organization's owner having
  turned it on. Off by default; on by explicit choice, with the same plain-language
  consent framing `DESIGN_PARTNER_BETA_INSTRUMENT_2026-08-08.md` already uses elsewhere.
- **Never claim OCR where none ran.** If OCR is not configured or the organization has
  not enabled it, keep today's honest `LOCAL_IMAGE_OCR_NOT_CONFIGURED` behavior exactly
  as is — a manual-review flag, not a silent guess.
- Money and dates extracted from OCR text go through the exact same validation
  (`validateFields`, `parseMinor`, `normalizeDate`) as today — never trust an OCR result
  into a posting without it.

## Tasks

### 1. An OCR adapter interface

Define the interface both adapters implement: image/PDF bytes in, recognized text plus
per-region confidence out (reusing `CaptureTextRegion`'s existing shape rather than
inventing a parallel one where it fits).

### 2. Azure Document Intelligence adapter (first)

Implement it against the `prebuilt-receipt` model documented above, reading the
resource's key and endpoint from environment variables the same way the email and
connector services already read their credentials (see
`EMAIL_GMAIL_CLIENT_ID`-style naming in `email-connection-service.ts` for the pattern to
match). Include a safe development fixture mode so automated tests never call the live
endpoint. Redact recognized text the same way `redactSensitiveText` already does before
it touches logs or diagnostics.

### 3. Wire it into the existing pipeline

Replace `extractLocalText`'s current no-op-for-images behavior with a call to the
configured adapter (or none, if the organization hasn't enabled one), feeding its output
into the same `extractFields`/`assignLabel`/`confidenceFor` chain unchanged.

### 4. Organization-level consent and setting

Add the setting an owner uses to enable OCR and pick a provider, following the existing
consent-recording pattern rather than a new one-off toggle.

### 5. Tests

- Adapter tests against fixture images/responses (receipts at varying quality, a rotated
  photo, a low-light photo, a multi-page scan) proving recognized text reaches field
  extraction correctly.
- A test proving the pipeline behaves exactly as today (`LOCAL_IMAGE_OCR_NOT_CONFIGURED`)
  when no adapter is configured or the organization hasn't enabled one.
- A test proving OCR-derived amounts and dates still fail validation the same way
  hand-typed bad data would.
- Update `docs/COMPETITIVE_RESEARCH_MATRIX.md`'s document-capture entry with the OCR
  adapter's implementation contract and the local-engine follow-on noted as deferred.

## Constraints

- No change to the review-queue, approval, or posting logic in
  `IMPROVE_DOCUMENT_CAPTURE_AP_REVIEW_PROMPT.md`'s scope.
- No document image or its recognized text logged, stored in analytics, or retained by
  the OCR adapter beyond the request needed to process it.
- No live call to a real cloud OCR endpoint from any automated test.

## Acceptance criteria

- A photographed receipt, once an organization enables cloud OCR, produces real
  recognized text and the same explainable field suggestions a clean PDF already gets.
- An organization that hasn't enabled OCR sees identical behavior to today — no change,
  no regression.
- `corepack pnpm lint`, `typecheck`, and the capture-service tests pass.

## Out of scope

The local/on-device OCR adapter's actual implementation — scoped here as a named
follow-on, not built in this pass. Any change to the review-first workflow's approval
requirement.
