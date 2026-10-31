import { createHash } from "node:crypto";
import { AppError } from "@clearledger/shared";
import { inspectImageBytes } from "./logo-service.js";
import {
  systemHostResolver,
  validatePublicHttpsResourceUrl,
  type HostResolver
} from "./connectors/connector-http-client.js";

const maximumImageBytes = 5_242_880;
const maximumDimension = 4096;
const maximumPixels = 16_777_216;
const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface CatalogImageBoundaryInput {
  readonly remoteUrl: string;
  readonly providerKey: string;
  readonly connectorExternalAccountId: string | null;
}

export interface IngestedCatalogImageEvidence {
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp";
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  /** Retained only in memory so the caller can create a local thumbnail. */
  readonly sourceBytes: Buffer;
}

export class CatalogImageIngestionService {
  public constructor(
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
    private readonly resolveHost: HostResolver = systemHostResolver
  ) {}

  public async validateBoundary(input: CatalogImageBoundaryInput): Promise<URL> {
    const url = await validatePublicHttpsResourceUrl(
      input.remoteUrl,
      this.resolveHost,
      "CATALOG_IMAGE_URL_INVALID"
    );
    const host = url.hostname.toLowerCase();
    const allowed =
      input.providerKey === "ETSY"
        ? host === "etsystatic.com" || host.endsWith(".etsystatic.com")
        : input.providerKey === "WOOCOMMERCE"
          ? connectorHostname(input.connectorExternalAccountId) === host
          : false;
    if (!allowed)
      throw new AppError(
        "CATALOG_IMAGE_HOST_REJECTED",
        "Catalog images must come from the authenticated connector host.",
        422
      );
    return url;
  }

  public async ingest(input: CatalogImageBoundaryInput): Promise<IngestedCatalogImageEvidence> {
    const url = await this.validateBoundary(input);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "image/png,image/jpeg,image/webp",
          "user-agent": "ClearLedger-Catalog-Image/1.0"
        }
      });
    } catch (error) {
      throw new AppError(
        "CATALOG_IMAGE_UNREACHABLE",
        "The catalog image could not be downloaded safely.",
        502,
        { errorName: error instanceof Error ? error.name : "NetworkError" }
      );
    }
    if (response.status >= 300 && response.status < 400)
      throw new AppError(
        "CATALOG_IMAGE_REDIRECT_REJECTED",
        "Catalog image redirects are not followed.",
        422
      );
    if (!response.ok)
      throw new AppError(
        "CATALOG_IMAGE_UNREACHABLE",
        "The catalog image provider rejected the request.",
        502
      );
    const declaredType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!declaredType || !supportedTypes.has(declaredType))
      throw new AppError(
        "CATALOG_IMAGE_TYPE_INVALID",
        "Catalog images must be PNG, JPEG, or WebP.",
        422
      );
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maximumImageBytes)
      throw new AppError("CATALOG_IMAGE_SIZE_INVALID", "Catalog images may not exceed 5 MiB.", 422);
    const bytes = await boundedBody(response, maximumImageBytes);
    let inspected: ReturnType<typeof inspectImageBytes>;
    try {
      inspected = inspectImageBytes(bytes);
    } catch {
      throw new AppError(
        "CATALOG_IMAGE_CONTENT_INVALID",
        "Catalog image bytes do not match a supported image type.",
        422
      );
    }
    if (inspected.mediaType !== declaredType)
      throw new AppError(
        "CATALOG_IMAGE_TYPE_MISMATCH",
        "Catalog image bytes do not match the declared content type.",
        422
      );
    if (
      inspected.width <= 0 ||
      inspected.height <= 0 ||
      inspected.width > maximumDimension ||
      inspected.height > maximumDimension ||
      inspected.width * inspected.height > maximumPixels
    )
      throw new AppError(
        "CATALOG_IMAGE_DIMENSIONS_INVALID",
        "Catalog image dimensions exceed the safe pixel limit.",
        422
      );
    return {
      mediaType: inspected.mediaType,
      byteLength: bytes.length,
      width: inspected.width,
      height: inspected.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sourceBytes: bytes
    };
  }
}

async function boundedBody(response: Response, maximum: number): Promise<Buffer> {
  if (response.body === null)
    throw new AppError("CATALOG_IMAGE_SIZE_INVALID", "Catalog images cannot be empty.", 422);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = (
    response.body as unknown as {
      getReader(): {
        read(): Promise<
          | { readonly done: true; readonly value?: never }
          | { readonly done: false; readonly value: Uint8Array }
        >;
        cancel(): Promise<void>;
      };
    }
  ).getReader();
  let complete = false;
  while (!complete) {
    const result = await reader.read();
    complete = result.done;
    if (result.done) continue;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new AppError("CATALOG_IMAGE_SIZE_INVALID", "Catalog images may not exceed 5 MiB.", 422);
    }
    chunks.push(result.value);
  }
  if (total === 0)
    throw new AppError("CATALOG_IMAGE_SIZE_INVALID", "Catalog images cannot be empty.", 422);
  return Buffer.concat(chunks, total);
}

function connectorHostname(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}
