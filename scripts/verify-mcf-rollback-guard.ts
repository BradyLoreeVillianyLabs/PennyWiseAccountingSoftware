import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "../packages/db/src/index.js";
import { buildApp } from "../apps/api/src/app.js";

const repoRoot = resolve(import.meta.dirname, "..");
const databaseUrl = process.env.DATABASE_URL;
const dockerContainer = process.env.PSQL_DOCKER_CONTAINER;

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!dockerContainer) throw new Error("PSQL_DOCKER_CONTAINER is required.");
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(dockerContainer)) {
  throw new Error("PSQL_DOCKER_CONTAINER contains unsupported characters.");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, "");
if (!/^clearledger_(?:review_guard|mcf_rollback_guard_)/.test(databaseName)) {
  throw new Error(`Refusing destructive MCFX guard verification on database "${databaseName}".`);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const ownerEmail = `mcf-rollback-guard-${randomUUID()}@example.test`;

try {
  await prisma.$connect();
  await app.ready();
  const organizationResponse = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: {
      "x-clearledger-user-email": ownerEmail,
      "x-clearledger-user-name": "MCFX rollback guard"
    },
    payload: {
      legalName: "MCFX Rollback Guard Ltd",
      displayName: "MCFX Rollback Guard"
    }
  });
  if (organizationResponse.statusCode !== 201) {
    throw new Error(
      `Could not seed the guard organization: ${String(organizationResponse.statusCode)} ${organizationResponse.body}`
    );
  }
  const organizationId = organizationResponse.json<{ organization: { id: string } }>().organization
    .id;
  const accountId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "Account" (
        "id", "organizationId", "code", "name", "type", "isControl", "updatedAt"
      ) VALUES (
        ${accountId}::uuid, ${organizationId}::uuid, '1000', 'Foreign bank',
        'ASSET'::"AccountType", false, CURRENT_TIMESTAMP
      )
    `;
    await tx.$executeRaw`
      INSERT INTO "MonetaryPosition" (
        "organizationId", "accountId", "kind", "currency", "sourceType", "sourceId",
        "carryingMinor", "originalTransactionMinor", "outstandingTransactionMinor",
        "originalBaseMinor", "carryingBaseMinor", "asOfDate", "updatedAt"
      ) VALUES (
        ${organizationId}::uuid, ${accountId}::uuid, 'BANK'::"MonetaryPositionKind",
        'USD', 'rollback_guard', ${randomUUID()}, 13500, 10000, 10000, 13500,
        13500, DATE '2026-07-29', CURRENT_TIMESTAMP
      )
    `;
  });
  const evidence = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "MonetaryPosition"
    WHERE "organizationId" = ${organizationId}::uuid
      AND trim("currency") = 'USD'
  `;
  if (evidence[0]?.count !== 1n) {
    throw new Error("Foreign-currency rollback evidence was not created.");
  }
} finally {
  await app.close();
  await prisma.$disconnect();
}

const cadUsdRelease = runDown("20260730015000_cad_usd_accounting_release");
const cadUsdReleaseOutput = `${cadUsdRelease.stdout}\n${cadUsdRelease.stderr}`;
if (cadUsdRelease.status === 0) {
  throw new Error("The CAD/USD release rollback accepted foreign-currency evidence.");
}
if (
  !cadUsdReleaseOutput.includes(
    "Refusing CAD/USD release rollback because foreign-currency accounting evidence exists"
  )
) {
  throw new Error(`The CAD/USD release rollback failed unexpectedly:\n${cadUsdReleaseOutput}`);
}

console.log(
  `Verified that the CAD/USD release rollback refuses foreign-currency evidence on ${databaseName}.`
);

function runDown(migration: string) {
  const sql = readFileSync(
    join(repoRoot, "packages", "db", "prisma", "migrations", migration, "down.sql"),
    "utf8"
  );
  return spawnSync(
    "docker",
    [
      "exec",
      "-i",
      dockerContainer!,
      "psql",
      "-U",
      decodeURIComponent(parsedDatabaseUrl.username),
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: sql
    }
  );
}
