# PB0 — Put the source under version control and make every installer traceable to it

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** repository and tooling (no `apps/web` edits, so it can run beside a web prompt)
**Effort:** S
**Beta gate:** yes. Do this first.
**Depends on:** nothing.

## Why

This tree is the only copy of six weeks of work. It has no `.git`, and the newest off-machine
copy is `Desktop\clearledger-src.tgz` from 2026-09-01. The private GitHub repository
`BradyLoreeVillianyLabs/ClearLedger` was last pushed 2026-07-22. Every September increment,
from I1–I9 and X1–X3 through C1 and the composer work, exists in one Desktop folder.

There is also no link between an installer and the source that produced it. As a result:

- the 0.14.0.23 folder is empty;
- `apps/api/dist/app.js` is older than `apps/api/src/http/schemas.ts`;
- the September 27 sale assessment says that installer and source equivalence can't be
  claimed without a build manifest.

`.github/workflows/ci.yml` exists but has never run on current code.

## Verified context (2026-10-17)

- `.gitignore` already excludes `node_modules/`, `dist/`, `build/`, `.env*`, `.data/`,
  signing material (`*.pem`, `*.key`, `*.pfx`) and both installer `output/` folders.
- It does **not** exclude:
  - `outputs/`;
  - `apps/web/.review-backup-20260901/` and `apps/web/.review-pre-d6d7/`, which are manual
    snapshots;
  - the root `.config/`;
  - `distribution/windows-native/build/stage/`, which `build/` covers by pattern but must be
    confirmed.
- `.env` exists and must never be read or committed (`MODEL-TAKEOVER.md`).
- The issuer private key lives outside the tree at
  `%LOCALAPPDATA%\PennyWiseBetaIssuer`. Confirm that nothing under the tree holds a copy.

## Tasks

1. **Preflight inventory, with no writes yet.**
   - List every path that a first commit would include.
   - Flag files over 5 MB, binary files, any path matching `secret|credential|token|password|private`,
     and any file that contains a PEM private-key header or a high-entropy string longer
     than 32 characters.
   - Use `gitleaks` if it is installed. Otherwise use a scripted regex scan, and say which
     one ran.
   - Write the inventory to `docs/status/PB0_FIRST_COMMIT_INVENTORY.md`.
   - **Stop and show the owner the flagged list before committing.**
2. **Tighten `.gitignore`** for the folders above and any others the inventory surfaces.
   Never ignore source, migrations, docs or test fixtures to make the commit smaller.
3. **Initialize the repository** after the owner approves the inventory.
   - Set `core.autocrlf=false` and keep the existing `.gitattributes`. The web assets
     verifier depends on LF.
   - Make one initial commit, then tag it `v0.14.0.22-source`, the source behind the last
     built candidate. State honestly that the tag is a best match, not proven equivalence.
   - **Do not push.** The owner adds the remote and pushes. Print the exact commands for
     that.
4. **Build manifest.**
   - Make `Build-PennyWiseInnoSetup.ps1` and `Build-PennyWiseMsix.ps1` write
     `<installer>.manifest.json` beside the installer. It records:
     - the version and the git commit;
     - a `dirty` flag, plus a hash of `git diff` when the tree is dirty;
     - the Node and pnpm versions;
     - the migration count and the newest migration name;
     - the SHA-256 of `apps/web/dist/app.js` and `apps/api/dist/index.js`;
     - the installer SHA-256.
   - Refuse to build a **public** flavour (see PB4) from a dirty tree. QA flavours may build
     dirty, but the manifest says so.
5. **Stale-output guard.** The installer build must rebuild `apps/api/dist` and
   `apps/web/dist` from source every time. Add a check that fails the build when any dist
   file is older than its newest source input.
6. **Branch convention.** Document it in `docs/tasks/paid-beta-readiness/README.md` under
   "Using git": one branch per prompt, named after the prompt ID, with a completion report
   per merge.

## Constraints

- Never read, print, stage or commit `.env`, `.data/`, anything under `%LOCALAPPDATA%`, or
  issuer keys.
- Don't rewrite or reformat source as part of this prompt.
- Don't create a GitHub repository, add remotes, or push.

## Acceptance criteria

- `git status` is clean after the initial commit, and `git ls-files` contains no flagged
  secret paths.
- A QA installer build writes a manifest whose commit matches `HEAD`.
- A public-flavour build from a dirty tree fails with a clear message.
- The stale-dist guard fails when `schemas.ts` is newer than `apps/api/dist/app.js`.

## Out of scope

- CI changes. QA0 owns them.
- Code signing. PB4 owns it.

## Standard rules

- **Authorization:** prepared, not authorized. Start only after the owner records this
  prompt as active in `docs/status/CURRENT_PHASE.md`.
- Follow `AGENTS.md` and `docs/tasks/TASK_EXECUTION_STANDARD.md`.
- Write a completion report under 1,200 words listing changed files, commands, results and
  anything unrun. Then stop.
