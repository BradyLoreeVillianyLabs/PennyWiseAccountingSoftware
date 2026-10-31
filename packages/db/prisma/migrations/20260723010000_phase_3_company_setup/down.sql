DROP TABLE IF EXISTS "LogoAsset", "BusinessDefaults", "OpeningBalanceLine", "OpeningBalanceDraft",
  "TaxComponent", "TaxCodeVersion", "TaxCode", "TaxRegistration", "AppliedAccountPreset",
  "SetupStepState", "OrganizationSettings" CASCADE;
DROP FUNCTION IF EXISTS protect_opening_balance_history(), protect_organization_accounting_settings(), prevent_phase3_history_mutation(), phase3_verify_tenant_references();
DROP INDEX IF EXISTS "Account_organizationId_systemPurpose_key";
ALTER TABLE "Account" DROP COLUMN IF EXISTS "systemPurpose", DROP COLUMN IF EXISTS "normalBalance",
  DROP COLUMN IF EXISTS "presetKey", DROP COLUMN IF EXISTS "presetVersion";
DROP TYPE IF EXISTS "LogoScanStatus", "TaxCalculationMode", "TaxTreatment", "OpeningBalanceStatus",
  "SetupStepStatus", "SetupStep", "NormalBalance";
