DO $rollback$
BEGIN
  IF to_regclass('public."EstimateDelivery"') IS NULL THEN
    RETURN;
  END IF;

  UPDATE "EstimateDelivery"
  SET "status" = 'QUEUED'
  WHERE "status" = 'SENDING';

UPDATE "Communication"
SET "status" = 'QUEUED'
WHERE "status" = 'SENDING';

ALTER TABLE "EstimateDelivery" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Communication" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "CommunicationStatus" RENAME TO "CommunicationStatus_with_sending";
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');

ALTER TABLE "EstimateDelivery"
  ALTER COLUMN "status" TYPE "CommunicationStatus"
  USING ("status"::text::"CommunicationStatus");
ALTER TABLE "Communication"
  ALTER COLUMN "status" TYPE "CommunicationStatus"
  USING ("status"::text::"CommunicationStatus");

ALTER TABLE "EstimateDelivery" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
ALTER TABLE "Communication" ALTER COLUMN "status" SET DEFAULT 'QUEUED';

  DROP TYPE "CommunicationStatus_with_sending";
END;
$rollback$;
