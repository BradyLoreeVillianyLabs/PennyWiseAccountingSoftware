CREATE TYPE "InvoiceDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED');
CREATE TYPE "InvoiceAttachmentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED');

ALTER TABLE "Invoice"
  ADD COLUMN "templateKey" TEXT,
  ADD COLUMN "templateVersion" INTEGER,
  ADD COLUMN "renderData" JSONB,
  ADD COLUMN "renderDataHash" CHAR(64),
  ADD CONSTRAINT "Invoice_render_data_contract_check" CHECK (
    ("renderData" IS NULL AND "templateKey" IS NULL AND "templateVersion" IS NULL AND "renderDataHash" IS NULL)
    OR ("renderData" IS NOT NULL AND "templateKey" IS NOT NULL AND "templateVersion" IS NOT NULL AND "templateVersion" > 0 AND "renderDataHash" IS NOT NULL)
  );

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_id_key" UNIQUE ("organizationId", "id");

CREATE TABLE "InvoiceTemplateConfig" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "templateKey" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "configuration" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InvoiceTemplateConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceTemplateConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "InvoiceTemplateConfig_templateVersion_check" CHECK ("templateVersion" > 0),
  CONSTRAINT "InvoiceTemplateConfig_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "InvoiceTemplateConfig_organizationId_key" ON "InvoiceTemplateConfig" ("organizationId");
CREATE INDEX "InvoiceTemplateConfig_organizationId_templateKey_idx" ON "InvoiceTemplateConfig" ("organizationId", "templateKey");

CREATE TABLE "InvoicePdfArtifact" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "storageKey" TEXT NOT NULL,
  "renderDataHash" CHAR(64) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "mediaType" TEXT NOT NULL DEFAULT 'application/pdf',
  "generatedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoicePdfArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoicePdfArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "InvoicePdfArtifact_invoice_tenant_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "InvoicePdfArtifact_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 52428800),
  CONSTRAINT "InvoicePdfArtifact_page_count_check" CHECK ("pageCount" > 0 AND "pageCount" <= 100),
  CONSTRAINT "InvoicePdfArtifact_media_type_check" CHECK ("mediaType" = 'application/pdf')
);
CREATE UNIQUE INDEX "InvoicePdfArtifact_storageKey_key" ON "InvoicePdfArtifact" ("storageKey");
CREATE INDEX "InvoicePdfArtifact_organizationId_invoiceId_createdAt_idx" ON "InvoicePdfArtifact" ("organizationId", "invoiceId", "createdAt");
CREATE INDEX "InvoicePdfArtifact_organizationId_renderDataHash_idx" ON "InvoicePdfArtifact" ("organizationId", "renderDataHash");

ALTER TABLE "InvoicePdfArtifact" ADD CONSTRAINT "InvoicePdfArtifact_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$');

CREATE TABLE "InvoiceDelivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT,
  "status" "InvoiceDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "queuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(6),
  "failedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InvoiceDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "InvoiceDelivery_invoice_tenant_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceDelivery_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "InvoiceDelivery_recipient_check" CHECK (length("recipientEmail") BETWEEN 3 AND 320),
  CONSTRAINT "InvoiceDelivery_subject_check" CHECK (length("subject") BETWEEN 1 AND 998)
);
CREATE INDEX "InvoiceDelivery_organizationId_invoiceId_queuedAt_idx" ON "InvoiceDelivery" ("organizationId", "invoiceId", "queuedAt");
CREATE INDEX "InvoiceDelivery_status_queuedAt_idx" ON "InvoiceDelivery" ("status", "queuedAt");
ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_attempt_state_check" CHECK (
  ("status" = 'QUEUED' AND "providerMessageId" IS NULL AND "sentAt" IS NULL)
  OR ("status" = 'SENDING' AND "providerMessageId" IS NULL AND "sentAt" IS NULL)
  OR ("status" = 'SENT' AND "providerMessageId" IS NOT NULL AND "sentAt" IS NOT NULL)
  OR ("status" = 'FAILED' AND "failedAt" IS NOT NULL)
);
ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_attempt_limit_check" CHECK ("attempts" <= 5);

ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_organizationId_id_key" UNIQUE ("organizationId", "id");

CREATE TABLE "InvoiceDeliveryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerReference" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceDeliveryEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceDeliveryEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "InvoiceDeliveryEvent_delivery_tenant_fkey" FOREIGN KEY ("organizationId", "deliveryId") REFERENCES "InvoiceDelivery"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceDeliveryEvent_type_check" CHECK ("eventType" IN ('QUEUED','SENT','ACCEPTED','FAILED','BOUNCED'))
);
CREATE INDEX "InvoiceDeliveryEvent_organizationId_deliveryId_occurredAt_idx" ON "InvoiceDeliveryEvent" ("organizationId", "deliveryId", "occurredAt");

CREATE TABLE "PublicInvoiceLink" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "lastViewedAt" TIMESTAMPTZ(6),
  "lastDownloadedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicInvoiceLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicInvoiceLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "PublicInvoiceLink_invoice_tenant_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PublicInvoiceLink_tokenHash_check" CHECK (length("tokenHash") = 64)
);
CREATE UNIQUE INDEX "PublicInvoiceLink_tokenHash_key" ON "PublicInvoiceLink" ("tokenHash");
CREATE INDEX "PublicInvoiceLink_organizationId_invoiceId_revokedAt_idx" ON "PublicInvoiceLink" ("organizationId", "invoiceId", "revokedAt");
CREATE INDEX "PublicInvoiceLink_expiresAt_idx" ON "PublicInvoiceLink" ("expiresAt");

CREATE TABLE "InvoiceAttachment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "scanStatus" "InvoiceAttachmentScanStatus" NOT NULL,
  "customerVisible" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "InvoiceAttachment_invoice_tenant_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceAttachment_file_name_check" CHECK (length("fileName") BETWEEN 1 AND 255 AND "fileName" !~ E'[\r\n/\\"]'),
  CONSTRAINT "InvoiceAttachment_media_type_check" CHECK ("mediaType" IN ('application/pdf','text/plain','image/png','image/jpeg','image/webp')),
  CONSTRAINT "InvoiceAttachment_size_check" CHECK ("byteSize" BETWEEN 1 AND 10485760),
  CONSTRAINT "InvoiceAttachment_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "InvoiceAttachment_storageKey_key" ON "InvoiceAttachment" ("storageKey");
CREATE INDEX "InvoiceAttachment_organizationId_invoiceId_createdAt_idx" ON "InvoiceAttachment" ("organizationId", "invoiceId", "createdAt");
CREATE INDEX "InvoiceAttachment_organizationId_invoiceId_customerVisible_idx" ON "InvoiceAttachment" ("organizationId", "invoiceId", "customerVisible");

CREATE OR REPLACE FUNCTION phase5_public_invoice_access(target_org UUID, target_invoice UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT current_setting('app.access_mode', true) = 'public_invoice'
    AND current_setting('app.public_invoice_token_hash', true) <> ''
    AND EXISTS (
      SELECT 1
      FROM public."PublicInvoiceLink" link
      WHERE link."organizationId" = target_org
        AND link."invoiceId" = target_invoice
        AND link."tokenHash" = current_setting('app.public_invoice_token_hash', true)
        AND link."revokedAt" IS NULL
        AND (link."expiresAt" IS NULL OR link."expiresAt" > CURRENT_TIMESTAMP)
    )
$$;
REVOKE ALL ON FUNCTION phase5_public_invoice_access(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION phase5_public_invoice_access(UUID, UUID) TO clearledger_runtime;

CREATE OR REPLACE FUNCTION phase5_protect_issued_render_data() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" NOT IN ('DRAFT', 'APPROVED') AND (
    NEW."templateKey" IS DISTINCT FROM OLD."templateKey"
    OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion"
    OR NEW."renderData" IS DISTINCT FROM OLD."renderData"
    OR NEW."renderDataHash" IS DISTINCT FROM OLD."renderDataHash"
  ) THEN
    RAISE EXCEPTION 'Issued invoice render data is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Invoice_render_data_protection"
BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION phase5_protect_issued_render_data();

CREATE OR REPLACE FUNCTION phase5_append_only_document_record() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Document history is append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "InvoicePdfArtifact_append_only_update"
BEFORE UPDATE OR DELETE ON "InvoicePdfArtifact" FOR EACH ROW EXECUTE FUNCTION phase5_append_only_document_record();
CREATE TRIGGER "InvoiceDeliveryEvent_append_only_update"
BEFORE UPDATE OR DELETE ON "InvoiceDeliveryEvent" FOR EACH ROW EXECUTE FUNCTION phase5_append_only_document_record();

CREATE OR REPLACE FUNCTION phase5_protect_issued_attachment() RETURNS TRIGGER AS $$
DECLARE target_invoice UUID; target_org UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_invoice := OLD."invoiceId";
    target_org := OLD."organizationId";
  ELSE
    target_invoice := NEW."invoiceId";
    target_org := NEW."organizationId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Invoice" invoice
    WHERE invoice."id" = target_invoice
      AND invoice."organizationId" = target_org
      AND invoice."status" NOT IN ('DRAFT', 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'Attachments for issued invoices are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "InvoiceAttachment_issued_protection"
BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceAttachment" FOR EACH ROW EXECUTE FUNCTION phase5_protect_issued_attachment();

GRANT SELECT, INSERT, UPDATE ON "InvoiceTemplateConfig", "InvoiceDelivery", "PublicInvoiceLink" TO clearledger_runtime;
GRANT SELECT, INSERT ON "InvoicePdfArtifact", "InvoiceDeliveryEvent" TO clearledger_runtime;
GRANT SELECT, INSERT ON "InvoiceAttachment" TO clearledger_runtime;
GRANT SELECT ON "LogoAsset" TO clearledger_runtime;
GRANT INSERT, UPDATE ON "LogoAsset" TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['InvoiceTemplateConfig','InvoicePdfArtifact','InvoiceDelivery','InvoiceDeliveryEvent','InvoiceAttachment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())', table_name || '_tenant_policy', table_name);
  END LOOP;
END $$;

ALTER TABLE "PublicInvoiceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PublicInvoiceLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PublicInvoiceLink_tenant_policy" ON "PublicInvoiceLink"
  FOR ALL TO clearledger_runtime
  USING (
    ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    OR (
      current_setting('app.access_mode', true) = 'public_invoice'
      AND "tokenHash" = current_setting('app.public_invoice_token_hash', true)
    )
  )
  WITH CHECK (
    ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    OR (
      current_setting('app.access_mode', true) = 'public_invoice'
      AND "tokenHash" = current_setting('app.public_invoice_token_hash', true)
    )
  );

CREATE POLICY "Invoice_public_policy" ON "Invoice"
  FOR SELECT TO clearledger_runtime
  USING (phase5_public_invoice_access("organizationId", "id"));
CREATE POLICY "InvoiceLine_public_policy" ON "InvoiceLine"
  FOR SELECT TO clearledger_runtime
  USING (phase5_public_invoice_access("organizationId", "invoiceId"));
CREATE POLICY "InvoicePdfArtifact_public_policy" ON "InvoicePdfArtifact"
  FOR SELECT TO clearledger_runtime
  USING (phase5_public_invoice_access("organizationId", "invoiceId"));
CREATE POLICY "InvoiceAttachment_public_policy" ON "InvoiceAttachment"
  FOR SELECT TO clearledger_runtime
  USING ("customerVisible" AND "scanStatus" = 'CLEAN' AND phase5_public_invoice_access("organizationId", "invoiceId"));

CREATE POLICY "AuditEvent_public_invoice_policy" ON "AuditEvent"
  FOR INSERT TO clearledger_runtime
  WITH CHECK (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND "organizationId" = app_current_organization_id()
    AND "actorUserId" IS NULL
  );
