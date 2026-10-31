import assert from "node:assert/strict";
import test from "node:test";
import { catalogKeys, t } from "./strings.js";

test("invoice strings are present and ready for incremental translation", () => {
  assert.equal(t("invoice.title"), "New invoice");
  assert.equal(
    t("invoice.draftCreated"),
    "Draft created. Review the exact customer preview before posting or sending it."
  );
  assert.equal(t("missing.key"), "missing.key");
  assert.ok(catalogKeys().includes("invoice.addCustomer"));
});
