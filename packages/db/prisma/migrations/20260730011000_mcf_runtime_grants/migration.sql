-- The journal trigger and Prisma relation writes can touch revaluation runs
-- while posting any journal. Keep this grant explicit and tenant-scoped.
GRANT SELECT, INSERT, UPDATE ON TABLE "FxRevaluationRun" TO clearledger_runtime;
