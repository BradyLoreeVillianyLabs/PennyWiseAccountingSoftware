import { describe, expect, it } from "vitest";
import { code128BModules, renderPickingSlip } from "./picking-slip-render-service.js";

describe("picking-slip renderer", () => {
  it("renders a printable one-page slip with a barcode and an optional thumbnail", async () => {
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const result = await renderPickingSlip({
      organizationName: "Destry Workwear",
      orderReference: "INV-1001",
      date: "2026-09-02",
      customerName: "Warehouse customer",
      lines: [
        {
          description: "Utility shirt",
          variantAttributes: "Size: 8 | Colour: Navy",
          sku: "SHIRT-8-NAVY",
          barcode: "SHIRT-8-NAVY",
          quantity: "2",
          location: "MAIN - Main warehouse",
          bin: "A-01",
          image
        },
        {
          description: "Utility trousers",
          variantAttributes: null,
          sku: "TROUSER-10",
          barcode: "TROUSER-10",
          quantity: "1",
          location: "MAIN - Main warehouse",
          bin: null,
          image: null
        }
      ]
    });
    expect(result.pageCount).toBe(1);
    expect(result.data.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("expands Code 128-B symbols and rejects non-ASCII values", () => {
    expect(code128BModules("SHIRT-8-NAVY").length).toBeGreaterThan(100);
    expect(code128BModules("é")).toEqual([]);
  });
});
