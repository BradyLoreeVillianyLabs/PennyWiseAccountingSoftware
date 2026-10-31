import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const matrixPath = fileURLToPath(
  new URL("../docs/COMPETITIVE_RESEARCH_MATRIX.md", import.meta.url)
);

const requiredModules = [
  "identity-and-access",
  "organizations-and-company-lifecycle",
  "accounting-ledger-and-close",
  "tax-and-compliance",
  "sales-invoicing-estimates-and-payments",
  "purchases-expenses-and-accounts-payable",
  "banking-reconciliation-and-cashflow",
  "inventory-fixed-assets-and-catalog",
  "reporting-budgeting-and-insights",
  "documents-capture-and-printing",
  "crm-contacts-projects-and-time",
  "calendar-and-planning",
  "payroll-and-hr",
  "point-of-sale",
  "commerce-woo-etsy-and-catalog-import",
  "integrations-email-and-notifications",
  "imports-migration-and-data-portability",
  "table-grid-and-workspace-experience",
  "navigation-settings-appearance-and-owner-mode",
  "audit-security-and-administration",
  "deployment-desktop-and-beta-operations"
];

const matrix = await readFile(matrixPath, "utf8");
const errors = [];

for (const moduleId of requiredModules) {
  const heading = `## ${moduleId}`;
  const start = matrix.indexOf(heading);
  const next = start === -1 ? -1 : matrix.indexOf("\n## ", start + heading.length);
  const section = start === -1 ? "" : matrix.slice(start, next === -1 ? undefined : next);
  if (!section) {
    errors.push(`Missing research baseline for ${moduleId}.`);
    continue;
  }
  if (!section.includes("**References:**") || !/https:\/\//.test(section))
    errors.push(`${moduleId} needs at least one primary or established reference.`);
  if (!section.includes("**PennyWise translation:**"))
    errors.push(`${moduleId} needs a PennyWise translation.`);
  if (!section.includes("**Required evidence:**"))
    errors.push(`${moduleId} needs focused acceptance evidence.`);
}

if (errors.length) {
  console.error("Competitive research matrix is incomplete:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Verified competitive research baselines for ${requiredModules.length} PennyWise modules.`
  );
}
