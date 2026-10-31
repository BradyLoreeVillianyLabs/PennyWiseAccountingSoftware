import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createRequire } from "node:module";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const issuer = join(scriptDirectory, "pennywise-beta-activation.mjs");
const require = createRequire(import.meta.url);
const activation = require("../distribution/windows-native/offline-activation.cjs");

test("offline beta issuer creates one device-bound activation and rejects a duplicate slot", async () => {
  const root = await mkdtemp(join(tmpdir(), "pennywise-beta-issuer-test-"));
  const privateKey = join(root, "issuer-private.pem");
  const publicKey = join(root, "issuer-public.pem");
  const ledger = join(root, "issued-slots.json");
  const activationFile = join(root, "slot-01.activation.json");
  const installId = "2f44f5d5-82f3-45a7-b401-f0aa13e11111";
  try {
    run("generate-key", "--private-key", privateKey, "--public-key", publicKey);
    run(
      "issue",
      "--private-key",
      privateKey,
      "--ledger",
      ledger,
      "--install-id",
      installId,
      "--slot",
      "1",
      "--out",
      activationFile
    );

    const envelope = JSON.parse(await readFile(activationFile, "utf8"));
    const verification = activation.verifyLicenseEnvelope({
      envelope,
      publicKey: await readFile(publicKey, "utf8"),
      installId,
      requiredEdition: activation.BETA20_EDITION
    });
    assert.equal(verification.valid, true);
    assert.equal(verification.claims.slot, 1);

    assert.throws(
      () =>
        run(
          "issue",
          "--private-key",
          privateKey,
          "--ledger",
          ledger,
          "--install-id",
          "3f44f5d5-82f3-45a7-b401-f0aa13e11111",
          "--slot",
          "1",
          "--out",
          join(root, "duplicate.activation.json")
        ),
      /already issued/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function run(...args) {
  return execFileSync(process.execPath, [issuer, ...args], { encoding: "utf8", stdio: "pipe" });
}
