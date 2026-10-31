import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const D6_DRILL_IDS = [
  "store-preparation",
  "catalog-import-review",
  "tax-configuration",
  "opening-balance-reconciliation",
  "end-to-end-order-trace",
  "backup-restore",
  "restart",
  "upgrade-over-install",
  "uninstall-preserves-data",
  "refund",
  "short-pick",
  "cancelled-order-after-posting",
  "non-developer-uat",
  "accessibility-acceptance",
  "disposable-machine-runbook"
];

const STATUSES = new Set(["PASS", "FAIL", "NOT_RUN", "UNVERIFIED", "BLOCKED"]);
const SENSITIVE_KEY = /(credential|password|secret|token|api.?key|private.?key|authorization)/i;
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");

export function validateEvidence(record, { requireComplete = false } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw new Error("D6 evidence must be a JSON object.");
  if (record.schemaVersion !== 1) throw new Error("D6 evidence schemaVersion must be 1.");
  if (record.sourceDataCopied !== false)
    throw new Error("D6 evidence must state sourceDataCopied=false.");
  if (record.sensitiveDataRedacted !== true)
    throw new Error("D6 evidence must state sensitiveDataRedacted=true.");
  if (!Array.isArray(record.drills)) throw new Error("D6 evidence drills must be an array.");

  const unexpectedSensitiveKeys = findSensitiveKeys(record);
  if (unexpectedSensitiveKeys.length > 0)
    throw new Error(`D6 evidence contains a secret-like key: ${unexpectedSensitiveKeys[0]}.`);

  const byId = new Map();
  for (const drill of record.drills) {
    if (!drill || typeof drill !== "object" || Array.isArray(drill))
      throw new Error("Every D6 drill entry must be an object.");
    if (typeof drill.id !== "string" || !D6_DRILL_IDS.includes(drill.id))
      throw new Error(`Unknown D6 drill id: ${String(drill.id)}.`);
    if (byId.has(drill.id)) throw new Error(`D6 drill is duplicated: ${drill.id}.`);
    if (typeof drill.status !== "string" || !STATUSES.has(drill.status))
      throw new Error(`D6 drill ${drill.id} has an invalid status.`);
    if (!Array.isArray(drill.evidence))
      throw new Error(`D6 drill ${drill.id} evidence must be an array.`);
    if (drill.status === "PASS") {
      if (drill.evidence.length === 0)
        throw new Error(`D6 drill ${drill.id} cannot PASS without evidence references.`);
      for (const field of ["observedAt", "operator", "environment"]) {
        if (typeof drill[field] !== "string" || drill[field].trim() === "")
          throw new Error(`D6 drill ${drill.id} cannot PASS without ${field}.`);
      }
    }
    if (drill.status === "FAIL" && (typeof drill.failure !== "string" || !drill.failure.trim()))
      throw new Error(`D6 drill ${drill.id} must record its failure.`);
    byId.set(drill.id, drill);
  }

  const missing = D6_DRILL_IDS.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`D6 evidence is missing: ${missing.join(", ")}.`);
  const passed = D6_DRILL_IDS.filter((id) => byId.get(id).status === "PASS").length;
  if (requireComplete && passed !== D6_DRILL_IDS.length)
    throw new Error(`D6 evidence is not complete: ${passed}/${D6_DRILL_IDS.length} drills PASS.`);
  return { passed, total: D6_DRILL_IDS.length };
}

function findSensitiveKeys(value, path = "root") {
  if (!value || typeof value !== "object") return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SENSITIVE_KEY.test(key)) found.push(childPath);
    else found.push(...findSensitiveKeys(child, childPath));
  }
  return found;
}

async function main() {
  const evidencePath = resolve(
    repoRoot,
    process.argv[2] ?? process.env.D6_EVIDENCE_PATH ?? "docs/status/D6_DRILL_EVIDENCE_TEMPLATE.json"
  );
  const record = JSON.parse(await readFile(evidencePath, "utf8"));
  const result = validateEvidence(record, {
    requireComplete: process.argv.includes("--require-complete")
  });
  console.log(
    `D6 evidence ledger is structurally valid: ${result.passed}/${result.total} drills currently PASS. ` +
      "This command does not turn UNVERIFIED or NOT_RUN drills into passes."
  );
}

if (resolve(process.argv[1] ?? "") === scriptPath) await main();
