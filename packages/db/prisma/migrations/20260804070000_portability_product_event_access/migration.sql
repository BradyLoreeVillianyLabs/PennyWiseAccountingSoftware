-- Product events are customer-owned organization records. The original table migration
-- installed tenant RLS but omitted the runtime SELECT grant, making those records
-- invisible to a tenant-scoped full export.
GRANT SELECT ON TABLE "ProductEvent" TO clearledger_runtime;
