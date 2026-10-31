-- Product events are immutable, tenant-scoped telemetry records. The original
-- table policy permitted runtime writes but its later export grant only included
-- SELECT, which prevented a consented event from being recorded.
GRANT INSERT ON TABLE "ProductEvent" TO clearledger_runtime;
