import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baselinePath = fileURLToPath(new URL("./fixtures/axe-baseline.json", import.meta.url));

type Fingerprint = {
  state: string;
  rule: string;
  impact: string;
  targets: string[];
};

export async function scanState(page: Page, testInfo: TestInfo, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`axe-${state}.json`, {
    body: Buffer.from(JSON.stringify(result, null, 2)),
    contentType: "application/json"
  });
  return result.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      state,
      rule: violation.id,
      impact: violation.impact ?? "minor",
      targets: node.target.map((target) => String(target))
    }))
  );
}

export function compareAxeBaseline(fingerprints: Fingerprint[]) {
  const baseline = readBaseline();
  if (process.env.AXE_UPDATE_BASELINE === "true") {
    const merged = new Map(baseline.map((entry) => [fingerprintKey(entry), entry]));
    for (const entry of fingerprints) merged.set(fingerprintKey(entry), entry);
    writeFileSync(baselinePath, `${JSON.stringify([...merged.values()].sort(compare), null, 2)}\n`);
    return {
      baselineUpdated: true,
      newSeriousOrCritical: [] as Fingerprint[],
      lowerImpactNew: [] as Fingerprint[]
    };
  }

  const known = new Set(baseline.map(fingerprintKey));
  const newFingerprints = fingerprints.filter((entry) => !known.has(fingerprintKey(entry)));
  const newSeriousOrCritical = newFingerprints.filter((entry) =>
    ["serious", "critical"].includes(entry.impact)
  );
  return {
    baselineUpdated: false,
    newSeriousOrCritical,
    lowerImpactNew: newFingerprints.filter((entry) => !newSeriousOrCritical.includes(entry))
  };
}

export function assertNoNewSeriousOrCritical(fingerprints: Fingerprint[]) {
  const comparison = compareAxeBaseline(fingerprints);
  expect(comparison.newSeriousOrCritical, JSON.stringify(comparison.newSeriousOrCritical)).toEqual(
    []
  );
  return comparison;
}

function readBaseline(): Fingerprint[] {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")) as Fingerprint[];
  } catch (error) {
    throw new Error(
      `The axe baseline is missing at ${resolve(baselinePath)}. Run this spec once with AXE_UPDATE_BASELINE=true.`,
      { cause: error }
    );
  }
}

function fingerprintKey(entry: Fingerprint) {
  return JSON.stringify([entry.state, entry.rule, entry.impact, [...entry.targets].sort()]);
}

function compare(left: Fingerprint, right: Fingerprint) {
  return fingerprintKey(left).localeCompare(fingerprintKey(right));
}

export function ensureEvidenceDirectory(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}
