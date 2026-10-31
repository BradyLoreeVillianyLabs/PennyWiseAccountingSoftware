import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

export interface LogoStorage {
  put(key: string, data: Buffer, mediaType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
export interface MalwareScanner {
  scan(data: Buffer): Promise<"CLEAN" | "REJECTED">;
}

export class DevelopmentLogoStorage implements LogoStorage {
  public constructor(private readonly root = resolve(process.cwd(), ".data", "logos")) {}
  public async put(key: string, data: Buffer) {
    const path = safePath(this.root, key);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, data, { flag: "wx" });
  }
  public async get(key: string) {
    return readFile(safePath(this.root, key));
  }
}

export class NoopDevelopmentScanner implements MalwareScanner {
  public scan(): Promise<"CLEAN"> {
    return Promise.resolve("CLEAN");
  }
}

export class LogoService {
  private readonly authorization: AuthorizationService;
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: LogoStorage,
    private readonly scanner: MalwareScanner
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async replace(context: OrganizationContext, data: Buffer) {
    await this.authorization.assert(context, "branding:manage", "LogoAsset");
    if (data.length === 0 || data.length > 2_097_152)
      throw new AppError("LOGO_SIZE_INVALID", "Logo must be between 1 byte and 2 MB.", 422);
    const image = inspectImageBytes(data);
    if (image.width > 2048 || image.height > 2048)
      throw new AppError(
        "LOGO_DIMENSIONS_INVALID",
        "Logo dimensions may not exceed 2048 by 2048 pixels.",
        422
      );
    const scanStatus = await this.scanner.scan(data);
    if (scanStatus !== "CLEAN")
      throw new AppError("LOGO_MALWARE_REJECTED", "Logo failed the security scan.", 422);
    const extension =
      image.mediaType === "image/png" ? "png" : image.mediaType === "image/jpeg" ? "jpg" : "webp";
    const storageKey = `${context.organizationId}/${randomUUID()}.${extension}`;
    await this.storage.put(storageKey, data, image.mediaType);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.logoAsset.updateMany({
        where: { organizationId: context.organizationId, active: true },
        data: { active: false, replacedAt: new Date() }
      });
      const asset = await tx.logoAsset.create({
        data: {
          organizationId: context.organizationId,
          storageKey,
          mediaType: image.mediaType,
          byteSize: data.length,
          width: image.width,
          height: image.height,
          checksum: createHash("sha256").update(data).digest("hex"),
          scanStatus: "CLEAN"
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "LOGO_REPLACED",
          targetType: "LogoAsset",
          targetId: asset.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            mediaType: asset.mediaType,
            byteSize: asset.byteSize,
            width: asset.width,
            height: asset.height,
            checksum: asset.checksum
          })
        }
      });
      return publicAsset(asset);
    });
  }

  /** Store a tenant-owned invoice image without replacing the active company logo. */
  public async uploadInvoiceBackground(context: OrganizationContext, data: Buffer) {
    await this.authorization.assert(context, "branding:manage", "LogoAsset");
    if (data.length === 0 || data.length > 4_194_304)
      throw new AppError(
        "INVOICE_BACKGROUND_SIZE_INVALID",
        "Invoice background images must be between 1 byte and 4 MB.",
        422
      );
    const image = inspectImageBytes(data);
    if (image.width > 4096 || image.height > 4096)
      throw new AppError(
        "INVOICE_BACKGROUND_DIMENSIONS_INVALID",
        "Invoice background images may not exceed 4096 by 4096 pixels.",
        422
      );
    const scanStatus = await this.scanner.scan(data);
    if (scanStatus !== "CLEAN")
      throw new AppError(
        "INVOICE_BACKGROUND_MALWARE_REJECTED",
        "Invoice background image failed the security scan.",
        422
      );
    const extension =
      image.mediaType === "image/png" ? "png" : image.mediaType === "image/jpeg" ? "jpg" : "webp";
    const storageKey = `${context.organizationId}/invoice-background-${randomUUID()}.${extension}`;
    await this.storage.put(storageKey, data, image.mediaType);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const asset = await tx.logoAsset.create({
        data: {
          organizationId: context.organizationId,
          storageKey,
          mediaType: image.mediaType,
          byteSize: data.length,
          width: image.width,
          height: image.height,
          checksum: createHash("sha256").update(data).digest("hex"),
          scanStatus: "CLEAN"
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "INVOICE_BACKGROUND_UPLOADED",
          targetType: "LogoAsset",
          targetId: asset.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            mediaType: asset.mediaType,
            byteSize: asset.byteSize,
            width: asset.width,
            height: asset.height,
            checksum: asset.checksum
          })
        }
      });
      return publicAsset(asset);
    });
  }

  public async read(context: OrganizationContext, assetId: string) {
    await this.authorization.assert(context, "settings:read", "LogoAsset", assetId);
    const asset = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.logoAsset.findFirst({ where: { id: assetId, organizationId: context.organizationId } })
    );
    if (!asset) throw new AppError("LOGO_NOT_FOUND", "Logo was not found.", 404);
    return { asset: publicAsset(asset), data: await this.storage.get(asset.storageKey) };
  }
}

export function inspectImageBytes(data: Buffer): {
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
} {
  if (
    data.length >= 33 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.readUInt32BE(8) === 13 &&
    data.toString("ascii", 12, 16) === "IHDR"
  )
    return { mediaType: "image/png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (
    data.length >= 12 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[data.length - 2] === 0xff &&
    data[data.length - 1] === 0xd9
  ) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1]!;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker
        )
      )
        return {
          mediaType: "image/jpeg",
          height: data.readUInt16BE(offset + 5),
          width: data.readUInt16BE(offset + 7)
        };
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = data.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += length + 2;
    }
  }
  if (
    data.length >= 30 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP" &&
    data.readUInt32LE(4) + 8 <= data.length
  ) {
    const kind = data.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return {
        mediaType: "image/webp",
        width: 1 + data.readUIntLE(24, 3),
        height: 1 + data.readUIntLE(27, 3)
      };
    if (kind === "VP8 " && data.length >= 30)
      return {
        mediaType: "image/webp",
        width: data.readUInt16LE(26) & 0x3fff,
        height: data.readUInt16LE(28) & 0x3fff
      };
    if (kind === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21);
      return {
        mediaType: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1
      };
    }
  }
  throw new AppError(
    "LOGO_CONTENT_INVALID",
    "Logo bytes are not a supported PNG, JPEG, or WebP image.",
    422
  );
}
function safePath(root: string, key: string) {
  const path = resolve(root, key);
  const prefix = `${resolve(root)}${sep}`;
  if (!path.startsWith(prefix) || key.includes("..")) throw new Error("Unsafe storage key");
  return path;
}
function publicAsset(asset: {
  id: string;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  checksum: string;
  scanStatus: string;
  active: boolean;
  createdAt: Date;
}) {
  return {
    id: asset.id,
    mediaType: asset.mediaType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    checksum: asset.checksum,
    scanStatus: asset.scanStatus,
    active: asset.active,
    createdAt: asset.createdAt.toISOString(),
    contentUrl: `/v1/setup/logo/${asset.id}/content`
  };
}
function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
