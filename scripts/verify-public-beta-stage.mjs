import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

const [stageArgument, expectedVersion, expectedVerification = "verified"] = process.argv.slice(2);
if (
  !stageArgument ||
  !expectedVersion ||
  !["verified", "unverified"].includes(expectedVerification)
)
  throw new Error(
    "Usage: node scripts/verify-public-beta-stage.mjs <stage> <version> <verified|unverified>"
  );

const stageRoot = resolve(stageArgument);
const stageStat = await stat(stageRoot);
if (!stageStat.isDirectory()) throw new Error("The public-beta stage is not a directory.");

const requiredFiles = [
  "BETA_LICENSE.txt",
  "BACKUP_AND_RECOVERY.md",
  "Backup-ClearLedger.ps1",
  "CAD_USD_OPERATOR_GUIDE.md",
  "ClearLedger-SBOM.cdx.json",
  "Compose-Compatibility.ps1",
  "Diagnose-ClearLedger.ps1",
  "INSTALL_WINDOWS.md",
  "KNOWN_LIMITATIONS.md",
  "PRIVACY_AND_DATA.md",
  "RELEASE_EVIDENCE.md",
  "Restore-ClearLedger.ps1",
  "SECURITY_AND_SUPPORT.md",
  "SECURITY_AND_COMPLIANCE.md",
  "SHA256SUMS.txt",
  "Share-ClearLedger.ps1",
  "Start-ClearLedger.ps1",
  "Test-ClearLedgerPrerequisites.ps1",
  "Stop-ClearLedger.ps1",
  "Stop-ClearLedgerShare.ps1",
  "THIRD_PARTY_NOTICES.md",
  "Uninstall-ClearLedger.ps1",
  "USER_ACCEPTANCE_SCRIPTS.md",
  "Update-ClearLedger.ps1",
  "clearledger-public-beta-image.tar",
  "compose.share.yaml",
  "compose.yaml",
  "container-package-inventory.txt",
  "release-manifest.json",
  "runtime-image-inspect.json"
];
const allowedTopLevelEntries = new Set([...requiredFiles, "third-party-licenses"]);
const forbiddenBasenames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".license-accepted",
  ".share-state.json",
  "beta.env",
  "beta.env.recovery",
  "pnpm-production-dependencies.json"
]);
const forbiddenExtensions = new Set([
  ".db",
  ".key",
  ".log",
  ".map",
  ".p12",
  ".pem",
  ".pfx",
  ".sqlite",
  ".sqlite3",
  ".ts",
  ".tsbuildinfo",
  ".tsx"
]);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".txt",
  ".webmanifest",
  ".yaml",
  ".yml"
]);

const files = await collectFiles(stageRoot);
const byRelativePath = new Map();
const caseInsensitivePaths = new Map();
for (const file of files) {
  const relativePath = portableRelative(file);
  validateRelativePath(relativePath);
  const pathParts = relativePath.split("/");
  if (!allowedTopLevelEntries.has(pathParts[0]))
    throw new Error(`Unexpected top-level public-beta entry: ${pathParts[0]}`);
  if (
    pathParts.some((part) =>
      ["backups", "restore-staging"].includes(part.toLocaleLowerCase("en-CA"))
    )
  )
    throw new Error(`Mutable runtime data must not be staged: ${relativePath}`);
  if (byRelativePath.has(relativePath)) throw new Error(`Duplicate staged path: ${relativePath}`);
  const caseFolded = relativePath.toLocaleLowerCase("en-CA");
  const collision = caseInsensitivePaths.get(caseFolded);
  if (collision && collision !== relativePath)
    throw new Error(`Case-insensitive path collision: ${collision} and ${relativePath}`);
  byRelativePath.set(relativePath, file);
  caseInsensitivePaths.set(caseFolded, relativePath);

  const fileBasename = basename(relativePath).toLocaleLowerCase("en-CA");
  const extension = fileBasename.includes(".")
    ? fileBasename.slice(fileBasename.lastIndexOf("."))
    : "";
  if (forbiddenBasenames.has(fileBasename) || forbiddenExtensions.has(extension))
    throw new Error(`Forbidden public-beta file: ${relativePath}`);
  if (relativePath.split("/").some((part) => part.toLocaleLowerCase("en-CA") === "node_modules"))
    throw new Error(`Unpacked dependency tree must not be staged: ${relativePath}`);
}
for (const required of requiredFiles) {
  if (!byRelativePath.has(required))
    throw new Error(`Required public-beta file is missing: ${required}`);
}

const manifest = JSON.parse(await readFile(byRelativePath.get("release-manifest.json"), "utf8"));
const createdAt = new Date(manifest.createdAt);
if (
  manifest.product !== "ClearLedger Public Beta" ||
  manifest.version !== expectedVersion ||
  manifest.image !== `clearledger/public-beta:${expectedVersion}` ||
  manifest.sourceReduced !== true ||
  manifest.localBinding !== "127.0.0.1:3000" ||
  manifest.localPortConfigurable !== true ||
  manifest.verificationSkipped !== (expectedVerification === "unverified") ||
  manifest.evidenceState !==
    (expectedVerification === "verified"
      ? "verified-package-assembly"
      : "unverified-development-artifact") ||
  manifest.artifactName !==
    `ClearLedger-Public-Beta-${expectedVersion}${
      expectedVerification === "verified" ? "" : "-UNVERIFIED-DO-NOT-DISTRIBUTE"
    }.zip` ||
  manifest.archiveFormat !== "zip-with-docker-image-v1" ||
  typeof manifest.createdAt !== "string" ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(manifest.createdAt) ||
  Number.isNaN(createdAt.valueOf()) ||
  manifest.postgresImage !==
    "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193" ||
  !/^sha256:[a-f0-9]{64}$/.test(manifest.imageId) ||
  !isSha256(manifest.imageArchiveSha256) ||
  !isSha256(manifest.sbomSha256) ||
  !isSha256(manifest.sourceInputSha256) ||
  !isSha256(manifest.gateInputSha256) ||
  !isSha256(manifest.migrationSetSha256) ||
  !Number.isSafeInteger(manifest.sourceInputFileCount) ||
  manifest.sourceInputFileCount < 1 ||
  !Number.isSafeInteger(manifest.gateInputFileCount) ||
  manifest.gateInputFileCount < manifest.sourceInputFileCount ||
  !Number.isSafeInteger(manifest.migrationCount) ||
  manifest.migrationCount < 1
)
  throw new Error("The public-beta release manifest is incomplete or inconsistent.");

const releaseEvidence = await readFile(byRelativePath.get("RELEASE_EVIDENCE.md"), "utf8");
const knownLimitations = await readFile(byRelativePath.get("KNOWN_LIMITATIONS.md"), "utf8");
const edmontonDateParts = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(createdAt)
    .filter(({ type }) => ["year", "month", "day"].includes(type))
    .map(({ type, value }) => [type, value])
);
const expectedEvidenceDate = `${edmontonDateParts.year}-${edmontonDateParts.month}-${edmontonDateParts.day}`;
const evidenceDateHeaders = [
  ...releaseEvidence.matchAll(/^Evidence date: (\d{4}-\d{2}-\d{2}) \(America\/Edmonton\)[ \t]*$/gm)
];
if (evidenceDateHeaders.length !== 1 || evidenceDateHeaders[0][1] !== expectedEvidenceDate)
  throw new Error("RELEASE_EVIDENCE.md does not identify the manifest creation date exactly once.");
if (!releaseEvidence.includes(`Packaged version: \`${expectedVersion}\``))
  throw new Error("RELEASE_EVIDENCE.md identifies another packaged version.");
if (expectedVerification === "verified") {
  if (
    !releaseEvidence.includes("Evidence status: verified package assembly") ||
    !releaseEvidence.includes("packaged inside a verified archive payload") ||
    releaseEvidence.includes("The final ZIP does not yet exist") ||
    /final post-merge (?:browser )?run must/i.test(`${releaseEvidence}\n${knownLimitations}`) ||
    /UNVERIFIED developer artifact/i.test(releaseEvidence)
  )
    throw new Error("RELEASE_EVIDENCE.md does not identify a verified packaged payload honestly.");
} else if (
  !releaseEvidence.includes("Evidence status: UNVERIFIED developer artifact") ||
  !releaseEvidence.includes("This UNVERIFIED developer artifact was assembled") ||
  releaseEvidence.includes("packaged inside a verified archive payload")
) {
  throw new Error(
    "RELEASE_EVIDENCE.md does not identify an unverified developer artifact honestly."
  );
}

const imageHash = await sha256File(byRelativePath.get("clearledger-public-beta-image.tar"));
if (imageHash !== manifest.imageArchiveSha256)
  throw new Error("The staged runtime image does not match release-manifest.json.");
const sbomHash = await sha256File(byRelativePath.get("ClearLedger-SBOM.cdx.json"));
if (sbomHash !== manifest.sbomSha256)
  throw new Error("The staged SBOM does not match release-manifest.json.");
const sbom = JSON.parse(await readFile(byRelativePath.get("ClearLedger-SBOM.cdx.json"), "utf8"));
if (
  sbom.bomFormat !== "CycloneDX" ||
  sbom.specVersion !== "1.5" ||
  sbom.metadata?.component?.name !== "ClearLedger Public Beta" ||
  sbom.metadata?.component?.version !== expectedVersion ||
  !Array.isArray(sbom.components) ||
  sbom.components.length < 1
)
  throw new Error("The staged CycloneDX SBOM is incomplete or identifies another release.");

const checksumLines = (await readFile(byRelativePath.get("SHA256SUMS.txt"), "utf8"))
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .filter(Boolean);
const checksums = new Map();
for (const line of checksumLines) {
  const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
  if (!match) throw new Error(`Malformed SHA256SUMS entry: ${line}`);
  const [, hash, relativePath] = match;
  validateRelativePath(relativePath);
  if (checksums.has(relativePath)) throw new Error(`Duplicate checksum path: ${relativePath}`);
  checksums.set(relativePath, hash);
}
const expectedChecksumPaths = [...byRelativePath.keys()]
  .filter((path) => path !== "SHA256SUMS.txt")
  .sort();
if (checksums.size !== expectedChecksumPaths.length)
  throw new Error("SHA256SUMS.txt does not contain exactly one entry for every staged file.");
for (const relativePath of expectedChecksumPaths) {
  const expectedHash = checksums.get(relativePath);
  if (!expectedHash) throw new Error(`SHA256SUMS.txt is missing ${relativePath}.`);
  const actualHash = await sha256File(byRelativePath.get(relativePath));
  if (actualHash !== expectedHash) throw new Error(`SHA-256 mismatch for ${relativePath}.`);
}

for (const [relativePath, absolutePath] of byRelativePath) {
  const lower = relativePath.toLocaleLowerCase("en-CA");
  const extension = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if (!textExtensions.has(extension)) continue;
  const fileStat = await stat(absolutePath);
  if (fileStat.size > 20 * 1024 * 1024)
    throw new Error(`Unexpectedly large text artifact requires review: ${relativePath}`);
  const text = await readFile(absolutePath, "utf8");
  if (/[A-Za-z]:\\Users\\[^\\\r\n]+\\/i.test(text) || /\/(?:Users|home)\/[^/\r\n]+\//.test(text))
    throw new Error(`Host-specific user path leaked into ${relativePath}.`);
  if (/V1\.VsStudioAccountingSoftwareBuild|QB Bridge VS Code|qb\W*woo\W*bridge/i.test(text))
    throw new Error(`Unrelated workspace identity leaked into ${relativePath}.`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    throw new Error(`A private-key marker was found in ${relativePath}.`);
  if (!relativePath.startsWith("third-party-licenses/") && containsHighConfidenceSecret(text))
    throw new Error(`A credential-like value requires security review in ${relativePath}.`);
  if (
    !relativePath.startsWith("third-party-licenses/") &&
    /[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo)\.[A-Z]{2,}/i.test(text)
  )
    throw new Error(`A consumer email address requires privacy review in ${relativePath}.`);
}

console.log(
  `Public-beta stage verified (${String(files.length)} files, ${manifest.migrationCount} migrations, ${expectedVerification}).`
);

async function collectFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Symbolic links are not permitted: ${portableRelative(absolutePath)}`);
    if (entry.isDirectory()) result.push(...(await collectFiles(absolutePath)));
    else if (entry.isFile()) result.push(absolutePath);
    else throw new Error(`Unsupported staged filesystem entry: ${portableRelative(absolutePath)}`);
  }
  return result;
}

function portableRelative(absolutePath) {
  return relative(stageRoot, absolutePath).split(sep).join("/");
}

function validateRelativePath(value) {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Unsafe staged relative path: ${value}`);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function containsHighConfidenceSecret(text) {
  return [
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
    /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
    /https?:\/\/[^/\s:@]+:[^/\s@]+@/i
  ].some((pattern) => pattern.test(text));
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolveHash);
    stream.once("error", rejectHash);
  });
  return hash.digest("hex");
}
