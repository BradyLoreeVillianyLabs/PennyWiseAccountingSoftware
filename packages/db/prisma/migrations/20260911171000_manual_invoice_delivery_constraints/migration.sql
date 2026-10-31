ALTER TABLE "InvoiceDelivery" DROP CONSTRAINT "InvoiceDelivery_attempt_state_check";
ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_attempt_state_check" CHECK (
  ("status" = 'QUEUED' AND "providerMessageId" IS NULL AND "sentAt" IS NULL)
  OR ("status" = 'SENDING' AND "providerMessageId" IS NULL AND "sentAt" IS NULL)
  OR ("status" = 'SENT' AND "providerMessageId" IS NOT NULL AND "sentAt" IS NOT NULL)
  OR ("status" = 'FAILED' AND "failedAt" IS NOT NULL)
  OR ("status" = 'MANUAL' AND "providerMessageId" IS NULL AND "sentAt" IS NOT NULL)
);

ALTER TABLE "InvoiceDeliveryEvent" DROP CONSTRAINT "InvoiceDeliveryEvent_type_check";
ALTER TABLE "InvoiceDeliveryEvent" ADD CONSTRAINT "InvoiceDeliveryEvent_type_check"
  CHECK ("eventType" IN ('QUEUED','SENT','ACCEPTED','FAILED','BOUNCED','MANUAL'));
