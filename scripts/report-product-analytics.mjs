import { Prisma, PrismaClient } from "../packages/db/dist/index.js";

const reportDatabaseUrl = process.env.PRODUCT_ANALYTICS_REPORT_DATABASE_URL;
if (!reportDatabaseUrl) {
  throw new Error(
    "PRODUCT_ANALYTICS_REPORT_DATABASE_URL is required. Use a separately provisioned, read-only reporting connection."
  );
}

if (
  reportDatabaseUrl === process.env.DATABASE_URL ||
  reportDatabaseUrl === process.env.TEST_DATABASE_URL
) {
  throw new Error(
    "The product analytics report refuses DATABASE_URL and TEST_DATABASE_URL. Use a separately provisioned reporting connection."
  );
}

const reportUrl = new URL(reportDatabaseUrl);
if (reportUrl.username.toLowerCase().includes("runtime")) {
  throw new Error("The product analytics report refuses a runtime database credential.");
}

const configuredMinimum = Number.parseInt(
  process.env.PRODUCT_ANALYTICS_REPORT_MIN_ORGANIZATIONS ?? "5",
  10
);
const minimumOrganizations = Number.isSafeInteger(configuredMinimum)
  ? Math.max(5, configuredMinimum)
  : 5;

const prisma = new PrismaClient({
  datasources: { db: { url: reportDatabaseUrl } }
});

try {
  // The output intentionally contains only thresholded aggregates. Do not add
  // organization ids, user ids, client event ids, timestamps, or payload data.
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        "eventType",
        COUNT(*)::integer AS "eventCount",
        COUNT(DISTINCT "organizationId")::integer AS "organizationCount"
      FROM "ProductEvent"
      GROUP BY "eventType"
      HAVING COUNT(DISTINCT "organizationId") >= ${minimumOrganizations}
      ORDER BY "eventType" ASC
    `
  );

  process.stdout.write(
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      minimumOrganizations,
      events: rows
    })}\n`
  );
} finally {
  await prisma.$disconnect();
}
