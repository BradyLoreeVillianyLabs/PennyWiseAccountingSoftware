# WD2 — Launcher shutdown and child-process supervision

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** native (`distribution/windows-native/launcher.cjs`)
**Effort:** M
**Severity:** High. Unclean exits leave stale locks (WD1), and they may leave PostgreSQL running
or its `postmaster.pid` behind (WD4).
**Depends on:** WD1, which edits the same file.

## Why

The launcher starts PostgreSQL and two Node children: the API on 32101 and the web server on 32100. It then polls a 500 ms loop (`launcher.cjs:765-771`). It stops them in order only when:

- it receives `SIGINT` or `SIGTERM` (`launcher.cjs:681-682`);
- a shutdown request arrives;
- startup throws.

## Verified evidence (launcher.log)

- **2026-09-07T04:12:10Z and 2026-10-10T06:43:13Z:** `FATAL node.exe stopped unexpectedly: exit
3221225786`. That code is 0xC000013A, `STATUS_CONTROL_C_EXIT`: Windows ended the process
  because of a console close, sign-out or shutdown.
- **2026-09-06T22:56:58Z:** `FATAL node.exe stopped unexpectedly: exit 4294967295` (−1), 32 s
  after Ready.
- **2026-10-12:** the launcher reached Ready at 18:07:12Z, then ended with no log line and left
  `launcher.lock` behind.
- **Children aren't supervised.** When a child exits, `spawnLogged` (`launcher.cjs:603-617`)
  calls `fail()`. `fail()` (`launcher.cjs:54-63`) logs, shows a message box and sets
  `process.exitCode`, but it doesn't call `stop()` or leave the `while (true)` loop.

## Hypotheses (confirm or refute each)

- **H1.** When the console window closes, Node on Windows delivers `SIGHUP`, and Ctrl+Break
  delivers `SIGBREAK`. The launcher handles neither, so Windows ends it before `stop()` or the
  `exit` handler runs. Sign-out and shutdown may not reach a console Node process as a signal at
  all. Check the Node documentation for the Node version bundled in `resources\node`.
- **H2.** The children share the launcher's console, so the same console event ends them first
  with 0xC000013A. That would fit both FATAL lines.
- **H3.** After a child dies, the launcher keeps running with a dead API or web server. It still
  holds the lock, and PostgreSQL stays up.
- **H4.** An unclean end leaves `postgresql\postmaster.pid` and possibly a running `postgres.exe`
  that `runtime-state.json` no longer describes.

## Tasks

1. **Build a harness that answers H1–H4.**

   - Use a disposable profile, or a stand-in script with the same spawn options as
     `spawnLogged`.
   - Trigger each event: close the console window, send Ctrl+Break and Ctrl+C (for example with
     a small `GenerateConsoleCtrlEvent` helper), and kill the API child.
   - For each event, record:
     - which processes exit, and with which codes;
     - whether `stop()` ran;
     - which files remain: `launcher.lock`, `runtime-state.json`, `startup-state.json`,
       `postgresql\postmaster.pid`;
     - which processes remain.

   Put the results in a table in the report.

2. **Fix only what the harness confirms.**
   - **Console events:** handle `SIGHUP` and `SIGBREAK` the same way as `SIGINT`. A closing
     console gets only a few seconds, so stop the children, run `pg_ctl stop -m fast`, release
     the lock, and log one line with the reason, all within that budget. Measure the budget and
     report it.
   - **Child supervision:** if the API or web child exits while `stopping` is false, log once,
     run `stop()`, release the lock and exit non-zero. Don't add auto-restart; propose it in the
     report if you think it's warranted.
   - **Exit-code wording:** log 0xC000013A as "ended by Windows (console closed, sign-out or
     shutdown)". Keep FATAL for real crashes, and keep the user's message box only for real
     failures.
   - **Child process groups:** consider spawning the children in their own process group so they
     don't receive the console's control events, and let the launcher stop them in order. If
     you do, prove they can't be orphaned when the launcher itself is killed, for example with a
     Job Object, or with WD1's lock rules plus the startup cleanup below. Record the choice in
     `distribution/windows-native/README.md`.
   - **Startup cleanup:** if `runtime-state.json` names a launcher PID that isn't running and a
     `postgres.exe` still serves this data directory, stop it with `pg_ctl stop -D … -m fast`
     before starting a new one, and log it.
3. **Add tests.**
   - Unit tests for the exit-code classifier and the supervision decision.
   - Rerun the task 1 harness after the fix and show a clean state for every event.

## Constraints

- Follow the README's shared rules. Kill only processes your harness started.
- Don't change ports, the data layout, migrations or the startup order.

## Acceptance criteria

- Closing the console in the harness leaves:
  - no `launcher.lock` and no `postmaster.pid`;
  - no stray `node.exe` or `postgres.exe` from the harness;
  - one reasoned log line.
- Killing the API child makes the launcher stop PostgreSQL and exit non-zero within 15 s.
- The native tests, lint and the format check pass.

## Out of scope

- How lock readers handle stale state (WD1).
- Why the scheduled backup failed on 2026-09-23 (WD4). Do record whether H4 would explain it.
