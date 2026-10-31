ALTER TABLE "EmailConnection"
  ADD COLUMN "isDefaultSender" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EmailConnection_organizationId_isDefaultSender_idx"
  ON "EmailConnection"("organizationId", "isDefaultSender");

CREATE UNIQUE INDEX "EmailConnection_one_default_sender_per_organization"
  ON "EmailConnection"("organizationId")
  WHERE "isDefaultSender" = true;
