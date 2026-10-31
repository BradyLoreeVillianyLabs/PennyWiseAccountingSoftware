-- D5: operator-owned carrier accounts, idempotent shipments, labels, tracking,
-- and carrier-governed void attempts. Postage is never held by PennyWise.

CREATE TYPE "CarrierEnvironment" AS ENUM ('TEST', 'PRODUCTION');
CREATE TYPE "CarrierAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'QUOTED', 'PURCHASING', 'PURCHASE_UNKNOWN', 'PURCHASED', 'PURCHASED_EXPENSE_PENDING', 'VOID_PENDING', 'VOIDED', 'VOID_REJECTED', 'FAILED');
CREATE TYPE "ShipmentLabelFormat" AS ENUM ('PDF', 'ZPL');
CREATE TYPE "ShipmentVoidStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN');

CREATE TABLE "CarrierAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "carrierKey" VARCHAR(80) NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "environment" "CarrierEnvironment" NOT NULL,
  "externalAccountId" VARCHAR(160),
  "credentialCiphertext" TEXT,
  "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "CarrierAccountStatus" NOT NULL DEFAULT 'INACTIVE',
  "defaultLabelFormat" "ShipmentLabelFormat" NOT NULL DEFAULT 'PDF',
  "defaultLabelWidthMm" INTEGER NOT NULL DEFAULT 101,
  "defaultLabelHeightMm" INTEGER NOT NULL DEFAULT 152,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CarrierAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CarrierAccount_version_check" CHECK ("credentialVersion" > 0),
  CONSTRAINT "CarrierAccount_label_size_check" CHECK ("defaultLabelWidthMm" > 0 AND "defaultLabelHeightMm" > 0)
);
ALTER TABLE "CarrierAccount" ADD CONSTRAINT "CarrierAccount_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "CarrierAccount_organizationId_id_key" ON "CarrierAccount"("organizationId", "id");
CREATE UNIQUE INDEX "CarrierAccount_organizationId_carrierKey_environment_key"
  ON "CarrierAccount"("organizationId", "carrierKey", "environment");
CREATE INDEX "CarrierAccount_organizationId_carrierKey_status_idx"
  ON "CarrierAccount"("organizationId", "carrierKey", "status");
ALTER TABLE "CarrierAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CarrierAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CarrierAccount_tenant_policy" ON "CarrierAccount" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT, UPDATE ON "CarrierAccount" TO clearledger_runtime;

CREATE TABLE "Shipment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "carrierAccountId" UUID NOT NULL,
  "sourceInvoiceId" UUID,
  "sourceSaleId" UUID,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
  "purchaseIdempotencyKey" VARCHAR(220) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "serviceCode" VARCHAR(80),
  "serviceName" VARCHAR(160),
  "quotedCostMinor" BIGINT,
  "quotedCurrency" CHAR(3),
  "purchasedCostMinor" BIGINT,
  "purchasedCurrency" CHAR(3),
  "providerShipmentId" VARCHAR(160),
  "trackingNumber" VARCHAR(160),
  "originAddress" JSONB NOT NULL,
  "destinationAddress" JSONB NOT NULL,
  "customsDeclaration" JSONB,
  "shippingExpenseId" UUID,
  "reconcileRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastProviderCode" VARCHAR(120),
  "lastErrorMessage" VARCHAR(500),
  "lastProviderCheckAt" TIMESTAMPTZ(6),
  "purchasedAt" TIMESTAMPTZ(6),
  "voidedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Shipment_version_check" CHECK ("version" > 0),
  CONSTRAINT "Shipment_source_check" CHECK (("sourceInvoiceId" IS NOT NULL)::integer + ("sourceSaleId" IS NOT NULL)::integer = 1)
);
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrierAccount_fkey"
  FOREIGN KEY ("carrierAccountId") REFERENCES "CarrierAccount"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "Shipment_purchaseIdempotencyKey_key" ON "Shipment"("purchaseIdempotencyKey");
CREATE UNIQUE INDEX "Shipment_shippingExpenseId_key" ON "Shipment"("shippingExpenseId");
CREATE UNIQUE INDEX "Shipment_organizationId_id_key" ON "Shipment"("organizationId", "id");
CREATE INDEX "Shipment_organizationId_status_createdAt_idx" ON "Shipment"("organizationId", "status", "createdAt");
CREATE INDEX "Shipment_organizationId_sourceInvoiceId_idx" ON "Shipment"("organizationId", "sourceInvoiceId");
CREATE INDEX "Shipment_organizationId_sourceSaleId_idx" ON "Shipment"("organizationId", "sourceSaleId");
CREATE INDEX "Shipment_organizationId_trackingNumber_idx" ON "Shipment"("organizationId", "trackingNumber");
ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shipment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Shipment_tenant_policy" ON "Shipment" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT, UPDATE ON "Shipment" TO clearledger_runtime;

CREATE TABLE "ShipmentParcel" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "parcelNumber" INTEGER NOT NULL,
  "weightGrams" INTEGER NOT NULL,
  "lengthMm" INTEGER NOT NULL,
  "widthMm" INTEGER NOT NULL,
  "heightMm" INTEGER NOT NULL,
  "packageType" VARCHAR(80),
  "labelFormat" "ShipmentLabelFormat" NOT NULL,
  "declaredValueMinor" BIGINT,
  "declaredCurrency" CHAR(3),
  "customsLines" JSONB,
  "providerParcelId" VARCHAR(160),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentParcel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShipmentParcel_dimensions_check" CHECK ("parcelNumber" > 0 AND "weightGrams" > 0 AND "lengthMm" > 0 AND "widthMm" > 0 AND "heightMm" > 0)
);
ALTER TABLE "ShipmentParcel" ADD CONSTRAINT "ShipmentParcel_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ShipmentParcel" ADD CONSTRAINT "ShipmentParcel_shipment_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "ShipmentParcel_shipmentId_parcelNumber_key" ON "ShipmentParcel"("shipmentId", "parcelNumber");
CREATE UNIQUE INDEX "ShipmentParcel_organizationId_id_key" ON "ShipmentParcel"("organizationId", "id");
CREATE INDEX "ShipmentParcel_organizationId_shipmentId_idx" ON "ShipmentParcel"("organizationId", "shipmentId");
ALTER TABLE "ShipmentParcel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShipmentParcel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ShipmentParcel_tenant_policy" ON "ShipmentParcel" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT, UPDATE ON "ShipmentParcel" TO clearledger_runtime;

CREATE TABLE "ShipmentLabel" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "parcelId" UUID,
  "format" "ShipmentLabelFormat" NOT NULL,
  "mediaType" VARCHAR(100) NOT NULL,
  "storageKey" VARCHAR(300) NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "providerLabelId" VARCHAR(160),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentLabel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShipmentLabel_file_check" CHECK ("byteSize" > 0 AND "contentHash" ~ '^[0-9a-fA-F]{64}$')
);
ALTER TABLE "ShipmentLabel" ADD CONSTRAINT "ShipmentLabel_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ShipmentLabel" ADD CONSTRAINT "ShipmentLabel_shipment_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE;
ALTER TABLE "ShipmentLabel" ADD CONSTRAINT "ShipmentLabel_parcel_fkey"
  FOREIGN KEY ("parcelId") REFERENCES "ShipmentParcel"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "ShipmentLabel_organizationId_storageKey_key" ON "ShipmentLabel"("organizationId", "storageKey");
CREATE UNIQUE INDEX "ShipmentLabel_organizationId_id_key" ON "ShipmentLabel"("organizationId", "id");
CREATE INDEX "ShipmentLabel_organizationId_shipmentId_createdAt_idx" ON "ShipmentLabel"("organizationId", "shipmentId", "createdAt");
ALTER TABLE "ShipmentLabel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShipmentLabel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ShipmentLabel_tenant_policy" ON "ShipmentLabel" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT ON "ShipmentLabel" TO clearledger_runtime;

CREATE TABLE "TrackingEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "externalEventId" VARCHAR(160),
  "eventHash" CHAR(64) NOT NULL,
  "status" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "location" VARCHAR(200),
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrackingEvent_hash_check" CHECK ("eventHash" ~ '^[0-9a-fA-F]{64}$')
);
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_shipment_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "TrackingEvent_shipmentId_eventHash_key" ON "TrackingEvent"("shipmentId", "eventHash");
CREATE UNIQUE INDEX "TrackingEvent_organizationId_id_key" ON "TrackingEvent"("organizationId", "id");
CREATE INDEX "TrackingEvent_organizationId_shipmentId_occurredAt_idx" ON "TrackingEvent"("organizationId", "shipmentId", "occurredAt");
ALTER TABLE "TrackingEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrackingEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TrackingEvent_tenant_policy" ON "TrackingEvent" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT ON "TrackingEvent" TO clearledger_runtime;

CREATE TABLE "ShipmentVoidAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "status" "ShipmentVoidStatus" NOT NULL,
  "providerCode" VARCHAR(120),
  "responseMessage" VARCHAR(500),
  "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  CONSTRAINT "ShipmentVoidAttempt_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ShipmentVoidAttempt" ADD CONSTRAINT "ShipmentVoidAttempt_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ShipmentVoidAttempt" ADD CONSTRAINT "ShipmentVoidAttempt_shipment_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "ShipmentVoidAttempt_organizationId_id_key" ON "ShipmentVoidAttempt"("organizationId", "id");
CREATE INDEX "ShipmentVoidAttempt_organizationId_shipmentId_attemptedAt_idx" ON "ShipmentVoidAttempt"("organizationId", "shipmentId", "attemptedAt");
ALTER TABLE "ShipmentVoidAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShipmentVoidAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ShipmentVoidAttempt_tenant_policy" ON "ShipmentVoidAttempt" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT ON "ShipmentVoidAttempt" TO clearledger_runtime;
