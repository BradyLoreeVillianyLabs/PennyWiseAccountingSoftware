ALTER TABLE "WorkflowPreferences"
  DROP CONSTRAINT "WorkflowPreferences_profileKey_check";

ALTER TABLE "WorkflowPreferences"
  ADD CONSTRAINT "WorkflowPreferences_profileKey_check"
  CHECK (
    "profileKey" IN (
      'INVOICING_ONLY',
      'SOLO_SERVICE',
      'PROJECT_TRADES',
      'BOOKKEEPER_MANAGED',
      'PRODUCT_OPERATIONS'
    )
  );
