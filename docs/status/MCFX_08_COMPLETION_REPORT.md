# MCFX-08 completion report

Status: FAIL

Superseded by `MCFX_POST_IMPLEMENTATION_AUDIT.md`.

The manual receipt branch calculates a limited realized difference, but it
does not post monetary-position events, preserve final proportional carrying
residue, validate the receiving account's currency/carrying value, or implement
the required refund, dispute, unapplied-money, deposit, write-off, reversal,
stale-event, and race cases. Foreign settlement is now fail-closed.
