import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Usage: node scripts/generate-cyclonedx-sbom.mjs <output.json>");

const input = await readStandardInput();
const roots = JSON.parse(input.replace(/^\uFEFF/, ""));
if (!Array.isArray(roots)) throw new Error("pnpm dependency inventory must be a JSON array.");

const componentMap = new Map();
const edgeMap = new Map();
const applicationDependencies = new Set();
for (const root of roots) {
  const dependencies =
    root?.dependencies && typeof root.dependencies === "object"
      ? Object.entries(root.dependencies)
      : [];
  for (const [dependencyName, dependency] of dependencies) {
    const childRef = visitPackage(
      dependency && typeof dependency === "object"
        ? { name: dependencyName, ...dependency }
        : dependency,
      false
    );
    if (childRef) applicationDependencies.add(childRef);
  }
}

const components = [...componentMap.values()].sort((left, right) =>
  left["bom-ref"].localeCompare(right["bom-ref"])
);
const clearLedgerPackage = JSON.parse(
  await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
);
const applicationRef = packageReference("clearledger", String(clearLedgerPackage.version));
edgeMap.set(applicationRef, applicationDependencies);
const dependencies = [...edgeMap.entries()]
  .map(([ref, children]) => ({ ref, dependsOn: [...children].sort() }))
  .sort((left, right) => left.ref.localeCompare(right.ref));
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ components, dependencies }))
  .digest("hex");
const serial = deterministicUuid(fingerprint);

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serial}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {
          type: "application",
          name: "ClearLedger dependency inventory generator",
          version: "1"
        }
      ]
    },
    component: {
      type: "application",
      name: "ClearLedger Public Beta",
      version: String(clearLedgerPackage.version),
      "bom-ref": applicationRef,
      purl: applicationRef
    },
    properties: [
      { name: "clearledger:inventory-source", value: "pnpm list --prod --json --depth Infinity" },
      { name: "clearledger:inventory-sha256", value: fingerprint }
    ]
  },
  components,
  dependencies
};

await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, "utf8");

function visitPackage(node, workspaceRoot = false) {
  if (!node || typeof node !== "object") return null;
  const name = typeof node.name === "string" ? node.name : null;
  const packageMetadata = installedPackageMetadata(node.path);
  const version =
    typeof node.version === "string" && !node.version.startsWith("link:")
      ? node.version
      : (packageMetadata?.version ?? null);
  const ref = name && version ? packageReference(name, version) : null;
  if (ref && !workspaceRoot) {
    const component = {
      type: "library",
      ...(name.startsWith("@") && name.includes("/")
        ? { group: name.slice(1).split("/")[0], name: name.split("/").slice(1).join("/") }
        : { name }),
      version,
      "bom-ref": ref,
      purl: ref
    };
    const licence = packageMetadata?.license ?? null;
    if (licence) component.licenses = [{ license: { id: licence } }];
    componentMap.set(ref, component);
  }

  const dependencies =
    node.dependencies && typeof node.dependencies === "object"
      ? Object.entries(node.dependencies)
      : [];
  const children = new Set();
  for (const [dependencyName, dependency] of dependencies) {
    const childRef = visitPackage(
      dependency && typeof dependency === "object"
        ? { name: dependencyName, ...dependency }
        : dependency,
      false
    );
    if (childRef) children.add(childRef);
  }
  if (ref && !workspaceRoot) {
    const mergedChildren = edgeMap.get(ref) ?? new Set();
    for (const child of children) mergedChildren.add(child);
    edgeMap.set(ref, mergedChildren);
  }
  return ref;
}

function packageReference(name, version) {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function installedPackageMetadata(packagePath) {
  if (typeof packagePath !== "string") return null;
  try {
    const packageJson = JSON.parse(
      globalThis.process
        .getBuiltinModule("fs")
        .readFileSync(resolve(packagePath, "package.json"), "utf8")
    );
    const licence = packageJson.license;
    return {
      version: typeof packageJson.version === "string" ? packageJson.version : null,
      license: typeof licence === "string" && /^[A-Za-z0-9.+-]+$/.test(licence) ? licence : null
    };
  } catch {
    return null;
  }
}

function deterministicUuid(hex) {
  const bytes = hex.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
