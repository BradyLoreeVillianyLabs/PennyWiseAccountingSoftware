-- SMTP is an explicit third sender option. Existing OAuth connections retain
-- their provider values and no credentials are changed by this append-only enum
-- migration.
ALTER TYPE "EmailConnectionProvider" ADD VALUE IF NOT EXISTS 'SMTP';
