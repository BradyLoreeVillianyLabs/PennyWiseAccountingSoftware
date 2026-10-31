import test from "node:test";
import assert from "node:assert/strict";
import { D6_DRILL_IDS, validateEvidence } from "./verify-d6-evidence.mjs";

function evidence(status = "UNVERIFIED") {
  return {
    schemaVersion: 1,
    sourceDataCopied: false,
    sensitiveDataRedacted: true,
    drills: D6_DRILL_IDS.map((id) => ({
      id,
      status,
      evidence: [],
      notes: "Not executed in this environment."
    }))
  };
}

test("D6 evidence validator accepts a complete unverified ledger without claiming a pass", () => {
  assert.deepEqual(validateEvidence(evidence()), { passed: 0, total: D6_DRILL_IDS.length });
});

test("D6 evidence validator requires evidence and operator metadata for PASS", () => {
  const record = evidence();
  record.drills[0] = { id: D6_DRILL_IDS[0], status: "PASS", evidence: [] };
  assert.throws(() => validateEvidence(record), /cannot PASS without evidence references/);
});

test("D6 evidence validator rejects duplicates and secret-like fields", () => {
  const record = evidence();
  record.credentials = "must not be recorded";
  assert.throws(() => validateEvidence(record), /secret-like key/);
  const duplicate = evidence();
  duplicate.drills.push(duplicate.drills[0]);
  assert.throws(() => validateEvidence(duplicate), /duplicated/);
});
