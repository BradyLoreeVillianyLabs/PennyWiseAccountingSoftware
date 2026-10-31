import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  catalogCandidateDecisionSchema,
  connectorCatalogPollSchema,
  inventorySyncConflictResolutionSchema,
  inventorySyncPolicySchema
} from "./http/schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(here, "app.ts"), "utf8");
const openApiSource = readFileSync(resolve(here, "openapi.ts"), "utf8");
const mappingSource = readFileSync(resolve(here, "services/catalog-mapping-service.ts"), "utf8");
const automationSource = readFileSync(
  resolve(here, "services/catalog-automation-service.ts"),
  "utf8"
);

describe("catalog and inventory automation API contract", () => {
  it("bounds catalog polling and requires versioned human mapping decisions", () => {
    expect(connectorCatalogPollSchema.parse({ maxPages: 25, pageSize: 25 })).toMatchObject({
      maxPages: 25,
      pageSize: 25,
      restart: false
    });
    expect(() => connectorCatalogPollSchema.parse({ maxPages: 26 })).toThrow();
    expect(catalogCandidateDecisionSchema.parse({ version: 2 })).toEqual({ version: 2 });
    expect(() => catalogCandidateDecisionSchema.parse({ version: 0 })).toThrow();
  });

  it("requires an explicit source of truth and versioned conflict action", () => {
    expect(
      inventorySyncPolicySchema.parse({
        installationId: "11111111-1111-4111-8111-111111111111",
        catalogVariantId: "22222222-2222-4222-8222-222222222222",
        productItemId: "33333333-3333-4333-8333-333333333333",
        locationId: "44444444-4444-4444-8444-444444444444",
        sourceOfTruth: "LOCAL",
        enabled: true
      })
    ).toMatchObject({ sourceOfTruth: "LOCAL", enabled: true });
    expect(
      inventorySyncConflictResolutionSchema.parse({
        action: "PUSH_LOCAL_TO_CHANNEL",
        version: 3
      })
    ).toEqual({ action: "PUSH_LOCAL_TO_CHANNEL", version: 3 });
  });

  it("registers every organization-scoped route and documents the non-posting review boundary", () => {
    for (const fragment of [
      "/connectors/:connectorInstallationId/catalog/poll",
      "/catalog/variants/:catalogVariantId/candidates",
      "/catalog/candidates/:candidateId/${action}",
      "/catalog/images/:imageId/${action}",
      "/inventory-sync/policies",
      "/inventory-sync/conflicts/:conflictId/resolve",
      "/inventory-sync/operations/process"
    ])
      expect(appSource).toContain(fragment);
    expect(appSource).toContain("requireOrganizationContext(request, prisma, identityAdapter)");
    expect(openApiSource).toContain("fuzzy evidence never confirms a mapping");
    expect(openApiSource).toContain("through InventoryService");
  });

  it("uses a durable outbox and never mutates ledger or quantity tables directly", () => {
    expect(mappingSource).toContain('eventType: "catalog.inventory-write-requested"');
    expect(automationSource).toContain("FOR UPDATE SKIP LOCKED");
    expect(automationSource).toContain("idempotencyKey: payload.idempotencyKey");
    expect(mappingSource).toContain("this.inventory.adjust(");
    expect(`${mappingSource}\n${automationSource}`).not.toMatch(
      /\.(journal|journalLine|inventoryMovement|inventoryBalance)\.(create|update|upsert)/
    );
    expect(`${mappingSource}\n${automationSource}`).toContain("accountingEntriesCreated: 0");
  });
});
