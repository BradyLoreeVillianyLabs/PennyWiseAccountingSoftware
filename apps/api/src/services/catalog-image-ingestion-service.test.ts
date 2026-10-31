import { describe, expect, it } from "vitest";
import { CatalogImageIngestionService } from "./catalog-image-ingestion-service.js";

const publicHost = (): Promise<readonly string[]> => Promise.resolve(["93.184.216.34"]);

describe("CatalogImageIngestionService", () => {
  it("accepts a same-host Woo image only after byte and pixel inspection", async () => {
    const png = fixturePng(1200, 800);
    const service = new CatalogImageIngestionService(
      () =>
        Promise.resolve(
          new Response(png, {
            status: 200,
            headers: { "content-type": "image/png", "content-length": String(png.length) }
          })
        ),
      publicHost
    );
    const result = await service.ingest({
      remoteUrl: "https://shop.example.com/media/product.png?size=full",
      providerKey: "WOOCOMMERCE",
      connectorExternalAccountId: "https://shop.example.com"
    });
    expect(result).toMatchObject({
      mediaType: "image/png",
      byteLength: png.length,
      width: 1200,
      height: 800
    });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects cross-host Woo images and private DNS before download", async () => {
    const noFetch = () => Promise.reject(new Error("fetch must not run"));
    const service = new CatalogImageIngestionService(noFetch, publicHost);
    await expect(
      service.validateBoundary({
        remoteUrl: "https://cdn.example.net/product.png",
        providerKey: "WOOCOMMERCE",
        connectorExternalAccountId: "https://shop.example.com"
      })
    ).rejects.toMatchObject({ code: "CATALOG_IMAGE_HOST_REJECTED" });

    const privateService = new CatalogImageIngestionService(noFetch, () =>
      Promise.resolve(["127.0.0.1"])
    );
    await expect(
      privateService.validateBoundary({
        remoteUrl: "https://shop.example.com/product.png",
        providerKey: "WOOCOMMERCE",
        connectorExternalAccountId: "https://shop.example.com"
      })
    ).rejects.toMatchObject({ code: "CATALOG_IMAGE_URL_INVALID" });
  });

  it("does not follow redirects and rejects declared/actual type mismatches", async () => {
    const redirected = new CatalogImageIngestionService(
      () =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { location: "https://x.invalid" } })
        ),
      publicHost
    );
    await expect(
      redirected.ingest({
        remoteUrl: "https://i.etsystatic.com/fixture.png",
        providerKey: "ETSY",
        connectorExternalAccountId: null
      })
    ).rejects.toMatchObject({ code: "CATALOG_IMAGE_REDIRECT_REJECTED" });

    const mismatch = new CatalogImageIngestionService(
      () =>
        Promise.resolve(
          new Response(fixturePng(10, 10), {
            status: 200,
            headers: { "content-type": "image/jpeg" }
          })
        ),
      publicHost
    );
    await expect(
      mismatch.ingest({
        remoteUrl: "https://i.etsystatic.com/fixture.jpg",
        providerKey: "ETSY",
        connectorExternalAccountId: null
      })
    ).rejects.toMatchObject({ code: "CATALOG_IMAGE_TYPE_MISMATCH" });
  });
});

function fixturePng(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}
