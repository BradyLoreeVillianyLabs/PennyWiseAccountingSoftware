# Second-beta implementation — controlling prompt

## Read first

Work only in `C:\Users\EmceeHax\Desktop\clearledger-src`. Read `AGENTS.md`,
`TASK_EXECUTION_STANDARD.md`, and `PROVIDER_INTEGRATIONS_HANDOFF_2026-09-08.md`.
For each increment, read the corresponding handoff and its required source and
primary documentation. Preserve concurrent work; this transferred tree currently
has no Git metadata from which authorship or a clean baseline can be recovered.

## Authorization

Owner authorization dated 2026-09-09 covers independent review, fixes, implementation,
tests, prompts, documentation, and a separately versioned Windows beta candidate.
Continue through the increments without another phase-permission exchange.
This prompt supersedes the prepared-only status and signup requirements of the
six provider handoffs for this work. Existing accounting invariants still apply.

## Exact intention and execution order

Owner update: execute independent implementation lanes concurrently, with one owner
for shared contracts, schema, dependency manifests and final integration. Dependency
order still applies to integration and acceptance; parallel work is not permission
to skip review or mark an incomplete feature ready.

**B2-UX — company and contextual creation.** Make trial-company creation and deletion
discoverable and functional. Preserve tenant boundaries and require explicit,
truthful deletion confirmation. Add contextual “+ Add” actions for missing required
records, preserving the originating draft, refreshing and selecting the new record,
and returning focus to the interrupted task. Exercise the rendered flows.

1. **B2-1 — Review and adapter repairs.** Reconcile the independent review with
   primary sources and executable evidence. Repair CPA-005 byte widths, account
   validation and diagnostics; settle webhook headers/asynchrony and repair
   PayPal verification, capture/order identity and merchant authentication.
   Exercise the actual installed SDK against local HTTP emulators, including
   negative responses, retries and identity mismatches. Keep Stripe regression
   evidence. Record unsupported or externally unverified behavior precisely.
2. **B2-2 — Usable payment processors.** Complete PayPal and Square hosted payment
   flows, explicit organization selection, provider-specific history and refunds,
   safe capture completion, webhook routing, schema migrations and UI. Local
   emulation must exercise the same application/service/SDK paths. Any selectable
   simulation is clearly labelled and isolated from real organizations/books.
3. **B2-3 — Mail and bank feeds.** Integrate SMTP with encrypted credentials and a
   verified test-send, using a local SMTP server for acceptance. Implement the
   documented Flinks connector with a local HTTP/hosted-consent test environment;
   retain usable CSV/OFX import and explicit selection. Correct inaccurate claims
   about free credentials and service availability in the original prompts.
4. **B2-4 — Payroll exports.** Inspect the existing payroll-domain implementation
   against its full prompt and ADR. Integrate exact EFT output for posted batches
   using an explicit encrypted bank-detail boundary. Validate downloadable filing
   exports against the applicable published CRA schemas. Exported is distinct from
   paid/submitted. No invented partner API or invented filing receipt.
5. **B2-5 — Receipt recognition.** Implement actual local image/PDF OCR with bundled
   runtime/model assets so ordinary beta use requires no cloud account. Also provide
   the documented optional Azure boundary with explicit organization consent and
   HTTP-contract tests. Feed existing explainable extraction/review validation;
   preserve the human posting decision. Exercise real images and OCR output.
6. **B2-6 — Product and installer acceptance.** Run formatting, lint, compilation,
   Prisma validation/generation, clean disposable migrations, unit/integration and
   relevant browser tests, research checks, and a full build. Repair failures.
   Package a new self-contained Inno candidate, preserving participant identity for
   upgrades. Verify hashes/signatures, bundled dependencies and isolated installed
   startup. Prepare a USB-transfer folder with install instructions only when its
   tested state supports handoff. Keep real clean-host evidence distinct from local
   checks and keep 0.14.0.15 frozen.

## Development discipline

- Use official SDKs where they fit the existing hosted flows. Check the installed
  types and wire protocol; REST response models are not webhook schemas.
- Local emulators must check real serialized requests and simulate provider errors,
  signatures, pagination, idempotency and incomplete state. A mocked success response
  by itself cannot demonstrate correctness.
- Do not create paid services or require owner account registration for development.
  Use existing authorized sandbox access if available without exposing credentials.
  Where real service access is unavailable, implement and test the boundary and
  record the external acceptance gap. Never label fabricated credentials as valid.
- User-facing local capabilities must actually work: OCR recognizes images, exports
  contain validated records, SMTP communicates with a server, import performs real
  parsing. Keep provider simulation out of production financial state.
- Update the research matrix, progress ledger, handoff index and changed contracts
  with every completed increment. Report actual commands, failures and unrun checks.

## Completion

The final deliverable is a tested, separately versioned Windows installer transfer
folder and current documents describing implemented capabilities and evidence limits.
Do not mark this program complete because an adapter's unit tests pass.
