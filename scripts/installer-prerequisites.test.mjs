import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repositoryRoot = join(import.meta.dirname, "..");
const runtimeDirectory = join(repositoryRoot, "distribution", "public-beta", "runtime");

describe("Windows beta prerequisite diagnostics", () => {
  it("is wired into the package and MSI payload contracts", () => {
    const buildScript = readFileSync(
      join(repositoryRoot, "scripts", "build-public-beta.ps1"),
      "utf8"
    );
    const stageVerifier = readFileSync(
      join(repositoryRoot, "scripts", "verify-public-beta-stage.mjs"),
      "utf8"
    );
    const msiBuilder = readFileSync(
      join(repositoryRoot, "scripts", "Build-ClearLedgerMsi.ps1"),
      "utf8"
    );
    for (const source of [buildScript, stageVerifier, msiBuilder])
      assert.match(source, /Test-ClearLedgerPrerequisites\.ps1/);
  });

  it(
    "reports structured, non-secret diagnostics on Windows",
    { skip: process.platform !== "win32" },
    () => {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(runtimeDirectory, "Test-ClearLedgerPrerequisites.ps1"),
          "-Json"
        ],
        { encoding: "utf8" }
      );
      assert.equal(result.error, undefined);
      const report = JSON.parse(result.stdout);
      assert.equal(typeof report.ready, "boolean");
      assert.ok(Array.isArray(report.checks));
      assert.ok(report.checks.some(({ name }) => name === "docker-cli"));
      assert.ok(report.checks.some(({ name }) => name === "verified-manifest"));
      assert.doesNotMatch(result.stdout, /password|secret|token/i);
    }
  );
});
