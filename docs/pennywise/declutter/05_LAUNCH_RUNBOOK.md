# UI v2 Launch Runbook (owner steps)

Everything an AI agent can prepare is already in place: plan, task files, board, metrics baseline,
stream tooling, engine entry points, CI check and GitHub issues. This runbook covers the steps that
need **you**, the owner, in order.

## Step 1 — Finish the git baseline (Codex is doing this)

Confirm the repository on GitHub contains the full source **including these new files**:

- `docs/pennywise/declutter/*`, `docs/tasks/ui-v2/*`, `scripts/ui-v2/*`
- `CLAUDE.md`, `.claude/commands/ui-v2-stream.md`, `.agents/workflows/ui-v2-stream.md`,
  `.github/prompts/ui-v2-stream.prompt.md`
- the edits to `AGENTS.md`, `.gitignore` (adds `.ui-v2-stream.ps1`) and `.github/workflows/ci.yml`
  (adds the clutter check)

The repository is **public**. Before or right after the first push, check that none of these were committed:

- `.env`
- anything under `.data/`, `outputs/` or `distribution/*/output/`
- `*.pfx`, `*.pem` or `*.key`
- `pennywise-beta-secrets.clixml`

The `.gitignore` covers them, but verify on GitHub. If the code should not be public, change the visibility
under Settings → General → Danger zone before pushing.

Then create the baseline tag and integration branch (one time, from the repo folder):

```powershell
git checkout main; git pull
git tag ui-v2-baseline; git push origin ui-v2-baseline
git branch ui/integration main; git push -u origin ui/integration
```

Optional: on GitHub → Settings → Branches, protect `main` and `ui/integration` (require PR + CI pass).

## Step 2 — Authorize U0 in `docs/status/CURRENT_PHASE.md`

AGENTS.md lets only you authorize phases. Paste this under the existing authorizations and commit it:

```markdown
- UI v2 declutter program authorized by the owner on <YYYY-MM-DD>: phase **U0 foundations** only
  (module split with zero behaviour change). See `docs/pennywise/declutter/03_REVISION_PLAN.md` and
  `docs/tasks/ui-v2/U0-foundations.md`. Later U phases need separate authorization. No changes to
  `packages/accounting-core`, `packages/db`, or posting code are authorized by this entry.
```

To authorize Wave 1 later, add `U1 shell, charts, api-summary (read-only endpoints), qa harness and
research`. Wave 2 is `U2–U5`, Wave 3 is `U6`, and Wave 4 is `U7–U8`. One line per wave keeps the audit trail clear.

## Step 3 — Wave 0: run U0 with Claude Code

```powershell
$env:TEST_DATABASE_URL = 'postgresql://<user>:<password>@127.0.0.1:<port>/clearledger_test'  # your local test server
scripts\ui-v2\new-stream.ps1 -Stream u0-foundations -Slot 1
cd ..\pw-u0-foundations; corepack.cmd pnpm install; . .\.ui-v2-stream.ps1
claude   # then type:  /ui-v2-stream u0-foundations
```

When the PR into `ui/integration` is open, start a Gate B review with Copilot (VS Code chat →
`/ui-v2-stream` prompt, stream `review`, give it the PR number). Merge once CI is green and the review is clean.

## Step 4 — Wave 1 (5 agents in parallel)

Authorize Wave 1 in `CURRENT_PHASE.md`, then create one worktree per stream:

```powershell
scripts\ui-v2\new-stream.ps1 -Stream shell       -Slot 2   # Claude Code:  /ui-v2-stream shell
scripts\ui-v2\new-stream.ps1 -Stream charts      -Slot 3   # Antigravity: open ..\pw-charts, run workflow ui-v2-stream, stream "charts"
scripts\ui-v2\new-stream.ps1 -Stream api-summary -Slot 4   # Codex: open ..\pw-api-summary, prompt below
scripts\ui-v2\new-stream.ps1 -Stream qa          -Slot 5   # Copilot (VS Code): open ..\pw-qa, prompt ui-v2-stream, stream "qa"
scripts\ui-v2\new-stream.ps1 -Stream research    -Slot 6   # Copilot research agent (docs only)
```

**Codex prompt** (Codex reads `AGENTS.md` automatically):

> You are the `<stream>` agent. Follow `docs/tasks/ui-v2/README.md#agent-contract` and do
> `docs/tasks/ui-v2/<task file>`. Dot-source `.ui-v2-stream.ps1` before tests. Open the PR into
> `ui/integration` and stop.

Codex cloud tasks work too: choose this repository, set the branch to `ui/<stream>` (create it from
`ui/integration` first), and use the same prompt.

## Step 5 — Wave 2 (7 agents in parallel)

Authorize U2–U5. Then:

- Run `new-stream.ps1` for `home` (7), `sales` (8), `expenses` (9), `banking` (10), `contacts` (11),
  `taxes` (12) and `reports` (13).
- Start six Codex sessions (home, sales, expenses, banking, contacts, taxes) and one Antigravity session
  (reports).
- Antigravity also performs Gate C on every Wave 2 PR.

## Step 6 — Wave 3 (async, Copilot coding agent)

Authorize U6. Then, for each `ext-N` issue on GitHub:

1. Open the issue.
2. Click **Assign to Copilot**.
3. Set the base branch to `ui/integration`.

Copilot opens one PR per module, and CI plus a Claude Gate B review apply. If the coding agent is not
enabled for your account, give those issues to Codex cloud instead.

## Step 7 — Wave 4

1. Authorize U7–U8.
2. U7: Antigravity runs the audit, then Claude Code fixes the findings.
3. Build the installer and smoke-install on a clean Windows 11 PC.
4. U8: run the usability sessions yourself (protocol in `docs/tasks/ui-v2/U8-usability.md`).
5. Merge `ui/integration` → `main`, release beta 0.15, and record completion in `CURRENT_PHASE.md`.

## At the end of every wave

- `node scripts/ui-v2/measure-ui.mjs --write wave-N`, commit `metrics.json`, and update `BOARD.md`.
- Every open stream: `git fetch; git rebase origin/ui/integration`.
- Clean up finished worktrees: `git worktree remove ..\pw-<stream>`.
