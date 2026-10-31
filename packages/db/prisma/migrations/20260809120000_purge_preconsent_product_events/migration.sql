-- Record the post-cutover data classification in PostgreSQL for operational
-- database administrators. The actual pre-consent purge occurs immediately
-- before forced RLS is enabled in the preceding scope-change migration.
COMMENT ON TABLE "ProductEvent" IS
  'Optional privacy-minimized organization telemetry. Server-enforced organization consent is required; it is not accounting evidence.';
