import { describe, expect, it } from "vitest";
import {
  buildLabelPreview,
  inventoryCapabilityBoundary,
  normalizedBarcode
} from "./services/inventory-catalog-control-service.js";
import {
  inventoryBarcodeRegisterSchema,
  inventoryLabelTemplateSchema,
  inventoryScanResolveSchema
} from "./http/schemas.js";

describe("inventory barcode and label control contract", () => {
  it("normalizes scanner punctuation without losing the source value in the request", () => {
    expect(normalizedBarcode("  00-1234  ")).toBe("001234");
    expect(
      inventoryBarcodeRegisterSchema.parse({
        productItemId: "00000000-0000-4000-8000-000000000001",
        code: " 00-1234 ",
        symbology: "CODE128",
        isPrimary: true
      }).code
    ).toBe("00-1234");
  });

  it("accepts camera payloads while making the device boundary explicit", () => {
    const request = inventoryScanResolveSchema.parse({
      code: "012345678905",
      captureMode: "CAMERA",
      symbology: "UPC_A"
    });
    expect(request.captureMode).toBe("CAMERA");
    expect(inventoryCapabilityBoundary().cameraScanProtocol).toContain("CAMERA");
  });

  it("validates a preview-only label contract with exact fields and no printer side effect", () => {
    const template = inventoryLabelTemplateSchema.parse({
      name: "Shelf label",
      symbology: "CODE128",
      widthMmMicros: "10000000",
      heightMmMicros: "5000000",
      fields: ["SKU", "NAME", "BARCODE", "PRICE"]
    });
    const preview = buildLabelPreview({
      templateId: "00000000-0000-4000-8000-000000000002",
      templateName: template.name,
      symbology: template.symbology,
      widthMmMicros: BigInt(template.widthMmMicros),
      heightMmMicros: BigInt(template.heightMmMicros),
      fields: template.fields,
      product: {
        id: "00000000-0000-4000-8000-000000000003",
        sku: "WIDGET-1",
        name: "Widget",
        gtin: null,
        manufacturerPartNumber: null,
        salesPriceMinor: 1299n
      },
      barcode: "00-1234"
    });
    expect(preview.elements).toEqual([
      { field: "SKU", value: "WIDGET-1" },
      { field: "NAME", value: "Widget" },
      { field: "BARCODE", value: "00-1234" },
      { field: "PRICE", value: "1299" }
    ]);
    expect(preview.sideEffect).toBe("PREVIEW_ONLY");
    expect(preview.printerAdapter).toBe("NOT_CONFIGURED");
  });

  it("keeps incomplete costing and assembly features visibly gated", () => {
    const capabilities = inventoryCapabilityBoundary();
    expect(capabilities.costing.fifo).toBe("SCAFFOLD_ONLY");
    expect(capabilities.costing.landedCostAllocation).toBe("SCAFFOLD_ONLY");
    expect(capabilities.assemblies.kitAssembly).toBe("SCAFFOLD_ONLY");
  });
});
