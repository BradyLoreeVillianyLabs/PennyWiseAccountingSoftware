import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleIndexHtml,
  readWebScripts,
  readWebStyles
} from "../apps/web/scripts/web-sources.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// package.json invokes these as flags (`--security`, `--accessibility`,
// `--performance`) but the comparisons below are against bare words. Without
// stripping the dashes, `--security` matched no branch: the mode's checks were
// skipped and the run still reported "contract passed". `pnpm test:security`,
// `test:accessibility` and `test:performance` were therefore green without
// executing anything they exist to assert. Accept both spellings.
const mode = (process.argv[2] ?? "all").replace(/^--/, "");
const requiredFiles = [
  "CHANGELOG.md",
  "docs/RELEASE_CANDIDATE.md",
  "docs/USER_ACCEPTANCE_SCRIPTS.md",
  "docs/tasks/OWNER_REQUEST_LEDGER_2026-08-03.md",
  "docs/tasks/PUBLIC_BETA_COMPLETION_PROGRAM_2026-08-03.md",
  "docs/MARKET_RELEASE_ASSESSMENT_2026-08-03.md",
  "docs/status/PHASE_14_DEFECT_REGISTER.md",
  "distribution/public-beta/KNOWN_LIMITATIONS.md",
  "distribution/public-beta/RELEASE_EVIDENCE.md",
  "apps/api/src/phase4-sales.integration.test.ts",
  "apps/api/src/phase5-documents.integration.test.ts",
  "apps/api/src/phase7-purchasing.integration.test.ts",
  "apps/api/src/phase8-banking.integration.test.ts",
  "apps/api/src/phase9-inventory.integration.test.ts",
  "apps/api/src/phase10-reporting.integration.test.ts",
  "apps/api/src/phase11-accountant.integration.test.ts",
  "apps/api/src/phase12-portability.integration.test.ts"
];

for (const file of requiredFiles) await readText(file);
const release = await readText("docs/RELEASE_CANDIDATE.md");
const userAcceptance = await readText("docs/USER_ACCEPTANCE_SCRIPTS.md");
const changelog = await readText("CHANGELOG.md");
const webRoot = resolve(root, "apps/web");
const html = await assembleIndexHtml(webRoot);
const javascript = await readWebScripts(webRoot);
const css = await readWebStyles(webRoot);
const ownerRequestLedger = await readText("docs/tasks/OWNER_REQUEST_LEDGER_2026-08-03.md");
const betaCompletionProgram = await readText(
  "docs/tasks/PUBLIC_BETA_COMPLETION_PROGRAM_2026-08-03.md"
);
const knownLimitations = await readText("distribution/public-beta/KNOWN_LIMITATIONS.md");
const releaseEvidence = await readText("distribution/public-beta/RELEASE_EVIDENCE.md");
const apiProductionTsconfig = JSON.parse(await readText("apps/api/tsconfig.json"));
const databaseProductionTsconfig = JSON.parse(await readText("packages/db/tsconfig.json"));
const databasePackage = JSON.parse(await readText("packages/db/package.json"));
const betaDockerfile = await readText("distribution/public-beta/docker/Dockerfile.beta");
const compactBetaCompletionProgram = betaCompletionProgram.replace(/\s+/g, " ");
const compactKnownLimitations = knownLimitations.replace(/\s+/g, " ");
const compactReleaseEvidence = releaseEvidence.replace(/\s+/g, " ");

for (const [configurationName, configuration, requiredExclusion] of [
  ["API", apiProductionTsconfig, "src/**/*.integration.ts"],
  ["database", databaseProductionTsconfig, "src/test-utils.ts"]
]) {
  if (!Array.isArray(configuration.exclude) || !configuration.exclude.includes(requiredExclusion))
    throw new Error(
      `${configurationName} production compilation no longer excludes ${requiredExclusion}.`
    );
}
if (Object.hasOwn(databasePackage.exports ?? {}, "./test-utils"))
  throw new Error("The production database package must not export destructive test utilities.");
for (const forbiddenArtifactPattern of [
  "-name '*.test.js'",
  "-name '*.integration.js'",
  "-name '*.spec.js'",
  "-name 'test-utils.js'"
]) {
  if (!betaDockerfile.includes(forbiddenArtifactPattern))
    throw new Error(
      `The beta image no longer fails closed on compiled test artifact ${forbiddenArtifactPattern}.`
    );
}

const ownerCommitments = [
  "Repeatable Windows startup",
  "production OIDC",
  "Named remote testers and separate test companies",
  "Free functional beta download",
  "Do not modify the operational QBWooBridge",
  "Top navigation rather than a side rail",
  "navigation through **Integrations** visible",
  "Make headers, titles, boxes, links, buttons, and menus visually distinct",
  "constrained or off-screen **More** and **New** menus",
  "Highlight selected Business/Accountant",
  "Darken default Home/Sales/Purchases navigation text",
  "three-vertical-pane desktop layout",
  "Adjustable/reorderable dashboard tiles",
  "Wider company selector",
  "More appearance themes, fonts, density, and display adjustments",
  "Guided getting-started tutorial",
  "Detailed About page",
  "Fully configured fictional demo company",
  "Robust clickable date controls",
  "Condense sprawling screens into clear labelled tabs",
  "Richer interactive process explanations and visualizations",
  "Walk the complete product as a new user",
  "Sales reminders, communication history, statements, and narrow customer self-service",
  "Evidence inbox that turns a reviewed receipt or bill into one draft",
  "Project profitability and approved time-to-invoice workflow",
  "CAD and USD multi-currency accounting",
  "Eventual currencies beyond CAD and USD",
  "Editable ledger work",
  "Forecasting estimates and accounting grey-area work",
  "Formal reports use only authoritative accounting documents",
  "User-created account code such as 4100",
  "Excel/CSV imports and spreadsheet support",
  "Visual GUI field mapping on imports",
  "centralized tax handling module",
  "Premium exact invoice previews",
  "Project planning, visual calendar, tasks, milestones, bills, and dates",
  "Fixed assets",
  "Progress billing and deposits",
  "Purchase orders, partial receiving, and bill matching",
  "Choose safe accounting defaults by target audience",
  "Native payroll",
  "Live bank feeds, OCR, payroll filing/payment providers, and native mobile packaging",
  "Native WooCommerce and Etsy connectors",
  "Create local item/inventory lists from WooCommerce and Etsy",
  "Automated inventory observations, desired quantities, retries, and conflicts",
  "Intelligent SKU mapping",
  "Nearest SKU, nearest product name, and nearest description",
  "Product image ingestion",
  "Live provider acceptance and payout reconciliation",
  "Assess competitors, target users, packaging, platforms, reach, workflow, switching, value, and monetization",
  "Prove value and make switching easy",
  "Research reusable open-source approaches without licensing contamination",
  "supplied market-research PDF",
  "Phase 15 controlled-beta launch and readiness evidence",
  "Phase 16 customer experience and activation",
  "Phase 17 sales automation",
  "Phase 18 projects and field productivity",
  "Phase 19 banking and cash planning",
  "Phase 20 migration-practice workflow and source-specific cutover",
  "Phase 21 commercial entitlements and provider-event controls",
  "Phase 22 developer API, credentials, OAuth, and signed webhooks",
  "Phase 23 commerce operations",
  "Phase 24 French and Quebec product/tax depth",
  "Phase 25 mobile companion",
  "Finish all safe missing customer expectations before returning a beta file",
  "Complete authorized Phases 15-25",
  "Remove a mandatory accountant approval gate",
  "typewritingmonkeys.com",
  "Private bug-report infrastructure",
  "Public community feedback board",
  "operational QBWooBridge"
];
for (const commitment of ownerCommitments) {
  if (!ownerRequestLedger.includes(commitment))
    throw new Error(`The cumulative owner-request ledger is missing: ${commitment}`);
}
const ledgerRows = ownerRequestLedger
  .split(/\r?\n/)
  .filter((line) => /^\|[^-].*\|.*\|$/.test(line) && !line.includes("Owner request"));
if (ledgerRows.length < 70)
  throw new Error("The cumulative owner-request ledger was unexpectedly truncated.");
for (const row of ledgerRows) {
  const cells = row
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  if (cells.length !== 2 || cells.some((cell) => !cell))
    throw new Error(`Malformed or unclassified owner-request row: ${row}`);
}
for (const required of [
  "Later steering changes work order but does not silently remove an earlier requirement",
  "final no-drop audit"
]) {
  if (!compactBetaCompletionProgram.includes(required))
    throw new Error(`The public-beta completion program lost its no-drop rule: ${required}`);
}
for (const required of [
  "CAD and USD",
  "WooCommerce and Etsy require credentials",
  "Live bank feeds",
  "statutory payroll",
  "production OCR",
  "mobile app-store packaging",
  "does not claim French-language, Quebec, QST"
]) {
  if (!compactKnownLimitations.includes(required))
    throw new Error(`Known limitations no longer disclose: ${required}`);
}
for (const required of [
  "Exact artifact identity",
  "verificationSkipped",
  "No professional or provider approval is represented"
]) {
  if (!compactReleaseEvidence.includes(required))
    throw new Error(`Release evidence lost a required honesty boundary: ${required}`);
}

if (
  !changelog.startsWith("# Changelog\n") ||
  !changelog.includes("\n## 0.14.0-rc.1 - 2026-07-25\n")
) {
  throw new Error("The release candidate version must be documented in CHANGELOG.md.");
}

const releaseScenarios = [
  "New service business setup",
  "New inventory business setup",
  "User invitation and role assignment",
  "Customer creation",
  "Service invoice creation and posting",
  "Invoice PDF and email delivery",
  "Public invoice viewing",
  "Hosted payment and receipt",
  "Partial payment",
  "Credit note and refund",
  "Vendor and bill creation",
  "Partial bill payment",
  "Immediate expense",
  "Bank import and matching",
  "Reconciliation",
  "Inventory purchase, sale, and return",
  "Inventory adjustment and transfer",
  "Financial and tax reports",
  "Period close and correction",
  "Full export",
  "Migration from sample legacy data",
  "Cross-tenant access attempt",
  "Duplicate webhook and duplicate import",
  "Backup restoration smoke test"
];
for (const scenario of releaseScenarios) {
  if (!release.includes(scenario)) throw new Error(`Release matrix is missing: ${scenario}`);
}

for (const journey of [
  "Fresh installation and identity",
  "Guided first-use and demo company",
  "Navigation, hierarchy, and responsive menus",
  "Spreadsheet migration reviewer",
  "CAD/USD owner and bookkeeper",
  "Invoice designer and customer document",
  "Commerce catalog and inventory reviewer",
  "Project, calendar, and planning reviewer",
  "Editable accounting workpaper",
  "Controlled trusted sharing",
  "Feedback, recovery, and exit"
]) {
  if (!userAcceptance.includes(`## ${journey}`))
    throw new Error(`The packaged owner journey is missing: ${journey}`);
}

if (mode === "all" || mode === "accessibility") {
  if (!/<html\b[^>]*\blang="en-CA"[^>]*>/i.test(html))
    throw new Error('Accessibility markup is missing: html lang="en-CA"');
  for (const required of [
    'name="viewport"',
    "<h1>",
    'id="notice" role="status" aria-live="polite" tabindex="-1"',
    'id="report-table" aria-label=',
    'class="sr-only"'
  ]) {
    if (!html.includes(required)) throw new Error(`Accessibility markup is missing: ${required}`);
  }
  for (const required of [
    "textarea:focus-visible",
    'output.setAttribute("role", "status")',
    'header.setAttribute("scope", "col")',
    "elements.notice.focus()"
  ]) {
    if (!(javascript + css).includes(required))
      throw new Error(`Accessibility behavior is missing: ${required}`);
  }
}

if (mode === "all" || mode === "performance") {
  const assets = await Promise.all(
    ["apps/web/dist/index.html", "apps/web/dist/app.js", "apps/web/dist/styles.css"].map(size)
  );
  const totalBytes = assets.reduce((total, value) => total + value, 0);
  // Bulk entry, indexed search, the reviewed window controls, phase-2/3 recovery,
  // spreadsheet workspaces, the localhost-only test-account picker, and the X3
  // inline document composer are intentionally shipped in the existing vanilla
  // client so they reuse the authenticated API and navigation shell. Keep a
  // bounded budget while allowing the tested accounting workflows to ship together.
  if (totalBytes > 1_215_000)
    throw new Error(`Initial web assets exceed beta budget (1.215 MB): ${totalBytes}`);
  if (!release.includes("Performance Targets"))
    throw new Error("Performance targets are undocumented.");
}

if (mode === "all" || mode === "security") {
  for (const secretName of [".env", ".env.local", ".env.production"]) {
    const exists = await fileExists(secretName);
    if (exists)
      throw new Error(`Local secret file must not be part of the release candidate: ${secretName}`);
  }
  if (!release.includes("Production debug endpoints are disabled"))
    throw new Error("Production debug posture is undocumented.");
}

console.log(`Release-candidate ${mode} contract passed (${totalAssetLabel()}).`);

async function readText(file) {
  return readFile(resolve(root, file), "utf8");
}

async function size(file) {
  return (await stat(resolve(root, file))).size;
}

async function fileExists(file) {
  try {
    await stat(resolve(root, file));
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

function totalAssetLabel() {
  return "web accessibility, release traceability, and hygiene";
}
