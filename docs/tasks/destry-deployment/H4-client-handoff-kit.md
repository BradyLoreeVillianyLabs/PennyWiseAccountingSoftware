# H4 — The kit Destry Workwear actually receives

Prepared task. Not authorized until the owner records it as the active phase in
`docs/status/CURRENT_PHASE.md`.

## Read first

1. `AGENTS.md`
2. `docs/tasks/TASK_EXECUTION_STANDARD.md`
3. `H1`, `H2`, `H3` completion reports; `D6` runbook and evidence if D6 has run
4. `distribution/public-beta/` — `README.md`, `BETA_LICENSE.txt`,
   `KNOWN_LIMITATIONS.md`, `PRIVACY_AND_DATA.md`, `SECURITY_AND_SUPPORT.md`,
   `RELEASE_EVIDENCE.md`
5. `docs/BACKUP_AND_RECOVERY.md`, `docs/USER_ACCEPTANCE_SCRIPTS.md`

## Exact intention

Assemble one folder that can be handed to Destry Workwear, and write the documents
that go in it. After this phase the answer to "what do we give them" is a path, not
a conversation.

Write for the person who will actually use this: a business owner who wants to
invoice customers and ship orders, who has no interest in Docker, ports, or
migrations, and who will be alone with the software at 7am when something looks
wrong.

The existing `distribution/public-beta/` documents are written for a beta
evaluator. This is a delivery to a named client running their real business, and
the difference in tone and content is the work.

## Boundary conditions

- **Every claim must be true of the artifact being shipped.** Do not describe a
  feature the package does not have, or that `H1` did not make reachable.
  `KNOWN_LIMITATIONS.md` is the honest half of the kit and must stay honest.
- If `H2` returned "not deliverable", this phase does not paper over it. Record
  the blockers and stop.
- Nothing in the kit contains a credential, a token, a connection string or the
  owner's data.
- Do not promise support hours, response times, uptime, or a warranty that has not
  been agreed with the client. Where a commitment is unknown, leave a marked
  placeholder for the project owner rather than inventing one.
- Nothing implies PennyWise provides accounting, tax, or customs advice, or that
  it moves money.

## Tasks

### 1. Assemble the artifact

One versioned folder containing the installer, its checksum, the licence, and the
documents below. Name the build unambiguously and state which commit or tree it
was produced from. A recipient must be able to verify what they received.

### 2. Install guide

Written for a non-developer, from the recorded transcript in `H2` — including the
exact text of every prompt and warning they will see, and what to do about each.
Prerequisites, install, first launch, and how to tell it worked. If SmartScreen
warns, say so and say why, rather than letting them meet it unprepared.

### 3. Daily operations guide

The loop the business actually runs, in the order they run it: an order arrives,
review it, convert it, pick it, ship it, get paid, reconcile the bank. Screens
and buttons as they are actually labelled after `H1`. One page per task, not a
reference manual.

### 4. Backup and recovery, for the owner

Plain-language, from `H2`'s rehearsed run: where the backup is, how to confirm it
happened, how to restore, and what to do if the computer is gone. This is the
document that matters most on the worst day; it must be followable while alarmed.

### 5. Known limitations

What the software does not do, in the owner's terms. Include the gated items —
live bank feeds, payroll, anything else behind a provider or regulatory gate — so
the client is not surprised by an absence they assumed was present. Reuse the
substance of `KNOWN_LIMITATIONS.md`, rewritten for this reader.

### 6. Support and escalation

Who to contact, how, and with what information. How to produce a diagnostic
bundle. What to do first when something looks wrong — and explicitly, what not to
do: do not reinstall, do not delete the data folder, take a backup first.

### 7. Acceptance script for the client

A short checklist the owner performs themselves to confirm the install is good on
their machine — derived from `docs/USER_ACCEPTANCE_SCRIPTS.md` but reduced to what
a non-developer can meaningfully verify. Signing this is the handoff.

## Constraints

- No new product code and no new features.
- Every document is written from a recorded run, not from the source. If a step
  was never performed, it does not appear as instruction.
- British/Canadian spelling and the product's existing voice.
- Nothing copied from another product's documentation.

## Acceptance criteria

- One folder, one version, containing installer, checksum, licence, and the six
  documents.
- Every factual claim traceable to `H1`–`H3` or `D6` evidence.
- A person who has not seen this project can install, complete one invoice and one
  shipment, take a backup and restore it, using only the kit.
- The client acceptance script has been performed once, by someone who did not
  build the software, and the result recorded.
- Any unresolved blocker from `H2` stated on the first page of the kit, not buried.

## Out of scope

Product changes. Commercial terms, pricing, and contracts. Training delivery.
