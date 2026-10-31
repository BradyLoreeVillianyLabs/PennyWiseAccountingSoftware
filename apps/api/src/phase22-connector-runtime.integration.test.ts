import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { OrganizationContext } from "@clearledger/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import {
  ConnectorRuntimeService,
  type ConnectorAdapter
} from "./services/connector-runtime-service.js";
import { AesPaymentAccountProtector } from "./services/payment-provider.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const adapter: ConnectorAdapter = {
  providerKey: "FIXTURE",
  validateCredentials(credentials) {
    if (credentials.token !== "fixture-secret") throw new Error("invalid");
    return Promise.resolve();
  },
  checkHealth() {
    return Promise.resolve("HEALTHY");
  }
};
const app = buildApp({
  prisma,
  connectorAdapters: [adapter],
  connectorCredentialProtector: new AesPaymentAccountProtector(
    "connector-fixture-encryption-secret"
  )
});
const owner = "phase22-connector-owner@example.test";
const headers = (organizationId?: string) => ({
  "x-clearledger-user-email": owner,
  "x-clearledger-user-name": "Connector Owner",
  ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
});

describe("Phase 22 connector runtime", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => resetDatabase(prisma));
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("stores consented credentials encrypted, bounds backfill, and records redacted health evidence", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Connector Ltd", displayName: "Connector" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const draft = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: { providerKey: "FIXTURE", displayName: "Fixture", mapping: { customer: "external" } }
    });
    expect(draft.statusCode).toBe(201);
    const connectorId = draft.json<{ connector: { id: string; status: string } }>().connector.id;
    const connected = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/connect`,
      headers: headers(organizationId),
      payload: {
        credentials: { token: "fixture-secret" },
        backfillStartAt: "2026-07-01T00:00:00.000Z",
        backfillEndAt: "2026-07-15T00:00:00.000Z"
      }
    });
    expect(connected.statusCode).toBe(200);
    expect(
      connected.json<{ connector: { status: string; credentialVersion: number } }>().connector
    ).toMatchObject({ status: "READY", credentialVersion: 1 });
    const stored = await prisma.connectorInstallation.findUniqueOrThrow({
      where: { id: connectorId }
    });
    expect(stored.credentialCiphertext).not.toContain("fixture-secret");
    expect(JSON.stringify(connected.json())).not.toContain("fixture-secret");
    const health = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/health`,
      headers: headers(organizationId)
    });
    expect(health.json<{ connector: { healthStatus: string } }>().connector.healthStatus).toBe(
      "HEALTHY"
    );
    expect(
      await prisma.connectorLog.count({ where: { organizationId, installationId: connectorId } })
    ).toBe(2);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId, userId: user.id }
    });
    const context: OrganizationContext = {
      requestId: "connector-runtime-test",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerifiedAt: user.emailVerifiedAt
      },
      organizationId,
      membershipId: membership.id,
      role: "OWNER",
      sessionId: null,
      recentAuthAt: new Date(),
      mfaAuthenticated: false,
      authenticationMethod: "DEVELOPMENT",
      auditOrigin: { ipAddress: null, userAgent: null }
    };
    const runtime = new ConnectorRuntimeService(
      prisma,
      [adapter],
      new AesPaymentAccountProtector("connector-fixture-encryption-secret")
    );
    const checkpoint = await runtime.saveCheckpoint(context, connectorId, {
      scope: "orders",
      checkpoint: { cursor: "page-2", accessToken: "should-not-persist" }
    });
    expect(checkpoint.checkpoint).toEqual({ cursor: "page-2", accessToken: "[REDACTED]" });
    const conflict = await runtime.openConflict(context, connectorId, {
      externalRef: "order-100",
      kind: "UNKNOWN_TAX",
      detail: { message: "Review tax", secret: "should-not-persist" }
    });
    expect(conflict).toMatchObject({ status: "OPEN", detail: { secret: "[REDACTED]" } });
    const listedConflicts = await app.inject({
      method: "GET",
      url: `/v1/organizations/current/connectors/${connectorId}/conflicts`,
      headers: headers(organizationId)
    });
    expect(listedConflicts.json<{ conflicts: Array<{ id: string }> }>().conflicts).toHaveLength(1);
    const resolved = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/conflicts/${conflict.id}/resolve`,
      headers: headers(organizationId)
    });
    expect(resolved.json<{ conflict: { status: string } }>().conflict.status).toBe("RESOLVED");
    const logs = await app.inject({
      method: "GET",
      url: `/v1/organizations/current/connectors/${connectorId}/logs`,
      headers: headers(organizationId)
    });
    expect(logs.json<{ logs: unknown[] }>().logs.length).toBeGreaterThanOrEqual(5);
    const unavailable = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: { providerKey: "UNKNOWN", displayName: "Nope", mapping: {} }
    });
    expect(unavailable.statusCode).toBe(422);
  });

  it("rejects client-owned catalog confirmations and preserves server-owned mappings", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Reserved Mapping Ltd", displayName: "Reserved Mapping" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const reservedKeys = [
      "catalogVariantMappings",
      "catalogProductMappings",
      "catalogSkuMappings"
    ] as const;
    const injectedDraft = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: {
        providerKey: "FIXTURE",
        displayName: "Injected fixture",
        mapping: Object.fromEntries(
          reservedKeys.map((key) => [key, { external: "client-selected-product" }])
        )
      }
    });
    expect(injectedDraft.statusCode, injectedDraft.body).toBe(422);
    expect(injectedDraft.json<{ error: { code: string } }>().error.code).toBe(
      "CONNECTOR_MAPPING_RESERVED"
    );
    expect(await prisma.connectorInstallation.count({ where: { organizationId } })).toBe(0);

    const draft = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: {
        providerKey: "FIXTURE",
        displayName: "Protected fixture",
        mapping: { customerStrategy: "UNCONFIGURED" }
      }
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const connectorId = draft.json<{ connector: { id: string } }>().connector.id;
    const serverOwnedMapping = {
      catalogVariantMappings: { "variant-1": "reviewed-product-1" },
      catalogProductMappings: { "product-1": "reviewed-product-1" },
      catalogSkuMappings: { "SKU-1": "reviewed-product-1" }
    };
    const seeded = await prisma.connectorInstallation.update({
      where: { id: connectorId },
      data: {
        mapping: { customerStrategy: "UNCONFIGURED", ...serverOwnedMapping },
        mappingVersion: { increment: 1 }
      }
    });

    for (const key of reservedKeys) {
      const overwrite = await app.inject({
        method: "PATCH",
        url: `/v1/organizations/current/connectors/${connectorId}/mapping`,
        headers: headers(organizationId),
        payload: {
          version: seeded.mappingVersion,
          mapping: { customerStrategy: "POOLED", [key]: { external: "different-product" } }
        }
      });
      expect(overwrite.statusCode, `${key}: ${overwrite.body}`).toBe(422);
      expect(overwrite.json<{ error: { code: string } }>().error.code).toBe(
        "CONNECTOR_MAPPING_RESERVED"
      );
    }
    expect(
      await prisma.connectorInstallation.findUniqueOrThrow({ where: { id: connectorId } })
    ).toMatchObject({ mappingVersion: seeded.mappingVersion, mapping: serverOwnedMapping });

    const invalidRemitter = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/current/connectors/${connectorId}/mapping`,
      headers: headers(organizationId),
      payload: {
        version: seeded.mappingVersion,
        mapping: {
          customerStrategy: "POOLED",
          taxRemittanceMappings: { GST: "AUTOMATIC" }
        }
      }
    });
    expect(invalidRemitter.statusCode, invalidRemitter.body).toBe(422);
    expect(invalidRemitter.json<{ error: { code: string } }>().error.code).toBe(
      "CONNECTOR_TAX_REMITTANCE_INVALID"
    );

    const safeUpdate = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/current/connectors/${connectorId}/mapping`,
      headers: headers(organizationId),
      payload: {
        version: seeded.mappingVersion,
        mapping: {
          customerStrategy: "POOLED",
          skuMappings: { "MANUAL-SKU": "manually-reviewed-product" },
          taxMappings: { GST: "gst-tax-code" },
          taxRemittanceMappings: { GST: "SELLER", "BC PST": "MARKETPLACE" },
          taxRemittanceResponsibility: "SELLER"
        }
      }
    });
    expect(safeUpdate.statusCode, safeUpdate.body).toBe(200);
    expect(
      safeUpdate.json<{
        connector: { mappingVersion: number; mapping: Record<string, unknown> };
      }>().connector
    ).toMatchObject({
      mappingVersion: seeded.mappingVersion + 1,
      mapping: {
        customerStrategy: "POOLED",
        skuMappings: { "MANUAL-SKU": "manually-reviewed-product" },
        taxMappings: { GST: "gst-tax-code" },
        taxRemittanceMappings: { GST: "SELLER", "BC PST": "MARKETPLACE" },
        taxRemittanceResponsibility: "SELLER",
        ...serverOwnedMapping
      }
    });
  });
});
