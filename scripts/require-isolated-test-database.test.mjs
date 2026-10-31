import assert from "node:assert/strict";
import test from "node:test";
import { requireIsolatedTestDatabase } from "./require-isolated-test-database.mjs";

test("requires an explicit disposable test database", () => {
  assert.throws(() => requireIsolatedTestDatabase("Integration tests", {}), /TEST_DATABASE_URL/);
  assert.equal(
    requireIsolatedTestDatabase("Integration tests", {
      TEST_DATABASE_URL:
        "postgresql://clearledger:clearledger_dev_only@127.0.0.1:5433/clearledger_test?schema=public"
    }),
    "postgresql://clearledger:clearledger_dev_only@127.0.0.1:5433/clearledger_test?schema=public"
  );
});

test("refuses the PennyWise beta deployment database", () => {
  assert.throws(
    () =>
      requireIsolatedTestDatabase("Browser tests", {
        TEST_DATABASE_URL:
          "postgresql://clearledger:clearledger_dev_only@127.0.0.1:55432/clearledger?schema=public"
      }),
    /PennyWise beta database/
  );
});

test("requires a disposable name unless isolated CI explicitly opts in", () => {
  const environment = {
    TEST_DATABASE_URL:
      "postgresql://clearledger:clearledger_dev_only@127.0.0.1:5433/ci_ephemeral?schema=public"
  };
  assert.throws(() => requireIsolatedTestDatabase("Performance tests", environment), /disposable/);
  assert.equal(
    requireIsolatedTestDatabase("Performance tests", {
      ...environment,
      CLEARLEDGER_ALLOW_NONSTANDARD_TEST_DATABASE: "1"
    }),
    environment.TEST_DATABASE_URL
  );
});
