# Payroll provider connectors — direct deposit and statutory filing

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

**Read `docs/tasks/ROBUST_PAYROLL_IMPLEMENTATION_PROMPT_2026-08-09.md` in full before this
document.** That prompt already specifies the payroll domain build — workers, schedules,
runs, the CA-AB statutory engine, approvals, posting, and payslips — and its Phase 6/Phase
5 sections deliberately stop short of a live money-movement or filing connector, gated
behind exactly this: real provider credentials and a separately accepted connector. If
that document's phases are not yet complete, finish them first; this document is the
piece they intentionally left for later, not a replacement for any of them.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `docs/tasks/ROBUST_PAYROLL_IMPLEMENTATION_PROMPT_2026-08-09.md` — the full domain spec
4. `apps/api/src/services/payroll-provider-gates.ts` — the two gates this closes
5. `apps/api/src/services/payroll-service.ts`, `payroll-statutory-service.ts`
6. `docs/adr/006-native-payroll-boundary.md`

## Exact intention

`payroll-provider-gates.ts` returns `enabled: false` for both `directDeposit` and
`taxFiling`, each with a named blocker (`PAYROLL_DIRECT_DEPOSIT_ADAPTER_NOT_IMPLEMENTED`,
`PAYROLL_TAX_FILING_ADAPTER_NOT_IMPLEMENTED`). PennyWise can calculate a payroll run,
produce a payslip, and post the journal — but cannot move a dollar to a worker's bank
account or submit a remittance/T4 to a government authority. Close both gates, each
behind a pluggable connector interface, not a single hard-wired vendor.

## Research already done

**Wagepoint was checked directly and does not have a public, self-serve developer API.**
Its own site (`wagepoint.com/people/developer-api-agreement`) describes a "Developers
Program" gated by a signed agreement, not open documentation with sandbox credentials —
so it is not a safe adapter target until that changes. The same search also surfaced
Rollfi and Gusto Embedded as API-first payroll platforms with real developer docs, but
neither confirms Canadian statutory support matching the CA-AB/CA-QC engine this codebase
already has, so naming either as the live-transfer partner would be a guess, not
research. **Do not build against any of these three without first confirming, from their
own primary documentation, a genuinely self-serve sandbox and confirmed Canadian
coverage** — if that confirmation doesn't exist, say so plainly rather than substituting
a different guess.

What research _does_ support building immediately, with no partnership needed at all, is
the file format itself:

### CPA Standard 005 — real, byte-exact, and has a working reference implementation

The format is a fixed-length text file, each record exactly **1464 bytes**: one file
header (**A** record), one or more detail records (**C** for credit/D for debit, packing
up to six 240-byte transaction segments behind a 24-byte logical header — 24 + 6×240 =
1464), and one file trailer (**Z** record). Each 240-byte segment carries a transaction-
type code, the amount in cents, the payment date, and the destination account/institution/
transit numbers. Payments Canada's own prose specification is reported to have real gaps
and inconsistencies, so **use the open-source reference implementation instead of
deriving the byte layout from prose alone**:
[`moov-io/cadeft`](https://github.com/moov-io/cadeft) — a working, tested Go
implementation with a real code sample:

```go
header := cadeft.NewFileHeader("123456789", 1, time.Now(), int64(610), "CAD")
txn := cadeft.NewTransaction(
  cadeft.CreditRecord, "450", 420, Ptr(time.Now()),
  "123456789", "12345", "222222222222222",
  "payor name", "payor long name", "987654321", "54321", "",
  cadeft.WithCrossRefNo("0000100000024"),
)
file := cadeft.NewFile(header, cadeft.Transactions{txn})
serializedFile, err := file.Create()
```

Read its field-level source directly (not just this summary) for the exact byte offsets
before implementing PennyWise's own generator — don't port the Go library, use it as the
ground truth the prose spec is missing.

**Implementation update (2026-09-11):** `apps/api/src/services/cpa005-eft-file-service.ts`
implements the full file header, credit detail records (packed six-per-record), and file
trailer, with `cpa005-eft-file-service.test.ts` asserting every field's exact byte offset.
Critically, its output was cross-checked against a Go program built against the real
`moov-io/cadeft` library and run with an identical fixture, diffed byte-for-byte — the
reference output is checked in at `__fixtures__/cadeft-reference-output.txt` and asserted
identical. That cross-check caught two real errors a source-reading-only pass missed: the
date field is 6 characters (3-digit year + 3-digit day-of-year), not 4, and records are
joined by a single LF with no trailing terminator, not CRLF. **Do not rebuild this piece
or re-derive the byte layout — wire the existing module into a payment batch, per task 1
below, only after an approved bank-detail decryption design exists.** It is a
standalone, byte-verified generator today; it is not a payroll export users can download.

## Boundary conditions — read before writing any adapter code

- **There is no server-side decryption of worker bank details anywhere in this codebase
  today, and that is very likely deliberate — confirm before adding one.**
  `PayrollWorker.bankAccountCiphertext` is a client-side-encrypted envelope
  (`ciphertext` + `keyVersion`, validated but never decrypted in
  `payroll-service.ts`'s `validateEnvelope`); grepping the entire `apps/api/src/services`
  tree for a decryption counterpart found none. This means the API server currently
  cannot read a real institution/transit/account number at all — by design, most likely,
  matching this program's pattern of never letting the server hold a secret it doesn't
  need. Building a real CPA-005 export requires resolving this, and it deserves its own
  deliberate design (who can trigger it, what's audited, does the key live in the API
  process at all) rather than a decrypt-on-demand helper added as a side effect of this
  task. If no such design exists yet, say so plainly and stop rather than inventing one.
- **This is regulated money movement and government filing.** Every constraint in
  `ROBUST_PAYROLL_IMPLEMENTATION_PROMPT_2026-08-09.md`'s "Non-negotiable engineering and
  compliance rules" applies in full here, especially: never submit to a live external
  system in development; keep "calculated," "exported," and "submitted" as distinct,
  honestly-labeled states; require scoped credentials, consent, re-authentication,
  idempotency, and a production feature flag before any live connector activates.
- **Ship the CPA-005 path as the real, primary, contract-free deliverable.** It needs no
  partner, no waiting, and gives every organization a working direct-deposit path
  immediately — the employer takes the generated file to their own bank. This is not a
  placeholder while a "real" connector gets built later; for a small-business product,
  this is a completely legitimate, commonly-used direct-deposit mechanism in its own
  right.
- **Current implementation status overrides the intended delivery order above.** Until an
  approved server-side decryption boundary exists, CPA-005 is not an available
  direct-deposit feature: the API cannot read the worker account inputs. Treat the
  completed generator as byte-level implementation evidence, not as a downloadable
  payment file or a reason to enable the provider gate.
- **Design the connector interface so a payroll-API partner can plug in later, but do not
  name or build against one now without the confirmation above.** Leave the second slot
  genuinely empty — an interface with zero implementations is honest; a stub built
  against an unconfirmed API is not.
- **Filing has the same shape.** Build a CRA remittance/T4 **export** path (the
  validated XML/Web Forms structures `ROBUST_PAYROLL_IMPLEMENTATION_PROMPT_2026-08-09.md`
  Phase 5 already specifies, citing the CRA's own T4127/RC4120/T4-XML pages) as the first,
  contract-free adapter. A live submission connector to CRA's filing systems is a second
  adapter behind the same interface, gated on the owner holding the required RepID/
  business filing credentials — CRA does not offer a public self-serve sandbox for this,
  so this side genuinely does stop at export until the owner pursues that access directly.
- **Never let file generation read as payment or filing completion.** An EFT file
  exported and a T4 XML exported are instructions, not proof that a bank paid anyone or
  that CRA received anything. Keep the UI copy precise about which state a run is in.

## Tasks

### 1. Direct-deposit connector interface

Define the interface both direct-deposit adapters implement: given a posted run's
payment batch (already modeled per the payroll prompt's Phase 6), produce either a
validated CPA 005 EFT file or a live transfer instruction, with a uniform result shape
(accepted/rejected per worker, file hash, provider reference where applicable).

### 2. EFT/PAD file adapter — done; wire it in

`cpa005-eft-file-service.ts`'s `buildCpa005CreditFile` already does the file generation,
byte-verified against the real reference implementation (see Research above). What
remains: call it from a posted `PayrollPaymentBatch`'s `PayrollPaymentItem` rows, resolve
each worker's real institution/transit/account number as input (see the server-side
decryption note above — this is the open question, not the file format), hash the
resulting file, store it via `PayrollPaymentExport` (`format: "CPA005"`), and mark the
batch `EXPORTED`, never `PAID`.

### 3. Payroll-API partner adapter interface (second slot, deliberately unimplemented)

Define the connector interface's shape so a real payroll-processing partner API can
implement it later, but do not implement it against Wagepoint, Rollfi, Gusto Embedded, or
any other named platform in this pass — none is confirmed as both self-serve and
Canadian-capable (see Research above). Its `enabled` flag must report `false` with a
named reason until a real, confirmed partner is identified and its credentials exist for
a given organization.

### 4. Filing export adapter (first, no external contract needed)

Wire the T4/T4A and remittance export structures from
`ROBUST_PAYROLL_IMPLEMENTATION_PROMPT_2026-08-09.md` Phase 5 into a real, downloadable,
CRA-format-validated export. This is the manual-submission path every organization gets
regardless of any live connector.

### 5. Live filing connector (second, contract-gated)

Behind the same interface, a connector to CRA's electronic filing where credentials and
a production feature flag exist. If no such credentialed sandbox exists to build against
honestly, stop after the export adapter and report exactly what is missing rather than
approximating a live submission.

### 6. Flip the gates, honestly

Update `payroll-provider-gates.ts` so `enabled` reflects real adapter availability per
organization (EFT/export adapters read `true` once built; partner/live adapters read
`true` only when that organization's real credentials are configured) — never a global
`true` that outruns what is actually connected for a given organization.

### 7. Tests

- CPA 005 file structure tests against the official field specification, including
  boundary cases (maximum workers per batch, invalid transit/account numbers, zero-net
  pay).
- T4/T4A export structure tests against the CRA's published XML specification.
- A test proving the gate reports `false` honestly when a partner adapter has no
  credentials configured, and `true` only once they exist.
- Update `docs/COMPETITIVE_RESEARCH_MATRIX.md`'s payroll entry with both connectors'
  implementation contracts.

## Constraints

- No change to the statutory calculation engine, journal posting, or payslip snapshots
  `ROBUST_PAYROLL_IMPLEMENTATION_PROMPT_2026-08-09.md` already covers.
- No live transfer or live filing submission in development under any circumstance.
- SIN, bank account numbers, and transit numbers stay encrypted through the existing
  protection pattern; masked in every response, log, and export filename.

## Acceptance criteria

- A posted payroll run produces a valid, hash-recorded EFT file an employer can submit
  through their own bank, and a valid, hash-recorded T4/remittance export — both without
  any third-party contract.
- `payroll-provider-gates.ts` reports each capability's true, per-organization state.
- Adding a partner/live adapter's real credentials flips that specific gate to `true`
  without any code change.
- `corepack pnpm lint`, `typecheck`, and the payroll integration/unit tests pass.

## Out of scope

Any live transfer or live government submission actually happening — those require the
owner to hold real credentials first, and remain gated exactly as
`ROBUST_PAYROLL_IMPLEMENTATION_PROMPT_2026-08-09.md` specifies. Quebec/US filing formats.
Payroll domain features not already covered by that document.
