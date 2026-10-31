import { randomUUID } from "node:crypto";
import {
  applyInbound,
  applyOutbound,
  averageUnitCostMicros,
  assertPosition,
  parseMinorUnit,
  parseQuantityMicros,
  receiptValueMinor,
  roundRatioHalfUp
} from "@clearledger/accounting-core";
import { Prisma, RuntimePrisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import { JournalService } from "./journal-service.js";

type Tx = Prisma.TransactionClient;
type Direction = "IN" | "OUT";

export interface InventoryBinInput {
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
  readonly pickPriority?: number | undefined;
  readonly capacityMicros?: string | null | undefined;
}

export interface InventoryStatusInput {
  readonly code: string;
  readonly name: string;
  readonly sellable?: boolean | undefined;
  readonly allocatable?: boolean | undefined;
}

export interface InventoryLocationInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly address?: Prisma.InputJsonValue | undefined;
  readonly isDefault?: boolean | undefined;
}

interface MovementInput {
  readonly eventId: string;
  readonly movementType:
    | "OPENING_QUANTITY"
    | "PURCHASE_RECEIPT"
    | "SALE"
    | "CUSTOMER_RETURN"
    | "VENDOR_RETURN"
    | "INCREASE_ADJUSTMENT"
    | "DECREASE_ADJUSTMENT"
    | "WRITE_OFF"
    | "TRANSFER_OUT"
    | "TRANSFER_IN"
    | "REVERSAL";
  readonly productItemId: string;
  readonly locationId: string;
  readonly quantityMicros: bigint;
  readonly direction: Direction;
  readonly inboundValueMinor?: bigint | undefined;
  readonly outboundValueMinor?: bigint | undefined;
  readonly eventDate: Date;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceLineId?: string | null | undefined;
  readonly billLineId?: string | null | undefined;
  readonly invoiceLineId?: string | null | undefined;
  readonly creditNoteLineId?: string | null | undefined;
  readonly vendorCreditLineId?: string | null | undefined;
  readonly offsetAccountId?: string | null | undefined;
  readonly adjustmentKind?:
    | "OPENING"
    | "COUNT_CORRECTION"
    | "DAMAGE"
    | "THEFT_LOSS"
    | "SPOILAGE"
    | "FOUND_STOCK"
    | undefined;
  readonly returnDisposition?: "RESTOCK" | "WRITE_OFF" | undefined;
  readonly reason?: string | null | undefined;
  readonly reversalOfMovementId?: string | null | undefined;
  readonly binId?: string | null | undefined;
  readonly statusId?: string | null | undefined;
  readonly lotId?: string | null | undefined;
  readonly serialId?: string | null | undefined;
  readonly reservationId?: string | null | undefined;
  readonly suppressJournal?: boolean | undefined;
}

export class InventoryService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
  }

  public async listLocations(context: OrganizationContext, active?: boolean) {
    await this.authorization.assert(context, "inventory:read", "InventoryLocation");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      (
        await tx.inventoryLocation.findMany({
          where: {
            organizationId: context.organizationId,
            ...(active === undefined ? {} : { isActive: active })
          },
          orderBy: [{ isDefault: "desc" }, { code: "asc" }]
        })
      ).map(locationDto)
    );
  }

  public async createLocation(context: OrganizationContext, input: InventoryLocationInput) {
    await this.authorization.assert(context, "inventory:configure", "InventoryLocation");
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        if (input.isDefault)
          await tx.inventoryLocation.updateMany({
            where: { organizationId: context.organizationId, isDefault: true },
            data: { isDefault: false, updatedByUserId: context.user.id, version: { increment: 1 } }
          });
        const row = await tx.inventoryLocation.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            description: input.description ?? null,
            address: input.address ?? Prisma.JsonNull,
            isDefault: input.isDefault ?? false,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "INVENTORY_LOCATION_CREATED", "InventoryLocation", row.id, {
          code: row.code
        });
        return locationDto(row);
      });
    } catch (error) {
      if (isUnique(error))
        throw new AppError("INVENTORY_LOCATION_EXISTS", "Inventory location code exists.", 409);
      throw error;
    }
  }

  public async updateLocation(
    context: OrganizationContext,
    id: string,
    version: number,
    input: {
      readonly code?: string | undefined;
      readonly name?: string | undefined;
      readonly description?: string | null | undefined;
      readonly address?: Prisma.InputJsonValue | undefined;
      readonly isDefault?: boolean | undefined;
    }
  ) {
    await this.authorization.assert(context, "inventory:configure", "InventoryLocation", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (input.isDefault)
        await tx.inventoryLocation.updateMany({
          where: { organizationId: context.organizationId, isDefault: true, id: { not: id } },
          data: { isDefault: false, updatedByUserId: context.user.id, version: { increment: 1 } }
        });
      const changed = await tx.inventoryLocation.updateMany({
        where: { id, organizationId: context.organizationId, version, isActive: true },
        data: {
          ...(input.code === undefined ? {} : { code: input.code.trim().toUpperCase() }),
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.address === undefined ? {} : { address: input.address }),
          ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError("STALE_INVENTORY_LOCATION", "Location changed or is inactive.", 409);
      const row = await tx.inventoryLocation.findUniqueOrThrow({ where: { id } });
      await audit(tx, context, "INVENTORY_LOCATION_UPDATED", "InventoryLocation", id, {});
      return locationDto(row);
    });
  }

  public async archiveLocation(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "inventory:configure", "InventoryLocation", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const nonzero = await tx.inventoryBalance.findFirst({
        where: {
          organizationId: context.organizationId,
          locationId: id,
          quantityOnHandMicros: { gt: 0 }
        }
      });
      if (nonzero)
        throw new AppError(
          "INVENTORY_LOCATION_NOT_EMPTY",
          "Transfer or adjust all inventory before archiving this location.",
          409
        );
      const changed = await tx.inventoryLocation.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version,
          isActive: true,
          isDefault: false
        },
        data: {
          isActive: false,
          archivedAt: new Date(),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "INVENTORY_LOCATION_NOT_ARCHIVABLE",
          "Default, inactive, or stale locations cannot be archived.",
          409
        );
      await audit(tx, context, "INVENTORY_LOCATION_ARCHIVED", "InventoryLocation", id, {});
      return { id, archived: true };
    });
  }

  public async receivePurchase(
    context: OrganizationContext,
    input: {
      billLineId: string;
      quantity: string;
      locationId?: string | undefined;
      receivedDate: string;
      reason?: string | undefined;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "inventory:receive", "BillLine", input.billLineId);
    const quantityMicros = parseQuantityMicros(input.quantity);
    return runIdempotent(
      this.prisma,
      context,
      "inventory.purchase-receipt",
      idempotencyKey,
      input,
      async (tx) => {
        const line = await tx.billLine.findFirst({
          where: {
            id: input.billLineId,
            organizationId: context.organizationId,
            productItemId: { not: null },
            bill: { status: "POSTED" }
          },
          include: { bill: true, productItem: true }
        });
        if (!line || !line.productItem)
          throw new AppError(
            "INVENTORY_BILL_LINE_NOT_FOUND",
            "A posted inventory bill line was not found.",
            404
          );
        const already = await receivedQuantity(tx, context.organizationId, line.id);
        if (already + quantityMicros > line.quantityMicros)
          throw new AppError(
            "PURCHASE_RECEIPT_EXCEEDS_BILL",
            "Received quantity cannot exceed the billed quantity.",
            422
          );
        const acquisitionTotal = line.netAmountMinor + line.nonRecoverableTaxMinor;
        const receivedValue =
          already + quantityMicros === line.quantityMicros
            ? acquisitionTotal - (await receivedValueTotal(tx, context.organizationId, line.id))
            : roundRatioHalfUp(acquisitionTotal * quantityMicros, line.quantityMicros);
        const eventId = randomUUID();
        const movement = await recordMovement(tx, context, this.journals, {
          eventId,
          movementType: "PURCHASE_RECEIPT",
          productItemId: line.productItem.id,
          locationId: input.locationId ?? requiredDefaultLocation(line.productItem),
          quantityMicros,
          direction: "IN",
          inboundValueMinor: receivedValue,
          eventDate: parseDate(input.receivedDate, "receivedDate"),
          sourceType: "bill_receipt",
          sourceId: eventId,
          sourceLineId: line.id,
          billLineId: line.id,
          offsetAccountId: requiredAccount(line.productItem.purchaseClearingAccountId),
          reason: input.reason
        });
        await inventoryAudit(tx, context, "INVENTORY_PURCHASE_RECEIVED", eventId, movement);
        return {
          statusCode: 201,
          body: { movement: movementDto(movement) },
          resourceId: movement.id
        };
      }
    );
  }

  public async adjust(
    context: OrganizationContext,
    input: {
      productItemId: string;
      locationId?: string | undefined;
      direction: Direction;
      quantity: string;
      unitCostMinor?: string | undefined;
      adjustmentKind:
        | "OPENING"
        | "COUNT_CORRECTION"
        | "DAMAGE"
        | "THEFT_LOSS"
        | "SPOILAGE"
        | "FOUND_STOCK";
      effectiveDate: string;
      reason: string;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "inventory:adjust",
      "ProductItem",
      input.productItemId
    );
    const quantityMicros = parseQuantityMicros(input.quantity);
    return runIdempotent(
      this.prisma,
      context,
      "inventory.adjust",
      idempotencyKey,
      input,
      async (tx) => {
        const product = await inventoryProduct(
          tx,
          context.organizationId,
          context.companyId,
          input.productItemId
        );
        const inboundValue =
          input.direction === "IN"
            ? receiptValueMinor(
                quantityMicros,
                parseMinorUnit(input.unitCostMinor ?? "", "unitCostMinor")
              )
            : undefined;
        const eventId = randomUUID();
        const movement = await recordMovement(tx, context, this.journals, {
          eventId,
          movementType:
            input.adjustmentKind === "OPENING"
              ? "OPENING_QUANTITY"
              : input.direction === "IN"
                ? "INCREASE_ADJUSTMENT"
                : ["DAMAGE", "THEFT_LOSS", "SPOILAGE"].includes(input.adjustmentKind)
                  ? "WRITE_OFF"
                  : "DECREASE_ADJUSTMENT",
          productItemId: product.id,
          locationId: input.locationId ?? requiredDefaultLocation(product),
          quantityMicros,
          direction: input.direction,
          inboundValueMinor: inboundValue,
          eventDate: parseDate(input.effectiveDate, "effectiveDate"),
          sourceType: "inventory_adjustment",
          sourceId: eventId,
          adjustmentKind: input.adjustmentKind,
          offsetAccountId:
            input.direction === "IN"
              ? requiredAccount(product.adjustmentGainAccountId)
              : requiredAccount(product.inventoryLossAccountId),
          reason: input.reason
        });
        await inventoryAudit(tx, context, "INVENTORY_ADJUSTED", eventId, movement);
        return {
          statusCode: 201,
          body: { movement: movementDto(movement) },
          resourceId: movement.id
        };
      }
    );
  }

  public async transfer(
    context: OrganizationContext,
    input: {
      productItemId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: string;
      effectiveDate: string;
      reason?: string | undefined;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "inventory:transfer",
      "ProductItem",
      input.productItemId
    );
    if (input.fromLocationId === input.toLocationId)
      throw new AppError("INVENTORY_TRANSFER_INVALID", "Transfer locations must differ.", 422);
    const quantityMicros = parseQuantityMicros(input.quantity);
    return runIdempotent(
      this.prisma,
      context,
      "inventory.transfer",
      idempotencyKey,
      input,
      async (tx) => {
        await lockProduct(tx, context.organizationId, input.productItemId);
        const product = await inventoryProduct(
          tx,
          context.organizationId,
          context.companyId,
          input.productItemId
        );
        const eventId = randomUUID();
        const date = parseDate(input.effectiveDate, "effectiveDate");
        const outbound = await recordMovement(tx, context, this.journals, {
          eventId,
          movementType: "TRANSFER_OUT",
          productItemId: product.id,
          locationId: input.fromLocationId,
          quantityMicros,
          direction: "OUT",
          eventDate: date,
          sourceType: "inventory_transfer",
          sourceId: eventId,
          reason: input.reason,
          suppressJournal: true
        });
        const inbound = await recordMovement(tx, context, this.journals, {
          eventId,
          movementType: "TRANSFER_IN",
          productItemId: product.id,
          locationId: input.toLocationId,
          quantityMicros,
          direction: "IN",
          inboundValueMinor: -outbound.totalValueMinor,
          eventDate: date,
          sourceType: "inventory_transfer",
          sourceId: eventId,
          reason: input.reason,
          suppressJournal: true
        });
        await inventoryAudit(tx, context, "INVENTORY_TRANSFERRED", eventId, outbound);
        return {
          statusCode: 201,
          body: { movements: [movementDto(outbound), movementDto(inbound)] },
          resourceId: eventId
        };
      }
    );
  }

  public async customerReturn(
    context: OrganizationContext,
    input: {
      creditNoteLineId: string;
      quantity: string;
      locationId?: string | undefined;
      disposition: "RESTOCK" | "WRITE_OFF";
      returnDate: string;
      reason: string;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "inventory:returns",
      "CreditNoteLine",
      input.creditNoteLineId
    );
    const quantityMicros = parseQuantityMicros(input.quantity);
    return runIdempotent(
      this.prisma,
      context,
      "inventory.customer-return",
      idempotencyKey,
      input,
      async (tx) => {
        const creditLine = await tx.creditNoteLine.findFirst({
          where: {
            id: input.creditNoteLineId,
            organizationId: context.organizationId,
            creditNote: { status: "POSTED" },
            invoiceLine: { productItem: { itemType: "INVENTORY_PRODUCT" } }
          },
          include: {
            creditNote: true,
            invoiceLine: { include: { productItem: true } }
          }
        });
        if (!creditLine || !creditLine.invoiceLine.productItem)
          throw new AppError(
            "INVENTORY_CREDIT_LINE_NOT_FOUND",
            "A posted credit line for an inventory product was not found.",
            404
          );
        if (quantityMicros > creditLine.quantityMicros)
          throw new AppError(
            "CUSTOMER_RETURN_EXCEEDS_CREDIT",
            "Returned quantity cannot exceed the credit-note quantity.",
            422
          );
        const original = await tx.inventoryMovement.findFirst({
          where: {
            organizationId: context.organizationId,
            invoiceLineId: creditLine.invoiceLineId,
            movementType: "SALE"
          }
        });
        if (!original)
          throw new AppError(
            "INVENTORY_SALE_NOT_FOUND",
            "Original inventory sale was not found.",
            409
          );
        const previous = await tx.inventoryMovement.aggregate({
          where: {
            organizationId: context.organizationId,
            invoiceLineId: creditLine.invoiceLineId,
            movementType: "CUSTOMER_RETURN"
          },
          _sum: { quantityMicros: true, totalValueMinor: true }
        });
        const returnedQuantity = previous._sum.quantityMicros ?? 0n;
        if (returnedQuantity + quantityMicros > -original.quantityMicros)
          throw new AppError(
            "CUSTOMER_RETURN_EXCEEDS_SALE",
            "Cumulative returns cannot exceed the original sale quantity.",
            422
          );
        const returnValue =
          returnedQuantity + quantityMicros === -original.quantityMicros
            ? -original.totalValueMinor - (previous._sum.totalValueMinor ?? 0n)
            : roundRatioHalfUp(
                -original.totalValueMinor * quantityMicros,
                -original.quantityMicros
              );
        const product = creditLine.invoiceLine.productItem;
        const locationId = input.locationId ?? original.locationId;
        const eventId = randomUUID();
        const returned = await recordMovement(tx, context, this.journals, {
          eventId,
          movementType: "CUSTOMER_RETURN",
          productItemId: product.id,
          locationId,
          quantityMicros,
          direction: "IN",
          inboundValueMinor: returnValue,
          eventDate: parseDate(input.returnDate, "returnDate"),
          sourceType: "customer_return",
          sourceId: eventId,
          sourceLineId: creditLine.id,
          invoiceLineId: creditLine.invoiceLineId,
          creditNoteLineId: creditLine.id,
          offsetAccountId: requiredAccount(product.costOfGoodsSoldAccountId),
          returnDisposition: input.disposition,
          reason: input.reason
        });
        const movements = [returned];
        if (input.disposition === "WRITE_OFF")
          movements.push(
            await recordMovement(tx, context, this.journals, {
              eventId,
              movementType: "WRITE_OFF",
              productItemId: product.id,
              locationId,
              quantityMicros,
              direction: "OUT",
              outboundValueMinor: returnValue,
              eventDate: parseDate(input.returnDate, "returnDate"),
              sourceType: "customer_return_writeoff",
              sourceId: eventId,
              sourceLineId: creditLine.id,
              invoiceLineId: creditLine.invoiceLineId,
              creditNoteLineId: creditLine.id,
              offsetAccountId: requiredAccount(product.inventoryLossAccountId),
              adjustmentKind: "DAMAGE",
              returnDisposition: "WRITE_OFF",
              reason: input.reason
            })
          );
        await inventoryAudit(tx, context, "INVENTORY_CUSTOMER_RETURNED", eventId, returned);
        return {
          statusCode: 201,
          body: { movements: movements.map(movementDto) },
          resourceId: eventId
        };
      }
    );
  }

  public async vendorReturn(
    context: OrganizationContext,
    input: {
      vendorCreditLineId: string;
      quantity: string;
      locationId?: string | undefined;
      returnDate: string;
      reason: string;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "inventory:returns",
      "VendorCreditLine",
      input.vendorCreditLineId
    );
    const quantityMicros = parseQuantityMicros(input.quantity);
    return runIdempotent(
      this.prisma,
      context,
      "inventory.vendor-return",
      idempotencyKey,
      input,
      async (tx) => {
        const creditLine = await tx.vendorCreditLine.findFirst({
          where: {
            id: input.vendorCreditLineId,
            organizationId: context.organizationId,
            vendorCredit: { status: { in: ["POSTED", "APPLIED"] } },
            billLine: { productItem: { itemType: "INVENTORY_PRODUCT" } }
          },
          include: {
            vendorCredit: true,
            billLine: { include: { productItem: true } }
          }
        });
        if (!creditLine?.billLine?.productItem)
          throw new AppError(
            "INVENTORY_VENDOR_CREDIT_LINE_NOT_FOUND",
            "A posted vendor-credit line for received inventory was not found.",
            404
          );
        const received = await receivedQuantity(tx, context.organizationId, creditLine.billLine.id);
        const previous = await tx.inventoryMovement.aggregate({
          where: {
            organizationId: context.organizationId,
            billLineId: creditLine.billLine.id,
            movementType: "VENDOR_RETURN"
          },
          _sum: { quantityMicros: true }
        });
        const alreadyReturned = -(previous._sum.quantityMicros ?? 0n);
        if (alreadyReturned + quantityMicros > received)
          throw new AppError(
            "VENDOR_RETURN_EXCEEDS_RECEIPTS",
            "Cumulative vendor returns cannot exceed received quantity.",
            422
          );
        const product = creditLine.billLine.productItem;
        const eventId = randomUUID();
        const movement = await recordMovement(tx, context, this.journals, {
          eventId,
          movementType: "VENDOR_RETURN",
          productItemId: product.id,
          locationId: input.locationId ?? requiredDefaultLocation(product),
          quantityMicros,
          direction: "OUT",
          eventDate: parseDate(input.returnDate, "returnDate"),
          sourceType: "vendor_return",
          sourceId: eventId,
          sourceLineId: creditLine.id,
          billLineId: creditLine.billLine.id,
          vendorCreditLineId: creditLine.id,
          offsetAccountId: requiredAccount(product.purchaseClearingAccountId),
          reason: input.reason
        });
        await inventoryAudit(tx, context, "INVENTORY_VENDOR_RETURNED", eventId, movement);
        return {
          statusCode: 201,
          body: { movement: movementDto(movement) },
          resourceId: movement.id
        };
      }
    );
  }

  public async listBins(context: OrganizationContext, locationId?: string) {
    await this.authorization.assert(context, "inventory:read", "InventoryBin");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryBin.findMany({
        where: {
          organizationId: context.organizationId,
          ...(locationId ? { locationId } : {}),
          isActive: true
        },
        orderBy: [{ pickPriority: "desc" }, { code: "asc" }]
      });
      return rows.map(binDto);
    });
  }

  public async createBin(context: OrganizationContext, input: InventoryBinInput) {
    await this.authorization.assert(context, "inventory:configure", "InventoryBin");
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const location = await activeLocation(
          tx,
          context.organizationId,
          input.locationId,
          context.companyId
        );
        const row = await tx.inventoryBin.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? location.companyId,
            locationId: location.id,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            pickPriority: input.pickPriority ?? 0,
            capacityMicros:
              input.capacityMicros == null ? null : parseQuantityMicros(input.capacityMicros),
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "INVENTORY_BIN_CREATED", "InventoryBin", row.id, {
          locationId: row.locationId,
          code: row.code
        });
        return binDto(row);
      });
    } catch (error) {
      if (isUnique(error))
        throw new AppError("INVENTORY_BIN_EXISTS", "Bin code is already in use.", 409);
      throw error;
    }
  }

  public async listStatuses(context: OrganizationContext) {
    await this.authorization.assert(context, "inventory:read", "InventoryStatus");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryStatus.findMany({
        where: { organizationId: context.organizationId, isActive: true },
        orderBy: [{ allocatable: "desc" }, { code: "asc" }]
      });
      return rows.map(statusDto);
    });
  }

  public async createStatus(context: OrganizationContext, input: InventoryStatusInput) {
    await this.authorization.assert(context, "inventory:configure", "InventoryStatus");
    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const row = await tx.inventoryStatus.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            sellable: input.sellable ?? true,
            allocatable: input.allocatable ?? true,
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "INVENTORY_STATUS_CREATED", "InventoryStatus", row.id, {
          code: row.code,
          allocatable: row.allocatable,
          sellable: row.sellable
        });
        return statusDto(row);
      });
    } catch (error) {
      if (isUnique(error))
        throw new AppError(
          "INVENTORY_STATUS_EXISTS",
          "Inventory status code is already in use.",
          409
        );
      throw error;
    }
  }

  public async createLot(
    context: OrganizationContext,
    input: {
      productItemId: string;
      lotNumber: string;
      receivedAt?: string | undefined;
      expiryDate?: string | null | undefined;
      supplierId?: string | null | undefined;
    }
  ) {
    await this.authorization.assert(context, "inventory:receive", "InventoryLot");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const product = await inventoryProduct(
        tx,
        context.organizationId,
        context.companyId,
        input.productItemId
      );
      const row = await tx.inventoryLot.upsert({
        where: {
          productItemId_lotNumber: {
            productItemId: product.id,
            lotNumber: input.lotNumber
          }
        },
        create: {
          organizationId: context.organizationId,
          companyId: context.companyId ?? null,
          productItemId: product.id,
          lotNumber: input.lotNumber,
          receivedAt: input.receivedAt ? parseDate(input.receivedAt, "receivedAt") : null,
          expiryDate: input.expiryDate ? parseDate(input.expiryDate, "expiryDate") : null,
          supplierId: input.supplierId ?? null,
          createdByUserId: context.user.id
        },
        update: {
          ...(input.receivedAt === undefined
            ? {}
            : { receivedAt: parseDate(input.receivedAt, "receivedAt") }),
          ...(input.expiryDate === undefined
            ? {}
            : { expiryDate: input.expiryDate ? parseDate(input.expiryDate, "expiryDate") : null })
        }
      });
      await audit(tx, context, "INVENTORY_LOT_REGISTERED", "InventoryLot", row.id, {
        productItemId: row.productItemId,
        lotNumber: row.lotNumber,
        expiryDate: row.expiryDate ? serializeDate(row.expiryDate) : null
      });
      return lotDto(row);
    });
  }

  public async listLots(context: OrganizationContext, productItemId?: string) {
    await this.authorization.assert(context, "inventory:read", "InventoryLot");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryLot.findMany({
        where: {
          organizationId: context.organizationId,
          ...(productItemId ? { productItemId } : {})
        },
        orderBy: [{ expiryDate: "asc" }, { lotNumber: "asc" }]
      });
      return rows.map(lotDto);
    });
  }

  public async registerSerials(
    context: OrganizationContext,
    input: {
      productItemId: string;
      serialNumbers: readonly string[];
      lotId?: string | null | undefined;
      locationId?: string | null | undefined;
      binId?: string | null | undefined;
      statusId?: string | null | undefined;
    }
  ) {
    await this.authorization.assert(context, "inventory:receive", "InventorySerial");
    if (!input.serialNumbers.length || input.serialNumbers.length > 500)
      throw new AppError(
        "INVENTORY_SERIAL_BATCH_INVALID",
        "Serial batch must contain 1 to 500 values.",
        422
      );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const product = await inventoryProduct(
        tx,
        context.organizationId,
        context.companyId,
        input.productItemId
      );
      const locationId = input.locationId ?? product.defaultLocationId;
      if (locationId)
        await activeLocation(tx, context.organizationId, locationId, context.companyId);
      if (input.lotId) {
        const lot = await tx.inventoryLot.findFirst({
          where: {
            id: input.lotId,
            organizationId: context.organizationId,
            ...(context.companyId ? { companyId: context.companyId } : {}),
            productItemId: product.id
          }
        });
        if (!lot)
          throw new AppError(
            "INVENTORY_LOT_NOT_FOUND",
            "The lot does not belong to this product.",
            404
          );
        if (lot.expiryDate && lot.expiryDate < new Date())
          throw new AppError("INVENTORY_LOT_EXPIRED", "Expired lots cannot receive serials.", 422);
      }
      if (input.binId) {
        const bin = await tx.inventoryBin.findFirst({
          where: {
            id: input.binId,
            organizationId: context.organizationId,
            ...(context.companyId ? { companyId: context.companyId } : {}),
            ...(locationId ? { locationId } : {}),
            isActive: true
          }
        });
        if (!bin)
          throw new AppError(
            "INVENTORY_BIN_NOT_FOUND",
            "The bin does not belong to this location.",
            404
          );
      }
      if (input.statusId) {
        const status = await tx.inventoryStatus.findFirst({
          where: {
            id: input.statusId,
            organizationId: context.organizationId,
            ...(context.companyId ? { companyId: context.companyId } : {}),
            isActive: true
          }
        });
        if (!status)
          throw new AppError("INVENTORY_STATUS_NOT_FOUND", "Inventory status was not found.", 404);
      }
      const serialNumbers = input.serialNumbers.map((value) => value);
      if (new Set(serialNumbers).size !== serialNumbers.length)
        throw new AppError(
          "INVENTORY_SERIAL_DUPLICATE",
          "Serial numbers must be unique in a batch.",
          422
        );
      const rows = await tx.inventorySerial.createManyAndReturn({
        data: serialNumbers.map((serialNumber) => ({
          organizationId: context.organizationId,
          companyId: context.companyId ?? null,
          productItemId: product.id,
          serialNumber,
          lotId: input.lotId ?? null,
          locationId: locationId ?? null,
          binId: input.binId ?? null,
          statusId: input.statusId ?? null,
          createdByUserId: context.user.id
        }))
      });
      await audit(tx, context, "INVENTORY_SERIALS_REGISTERED", "InventorySerial", product.id, {
        productItemId: product.id,
        count: rows.length
      });
      return rows.map(serialDto);
    });
  }

  public async reserve(
    context: OrganizationContext,
    input: {
      productItemId: string;
      locationId: string;
      quantity: string;
      sourceType: string;
      sourceId: string;
      sourceLineId?: string | null | undefined;
      binId?: string | null | undefined;
      lotId?: string | null | undefined;
      statusId?: string | null | undefined;
      expiresAt?: string | null | undefined;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "inventory:reserve", "InventoryReservation");
    const quantityMicros = parseQuantityMicros(input.quantity);
    return runIdempotent(
      this.prisma,
      context,
      "inventory.reserve",
      idempotencyKey,
      input,
      async (tx) => {
        await lockProduct(tx, context.organizationId, input.productItemId);
        const product = await inventoryProduct(
          tx,
          context.organizationId,
          context.companyId,
          input.productItemId
        );
        await activeLocation(tx, context.organizationId, input.locationId, context.companyId);
        if (input.binId) {
          const bin = await tx.inventoryBin.findFirst({
            where: {
              id: input.binId,
              organizationId: context.organizationId,
              ...(context.companyId ? { companyId: context.companyId } : {}),
              locationId: input.locationId,
              isActive: true
            }
          });
          if (!bin)
            throw new AppError(
              "INVENTORY_BIN_NOT_FOUND",
              "The bin does not belong to this location.",
              404
            );
        }
        if (input.statusId) {
          const status = await tx.inventoryStatus.findFirst({
            where: {
              id: input.statusId,
              organizationId: context.organizationId,
              ...(context.companyId ? { companyId: context.companyId } : {}),
              isActive: true,
              allocatable: true
            }
          });
          if (!status)
            throw new AppError(
              "INVENTORY_STATUS_NOT_ALLOCATABLE",
              "The inventory status cannot be reserved.",
              422
            );
        }
        if (input.lotId) {
          const lot = await tx.inventoryLot.findFirst({
            where: {
              id: input.lotId,
              organizationId: context.organizationId,
              ...(context.companyId ? { companyId: context.companyId } : {}),
              productItemId: product.id
            }
          });
          if (!lot)
            throw new AppError(
              "INVENTORY_LOT_NOT_FOUND",
              "The lot does not belong to this product.",
              404
            );
          if (lot.expiryDate && lot.expiryDate < new Date())
            throw new AppError("INVENTORY_LOT_EXPIRED", "Expired lots cannot be reserved.", 422);
        }
        const balance = await lockInventoryBalance(tx, context, product.id, input.locationId);
        const now = new Date();
        await tx.inventoryReservation.updateMany({
          where: {
            organizationId: context.organizationId,
            productItemId: product.id,
            locationId: input.locationId,
            status: { in: ["ACTIVE", "ALLOCATED"] },
            expiresAt: { lt: now }
          },
          data: { status: "EXPIRED", releasedAt: now }
        });
        const reserved = await tx.inventoryReservation.aggregate({
          where: {
            organizationId: context.organizationId,
            productItemId: product.id,
            locationId: input.locationId,
            status: { in: ["ACTIVE", "ALLOCATED"] },
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }]
          },
          _sum: { quantityMicros: true }
        });
        const reservedMicros = reserved._sum.quantityMicros ?? 0n;
        if (reservedMicros + quantityMicros > balance.quantityOnHandMicros)
          throw new AppError(
            "INSUFFICIENT_AVAILABLE_INVENTORY",
            "The requested quantity is not available to reserve.",
            422,
            {
              availableMicros: (balance.quantityOnHandMicros - reservedMicros).toString()
            }
          );
        const existingSource = await tx.inventoryReservation.findFirst({
          where: {
            organizationId: context.organizationId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            ...(input.sourceLineId === undefined
              ? { sourceLineId: null }
              : { sourceLineId: input.sourceLineId ?? null })
          }
        });
        if (existingSource)
          throw new AppError(
            "INVENTORY_RESERVATION_SOURCE_EXISTS",
            "This source demand already has a reservation.",
            409,
            { reservationId: existingSource.id }
          );
        const row = await tx.inventoryReservation.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            productItemId: product.id,
            locationId: input.locationId,
            binId: input.binId ?? null,
            lotId: input.lotId ?? null,
            statusId: input.statusId ?? null,
            quantityMicros,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceLineId: input.sourceLineId ?? null,
            idempotencyKey: idempotencyKey ?? null,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "INVENTORY_RESERVED", "InventoryReservation", row.id, {
          productItemId: row.productItemId,
          locationId: row.locationId,
          quantityMicros: row.quantityMicros.toString(),
          sourceType: row.sourceType
        });
        return {
          statusCode: 201,
          body: {
            reservation: reservationDto(row),
            availableQuantityMicros: (
              balance.quantityOnHandMicros -
              reservedMicros -
              quantityMicros
            ).toString()
          },
          resourceId: row.id
        };
      }
    );
  }

  public async releaseReservation(context: OrganizationContext, reservationId: string) {
    await this.authorization.assert(
      context,
      "inventory:reserve",
      "InventoryReservation",
      reservationId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.inventoryReservation.findFirst({
        where: { id: reservationId, organizationId: context.organizationId }
      });
      if (!row)
        throw new AppError("INVENTORY_RESERVATION_NOT_FOUND", "Reservation was not found.", 404);
      if (!["ACTIVE", "ALLOCATED"].includes(row.status)) return reservationDto(row);
      const updated = await tx.inventoryReservation.update({
        where: { id: row.id },
        data: { status: "RELEASED", releasedAt: new Date() }
      });
      await audit(
        tx,
        context,
        "INVENTORY_RESERVATION_RELEASED",
        "InventoryReservation",
        row.id,
        {}
      );
      return reservationDto(updated);
    });
  }

  public async listReservations(
    context: OrganizationContext,
    filters: {
      productItemId?: string | undefined;
      locationId?: string | undefined;
      status?: string | undefined;
    }
  ) {
    await this.authorization.assert(context, "inventory:read", "InventoryReservation");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryReservation.findMany({
        where: {
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {}),
          ...(filters.productItemId ? { productItemId: filters.productItemId } : {}),
          ...(filters.locationId ? { locationId: filters.locationId } : {}),
          ...(filters.status ? { status: filters.status as never } : {})
        },
        orderBy: { createdAt: "desc" },
        take: 500
      });
      return rows.map(reservationDto);
    });
  }

  public async listTransfers(context: OrganizationContext, status?: string) {
    await this.authorization.assert(context, "inventory:read", "InventoryTransfer");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryTransfer.findMany({
        where: {
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {}),
          ...(status ? { status: status as never } : {})
        },
        include: { lines: true },
        orderBy: { createdAt: "desc" },
        take: 500
      });
      return rows.map(transferDto);
    });
  }

  public async fulfillReservation(
    context: OrganizationContext,
    reservationId: string,
    effectiveDate: string,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "inventory:reserve",
      "InventoryReservation",
      reservationId
    );
    return runIdempotent<{
      reservation: ReturnType<typeof reservationDto>;
      movement: ReturnType<typeof movementDto> | null;
    }>(
      this.prisma,
      context,
      "inventory.fulfill-reservation",
      idempotencyKey,
      { reservationId, effectiveDate },
      async (tx) => {
        const row = await tx.inventoryReservation.findFirst({
          where: { id: reservationId, organizationId: context.organizationId }
        });
        if (!row)
          throw new AppError("INVENTORY_RESERVATION_NOT_FOUND", "Reservation was not found.", 404);
        if (row.status === "FULFILLED")
          return {
            statusCode: 200,
            body: { reservation: reservationDto(row), movement: null },
            resourceId: row.id
          };
        if (row.status !== "ACTIVE" && row.status !== "ALLOCATED")
          throw new AppError(
            "INVENTORY_RESERVATION_NOT_ACTIVE",
            "Only active reservations can be fulfilled.",
            409
          );
        if (row.expiresAt && row.expiresAt < new Date())
          throw new AppError(
            "INVENTORY_RESERVATION_EXPIRED",
            "An expired reservation cannot be fulfilled.",
            409
          );
        const product = await inventoryProduct(
          tx,
          context.organizationId,
          context.companyId,
          row.productItemId
        );
        const movement = await recordMovement(tx, context, this.journals, {
          eventId: randomUUID(),
          movementType: "SALE",
          productItemId: row.productItemId,
          locationId: row.locationId,
          quantityMicros: row.quantityMicros,
          direction: "OUT",
          eventDate: parseDate(effectiveDate, "effectiveDate"),
          sourceType: "inventory_reservation_fulfillment",
          sourceId: row.sourceId,
          sourceLineId: row.sourceLineId,
          offsetAccountId: requiredAccount(product.costOfGoodsSoldAccountId),
          reservationId: row.id
        });
        const updated = await tx.inventoryReservation.update({
          where: { id: row.id },
          data: { status: "FULFILLED", fulfilledAt: new Date() }
        });
        await audit(
          tx,
          context,
          "INVENTORY_RESERVATION_FULFILLED",
          "InventoryReservation",
          row.id,
          {
            movementId: movement.id
          }
        );
        return {
          statusCode: 201,
          body: { reservation: reservationDto(updated), movement: movementDto(movement) },
          resourceId: movement.id
        };
      }
    );
  }

  public async reorderSuggestions(context: OrganizationContext) {
    await this.authorization.assert(context, "inventory:reports", "InventoryBalance");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const products = await tx.productItem.findMany({
        where: {
          organizationId: context.organizationId,
          active: true,
          itemType: "INVENTORY_PRODUCT"
        },
        orderBy: { name: "asc" }
      });
      const balances = await tx.inventoryBalance.groupBy({
        by: ["productItemId"],
        where: {
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {})
        },
        _sum: { quantityOnHandMicros: true }
      });
      const reservations = await tx.inventoryReservation.groupBy({
        by: ["productItemId"],
        where: {
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {}),
          status: { in: ["ACTIVE", "ALLOCATED"] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }]
        },
        _sum: { quantityMicros: true }
      });
      const reservedByProduct = new Map(
        reservations.map((row) => [row.productItemId, row._sum.quantityMicros ?? 0n])
      );
      const quantities = new Map(
        balances.map((row) => [
          row.productItemId,
          (row._sum.quantityOnHandMicros ?? 0n) - (reservedByProduct.get(row.productItemId) ?? 0n)
        ])
      );
      return products
        .map((product) => {
          const onHand = quantities.get(product.id) ?? 0n;
          const target =
            product.preferredStockMicros > 0n
              ? product.preferredStockMicros
              : product.reorderPointMicros + product.safetyStockMicros;
          const shortage = target > onHand ? target - onHand : 0n;
          const multiple = product.orderMultipleMicros > 0n ? product.orderMultipleMicros : 1n;
          const rounded = shortage === 0n ? 0n : ((shortage + multiple - 1n) / multiple) * multiple;
          const suggested =
            rounded === 0n
              ? 0n
              : rounded < product.minimumOrderMicros
                ? product.minimumOrderMicros
                : rounded;
          return {
            productItemId: product.id,
            sku: product.sku,
            name: product.name,
            onHandMicros: onHand.toString(),
            reorderPointMicros: product.reorderPointMicros.toString(),
            safetyStockMicros: product.safetyStockMicros.toString(),
            leadTimeDays: product.leadTimeDays,
            suggestedOrderMicros: suggested.toString(),
            reason: suggested > 0n ? "BELOW_TARGET" : "AT_OR_ABOVE_TARGET"
          };
        })
        .filter((row) => row.suggestedOrderMicros !== "0");
    });
  }

  public async createTransfer(
    context: OrganizationContext,
    input: {
      fromLocationId: string;
      toLocationId: string;
      lines: readonly { productItemId: string; quantity: string }[];
      reason?: string | undefined;
    },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "inventory:transfer", "InventoryTransfer");
    if (input.fromLocationId === input.toLocationId || input.lines.length === 0)
      throw new AppError(
        "INVENTORY_TRANSFER_INVALID",
        "A transfer needs two locations and at least one line.",
        422
      );
    return runIdempotent(
      this.prisma,
      context,
      "inventory.transfer-create",
      idempotencyKey,
      input,
      async (tx) => {
        await activeLocation(tx, context.organizationId, input.fromLocationId, context.companyId);
        await activeLocation(tx, context.organizationId, input.toLocationId, context.companyId);
        const seen = new Set<string>();
        const lines: { productItemId: string; quantityMicros: bigint }[] = [];
        for (const line of input.lines) {
          if (seen.has(line.productItemId))
            throw new AppError(
              "INVENTORY_TRANSFER_DUPLICATE_LINE",
              "A product may appear only once on a transfer.",
              422
            );
          seen.add(line.productItemId);
          const quantityMicros = parseQuantityMicros(line.quantity);
          const product = await inventoryProduct(
            tx,
            context.organizationId,
            context.companyId,
            line.productItemId
          );
          const balance = await lockInventoryBalance(tx, context, product.id, input.fromLocationId);
          const reservedMicros = await activeReservedQuantity(
            tx,
            context,
            product.id,
            input.fromLocationId
          );
          const available = balance.quantityOnHandMicros - reservedMicros;
          if (quantityMicros > available)
            throw new AppError(
              "INSUFFICIENT_AVAILABLE_INVENTORY",
              "The transfer exceeds available stock.",
              422,
              {
                availableMicros: available.toString()
              }
            );
          lines.push({ productItemId: product.id, quantityMicros });
        }
        const transfer = await tx.inventoryTransfer.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            fromLocationId: input.fromLocationId,
            toLocationId: input.toLocationId,
            transferNumber: `TR-${String(Date.now())}-${randomUUID().slice(0, 8).toUpperCase()}`,
            reason: input.reason ?? null,
            requestedByUserId: context.user.id,
            lines: {
              create: lines.map((line) => ({
                organizationId: context.organizationId,
                companyId: context.companyId ?? null,
                eventId: randomUUID(),
                productItemId: line.productItemId,
                quantityMicros: line.quantityMicros
              }))
            }
          },
          include: { lines: true }
        });
        await audit(tx, context, "INVENTORY_TRANSFER_CREATED", "InventoryTransfer", transfer.id, {
          transferNumber: transfer.transferNumber,
          lineCount: transfer.lines.length
        });
        return {
          statusCode: 201,
          body: { transfer: transferDto(transfer) },
          resourceId: transfer.id
        };
      }
    );
  }

  public async advanceTransfer(
    context: OrganizationContext,
    transferId: string,
    action: "approve" | "ship" | "receive" | "cancel",
    effectiveDate: string,
    idempotencyKey: string | undefined,
    quantities?: readonly { lineId: string; quantity: string }[]
  ) {
    await this.authorization.assert(context, "inventory:transfer", "InventoryTransfer", transferId);
    return runIdempotent(
      this.prisma,
      context,
      `inventory.transfer-${action}`,
      idempotencyKey,
      { transferId, action, effectiveDate, quantities },
      async (tx) => {
        const transfer = await tx.inventoryTransfer.findFirst({
          where: { id: transferId, organizationId: context.organizationId },
          include: { lines: true }
        });
        if (!transfer)
          throw new AppError("INVENTORY_TRANSFER_NOT_FOUND", "Transfer was not found.", 404);
        if (action === "cancel") {
          if (!["DRAFT", "APPROVED", "PICKED"].includes(transfer.status))
            throw new AppError(
              "INVENTORY_TRANSFER_NOT_CANCELLABLE",
              "This transfer can no longer be cancelled.",
              409
            );
          const updated = await tx.inventoryTransfer.update({
            where: { id: transfer.id },
            data: { status: "CANCELLED" },
            include: { lines: true }
          });
          await audit(
            tx,
            context,
            "INVENTORY_TRANSFER_CANCELLED",
            "InventoryTransfer",
            transfer.id,
            {}
          );
          return {
            statusCode: 200,
            body: { transfer: transferDto(updated) },
            resourceId: updated.id
          };
        }
        if (action === "approve") {
          if (transfer.status !== "DRAFT")
            throw new AppError(
              "INVENTORY_TRANSFER_STATE",
              "Only draft transfers can be approved.",
              409
            );
          const updated = await tx.inventoryTransfer.update({
            where: { id: transfer.id },
            data: { status: "APPROVED", approvedByUserId: context.user.id },
            include: { lines: true }
          });
          await audit(
            tx,
            context,
            "INVENTORY_TRANSFER_APPROVED",
            "InventoryTransfer",
            transfer.id,
            {}
          );
          return {
            statusCode: 200,
            body: { transfer: transferDto(updated) },
            resourceId: updated.id
          };
        }
        const date = parseDate(effectiveDate, "effectiveDate");
        const requested = new Map(
          (quantities ?? []).map((line) => [line.lineId, parseQuantityMicros(line.quantity)])
        );
        if (action === "ship") {
          if (!["APPROVED", "PICKED", "SHIPPED", "PARTIALLY_RECEIVED"].includes(transfer.status))
            throw new AppError(
              "INVENTORY_TRANSFER_STATE",
              "Only approved or in-progress transfers can be shipped.",
              409
            );
          for (const line of transfer.lines) {
            const quantity = requested.get(line.id) ?? line.quantityMicros - line.shippedMicros;
            const remaining = line.quantityMicros - line.shippedMicros;
            if (quantity <= 0n || quantity > remaining)
              throw new AppError(
                "INVENTORY_TRANSFER_QUANTITY",
                "Shipment quantity is invalid.",
                422
              );
            await inventoryProduct(
              tx,
              context.organizationId,
              context.companyId,
              line.productItemId
            );
            const balance = await lockInventoryBalance(
              tx,
              context,
              line.productItemId,
              transfer.fromLocationId
            );
            const reservedMicros = await activeReservedQuantity(
              tx,
              context,
              line.productItemId,
              transfer.fromLocationId
            );
            const available = balance.quantityOnHandMicros - reservedMicros;
            if (quantity > available)
              throw new AppError(
                "INSUFFICIENT_AVAILABLE_INVENTORY",
                "The transfer shipment exceeds currently available stock.",
                422,
                { availableMicros: available.toString() }
              );
            const movement = await recordMovement(tx, context, this.journals, {
              eventId: line.eventId,
              movementType: "TRANSFER_OUT",
              productItemId: line.productItemId,
              locationId: transfer.fromLocationId,
              quantityMicros: quantity,
              direction: "OUT",
              eventDate: date,
              sourceType: "inventory_transfer",
              sourceId: transfer.id,
              sourceLineId: line.id,
              suppressJournal: true,
              reason: transfer.reason
            });
            await tx.inventoryTransferLine.update({
              where: { id: line.id },
              data: {
                shippedMicros: { increment: quantity },
                unitValueMinor: { increment: -movement.totalValueMinor },
                version: { increment: 1 }
              }
            });
          }
          const updated = await tx.inventoryTransfer.update({
            where: { id: transfer.id },
            data: {
              status: transfer.status === "PARTIALLY_RECEIVED" ? "PARTIALLY_RECEIVED" : "SHIPPED",
              shippedAt: new Date()
            },
            include: { lines: true }
          });
          await audit(
            tx,
            context,
            "INVENTORY_TRANSFER_SHIPPED",
            "InventoryTransfer",
            transfer.id,
            {}
          );
          return {
            statusCode: 200,
            body: { transfer: transferDto(updated) },
            resourceId: updated.id
          };
        }
        if (!["SHIPPED", "PARTIALLY_RECEIVED"].includes(transfer.status))
          throw new AppError(
            "INVENTORY_TRANSFER_STATE",
            "Only shipped transfers can be received.",
            409
          );
        for (const line of transfer.lines) {
          const shipped = await tx.inventoryMovement.aggregate({
            where: {
              organizationId: context.organizationId,
              sourceId: transfer.id,
              sourceLineId: line.id,
              movementType: "TRANSFER_OUT"
            },
            _sum: { quantityMicros: true, totalValueMinor: true }
          });
          const received = await tx.inventoryMovement.aggregate({
            where: {
              organizationId: context.organizationId,
              sourceId: transfer.id,
              sourceLineId: line.id,
              movementType: "TRANSFER_IN"
            },
            _sum: { quantityMicros: true, totalValueMinor: true }
          });
          const shippedQuantity = -(shipped._sum.quantityMicros ?? 0n);
          const receivedQuantity = received._sum.quantityMicros ?? 0n;
          const quantity = requested.get(line.id) ?? shippedQuantity - receivedQuantity;
          if (quantity <= 0n || receivedQuantity + quantity > shippedQuantity)
            throw new AppError(
              "INVENTORY_TRANSFER_QUANTITY",
              "Receipt quantity exceeds shipped quantity.",
              422
            );
          const shippedValue = -(shipped._sum.totalValueMinor ?? 0n);
          const receivedValue = received._sum.totalValueMinor ?? 0n;
          const value =
            receivedQuantity + quantity === shippedQuantity
              ? shippedValue - receivedValue
              : roundRatioHalfUp(shippedValue * quantity, shippedQuantity);
          await recordMovement(tx, context, this.journals, {
            eventId: line.eventId,
            movementType: "TRANSFER_IN",
            productItemId: line.productItemId,
            locationId: transfer.toLocationId,
            quantityMicros: quantity,
            direction: "IN",
            inboundValueMinor: value,
            eventDate: date,
            sourceType: "inventory_transfer",
            sourceId: transfer.id,
            sourceLineId: line.id,
            suppressJournal: true,
            reason: transfer.reason
          });
        }
        const after = await tx.inventoryTransfer.findUniqueOrThrow({
          where: { id: transfer.id },
          include: { lines: true }
        });
        for (const line of after.lines) {
          const received = await tx.inventoryMovement.aggregate({
            where: {
              organizationId: context.organizationId,
              sourceId: transfer.id,
              sourceLineId: line.id,
              movementType: "TRANSFER_IN"
            },
            _sum: { quantityMicros: true }
          });
          await tx.inventoryTransferLine.update({
            where: { id: line.id },
            data: { receivedMicros: received._sum.quantityMicros ?? 0n }
          });
        }
        const refreshed = await tx.inventoryTransfer.findUniqueOrThrow({
          where: { id: transfer.id },
          include: { lines: true }
        });
        const complete = refreshed.lines.every(
          (line) => line.receivedMicros >= line.quantityMicros
        );
        await tx.inventoryTransfer.update({
          where: { id: transfer.id },
          data: {
            status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED",
            ...(complete ? { receivedAt: new Date() } : {})
          },
          include: { lines: true }
        });
        const finalTransfer = await tx.inventoryTransfer.findUniqueOrThrow({
          where: { id: transfer.id },
          include: { lines: true }
        });
        await audit(
          tx,
          context,
          "INVENTORY_TRANSFER_RECEIVED",
          "InventoryTransfer",
          transfer.id,
          {}
        );
        return {
          statusCode: 200,
          body: { transfer: transferDto(finalTransfer) },
          resourceId: finalTransfer.id
        };
      }
    );
  }

  public async createCount(
    context: OrganizationContext,
    input: { locationId: string; blind?: boolean | undefined },
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "inventory:count", "InventoryCount");
    return runIdempotent(
      this.prisma,
      context,
      "inventory.count-create",
      idempotencyKey,
      input,
      async (tx) => {
        await activeLocation(tx, context.organizationId, input.locationId, context.companyId);
        const products = await tx.productItem.findMany({
          where: {
            organizationId: context.organizationId,
            ...(context.companyId ? { companyId: context.companyId } : {}),
            active: true,
            itemType: "INVENTORY_PRODUCT"
          }
        });
        const balances = await tx.inventoryBalance.findMany({
          where: { organizationId: context.organizationId, locationId: input.locationId }
        });
        const expected = new Map(
          balances.map((balance) => [balance.productItemId, balance.quantityOnHandMicros])
        );
        const count = await tx.inventoryCount.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            locationId: input.locationId,
            countNumber: `COUNT-${String(Date.now())}-${randomUUID().slice(0, 8).toUpperCase()}`,
            blind: input.blind ?? false,
            status: "RELEASED",
            createdByUserId: context.user.id,
            lines: {
              create: products.map((product) => ({
                organizationId: context.organizationId,
                companyId: context.companyId ?? null,
                productItemId: product.id,
                expectedMicros: expected.get(product.id) ?? 0n
              }))
            }
          },
          include: { lines: true }
        });
        await audit(tx, context, "INVENTORY_COUNT_CREATED", "InventoryCount", count.id, {
          lineCount: count.lines.length,
          blind: count.blind
        });
        return { statusCode: 201, body: { count: countDto(count) }, resourceId: count.id };
      }
    );
  }

  public async recordCountLine(context: OrganizationContext, countLineId: string, counted: string) {
    await this.authorization.assert(context, "inventory:count", "InventoryCountLine", countLineId);
    const countedMicros = parseQuantityMicros(counted);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const line = await tx.inventoryCountLine.findFirst({
        where: {
          id: countLineId,
          organizationId: context.organizationId,
          count: { status: { in: ["RELEASED", "COUNTING"] } }
        },
        include: { count: true }
      });
      if (!line)
        throw new AppError("INVENTORY_COUNT_LINE_NOT_FOUND", "Count line is not available.", 404);
      const updated = await tx.inventoryCountLine.update({
        where: { id: line.id },
        data: {
          countedMicros,
          varianceMicros: countedMicros - line.expectedMicros,
          countedAt: new Date(),
          countedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (line.count.status === "RELEASED")
        await tx.inventoryCount.update({
          where: { id: line.count.id },
          data: { status: "COUNTING" }
        });
      await audit(tx, context, "INVENTORY_COUNT_LINE_RECORDED", "InventoryCountLine", line.id, {
        countedMicros: countedMicros.toString()
      });
      return countLineDto(updated);
    });
  }

  public async approveCount(
    context: OrganizationContext,
    countId: string,
    effectiveDate: string,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "inventory:count", "InventoryCount", countId);
    return runIdempotent(
      this.prisma,
      context,
      "inventory.count-approve",
      idempotencyKey,
      { countId, effectiveDate },
      async (tx) => {
        const count = await tx.inventoryCount.findFirst({
          where: { id: countId, organizationId: context.organizationId },
          include: { lines: true }
        });
        if (!count) throw new AppError("INVENTORY_COUNT_NOT_FOUND", "Count was not found.", 404);
        if (count.status === "POSTED")
          return { statusCode: 200, body: { count: countDto(count) }, resourceId: count.id };
        if (
          count.status !== "COUNTING" &&
          count.status !== "SUBMITTED" &&
          count.status !== "PENDING_APPROVAL"
        )
          throw new AppError("INVENTORY_COUNT_STATE", "Count is not ready for approval.", 409);
        if (count.lines.some((line) => line.countedMicros === null))
          throw new AppError(
            "INVENTORY_COUNT_INCOMPLETE",
            "Every count line must be counted before approval.",
            422
          );
        for (const line of count.lines) {
          const variance = line.countedMicros! - line.expectedMicros;
          if (variance === 0n) continue;
          const product = await inventoryProduct(
            tx,
            context.organizationId,
            context.companyId,
            line.productItemId
          );
          const inbound = variance > 0n;
          await recordMovement(tx, context, this.journals, {
            eventId: randomUUID(),
            movementType: inbound ? "INCREASE_ADJUSTMENT" : "DECREASE_ADJUSTMENT",
            productItemId: line.productItemId,
            locationId: count.locationId,
            quantityMicros: variance < 0n ? -variance : variance,
            direction: inbound ? "IN" : "OUT",
            inboundValueMinor: inbound
              ? receiptValueMinor(variance, product.purchaseCostMinor ?? 0n)
              : undefined,
            eventDate: parseDate(effectiveDate, "effectiveDate"),
            sourceType: "inventory_count",
            sourceId: count.id,
            sourceLineId: line.id,
            offsetAccountId: inbound
              ? requiredAccount(product.adjustmentGainAccountId)
              : requiredAccount(product.inventoryLossAccountId),
            adjustmentKind: "COUNT_CORRECTION",
            reason: "Approved physical inventory count"
          });
        }
        const updated = await tx.inventoryCount.update({
          where: { id: count.id },
          data: { status: "POSTED", approvedAt: new Date(), approvedByUserId: context.user.id },
          include: { lines: true }
        });
        await audit(tx, context, "INVENTORY_COUNT_APPROVED", "InventoryCount", count.id, {
          effectiveDate
        });
        return { statusCode: 201, body: { count: countDto(updated) }, resourceId: updated.id };
      }
    );
  }

  public async listCounts(context: OrganizationContext, status?: string) {
    await this.authorization.assert(context, "inventory:count", "InventoryCount");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryCount.findMany({
        where: {
          organizationId: context.organizationId,
          ...(status ? { status: status as never } : {})
        },
        include: { lines: true },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return rows.map(countDto);
    });
  }

  public async quantities(context: OrganizationContext, locationId?: string) {
    await this.authorization.assert(context, "inventory:read", "InventoryBalance");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryBalance.findMany({
        where: {
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {}),
          ...(locationId ? { locationId } : {})
        },
        include: {
          productItem: {
            select: { id: true, sku: true, name: true, productImageReference: true }
          },
          location: { select: { code: true, name: true } }
        },
        orderBy: [{ productItem: { name: "asc" } }, { location: { code: "asc" } }]
      });
      const reservations = await tx.inventoryReservation.groupBy({
        by: ["productItemId", "locationId"],
        where: {
          organizationId: context.organizationId,
          ...(context.companyId ? { companyId: context.companyId } : {}),
          status: { in: ["ACTIVE", "ALLOCATED"] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }]
        },
        _sum: { quantityMicros: true }
      });
      const reservedByBalance = new Map(
        reservations.map((row) => [
          `${row.productItemId}:${row.locationId}`,
          row._sum.quantityMicros ?? 0n
        ])
      );
      return rows.map((row) =>
        balanceDto(row, reservedByBalance.get(`${row.productItemId}:${row.locationId}`) ?? 0n)
      );
    });
  }

  public async movements(
    context: OrganizationContext,
    filters: {
      productItemId?: string | undefined;
      locationId?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
    }
  ) {
    await this.authorization.assert(context, "inventory:read", "InventoryMovement");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      (
        await tx.inventoryMovement.findMany({
          where: {
            organizationId: context.organizationId,
            ...(filters.productItemId ? { productItemId: filters.productItemId } : {}),
            ...(filters.locationId ? { locationId: filters.locationId } : {}),
            ...(filters.from || filters.to
              ? {
                  eventDate: {
                    ...(filters.from ? { gte: parseDate(filters.from, "from") } : {}),
                    ...(filters.to ? { lte: parseDate(filters.to, "to") } : {})
                  }
                }
              : {})
          },
          orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
          take: 1000
        })
      ).map(movementDto)
    );
  }

  public async valuation(context: OrganizationContext, asOf?: string) {
    await this.authorization.assert(context, "inventory:reports", "InventoryMovement");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryMovement.groupBy({
        by: ["productItemId", "locationId"],
        where: {
          organizationId: context.organizationId,
          ...(asOf ? { eventDate: { lte: parseDate(asOf, "asOf") } } : {})
        },
        _sum: { quantityMicros: true, totalValueMinor: true }
      });
      return rows.map((row) => ({
        productItemId: row.productItemId,
        locationId: row.locationId,
        quantityOnHandMicros: (row._sum.quantityMicros ?? 0n).toString(),
        valueOnHandMinor: (row._sum.totalValueMinor ?? 0n).toString()
      }));
    });
  }

  public async costOfGoods(
    context: OrganizationContext,
    filters: { from?: string | undefined; to?: string | undefined }
  ) {
    await this.authorization.assert(context, "inventory:reports", "InventoryMovement");
    const from = filters.from ? parseDate(filters.from, "from") : undefined;
    const to = filters.to ? parseDate(filters.to, "to") : undefined;
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.inventoryMovement.findMany({
        where: {
          organizationId: context.organizationId,
          movementType: { in: ["SALE", "CUSTOMER_RETURN"] },
          ...(from || to
            ? {
                eventDate: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {})
                }
              }
            : {})
        },
        include: { productItem: true, location: true },
        orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }]
      });
      const detail = rows.map((row) => ({
        movementId: row.id,
        eventDate: serializeDate(row.eventDate),
        movementType: row.movementType,
        productItemId: row.productItemId,
        productName: row.productItem.name,
        sku: row.productItem.sku,
        locationId: row.locationId,
        locationCode: row.location.code,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        quantityMicros: row.quantityMicros.toString(),
        costOfGoodsMinor: (-row.totalValueMinor).toString(),
        costOfGoodsSoldAccountId: row.offsetAccountId
      }));
      return {
        from: from ? serializeDate(from) : null,
        to: to ? serializeDate(to) : null,
        totalCostOfGoodsMinor: detail
          .reduce((total, row) => total + BigInt(row.costOfGoodsMinor), 0n)
          .toString(),
        detail
      };
    });
  }

  public async controlReconciliation(context: OrganizationContext, asOf?: string) {
    await this.authorization.assert(context, "inventory:reports", "InventoryMovement");
    const asOfDate = asOf ? parseDate(asOf, "asOf") : undefined;
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const configuredAccounts = await tx.productItem.findMany({
        where: {
          organizationId: context.organizationId,
          itemType: "INVENTORY_PRODUCT",
          inventoryAssetAccountId: { not: null }
        },
        select: { inventoryAssetAccountId: true },
        distinct: ["inventoryAssetAccountId"]
      });
      const accountIds = configuredAccounts.flatMap((row) =>
        row.inventoryAssetAccountId ? [row.inventoryAssetAccountId] : []
      );
      const accounts = await tx.account.findMany({
        where: { organizationId: context.organizationId, id: { in: accountIds } },
        orderBy: [{ code: "asc" }, { id: "asc" }]
      });
      const inventoryRows = await tx.inventoryMovement.groupBy({
        by: ["inventoryAssetAccountId"],
        where: {
          organizationId: context.organizationId,
          inventoryAssetAccountId: { in: accountIds },
          ...(asOfDate ? { eventDate: { lte: asOfDate } } : {})
        },
        _sum: { totalValueMinor: true }
      });
      const ledgerRows = await tx.journalLine.groupBy({
        by: ["accountId"],
        where: {
          organizationId: context.organizationId,
          accountId: { in: accountIds },
          journal: {
            status: "POSTED",
            ...(asOfDate ? { effectiveDate: { lte: asOfDate } } : {})
          }
        },
        _sum: { debitMinor: true, creditMinor: true }
      });
      const inventoryByAccount = new Map(
        inventoryRows.map((row) => [row.inventoryAssetAccountId, row._sum.totalValueMinor ?? 0n])
      );
      const ledgerByAccount = new Map(
        ledgerRows.map((row) => [
          row.accountId,
          (row._sum.debitMinor ?? 0n) - (row._sum.creditMinor ?? 0n)
        ])
      );
      const rows = accounts.map((account) => {
        const inventoryValueMinor = inventoryByAccount.get(account.id) ?? 0n;
        const ledgerBalanceMinor = ledgerByAccount.get(account.id) ?? 0n;
        const differenceMinor = ledgerBalanceMinor - inventoryValueMinor;
        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          inventoryValueMinor: inventoryValueMinor.toString(),
          ledgerBalanceMinor: ledgerBalanceMinor.toString(),
          differenceMinor: differenceMinor.toString(),
          isReconciled: differenceMinor === 0n
        };
      });
      const totalInventoryValueMinor = rows.reduce(
        (total, row) => total + BigInt(row.inventoryValueMinor),
        0n
      );
      const totalLedgerBalanceMinor = rows.reduce(
        (total, row) => total + BigInt(row.ledgerBalanceMinor),
        0n
      );
      return {
        asOf: asOfDate ? serializeDate(asOfDate) : null,
        totalInventoryValueMinor: totalInventoryValueMinor.toString(),
        totalLedgerBalanceMinor: totalLedgerBalanceMinor.toString(),
        differenceMinor: (totalLedgerBalanceMinor - totalInventoryValueMinor).toString(),
        isReconciled: rows.every((row) => row.isReconciled),
        rows
      };
    });
  }

  public async lowStock(context: OrganizationContext) {
    await this.authorization.assert(context, "inventory:reports", "InventoryBalance");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.$queryRaw<
        {
          productItemId: string;
          sku: string | null;
          name: string;
          reorderPointMicros: bigint;
          quantityMicros: bigint;
        }[]
      >`
        SELECT p.id AS "productItemId", p.sku, p.name,
               p."reorderPointMicros",
               COALESCE(SUM(b."quantityOnHandMicros"), 0)::bigint AS "quantityMicros"
          FROM "ProductItem" p
          LEFT JOIN "InventoryBalance" b
            ON b."productItemId" = p.id AND b."organizationId" = p."organizationId"
         WHERE p."organizationId" = ${context.organizationId}::uuid
           AND p.active AND p."itemType" = 'INVENTORY_PRODUCT'
         GROUP BY p.id
        HAVING COALESCE(SUM(b."quantityOnHandMicros"), 0) <= p."reorderPointMicros"
         ORDER BY p.name
      `;
      return rows.map((row) => ({
        ...row,
        reorderPointMicros: row.reorderPointMicros.toString(),
        quantityMicros: row.quantityMicros.toString()
      }));
    });
  }
}

export async function depleteInvoiceInventoryInTransaction(
  tx: Tx,
  context: OrganizationContext,
  journals: JournalService,
  invoiceId: string,
  effectiveDate: Date,
  locationIdOverride?: string
) {
  const lines = await tx.invoiceLine.findMany({
    where: {
      organizationId: context.organizationId,
      invoiceId,
      productItem: { itemType: "INVENTORY_PRODUCT" }
    },
    include: { productItem: true },
    orderBy: { lineNumber: "asc" }
  });
  for (const line of lines) {
    const product = line.productItem!;
    const eventId = randomUUID();
    await recordMovement(tx, context, journals, {
      eventId,
      movementType: "SALE",
      productItemId: product.id,
      locationId: locationIdOverride ?? requiredDefaultLocation(product),
      quantityMicros: line.quantityMicros,
      direction: "OUT",
      eventDate: effectiveDate,
      sourceType: "invoice_sale",
      sourceId: eventId,
      sourceLineId: line.id,
      invoiceLineId: line.id,
      offsetAccountId: requiredAccount(product.costOfGoodsSoldAccountId)
    });
  }
}

export async function reverseInvoiceInventoryInTransaction(
  tx: Tx,
  context: OrganizationContext,
  journals: JournalService,
  invoiceId: string,
  effectiveDate: Date,
  reason: string
) {
  const originals = await tx.inventoryMovement.findMany({
    where: {
      organizationId: context.organizationId,
      sourceType: "invoice_sale",
      invoiceLine: { invoiceId },
      movementType: "SALE"
    },
    include: { productItem: true },
    orderBy: { createdAt: "asc" }
  });
  for (const original of originals) {
    if (!original.journalId)
      throw new AppError("INVENTORY_JOURNAL_MISSING", "Sale inventory journal is missing.", 409);
    const reversalJournal = await journals.reverseJournalInTransaction(
      tx,
      context,
      original.journalId,
      { effectiveDate: effectiveDate.toISOString().slice(0, 10), reason },
      "inventory_sale_reversal",
      original.id,
      `inventory:sale:reverse:${original.id}`
    );
    await recordMovement(
      tx,
      context,
      journals,
      {
        eventId: randomUUID(),
        movementType: "REVERSAL",
        productItemId: original.productItemId,
        locationId: original.locationId,
        quantityMicros: -original.quantityMicros,
        direction: "IN",
        inboundValueMinor: -original.totalValueMinor,
        eventDate: effectiveDate,
        sourceType: "invoice_void",
        sourceId: original.id,
        sourceLineId: original.sourceLineId,
        invoiceLineId: original.invoiceLineId,
        offsetAccountId: original.offsetAccountId,
        reason,
        reversalOfMovementId: original.id,
        suppressJournal: true
      },
      reversalJournal.id
    );
  }
}

async function recordMovement(
  tx: Tx,
  context: OrganizationContext,
  journals: JournalService,
  input: MovementInput,
  suppliedJournalId?: string
) {
  await lockOpenPeriod(tx, context.organizationId, input.eventDate);
  await lockProduct(tx, context.organizationId, input.productItemId);
  const product = await inventoryProduct(
    tx,
    context.organizationId,
    context.companyId,
    input.productItemId
  );
  await activeLocation(tx, context.organizationId, input.locationId, context.companyId);
  await tx.inventoryBalance.upsert({
    where: {
      productItemId_locationId: {
        productItemId: input.productItemId,
        locationId: input.locationId
      }
    },
    create: {
      organizationId: context.organizationId,
      companyId: context.companyId ?? null,
      productItemId: input.productItemId,
      locationId: input.locationId
    },
    update: {}
  });
  const [balance] = await tx.$queryRaw<
    {
      id: string;
      quantityOnHandMicros: bigint;
      valueOnHandMinor: bigint;
      version: number;
    }[]
  >`
    SELECT id, "quantityOnHandMicros", "valueOnHandMinor", version
      FROM "InventoryBalance"
     WHERE "organizationId" = ${context.organizationId}::uuid
       AND "productItemId" = ${input.productItemId}::uuid
       AND "locationId" = ${input.locationId}::uuid
     FOR UPDATE
  `;
  if (!balance)
    throw new AppError("INVENTORY_BALANCE_NOT_FOUND", "Inventory balance missing.", 409);
  const current = {
    quantityMicros: balance.quantityOnHandMicros,
    valueMinor: balance.valueOnHandMinor
  };
  const outboundValue = input.outboundValueMinor;
  const result =
    input.direction === "IN"
      ? {
          ...applyInbound(current, input.quantityMicros, input.inboundValueMinor ?? 0n),
          movementValue: input.inboundValueMinor ?? 0n
        }
      : outboundValue === undefined
        ? (() => {
            const next = applyOutbound(current, input.quantityMicros);
            return { ...next, movementValue: next.outboundValueMinor };
          })()
        : (() => {
            if (input.quantityMicros > current.quantityMicros || outboundValue > current.valueMinor)
              throw new AppError(
                "INSUFFICIENT_INVENTORY",
                "Inventory quantity or carrying value cannot become negative.",
                422
              );
            const next = {
              quantityMicros: current.quantityMicros - input.quantityMicros,
              valueMinor: current.valueMinor - outboundValue
            };
            assertPosition(next);
            return { ...next, movementValue: outboundValue };
          })();
  const assetAccountId = requiredAccount(product.inventoryAssetAccountId);
  const offsetAccountId = input.offsetAccountId ?? null;
  let journalId = suppliedJournalId;
  if (!input.suppressJournal && result.movementValue > 0n) {
    if (!offsetAccountId)
      throw new AppError("INVENTORY_OFFSET_REQUIRED", "Inventory offset account is required.", 422);
    const inbound = input.direction === "IN";
    const journal = await journals.postJournalInTransaction(
      tx,
      context,
      {
        description: `${input.movementType.replaceAll("_", " ")} inventory`,
        effectiveDate: input.eventDate.toISOString().slice(0, 10),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        postingKey: `inventory:${input.eventId}:${input.movementType}`,
        allowControlAccountPosting: false,
        ...(input.reason ? { reason: input.reason } : {}),
        lines: [
          {
            accountId: inbound ? assetAccountId : offsetAccountId,
            debitMinor: result.movementValue.toString(),
            creditMinor: "0"
          },
          {
            accountId: inbound ? offsetAccountId : assetAccountId,
            debitMinor: "0",
            creditMinor: result.movementValue.toString()
          }
        ]
      },
      true
    );
    journalId = journal.id;
  }
  const signedQuantity = input.direction === "IN" ? input.quantityMicros : -input.quantityMicros;
  const signedValue = input.direction === "IN" ? result.movementValue : -result.movementValue;
  const movement = await tx.inventoryMovement.create({
    data: {
      organizationId: context.organizationId,
      companyId: context.companyId ?? null,
      eventId: input.eventId,
      movementType: input.movementType,
      productItemId: input.productItemId,
      locationId: input.locationId,
      quantityMicros: signedQuantity,
      unitCostMicros:
        input.quantityMicros === 0n
          ? 0n
          : roundRatioHalfUp(result.movementValue * 1_000_000n * 1_000_000n, input.quantityMicros),
      totalValueMinor: signedValue,
      eventDate: input.eventDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLineId: input.sourceLineId ?? null,
      billLineId: input.billLineId ?? null,
      invoiceLineId: input.invoiceLineId ?? null,
      creditNoteLineId: input.creditNoteLineId ?? null,
      vendorCreditLineId: input.vendorCreditLineId ?? null,
      journalId: journalId ?? null,
      inventoryAssetAccountId: assetAccountId,
      offsetAccountId,
      adjustmentKind: input.adjustmentKind ?? null,
      returnDisposition: input.returnDisposition ?? null,
      reason: input.reason ?? null,
      reversalOfMovementId: input.reversalOfMovementId ?? null,
      binId: input.binId ?? null,
      statusId: input.statusId ?? null,
      lotId: input.lotId ?? null,
      serialId: input.serialId ?? null,
      reservationId: input.reservationId ?? null,
      configurationSnapshot: {
        productName: product.name,
        sku: product.sku,
        inventoryAssetAccountId: assetAccountId,
        costOfGoodsSoldAccountId: product.costOfGoodsSoldAccountId,
        purchaseClearingAccountId: product.purchaseClearingAccountId,
        adjustmentGainAccountId: product.adjustmentGainAccountId,
        inventoryLossAccountId: product.inventoryLossAccountId,
        locationId: input.locationId,
        valuationMethod: "WEIGHTED_AVERAGE"
      },
      createdByUserId: context.user.id
    }
  });
  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      quantityOnHandMicros: result.quantityMicros,
      valueOnHandMinor: result.valueMinor,
      averageUnitCostMicros: averageUnitCostMicros(result),
      version: { increment: 1 }
    }
  });
  return movement;
}

async function lockOpenPeriod(tx: Tx, organizationId: string, eventDate: Date) {
  const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status
      FROM "FiscalPeriod"
     WHERE "organizationId" = ${organizationId}::uuid
       AND "startDate" <= ${eventDate}::date
       AND "endDate" >= ${eventDate}::date
     ORDER BY "startDate" DESC
     LIMIT 1
     FOR SHARE
  `;
  if (!rows[0])
    throw new AppError(
      "FISCAL_PERIOD_NOT_FOUND",
      "No fiscal period contains the inventory movement date.",
      422
    );
  if (rows[0].status !== "OPEN")
    throw new AppError("PERIOD_LOCKED", "The inventory movement date is in a closed period.", 409);
}

async function inventoryProduct(
  tx: Tx,
  organizationId: string,
  companyId: string | null | undefined,
  id: string
) {
  const product = await tx.productItem.findFirst({
    where: {
      id,
      organizationId,
      ...(companyId ? { companyId } : {}),
      active: true,
      itemType: "INVENTORY_PRODUCT"
    }
  });
  if (!product)
    throw new AppError("INVENTORY_PRODUCT_NOT_FOUND", "Active inventory product not found.", 404);
  if (
    !product.inventoryAssetAccountId ||
    !product.costOfGoodsSoldAccountId ||
    !product.purchaseClearingAccountId ||
    !product.adjustmentGainAccountId ||
    !product.inventoryLossAccountId ||
    !product.defaultLocationId
  )
    throw new AppError(
      "INVENTORY_CONFIGURATION_INCOMPLETE",
      "Inventory product accounting configuration is incomplete.",
      422
    );
  if (product.inventoryCostingMethod !== "WEIGHTED_AVERAGE")
    throw new AppError(
      "INVENTORY_COSTING_UNSUPPORTED",
      "Only moving weighted-average costing is enabled for this release.",
      422
    );
  return product;
}

async function lockProduct(tx: Tx, organizationId: string, productItemId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "ProductItem"
     WHERE id = ${productItemId}::uuid AND "organizationId" = ${organizationId}::uuid
     FOR UPDATE
  `;
  if (rows.length !== 1)
    throw new AppError("INVENTORY_PRODUCT_NOT_FOUND", "Inventory product not found.", 404);
}

async function activeLocation(
  tx: Tx,
  organizationId: string,
  id: string,
  companyId?: string | null
) {
  const location = await tx.inventoryLocation.findFirst({
    where: { id, organizationId, isActive: true, ...(companyId ? { companyId } : {}) }
  });
  if (!location)
    throw new AppError("INVENTORY_LOCATION_NOT_FOUND", "Active inventory location not found.", 404);
  return location;
}

async function receivedQuantity(tx: Tx, organizationId: string, billLineId: string) {
  const value = await tx.inventoryMovement.aggregate({
    where: { organizationId, billLineId, movementType: "PURCHASE_RECEIPT" },
    _sum: { quantityMicros: true }
  });
  return value._sum.quantityMicros ?? 0n;
}

async function receivedValueTotal(tx: Tx, organizationId: string, billLineId: string) {
  const value = await tx.inventoryMovement.aggregate({
    where: { organizationId, billLineId, movementType: "PURCHASE_RECEIPT" },
    _sum: { totalValueMinor: true }
  });
  return value._sum.totalValueMinor ?? 0n;
}

function requiredDefaultLocation(product: { defaultLocationId: string | null }) {
  if (!product.defaultLocationId)
    throw new AppError("INVENTORY_DEFAULT_LOCATION_REQUIRED", "Default location is required.", 422);
  return product.defaultLocationId;
}

function requiredAccount(value: string | null) {
  if (!value)
    throw new AppError("INVENTORY_ACCOUNT_REQUIRED", "Inventory account is required.", 422);
  return value;
}

async function lockInventoryBalance(
  tx: Tx,
  context: OrganizationContext,
  productItemId: string,
  locationId: string
) {
  await tx.inventoryBalance.upsert({
    where: { productItemId_locationId: { productItemId, locationId } },
    create: {
      organizationId: context.organizationId,
      companyId: context.companyId ?? null,
      productItemId,
      locationId
    },
    update: {}
  });
  const rows = await tx.$queryRaw<
    { id: string; quantityOnHandMicros: bigint; valueOnHandMinor: bigint; version: number }[]
  >`
    SELECT id, "quantityOnHandMicros", "valueOnHandMinor", version
      FROM "InventoryBalance"
     WHERE "organizationId" = ${context.organizationId}::uuid
       AND "productItemId" = ${productItemId}::uuid
       AND "locationId" = ${locationId}::uuid
       AND (${context.companyId ? RuntimePrisma.sql`"companyId" = ${context.companyId}::uuid` : RuntimePrisma.sql`TRUE`})
     FOR UPDATE
  `;
  if (!rows[0])
    throw new AppError("INVENTORY_BALANCE_NOT_FOUND", "Inventory balance missing.", 409);
  return rows[0];
}

async function activeReservedQuantity(
  tx: Tx,
  context: OrganizationContext,
  productItemId: string,
  locationId: string,
  at = new Date()
) {
  const reserved = await tx.inventoryReservation.aggregate({
    where: {
      organizationId: context.organizationId,
      ...(context.companyId ? { companyId: context.companyId } : {}),
      productItemId,
      locationId,
      status: { in: ["ACTIVE", "ALLOCATED"] },
      OR: [{ expiresAt: null }, { expiresAt: { gte: at } }]
    },
    _sum: { quantityMicros: true }
  });
  return reserved._sum.quantityMicros ?? 0n;
}

function binDto(row: {
  id: string;
  locationId: string;
  code: string;
  name: string;
  pickPriority: number;
  capacityMicros: bigint | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    capacityMicros: row.capacityMicros?.toString() ?? null,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function statusDto(row: {
  id: string;
  code: string;
  name: string;
  sellable: boolean;
  allocatable: boolean;
  isActive: boolean;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function lotDto(row: {
  id: string;
  productItemId: string;
  lotNumber: string;
  receivedAt: Date | null;
  expiryDate: Date | null;
  supplierId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    receivedAt: row.receivedAt ? serializeDate(row.receivedAt) : null,
    expiryDate: row.expiryDate ? serializeDate(row.expiryDate) : null,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function serialDto(row: {
  id: string;
  productItemId: string;
  serialNumber: string;
  lotId: string | null;
  locationId: string | null;
  binId: string | null;
  statusId: string | null;
  state: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function reservationDto(row: {
  id: string;
  productItemId: string;
  locationId: string;
  binId: string | null;
  lotId: string | null;
  statusId: string | null;
  quantityMicros: bigint;
  status: string;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  releasedAt: Date | null;
  fulfilledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    quantityMicros: row.quantityMicros.toString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function transferDto(row: {
  id: string;
  transferNumber: string;
  fromLocationId: string;
  toLocationId: string;
  status: string;
  reason: string | null;
  requestedByUserId: string;
  approvedByUserId: string | null;
  shippedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly {
    id: string;
    productItemId: string;
    quantityMicros: bigint;
    shippedMicros: bigint;
    receivedMicros: bigint;
    unitValueMinor: bigint;
    version: number;
  }[];
}) {
  return {
    ...row,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      ...line,
      quantityMicros: line.quantityMicros.toString(),
      shippedMicros: line.shippedMicros.toString(),
      receivedMicros: line.receivedMicros.toString(),
      unitValueMinor: line.unitValueMinor.toString()
    }))
  };
}

function countLineDto(row: {
  id: string;
  countId: string;
  productItemId: string;
  expectedMicros: bigint;
  countedMicros: bigint | null;
  varianceMicros: bigint | null;
  countedAt: Date | null;
  countedByUserId: string | null;
  version: number;
}) {
  return {
    ...row,
    expectedMicros: row.expectedMicros.toString(),
    countedMicros: row.countedMicros?.toString() ?? null,
    varianceMicros: row.varianceMicros?.toString() ?? null,
    countedAt: row.countedAt?.toISOString() ?? null
  };
}

function countDto(row: {
  id: string;
  locationId: string;
  status: string;
  countNumber: string;
  blind: boolean;
  snapshotAt: Date;
  releasedAt: Date | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  lines: readonly {
    id: string;
    countId: string;
    productItemId: string;
    expectedMicros: bigint;
    countedMicros: bigint | null;
    varianceMicros: bigint | null;
    countedAt: Date | null;
    countedByUserId: string | null;
    version: number;
  }[];
}) {
  return {
    ...row,
    snapshotAt: row.snapshotAt.toISOString(),
    releasedAt: row.releasedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map(countLineDto)
  };
}

function locationDto(row: {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  address: Prisma.JsonValue | null;
  isActive: boolean;
  isDefault: boolean;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    archivedAt: row.archivedAt ? serializeDate(row.archivedAt) : null,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function balanceDto(
  row: {
    id: string;
    productItemId: string;
    locationId: string;
    quantityOnHandMicros: bigint;
    valueOnHandMinor: bigint;
    averageUnitCostMicros: bigint;
    version: number;
    updatedAt: Date;
    productItem: {
      id: string;
      sku: string | null;
      name: string;
      productImageReference: string | null;
    };
    location: { code: string; name: string };
  },
  reservedQuantityMicros = 0n
) {
  return {
    id: row.id,
    productItemId: row.productItemId,
    locationId: row.locationId,
    quantityOnHandMicros: row.quantityOnHandMicros.toString(),
    quantityAvailableMicros: (row.quantityOnHandMicros - reservedQuantityMicros).toString(),
    valueOnHandMinor: row.valueOnHandMinor.toString(),
    averageUnitCostMicros: row.averageUnitCostMicros.toString(),
    version: row.version,
    updatedAt: serializeDate(row.updatedAt),
    productItem: row.productItem,
    location: row.location
  };
}

function movementDto(row: {
  id: string;
  eventId: string;
  movementType: string;
  productItemId: string;
  locationId: string;
  quantityMicros: bigint;
  unitCostMicros: bigint;
  totalValueMinor: bigint;
  eventDate: Date;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  journalId: string | null;
  reason: string | null;
  createdAt: Date;
}) {
  return {
    ...row,
    quantityMicros: row.quantityMicros.toString(),
    unitCostMicros: row.unitCostMicros.toString(),
    totalValueMinor: row.totalValueMinor.toString(),
    eventDate: serializeDate(row.eventDate),
    createdAt: serializeDate(row.createdAt)
  };
}

async function inventoryAudit(
  tx: Tx,
  context: OrganizationContext,
  action: string,
  eventId: string,
  movement: { id: string; productItemId: string; locationId: string; quantityMicros: bigint }
) {
  await audit(tx, context, action, "InventoryMovement", movement.id, {
    eventId,
    productItemId: movement.productItemId,
    locationId: movement.locationId,
    quantityMicros: movement.quantityMicros.toString()
  });
}

async function audit(
  tx: Tx,
  context: OrganizationContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType,
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

function isUnique(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
