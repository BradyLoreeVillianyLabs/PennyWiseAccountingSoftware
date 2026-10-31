import { createHash } from "node:crypto";
import { parseQuantityMicros, serializeQuantityMicros } from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import type { DocumentStorage } from "./invoice-render-service.js";
import { renderPickingSlip } from "./picking-slip-render-service.js";

export interface ShortPickLineInput {
  readonly lineId: string;
  readonly pickedQuantity: string;
}

export class PickingSlipService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async createForInvoice(context: OrganizationContext, invoiceId: string) {
    await this.authorization.assert(context, "inventory:read", "PickingSlip", invoiceId);
    const existing = await this.findSlip(context, invoiceId);
    if (existing) {
      if (existing.generations.length)
        return {
          statusCode: 200,
          slip: slipDto(existing),
          generation: generationDto(existing.generations[0]),
          replayed: true
        };
      const generated = await this.generate(context, existing.id);
      return { statusCode: 200, ...generated, replayed: true };
    }
    const source = await this.loadInvoiceSource(context, invoiceId);
    const lineData: Prisma.PickingSlipLineUncheckedCreateWithoutPickingSlipInput[] =
      source.lines.map((line) => ({ ...line, invoiceLineId: line.invoiceLineId }));
    let slip;
    try {
      slip = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.pickingSlip.create({
          data: {
            organizationId: context.organizationId,
            invoiceId: source.invoiceId,
            status: "OPEN",
            createdByUserId: context.user.id,
            lines: { create: lineData }
          },
          include: { generations: true }
        })
      );
    } catch (error) {
      if (!isUnique(error)) throw error;
      const concurrent = await this.findSlip(context, invoiceId);
      if (!concurrent) throw error;
      if (concurrent.generations.length)
        return {
          statusCode: 200,
          slip: slipDto(concurrent),
          generation: generationDto(concurrent.generations[0]),
          replayed: true
        };
      const generated = await this.generate(context, concurrent.id);
      return { statusCode: 200, ...generated, replayed: true };
    }
    const generated = await this.generate(context, slip.id);
    return { statusCode: 201, ...generated, replayed: false };
  }

  public async createForSale(context: OrganizationContext, saleId: string) {
    await this.authorization.assert(context, "inventory:read", "PickingSlip", saleId);
    const sale = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.posSale.findFirst({
        where: { id: saleId, organizationId: context.organizationId },
        select: { invoiceId: true, status: true }
      })
    );
    if (!sale) throw new AppError("POS_SALE_NOT_FOUND", "POS sale was not found.", 404);
    if (!sale.invoiceId || sale.status !== "COMPLETED")
      throw new AppError(
        "PICKING_SLIP_SALE_NOT_COMPLETED",
        "A picking slip can only be generated for a completed sale.",
        409
      );
    return this.createForInvoice(context, sale.invoiceId);
  }

  public async get(context: OrganizationContext, pickingSlipId: string) {
    await this.authorization.assert(context, "inventory:read", "PickingSlip", pickingSlipId);
    const slip = await this.findSlipById(context, pickingSlipId);
    if (!slip) throw new AppError("PICKING_SLIP_NOT_FOUND", "Picking slip was not found.", 404);
    return slipDto(slip);
  }

  public async getForInvoice(context: OrganizationContext, invoiceId: string) {
    await this.authorization.assert(context, "inventory:read", "PickingSlip", invoiceId);
    const slip = await this.findSlip(context, invoiceId);
    if (!slip) throw new AppError("PICKING_SLIP_NOT_FOUND", "Picking slip was not found.", 404);
    return slipDto(slip);
  }

  public async reprint(context: OrganizationContext, pickingSlipId: string) {
    await this.authorization.assert(context, "inventory:read", "PickingSlip", pickingSlipId);
    return this.generate(context, pickingSlipId);
  }

  public async readPdf(context: OrganizationContext, pickingSlipId: string) {
    await this.authorization.assert(context, "inventory:read", "PickingSlip", pickingSlipId);
    const slip = await this.findSlipById(context, pickingSlipId);
    if (!slip) throw new AppError("PICKING_SLIP_NOT_FOUND", "Picking slip was not found.", 404);
    const generation = slip.generations[0];
    if (!generation)
      throw new AppError(
        "PICKING_SLIP_NOT_GENERATED",
        "The picking slip has not been generated.",
        409
      );
    return {
      generation: generationDto(generation),
      data: await this.storage.get(generation.storageKey)
    };
  }

  public async recordShortPick(
    context: OrganizationContext,
    pickingSlipId: string,
    input: readonly ShortPickLineInput[]
  ) {
    await this.authorization.assert(context, "inventory:count", "PickingSlip", pickingSlipId);
    if (!input.length || input.length > 500)
      throw new AppError(
        "PICKING_SLIP_PICK_LINES_REQUIRED",
        "Record every picking-slip line.",
        422
      );
    const result = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const slip = await tx.pickingSlip.findFirst({
        where: { id: pickingSlipId, organizationId: context.organizationId },
        include: { lines: true, shortPickCounts: { include: { lines: true } } }
      });
      if (!slip) throw new AppError("PICKING_SLIP_NOT_FOUND", "Picking slip was not found.", 404);
      if (slip.status === "PICKED")
        throw new AppError(
          "PICKING_SLIP_ALREADY_PICKED",
          "This picking slip is already complete.",
          409
        );
      const supplied = new Map<string, bigint>();
      for (const line of input) {
        if (supplied.has(line.lineId))
          throw new AppError(
            "PICKING_SLIP_DUPLICATE_LINE",
            "A picking line was supplied twice.",
            422
          );
        supplied.set(line.lineId, parsePickedQuantity(line.pickedQuantity));
      }
      if (supplied.size !== slip.lines.length || slip.lines.some((line) => !supplied.has(line.id)))
        throw new AppError(
          "PICKING_SLIP_PICK_LINES_REQUIRED",
          "Record every picking-slip line.",
          422
        );
      const picked = slip.lines.map((line) => {
        const pickedQuantity = supplied.get(line.id)!;
        if (pickedQuantity > line.quantityToPick)
          throw new AppError(
            "PICKING_SLIP_PICK_QUANTITY_INVALID",
            "Picked quantity cannot exceed the quantity to pick.",
            422
          );
        return { line, pickedQuantity };
      });
      const shortLines = picked.filter(
        ({ line, pickedQuantity }) => pickedQuantity < line.quantityToPick
      );
      for (const { line, pickedQuantity } of picked)
        await tx.pickingSlipLine.update({
          where: { id: line.id },
          data: { pickedQuantityMicros: pickedQuantity }
        });
      if (!shortLines.length) {
        const updated = await tx.pickingSlip.update({
          where: { id: slip.id },
          data: { status: "PICKED", version: { increment: 1 } },
          include: {
            lines: true,
            generations: { orderBy: [{ generationNumber: "desc" }] },
            shortPickCounts: { include: { lines: true } }
          }
        });
        await audit(tx, context, "PICKING_SLIP_PICKED", slip.id, {
          lineCount: picked.length,
          accountingEntriesCreated: 0,
          inventoryQuantityChanged: false
        });
        return { slip: updated, countIds: [] as string[] };
      }
      const grouped = new Map<string, Set<string>>();
      for (const { line } of shortLines) {
        if (!line.locationId)
          throw new AppError(
            "PICKING_SLIP_LOCATION_REQUIRED",
            "A short pick needs a location for the existing count workflow.",
            422
          );
        const products = grouped.get(line.locationId) ?? new Set<string>();
        if (line.productItemId) products.add(line.productItemId);
        grouped.set(line.locationId, products);
      }
      const countIds: string[] = [];
      for (const [locationId, productIds] of grouped) {
        if (!productIds.size) continue;
        const balances = await tx.inventoryBalance.findMany({
          where: {
            organizationId: context.organizationId,
            locationId,
            productItemId: { in: [...productIds] }
          },
          select: { productItemId: true, quantityOnHandMicros: true }
        });
        const expected = new Map(
          balances.map((balance) => [balance.productItemId, balance.quantityOnHandMicros])
        );
        const count = await tx.inventoryCount.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            pickingSlipId: slip.id,
            locationId,
            countNumber: `SHORT-PICK-${slip.id.slice(0, 8).toUpperCase()}-${locationId.slice(0, 8).toUpperCase()}`,
            blind: false,
            status: "RELEASED",
            createdByUserId: context.user.id,
            lines: {
              create: [...productIds].map((productItemId) => ({
                organizationId: context.organizationId,
                companyId: context.companyId ?? null,
                productItemId,
                expectedMicros: expected.get(productItemId) ?? 0n
              }))
            }
          }
        });
        countIds.push(count.id);
        await audit(tx, context, "PICKING_SLIP_SHORT_PICK_REVIEW_CREATED", count.id, {
          pickingSlipId: slip.id,
          locationId,
          productItemIds: [...productIds],
          accountingEntriesCreated: 0,
          inventoryQuantityChanged: false
        });
      }
      const updated = await tx.pickingSlip.update({
        where: { id: slip.id },
        data: { status: "SHORT_PICK", version: { increment: 1 } },
        include: {
          lines: true,
          generations: { orderBy: [{ generationNumber: "desc" }] },
          shortPickCounts: { include: { lines: true } }
        }
      });
      await audit(tx, context, "PICKING_SLIP_SHORT_PICK_RECORDED", slip.id, {
        shortLineCount: shortLines.length,
        countIds,
        accountingEntriesCreated: 0,
        inventoryQuantityChanged: false
      });
      return { slip: updated, countIds };
    });
    return { slip: slipDto(result.slip), countIds: result.countIds, accountingEntriesCreated: 0 };
  }

  private async generate(context: OrganizationContext, pickingSlipId: string) {
    const source = await this.loadSlipForRender(context, pickingSlipId);
    if (!source) throw new AppError("PICKING_SLIP_NOT_FOUND", "Picking slip was not found.", 404);
    const images = new Map<string, Buffer>();
    for (const line of source.lines) {
      if (!line.imageAsset) continue;
      try {
        images.set(line.imageAsset.id, await this.storage.get(line.imageAsset.storageKey));
      } catch {
        // A missing thumbnail is equivalent to a product without an image.
        // The operational document remains printable and does not fetch remotely.
      }
    }
    const rendered = await renderPickingSlip({
      organizationName: source.organizationName,
      orderReference: source.invoiceNumber ?? source.provisionalIdentifier,
      date: source.issueDate.toISOString().slice(0, 10),
      customerName: source.customerName,
      lines: source.lines
        .slice()
        .sort(compareLines)
        .map((line) => ({
          description: line.descriptionSnapshot,
          variantAttributes: formatVariantAttributes(line.variantAttributes),
          sku: line.skuSnapshot,
          barcode: line.barcodeSnapshot!,
          quantity: serializeQuantityMicros(line.quantityToPick),
          location: line.locationSnapshot ?? "No location assigned",
          bin: line.binSnapshot,
          image: line.imageAsset ? (images.get(line.imageAsset.id) ?? null) : null
        }))
    });
    const result = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PickingSlip" WHERE "id" = ${pickingSlipId}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
      const slip = await tx.pickingSlip.findFirst({
        where: { id: pickingSlipId, organizationId: context.organizationId },
        include: { lines: true, generations: { orderBy: [{ generationNumber: "desc" }] } }
      });
      if (!slip) throw new AppError("PICKING_SLIP_NOT_FOUND", "Picking slip was not found.", 404);
      const generationNumber = (slip.generations[0]?.generationNumber ?? 0) + 1;
      const storageKey = `${context.organizationId}/picking-slips/${slip.id}/generation-${String(generationNumber)}.pdf`;
      await this.storage.put(storageKey, rendered.data, "application/pdf");
      const generation = await tx.pickingSlipGeneration.create({
        data: {
          organizationId: context.organizationId,
          pickingSlipId: slip.id,
          generationNumber,
          storageKey,
          checksum: sha256(rendered.data),
          byteSize: rendered.data.length,
          pageCount: rendered.pageCount,
          generatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "PICKING_SLIP_GENERATED", generation.id, {
        pickingSlipId: slip.id,
        generationNumber,
        checksum: generation.checksum,
        pageCount: generation.pageCount,
        accountingEntriesCreated: 0,
        inventoryQuantityChanged: false
      });
      const refreshed = await tx.pickingSlip.findFirstOrThrow({
        where: { id: slip.id, organizationId: context.organizationId },
        include: {
          lines: true,
          generations: { orderBy: [{ generationNumber: "desc" }] },
          shortPickCounts: { include: { lines: true } }
        }
      });
      return { slip: refreshed, generation };
    });
    return { slip: slipDto(result.slip), generation: generationDto(result.generation) };
  }

  private async loadInvoiceSource(context: OrganizationContext, invoiceId: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: context.organizationId },
        include: {
          organization: { select: { displayName: true } },
          customer: { select: { displayName: true } },
          commerceInboxEvent: { select: { installationId: true, normalizedPayload: true } },
          lines: {
            orderBy: [{ lineNumber: "asc" }],
            include: {
              productItem: {
                include: {
                  defaultLocation: { select: { id: true, code: true, name: true } },
                  barcodes: {
                    where: { active: true },
                    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
                  },
                  imageAssets: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] }
                }
              }
            }
          }
        }
      });
      if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
      if (invoice.status !== "POSTED")
        throw new AppError(
          "PICKING_SLIP_INVOICE_NOT_POSTED",
          "A picking slip can only be generated from a posted invoice.",
          409
        );
      const normalizedLines = normalizedCommerceLines(
        invoice.commerceInboxEvent?.normalizedPayload
      );
      const variationIds = normalizedLines
        .map((line) => line.variationExternalId)
        .filter((value): value is string => Boolean(value));
      const variants =
        invoice.commerceInboxEvent && variationIds.length
          ? await tx.externalCatalogVariant.findMany({
              where: {
                organizationId: context.organizationId,
                installationId: invoice.commerceInboxEvent.installationId,
                externalVariantId: { in: [...new Set(variationIds)] }
              },
              select: { externalVariantId: true, variantSignature: true }
            })
          : [];
      const variantByExternalId = new Map(
        variants.map((variant) => [variant.externalVariantId, variant.variantSignature])
      );
      const lines = [];
      for (const line of invoice.lines) {
        if (!line.productItem) continue;
        const product = line.productItem;
        const location = product.defaultLocation;
        const movement = location
          ? await tx.inventoryMovement.findFirst({
              where: {
                organizationId: context.organizationId,
                productItemId: product.id,
                locationId: location.id,
                binId: { not: null },
                bin: { isActive: true }
              },
              include: {
                bin: { select: { id: true, code: true, name: true, pickPriority: true } }
              },
              orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }]
            })
          : null;
        const normalizedLine = normalizedLines[line.lineNumber - 1];
        const variantSignature = normalizedLine?.variationExternalId
          ? variantByExternalId.get(normalizedLine.variationExternalId)
          : null;
        const barcode = product.barcodes[0]?.code ?? product.gtin ?? product.sku;
        if (!barcode || !isCode128Text(barcode))
          throw new AppError(
            "PICKING_SLIP_BARCODE_REQUIRED",
            `Product ${product.name} needs an ASCII barcode, GTIN, or SKU before it can be picked.`,
            422,
            { productItemId: product.id, lineNumber: line.lineNumber }
          );
        if (line.quantityMicros <= 0n)
          throw new AppError(
            "PICKING_SLIP_QUANTITY_INVALID",
            "Picking quantities must be positive.",
            422
          );
        lines.push({
          organizationId: context.organizationId,
          lineNumber: line.lineNumber,
          invoiceLineId: line.id,
          descriptionSnapshot: line.description,
          variantAttributes:
            variantSignature &&
            typeof variantSignature === "object" &&
            !Array.isArray(variantSignature)
              ? (variantSignature as Prisma.InputJsonObject)
              : Prisma.JsonNull,
          skuSnapshot: product.sku,
          barcodeSnapshot: barcode,
          quantityToPick: line.quantityMicros,
          productItemId: product.id,
          locationId: location?.id ?? null,
          binId: movement?.bin?.id ?? null,
          locationSnapshot: location ? `${location.code} - ${location.name}` : null,
          binSnapshot: movement?.bin ? `${movement.bin.code} - ${movement.bin.name}` : null,
          binPriority: movement?.bin?.pickPriority ?? null,
          imageAssetId: product.imageAssets[0]?.id ?? null
        });
      }
      if (!lines.length)
        throw new AppError(
          "PICKING_SLIP_NO_PICKABLE_LINES",
          "The invoice has no product lines to pick.",
          422
        );
      return {
        invoiceId: invoice.id,
        organizationName: invoice.organization.displayName,
        invoiceNumber: invoice.invoiceNumber,
        provisionalIdentifier: invoice.provisionalIdentifier,
        issueDate: invoice.issueDate,
        customerName: invoice.customer.displayName,
        lines
      };
    });
  }

  private async findSlip(context: OrganizationContext, invoiceId: string) {
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.pickingSlip.findFirst({
        where: { invoiceId, organizationId: context.organizationId },
        include: {
          lines: true,
          generations: { orderBy: [{ generationNumber: "desc" }] },
          shortPickCounts: { include: { lines: true } }
        }
      })
    );
  }

  private async findSlipById(context: OrganizationContext, pickingSlipId: string) {
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.pickingSlip.findFirst({
        where: { id: pickingSlipId, organizationId: context.organizationId },
        include: {
          lines: true,
          generations: { orderBy: [{ generationNumber: "desc" }] },
          shortPickCounts: { include: { lines: true } }
        }
      })
    );
  }

  private async loadSlipForRender(context: OrganizationContext, pickingSlipId: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const slip = await tx.pickingSlip.findFirst({
        where: { id: pickingSlipId, organizationId: context.organizationId },
        include: {
          invoice: {
            select: {
              invoiceNumber: true,
              provisionalIdentifier: true,
              issueDate: true,
              customerNameSnapshot: true,
              organization: { select: { displayName: true } }
            }
          },
          lines: {
            include: { imageAsset: true }
          }
        }
      });
      if (!slip) return null;
      return {
        organizationName: slip.invoice.organization.displayName,
        invoiceNumber: slip.invoice.invoiceNumber,
        provisionalIdentifier: slip.invoice.provisionalIdentifier,
        issueDate: slip.invoice.issueDate,
        customerName: slip.invoice.customerNameSnapshot,
        lines: slip.lines
      };
    });
  }
}

function normalizedCommerceLines(value: Prisma.JsonValue | null | undefined): readonly {
  variationExternalId: string | null;
}[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const lines = (value as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line))
      return { variationExternalId: null };
    const value = (line as { variationExternalId?: unknown }).variationExternalId;
    return { variationExternalId: typeof value === "string" ? value : null };
  });
}

function formatVariantAttributes(value: Prisma.JsonValue | null): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      ([, entry]) =>
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
    )
    .map(([key, entry]) => `${key}: ${String(entry)}`);
  return entries.length ? entries.join(" | ") : null;
}

function compareLines(
  left: {
    locationSnapshot: string | null;
    binSnapshot: string | null;
    binPriority: number | null;
    lineNumber: number;
  },
  right: {
    locationSnapshot: string | null;
    binSnapshot: string | null;
    binPriority: number | null;
    lineNumber: number;
  }
) {
  if (left.locationSnapshot === null && right.locationSnapshot !== null) return 1;
  if (left.locationSnapshot !== null && right.locationSnapshot === null) return -1;
  const location = (left.locationSnapshot ?? "").localeCompare(right.locationSnapshot ?? "");
  if (location) return location;
  if (left.binSnapshot === null && right.binSnapshot !== null) return 1;
  if (left.binSnapshot !== null && right.binSnapshot === null) return -1;
  const priority =
    (right.binPriority ?? Number.MIN_SAFE_INTEGER) - (left.binPriority ?? Number.MIN_SAFE_INTEGER);
  if (priority) return priority;
  const bin = (left.binSnapshot ?? "").localeCompare(right.binSnapshot ?? "");
  return bin || left.lineNumber - right.lineNumber;
}

function parsePickedQuantity(value: string) {
  if (value === "0") return 0n;
  return parseQuantityMicros(value, "pickedQuantity");
}

function isCode128Text(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 0x20 || codePoint > 0x7e) return false;
  }
  return true;
}

function slipDto(value: unknown) {
  return toJsonSafe(value);
}

function generationDto(value: unknown) {
  return toJsonSafe(value);
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>).map(([key, entry]) => [
        key,
        toJsonSafe(entry)
      ])
    );
  return value;
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function audit(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType: action.startsWith("PICKING_SLIP_SHORT_PICK_REVIEW")
        ? "InventoryCount"
        : "PickingSlip",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
