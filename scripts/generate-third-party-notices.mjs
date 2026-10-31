import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

const [inventoryPath, noticePath, licenseRoot] = process.argv.slice(2);
if (!inventoryPath || !noticePath || !licenseRoot)
  throw new Error(
    "Usage: node scripts/generate-third-party-notices.mjs <pnpm-list.json> <notice.md> <licence-dir>"
  );

const roots = JSON.parse((await readFile(inventoryPath, "utf8")).replace(/^\uFEFF/, ""));
if (!Array.isArray(roots)) throw new Error("The dependency inventory must be a JSON array.");
const packages = new Map();
for (const root of roots) collectDependencies(root.dependencies);

await mkdir(licenseRoot, { recursive: true });
const rows = [];
for (const dependency of [...packages.values()].sort(packageOrder)) {
  const packageJson = JSON.parse(await readFile(resolve(dependency.path, "package.json"), "utf8"));
  const version = String(packageJson.version ?? dependency.version ?? "unknown");
  const licence = licenceLabel(packageJson.license);
  const homepage = safeUrl(packageJson.homepage) ?? safeUrl(packageJson.repository?.url) ?? "";
  const copied = [];
  const directoryName = safeDirectoryName(`${dependency.name}@${version}`);
  const packageLicenseDirectory = resolve(licenseRoot, directoryName);
  for (const file of await readdir(dependency.path, { withFileTypes: true })) {
    if (!file.isFile() || !/^(licen[cs]e|copying|notice)(\..*)?$/i.test(file.name)) continue;
    await mkdir(packageLicenseDirectory, { recursive: true });
    await copyFile(
      resolve(dependency.path, file.name),
      resolve(packageLicenseDirectory, file.name)
    );
    copied.push(`${basename(licenseRoot)}/${directoryName}/${file.name}`);
  }
  rows.push({ name: dependency.name, version, licence, homepage, copied });
}

const lines = [
  "# Third-Party Notices",
  "",
  "ClearLedger includes the following production JavaScript dependencies. The corresponding",
  "licence and notice files copied from the installed packages are in `third-party-licenses/`.",
  "Those third-party terms govern their respective components. This inventory does not change",
  "the ClearLedger public-beta licence.",
  "",
  "The runtime images also contain Node.js, Debian, PostgreSQL, and Alpine Linux components.",
  "Their package inventories and licence files remain inside the pinned OCI images and the release",
  "includes the exact image IDs/digests. `ClearLedger-SBOM.cdx.json` is the production npm",
  "CycloneDX inventory.",
  "",
  "| Package | Version | Licence | Project | Included notice files |",
  "| --- | --- | --- | --- | --- |"
];
for (const row of rows) {
  const project = row.homepage ? `[project](${row.homepage})` : "-";
  const notices = row.copied.length ? row.copied.map((path) => `\`${path}\``).join("<br>") : "-";
  lines.push(
    `| ${escapeCell(row.name)} | ${escapeCell(row.version)} | ${escapeCell(row.licence)} | ${project} | ${notices} |`
  );
}
lines.push("");
await writeFile(noticePath, `${lines.join("\n")}\n`, "utf8");

function collectDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== "object") return;
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency || typeof dependency !== "object") continue;
    if (!name.startsWith("@clearledger/") && typeof dependency.path === "string") {
      const key = `${name}\u0000${dependency.version ?? dependency.path}`;
      packages.set(key, { name, version: dependency.version, path: dependency.path });
    }
    collectDependencies(dependency.dependencies);
  }
}

function licenceLabel(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.type === "string") return value.type;
  return "See included package notice";
}

function safeUrl(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/^git\+/, "").replace(/\.git$/, "");
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeDirectoryName(value) {
  const normalized = value.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "__");
  if (normalized.length <= 28) return normalized;
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${normalized.slice(0, 14)}__${digest}`;
}

function packageOrder(left, right) {
  return (
    left.name.localeCompare(right.name) || String(left.version).localeCompare(String(right.version))
  );
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
