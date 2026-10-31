/*
 * The checked-in legacy Prisma client cannot describe the additive D5 models
 * without triggering TypeScript's recursive generated-payload limit. The
 * package runtime uses the regenerated D5 client; this service keeps its
 * shallow transaction boundary explicit until the generated clients converge.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/restrict-template-expressions */
import { createHash, randomUUID } from "node:crypto";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../../auth/permissions.js";
import { withAuditOrigin } from "../../utils/audit.js";
import type { DocumentStorage } from "../invoice-render-service.js";
import { PurchaseService } from "../purchase-service.js";
import {
  CarrierOperationError,
  type CarrierAdapter,
  type CarrierCredentials,
  type CarrierEnvironment,
  type CarrierLabel,
  type CarrierPurchase,
  type CarrierShipmentRequest,
  type CustomsLine,
  type LabelFormat,
  type ShippingAddress
} from "./carrier-adapter.js";

type Tx = any;
type ShipmentCreateInput = {
  readonly carrierAccountId: string;
  readonly parcels: readonly {
    readonly parcelNumber: number;
    readonly weightGrams: number;
    readonly lengthMm: number;
    readonly widthMm: number;
    readonly heightMm: number;
    readonly packageType?: string | null | undefined;
    readonly labelFormat?: LabelFormat | undefined;
    readonly declaredValueMinor?: string | null | undefined;
    readonly declaredCurrency?: string | null | undefined;
    readonly customsLines?: readonly CustomsLine[] | null | undefined;
  }[];
  readonly destinationAddress?: ShippingAddress | undefined;
};

type SourceLine = {
  readonly id: string;
  readonly description: string;
  readonly quantityMicros: bigint;
  readonly totalMinor: bigint;
  readonly productItem: {
    readonly id: string;
    readonly hsTariffCode: string | null;
    readonly countryOfOrigin: string | null;
  } | null;
};

// Keep the generated Prisma payload shallow. Related shipping rows are
// hydrated explicitly below, avoiding a recursive tenant graph in TypeScript.
type ShipmentWithRelations = Record<string, any> & {
  carrierAccount: Record<string, any>;
  parcels: Record<string, any>[];
  labels: Record<string, any>[];
  trackingEvents: Record<string, any>[];
  voidAttempts: Record<string, any>[];
  inventoryMovements: Record<string, any>[];
};

export class ShippingService {
  private readonly authorization: AuthorizationService;
  private readonly adapters = new Map<string, CarrierAdapter>();

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage,
    private readonly purchases: PurchaseService,
    adapters: readonly CarrierAdapter[],
    private readonly credentialProtector: {
      protect(value: string): string;
      reveal(value: string): string;
    }
  ) {
    this.authorization = new AuthorizationService(prisma);
    for (const adapter of adapters) this.adapters.set(adapter.carrierKey, adapter);
  }

  public async listCarrierAccounts(context: OrganizationContext) {
    await this.authorization.assert(context, "shipping:read", "CarrierAccount");
    const rows = (await withTenantTransaction(this.prisma, dbContext(context), (tx: any) =>
      tx.carrierAccount.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ displayName: "asc" }, { id: "asc" }]
      })
    )) as any[];
    return rows.map((row) => carrierAccountDto(row));
  }

  public async createCarrierAccount(
    context: OrganizationContext,
    input: {
      readonly carrierKey: string;
      readonly displayName: string;
      readonly environment: CarrierEnvironment;
      readonly credentials: CarrierCredentials;
      readonly externalAccountId?: string | null | undefined;
      readonly defaultLabelFormat: LabelFormat;
      readonly defaultLabelWidthMm: number;
      readonly defaultLabelHeightMm: number;
    }
  ) {
    await this.authorization.assert(context, "shipping:manage", "CarrierAccount");
    const adapter = this.adapter(input.carrierKey);
    await this.callCarrier(() => adapter.validateCredentials(input.credentials, input.environment));
    const id = randomUUID();
    try {
      const row = await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
        const created = await tx.carrierAccount.create({
          data: {
            id,
            organizationId: context.organizationId,
            carrierKey: input.carrierKey,
            displayName: input.displayName.trim(),
            environment: input.environment,
            externalAccountId: input.externalAccountId?.trim() || null,
            credentialCiphertext: this.credentialProtector.protect(
              JSON.stringify(input.credentials)
            ),
            status: "ACTIVE",
            defaultLabelFormat: input.defaultLabelFormat,
            defaultLabelWidthMm: input.defaultLabelWidthMm,
            defaultLabelHeightMm: input.defaultLabelHeightMm,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "CARRIER_ACCOUNT_CREATED", "CarrierAccount", id, {
          carrierKey: created.carrierKey,
          environment: created.environment
        });
        return created;
      });
      return carrierAccountDto(row);
    } catch (error) {
      if (isUniqueError(error))
        throw new AppError(
          "SHIPPING_CARRIER_ACCOUNT_EXISTS",
          "An account for this carrier and environment already exists.",
          409
        );
      throw error;
    }
  }

  public async deactivateCarrierAccount(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "shipping:manage", "CarrierAccount", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
      const result = await tx.carrierAccount.updateMany({
        where: { id, organizationId: context.organizationId, status: { not: "INACTIVE" } },
        data: { status: "INACTIVE", updatedByUserId: context.user.id }
      });
      if (result.count !== 1)
        throw new AppError(
          "SHIPPING_CARRIER_ACCOUNT_NOT_FOUND",
          "Carrier account was not found.",
          404
        );
      await audit(tx, context, "CARRIER_ACCOUNT_DEACTIVATED", "CarrierAccount", id, {});
      return tx.carrierAccount.findUniqueOrThrow({ where: { id } });
    });
    return carrierAccountDto(row);
  }

  public async createShipmentFromInvoice(
    context: OrganizationContext,
    invoiceId: string,
    input: ShipmentCreateInput
  ) {
    await this.authorization.assert(context, "shipping:manage", "Shipment", invoiceId);
    return this.createShipment(context, { invoiceId, input });
  }

  public async createShipmentFromSale(
    context: OrganizationContext,
    saleId: string,
    input: ShipmentCreateInput
  ) {
    await this.authorization.assert(context, "shipping:manage", "Shipment", saleId);
    return this.createShipment(context, { saleId, input });
  }

  public async getShipment(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "shipping:read", "Shipment", id);
    const row = await this.findShipment(context, id);
    if (!row) throw new AppError("SHIPPING_SHIPMENT_NOT_FOUND", "Shipment was not found.", 404);
    return shipmentDto(row);
  }

  public async quoteShipment(
    context: OrganizationContext,
    id: string,
    input: { readonly version: number; readonly serviceCode?: string | undefined }
  ) {
    await this.authorization.assert(context, "shipping:quote", "Shipment", id);
    const shipment = await this.findShipment(context, id);
    if (!shipment)
      throw new AppError("SHIPPING_SHIPMENT_NOT_FOUND", "Shipment was not found.", 404);
    if (["PURCHASED", "PURCHASED_EXPENSE_PENDING", "VOIDED"].includes(shipment.status))
      return shipmentDto(shipment);
    if (shipment.version !== input.version)
      throw new AppError(
        "SHIPPING_SHIPMENT_STALE",
        "Shipment was changed; reload before quoting.",
        409
      );
    const adapter = this.adapter(shipment.carrierAccount.carrierKey);
    const credentials = this.credentials(shipment.carrierAccount.credentialCiphertext);
    await this.assertCustoms(context, shipment);
    const origin = addressFromJson(shipment.originAddress);
    const destination = addressFromJson(shipment.destinationAddress);
    if (!origin || !destination)
      throw new AppError(
        "SHIPPING_ADDRESS_INVALID",
        "The shipment addresses are incomplete or invalid.",
        422
      );
    await this.callCarrier(() =>
      adapter.validateCredentials(credentials, shipment.carrierAccount.environment)
    );
    await this.callCarrier(() => adapter.validateAddress(credentials, origin, "ORIGIN"));
    await this.callCarrier(() => adapter.validateAddress(credentials, destination, "DESTINATION"));
    const quote = await this.callCarrier(() =>
      adapter.quote(
        credentials,
        shipment.carrierAccount.environment,
        this.carrierRequest(shipment, input.serviceCode)
      )
    );
    const updated = await withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx: any) => {
        const result = await tx.shipment.updateMany({
          where: { id, organizationId: context.organizationId, version: input.version },
          data: {
            status: "QUOTED",
            serviceCode: quote.serviceCode,
            serviceName: quote.serviceName,
            quotedCostMinor: BigInt(quote.costMinor),
            quotedCurrency: quote.currency,
            customsDeclaration: customsJson(shipment),
            lastProviderCode: null,
            lastErrorMessage: null,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (result.count !== 1)
          throw new AppError(
            "SHIPPING_SHIPMENT_STALE",
            "Shipment was changed; reload before quoting.",
            409
          );
        await audit(tx, context, "SHIPMENT_QUOTED", "Shipment", id, {
          carrierKey: shipment.carrierAccount.carrierKey,
          serviceCode: quote.serviceCode,
          quotedCostMinor: quote.costMinor,
          quotedCurrency: quote.currency
        });
        return hydrateShipment(tx, await tx.shipment.findUniqueOrThrow({ where: { id } }));
      }
    );
    return shipmentDto(updated);
  }

  public async purchaseShipment(
    context: OrganizationContext,
    id: string,
    input: {
      readonly version: number;
      readonly confirmed: true;
      readonly serviceCode: string;
      readonly quotedCostMinor: string;
      readonly quotedCurrency: string;
      readonly expenseAccountId: string;
      readonly payingAccountId: string;
      readonly expenseMethod:
        | "CASH"
        | "CHEQUE"
        | "ELECTRONIC_TRANSFER"
        | "CREDIT_CARD"
        | "OWNER_PAID"
        | "OTHER";
      readonly expenseDate: string;
    }
  ) {
    await this.authorization.assert(context, "shipping:purchase", "Shipment", id);
    let shipment = await this.findShipment(context, id);
    if (!shipment)
      throw new AppError("SHIPPING_SHIPMENT_NOT_FOUND", "Shipment was not found.", 404);
    if (shipment.status === "PURCHASED_EXPENSE_PENDING")
      return shipmentDto(await this.finishPendingExpense(context, shipment, input));
    if (shipment.status === "PURCHASED" || shipment.status === "VOIDED")
      return shipmentDto(shipment);
    if (shipment.version !== input.version)
      throw new AppError(
        "SHIPPING_SHIPMENT_STALE",
        "Shipment was changed; reload before purchasing.",
        409
      );
    await this.assertCustoms(context, shipment);
    const adapter = this.adapter(shipment.carrierAccount.carrierKey);
    const credentials = this.credentials(shipment.carrierAccount.credentialCiphertext);
    const request = this.carrierRequest(shipment, input.serviceCode);

    if (shipment.status === "PURCHASE_UNKNOWN" || shipment.status === "PURCHASING") {
      const reconciled = await this.callCarrier(() =>
        adapter.reconcilePurchase(
          credentials,
          shipment!.carrierAccount.environment,
          shipment!.purchaseIdempotencyKey
        )
      );
      if (!reconciled) {
        if (shipment.status === "PURCHASING")
          throw new AppError(
            "SHIPPING_PURCHASE_IN_PROGRESS",
            "The carrier purchase is still being reconciled.",
            409
          );
        throw new AppError(
          "SHIPPING_PURCHASE_RECONCILIATION_REQUIRED",
          "The carrier did not confirm the purchase; reconcile before retrying.",
          409
        );
      }
      return shipmentDto(await this.finalizePurchase(context, shipment, reconciled, input));
    }

    if (shipment.status !== "QUOTED")
      throw new AppError(
        "SHIPPING_QUOTE_REQUIRED",
        "Quote the shipment and review its cost before purchasing.",
        409
      );
    if (
      shipment.serviceCode !== input.serviceCode ||
      shipment.quotedCurrency !== input.quotedCurrency ||
      shipment.quotedCostMinor?.toString() !== input.quotedCostMinor
    )
      throw new AppError(
        "SHIPPING_QUOTE_CONFIRMATION_MISMATCH",
        "The carrier, service, currency, or quoted cost no longer matches the reviewed quote.",
        409
      );
    shipment = await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
      const changed = await tx.shipment.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version: input.version,
          status: "QUOTED"
        },
        data: {
          status: "PURCHASING",
          reconcileRequired: false,
          lastErrorMessage: null,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "SHIPPING_PURCHASE_IN_PROGRESS",
          "Another purchase attempt is already handling this shipment.",
          409
        );
      await audit(tx, context, "SHIPMENT_PURCHASE_STARTED", "Shipment", id, {
        serviceCode: input.serviceCode
      });
      return hydrateShipment(tx, await tx.shipment.findUniqueOrThrow({ where: { id } }));
    });

    let purchase: CarrierPurchase;
    try {
      purchase = await this.callCarrier(() =>
        adapter.buyLabel(credentials, shipment.carrierAccount.environment, request)
      );
    } catch (error) {
      const ambiguous = error instanceof CarrierOperationError && error.ambiguous;
      await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
        await tx.shipment.updateMany({
          where: { id, organizationId: context.organizationId },
          data: {
            status: ambiguous ? "PURCHASE_UNKNOWN" : "FAILED",
            reconcileRequired: ambiguous,
            lastProviderCode:
              error instanceof CarrierOperationError ? error.code : "CARRIER_REQUEST_FAILED",
            lastErrorMessage: redactedError(error),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
      });
      if (ambiguous)
        throw new AppError(
          "SHIPPING_PURCHASE_UNKNOWN",
          "The carrier may have purchased this label, but did not return a definitive answer. Retry to reconcile it before another purchase attempt.",
          409
        );
      throw error;
    }
    return shipmentDto(await this.finalizePurchase(context, shipment, purchase, input));
  }

  public async getLabel(
    context: OrganizationContext,
    id: string
  ): Promise<{ readonly mediaType: "application/pdf" | "application/zpl"; readonly data: Buffer }> {
    await this.authorization.assert(context, "shipping:read", "ShipmentLabel", id);
    const label = (await withTenantTransaction(this.prisma, dbContext(context), (tx: any) =>
      tx.shipmentLabel.findFirst({ where: { id, organizationId: context.organizationId } })
    )) as any;
    if (!label)
      throw new AppError("SHIPPING_LABEL_NOT_FOUND", "Shipping label was not found.", 404);
    return { ...labelDto(label), data: await this.storage.get(label.storageKey) };
  }

  public async voidShipment(
    context: OrganizationContext,
    id: string,
    input: { readonly version: number; readonly reason: string }
  ) {
    await this.authorization.assert(context, "shipping:void", "Shipment", id);
    let shipment = await this.findShipment(context, id);
    if (!shipment)
      throw new AppError("SHIPPING_SHIPMENT_NOT_FOUND", "Shipment was not found.", 404);
    if (!["PURCHASED", "VOID_REJECTED", "VOID_PENDING"].includes(shipment.status))
      throw new AppError(
        "SHIPPING_VOID_NOT_AVAILABLE",
        "Only a purchased shipment can be sent to the carrier for voiding.",
        409
      );
    if (shipment.status !== "VOID_PENDING") {
      if (shipment.version !== input.version)
        throw new AppError(
          "SHIPPING_SHIPMENT_STALE",
          "Shipment was changed; reload before voiding.",
          409
        );
      await withTenantTransaction(this.prisma, dbContext(context), (tx: any) =>
        tx.shipment.update({
          where: { id },
          data: {
            status: "VOID_PENDING",
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        })
      );
      shipment = (await this.findShipment(context, id))!;
    }
    const adapter = this.adapter(shipment.carrierAccount.carrierKey);
    const credentials = this.credentials(shipment.carrierAccount.credentialCiphertext);
    try {
      const answer = await this.callCarrier(() =>
        adapter.voidLabel(
          credentials,
          shipment.carrierAccount.environment,
          shipment.providerShipmentId!
        )
      );
      const updated = await withTenantTransaction(
        this.prisma,
        dbContext(context),
        async (tx: any) => {
          const status = answer.status === "ACCEPTED" ? "VOIDED" : "VOID_REJECTED";
          await tx.shipmentVoidAttempt.create({
            data: {
              organizationId: context.organizationId,
              shipmentId: id,
              status: answer.status,
              providerCode: answer.providerCode ?? null,
              responseMessage: answer.message?.slice(0, 500) ?? null,
              completedAt: new Date(),
              createdByUserId: context.user.id
            }
          });
          await tx.shipment.update({
            where: { id },
            data: {
              status,
              voidedAt: answer.status === "ACCEPTED" ? new Date() : null,
              lastProviderCode: answer.providerCode ?? null,
              lastErrorMessage:
                answer.status === "REJECTED" ? (answer.message?.slice(0, 500) ?? null) : null,
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            }
          });
          await audit(tx, context, "SHIPMENT_VOID_ANSWERED", "Shipment", id, {
            status: answer.status,
            reason: input.reason.trim()
          });
          return hydrateShipment(tx, await tx.shipment.findUniqueOrThrow({ where: { id } }));
        }
      );
      return shipmentDto(updated);
    } catch (error) {
      await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
        await tx.shipmentVoidAttempt.create({
          data: {
            organizationId: context.organizationId,
            shipmentId: id,
            status: "UNKNOWN",
            providerCode:
              error instanceof CarrierOperationError ? error.code : "CARRIER_REQUEST_FAILED",
            responseMessage: redactedError(error),
            completedAt: null,
            createdByUserId: context.user.id
          }
        });
        await tx.shipment.update({
          where: { id },
          data: {
            status: "VOID_PENDING",
            lastProviderCode:
              error instanceof CarrierOperationError ? error.code : "CARRIER_REQUEST_FAILED",
            lastErrorMessage: redactedError(error),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
      });
      throw new AppError(
        "SHIPPING_VOID_RECONCILIATION_REQUIRED",
        "The carrier did not confirm the void. Check the carrier before retrying.",
        409
      );
    }
  }

  public async trackShipment(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "shipping:track", "Shipment", id);
    const shipment = await this.findShipment(context, id);
    if (!shipment)
      throw new AppError("SHIPPING_SHIPMENT_NOT_FOUND", "Shipment was not found.", 404);
    if (!shipment.trackingNumber)
      throw new AppError(
        "SHIPPING_TRACKING_NOT_AVAILABLE",
        "The carrier has not returned a tracking number.",
        409
      );
    const adapter = this.adapter(shipment.carrierAccount.carrierKey);
    const credentials = this.credentials(shipment.carrierAccount.credentialCiphertext);
    const result = await this.callCarrier(() =>
      adapter.track(credentials, shipment.carrierAccount.environment, shipment.trackingNumber!)
    );
    const updated = await withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx: any) => {
        for (const event of result.events) {
          const eventHash = createHash("sha256")
            .update(
              JSON.stringify({
                externalEventId: event.externalEventId,
                status: event.status,
                occurredAt: event.occurredAt.toISOString(),
                description: event.description,
                location: event.location
              })
            )
            .digest("hex");
          await tx.trackingEvent.createMany({
            data: [
              {
                organizationId: context.organizationId,
                shipmentId: id,
                externalEventId: event.externalEventId ?? null,
                eventHash,
                status: event.status,
                description: event.description?.slice(0, 500) ?? null,
                location: event.location?.slice(0, 200) ?? null,
                occurredAt: event.occurredAt,
                metadata: event.metadata
                  ? (event.metadata as Prisma.InputJsonValue)
                  : Prisma.JsonNull
              }
            ],
            skipDuplicates: true
          });
        }
        await tx.shipment.update({
          where: { id },
          data: {
            lastProviderCheckAt: new Date(),
            lastProviderCode: null,
            lastErrorMessage: null,
            updatedByUserId: context.user.id
          }
        });
        return hydrateShipment(tx, await tx.shipment.findUniqueOrThrow({ where: { id } }));
      }
    );
    return shipmentDto(updated);
  }

  private async createShipment(
    context: OrganizationContext,
    source: {
      readonly invoiceId?: string;
      readonly saleId?: string;
      readonly input: ShipmentCreateInput;
    }
  ) {
    const account = (await withTenantTransaction(this.prisma, dbContext(context), (tx: any) =>
      tx.carrierAccount.findFirst({
        where: {
          id: source.input.carrierAccountId,
          organizationId: context.organizationId,
          status: "ACTIVE"
        }
      })
    )) as any;
    if (!account)
      throw new AppError(
        "SHIPPING_CARRIER_ACCOUNT_NOT_FOUND",
        "Active carrier account was not found.",
        404
      );
    const sourceData = await withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx: any) => {
        if (source.invoiceId) {
          const invoice = await tx.invoice.findFirst({
            where: { id: source.invoiceId, organizationId: context.organizationId },
            include: {
              customer: { include: { addresses: true } },
              lines: { include: { productItem: true } }
            }
          });
          if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
          if (!["POSTED", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(invoice.status))
            throw new AppError(
              "SHIPPING_SOURCE_NOT_POSTED",
              "Only a posted invoice can have a shipment.",
              409
            );
          const settings = await tx.organizationSettings.findUnique({
            where: { organizationId: context.organizationId }
          });
          const organization = await tx.organization.findUnique({
            where: { id: context.organizationId },
            select: { displayName: true, legalName: true }
          });
          return {
            sourceInvoiceId: invoice.id,
            sourceId: invoice.id,
            customerName: invoice.customer.displayName,
            customerAddresses: invoice.customer.addresses,
            origin: addressFromJson(
              settings?.businessAddress,
              organization?.displayName ?? organization?.legalName ?? "Shipping sender"
            ),
            destination:
              source.input.destinationAddress ??
              addressFromCustomer(invoice.customer.addresses, invoice.customer.displayName),
            lines: invoice.lines.map((line: any) => ({
              id: line.id,
              description: line.description,
              quantityMicros: line.quantityMicros,
              totalMinor: line.totalMinor,
              productItem: line.productItem
                ? {
                    id: line.productItem.id,
                    hsTariffCode: line.productItem.hsTariffCode,
                    countryOfOrigin: line.productItem.countryOfOrigin
                  }
                : null
            }))
          };
        }
        const sale = await tx.posSale.findFirst({
          where: { id: source.saleId, organizationId: context.organizationId },
          include: {
            customer: { include: { addresses: true } },
            lines: { include: { productItem: true } }
          }
        });
        if (!sale)
          throw new AppError("POS_SALE_NOT_FOUND", "Point-of-sale sale was not found.", 404);
        if (sale.status !== "COMPLETED")
          throw new AppError(
            "SHIPPING_SOURCE_NOT_COMPLETED",
            "Only a completed sale can have a shipment.",
            409
          );
        const settings = await tx.organizationSettings.findUnique({
          where: { organizationId: context.organizationId }
        });
        const organization = await tx.organization.findUnique({
          where: { id: context.organizationId },
          select: { displayName: true, legalName: true }
        });
        return {
          sourceSaleId: sale.id,
          sourceId: sale.id,
          customerName: sale.customer.displayName,
          customerAddresses: sale.customer.addresses,
          origin: addressFromJson(
            settings?.businessAddress,
            organization?.displayName ?? organization?.legalName ?? "Shipping sender"
          ),
          destination:
            source.input.destinationAddress ??
            addressFromCustomer(sale.customer.addresses, sale.customer.displayName),
          lines: sale.lines.map((line: any) => ({
            id: line.id,
            description: line.description,
            quantityMicros: line.quantityMicros,
            totalMinor: line.totalMinor,
            productItem: line.productItem
              ? {
                  id: line.productItem.id,
                  hsTariffCode: line.productItem.hsTariffCode,
                  countryOfOrigin: line.productItem.countryOfOrigin
                }
              : null
          }))
        };
      }
    );
    if (!sourceData.origin || !sourceData.destination)
      throw new AppError(
        "SHIPPING_ADDRESS_REQUIRED",
        "A complete origin and shipping destination address are required.",
        422
      );
    validateAddress(sourceData.origin, "origin");
    validateAddress(sourceData.destination, "destination");
    for (const parcel of source.input.parcels) {
      if (parcel.declaredValueMinor && !parcel.declaredCurrency)
        throw new AppError(
          "SHIPPING_DECLARED_CURRENCY_REQUIRED",
          "Declared value requires a declared currency.",
          422
        );
    }
    const id = randomUUID();
    const row = await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
      const existing = await tx.shipment.findFirst({
        where: {
          organizationId: context.organizationId,
          ...(source.invoiceId
            ? { sourceInvoiceId: source.invoiceId }
            : { sourceSaleId: source.saleId }),
          status: { not: "VOIDED" }
        }
      });
      if (existing)
        throw new AppError(
          "SHIPPING_SOURCE_ALREADY_HAS_SHIPMENT",
          "This sale already has an active shipment.",
          409
        );
      const movements = await tx.inventoryMovement.findMany({
        where: {
          organizationId: context.organizationId,
          OR: [
            { sourceId: sourceData.sourceId },
            { invoiceLineId: { in: sourceData.lines.map((line: any) => line.id) } }
          ]
        },
        select: { id: true }
      });
      const created = await tx.shipment.create({
        data: {
          id,
          organizationId: context.organizationId,
          carrierAccountId: account.id,
          sourceInvoiceId: sourceData.sourceInvoiceId ?? null,
          sourceSaleId: sourceData.sourceSaleId ?? null,
          purchaseIdempotencyKey: `shipment:${id}`,
          originAddress: addressJson(sourceData.origin!),
          destinationAddress: addressJson(sourceData.destination!),
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await tx.shipmentParcel.createMany({
        data: source.input.parcels.map((parcel) => ({
          organizationId: context.organizationId,
          shipmentId: id,
          parcelNumber: parcel.parcelNumber,
          weightGrams: parcel.weightGrams,
          lengthMm: parcel.lengthMm,
          widthMm: parcel.widthMm,
          heightMm: parcel.heightMm,
          packageType: parcel.packageType ?? null,
          labelFormat: account.defaultLabelFormat,
          declaredValueMinor: parcel.declaredValueMinor ? BigInt(parcel.declaredValueMinor) : null,
          declaredCurrency: parcel.declaredCurrency ?? null,
          customsLines: parcel.customsLines
            ? (parcel.customsLines as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull
        }))
      });
      if (movements.length)
        await tx.shipmentInventoryMovement.createMany({
          data: movements.map((movement: any) => ({
            organizationId: context.organizationId,
            shipmentId: id,
            inventoryMovementId: movement.id
          }))
        });
      await audit(tx, context, "SHIPMENT_DRAFT_CREATED", "Shipment", id, {
        sourceId: sourceData.sourceId,
        carrierKey: account.carrierKey,
        inventoryMovementCount: movements.length
      });
      return hydrateShipment(tx, created);
    });
    return shipmentDto(row);
  }

  private async finishPendingExpense(
    context: OrganizationContext,
    shipment: ShipmentWithRelations,
    input: {
      readonly expenseAccountId: string;
      readonly payingAccountId: string;
      readonly expenseMethod:
        | "CASH"
        | "CHEQUE"
        | "ELECTRONIC_TRANSFER"
        | "CREDIT_CARD"
        | "OWNER_PAID"
        | "OTHER";
      readonly expenseDate: string;
    }
  ) {
    if (shipment.purchasedCostMinor === null || !shipment.purchasedCurrency)
      throw new AppError(
        "SHIPPING_PURCHASE_RECORD_INVALID",
        "The purchased shipment is missing its carrier cost.",
        500
      );
    const expense = await this.recordShippingExpense(
      context,
      shipment,
      shipment.purchasedCostMinor.toString(),
      shipment.purchasedCurrency,
      input
    );
    const updated = await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) =>
      hydrateShipment(
        tx,
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            status: "PURCHASED",
            shippingExpenseId: expense.id,
            reconcileRequired: false,
            lastErrorMessage: null,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        })
      )
    );
    return updated;
  }

  private async finalizePurchase(
    context: OrganizationContext,
    shipment: ShipmentWithRelations,
    purchase: CarrierPurchase,
    input: {
      readonly expenseAccountId: string;
      readonly payingAccountId: string;
      readonly expenseMethod:
        | "CASH"
        | "CHEQUE"
        | "ELECTRONIC_TRANSFER"
        | "CREDIT_CARD"
        | "OWNER_PAID"
        | "OTHER";
      readonly expenseDate: string;
    }
  ) {
    const labels: Array<{
      label: CarrierLabel;
      parcel: Record<string, any> | undefined;
      storageKey: string;
      contentHash: string;
    }> = [];
    for (const label of purchase.labels) {
      if (label.data.length === 0)
        throw new AppError(
          "SHIPPING_LABEL_CONTENT_MISSING",
          "The carrier returned an empty label.",
          502
        );
      const parcel = shipment.parcels.find(
        (candidate) => candidate.parcelNumber === (label.parcelNumber ?? 1)
      );
      const extension = label.format === "ZPL" ? "zpl" : "pdf";
      const storageKey = `shipping/${context.organizationId}/${shipment.id}/${label.parcelNumber ?? 1}.${extension}`;
      await this.storage.put(storageKey, label.data, label.mediaType);
      labels.push({
        label,
        parcel,
        storageKey,
        contentHash: createHash("sha256").update(label.data).digest("hex")
      });
    }
    let expense: { id: string };
    try {
      expense = await this.recordShippingExpense(
        context,
        shipment,
        purchase.costMinor,
        purchase.currency,
        input
      );
    } catch (error) {
      await withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
        await tx.shipment.updateMany({
          where: { id: shipment.id, organizationId: context.organizationId },
          data: {
            status: "PURCHASED_EXPENSE_PENDING",
            providerShipmentId: purchase.providerShipmentId,
            trackingNumber: purchase.trackingNumber ?? null,
            purchasedCostMinor: BigInt(purchase.costMinor),
            purchasedCurrency: purchase.currency,
            purchasedAt: new Date(),
            reconcileRequired: false,
            lastProviderCode: "EXPENSE_POSTING_PENDING",
            lastErrorMessage: redactedError(error),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
      });
      throw error;
    }
    const updated = await withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx: any) => {
        for (const item of labels) {
          const existing = await tx.shipmentLabel.findFirst({
            where: { organizationId: context.organizationId, storageKey: item.storageKey }
          });
          if (!existing)
            await tx.shipmentLabel.create({
              data: {
                organizationId: context.organizationId,
                shipmentId: shipment.id,
                parcelId: item.parcel?.id ?? null,
                format: item.label.format,
                mediaType: item.label.mediaType,
                storageKey: item.storageKey,
                contentHash: item.contentHash,
                byteSize: item.label.data.length,
                providerLabelId: item.label.providerLabelId ?? null
              }
            });
        }
        const row = await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            status: "PURCHASED",
            providerShipmentId: purchase.providerShipmentId,
            trackingNumber: purchase.trackingNumber ?? null,
            purchasedCostMinor: BigInt(purchase.costMinor),
            purchasedCurrency: purchase.currency,
            shippingExpenseId: expense.id,
            purchasedAt: new Date(),
            reconcileRequired: false,
            lastProviderCode: null,
            lastErrorMessage: null,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await audit(tx, context, "SHIPMENT_PURCHASED", "Shipment", shipment.id, {
          providerShipmentId: purchase.providerShipmentId,
          trackingNumber: purchase.trackingNumber ?? null,
          costMinor: purchase.costMinor,
          currency: purchase.currency,
          shippingExpenseId: expense.id
        });
        return hydrateShipment(tx, row);
      }
    );
    return updated;
  }

  private async recordShippingExpense(
    context: OrganizationContext,
    shipment: ShipmentWithRelations,
    costMinor: string,
    currency: string,
    input: {
      readonly expenseAccountId: string;
      readonly payingAccountId: string;
      readonly expenseMethod:
        | "CASH"
        | "CHEQUE"
        | "ELECTRONIC_TRANSFER"
        | "CREDIT_CARD"
        | "OWNER_PAID"
        | "OTHER";
      readonly expenseDate: string;
    }
  ) {
    const result = await this.purchases.recordImmediateExpense(
      context,
      {
        reference: `Shipping ${shipment.id}`,
        expenseDate: input.expenseDate,
        method: input.expenseMethod,
        payingAccountId: input.payingAccountId,
        internalNotes: `Carrier label cost for shipment ${shipment.id}. Postage was purchased directly on the operator-owned carrier account.`,
        lines: [
          {
            description: `Shipping label — ${shipment.carrierAccount.displayName}`,
            quantity: "1",
            unitCostMinor: costMinor,
            accountId: input.expenseAccountId
          }
        ]
      },
      `shipping-expense:${shipment.id}`
    );
    const expense = (result.body as { expense?: { id?: string } }).expense;
    if (!expense?.id)
      throw new AppError(
        "SHIPPING_EXPENSE_NOT_CREATED",
        `The ${currency} shipping cost could not be linked to the shipment.`,
        500
      );
    return expense as { id: string };
  }

  private async assertCustoms(context: OrganizationContext, shipment: ShipmentWithRelations) {
    const origin = addressFromJson(shipment.originAddress);
    const destination = addressFromJson(shipment.destinationAddress);
    if (!origin || !destination)
      throw new AppError(
        "SHIPPING_ADDRESS_INVALID",
        "The shipment addresses are incomplete or invalid.",
        422
      );
    if (origin.countryCode === destination.countryCode) return null;
    const lines = await this.sourceLines(context, shipment);
    const customs = shipment.parcels.flatMap((parcel) =>
      Array.isArray(parcel.customsLines) ? parcel.customsLines.filter(isCustomsLine) : []
    );
    const missing: string[] = [];
    const normalized: Record<string, unknown>[] = [];
    for (const line of lines) {
      if (!line.productItem?.hsTariffCode || !line.productItem.countryOfOrigin)
        missing.push(`${line.description}: HS code and country of origin`);
      const supplied = customs.find(
        (candidate) =>
          candidate.invoiceLineId === line.id || candidate.description === line.description
      );
      if (!supplied) missing.push(`${line.description}: declared value`);
      if (
        supplied &&
        line.productItem?.hsTariffCode &&
        supplied.hsTariffCode !== line.productItem.hsTariffCode
      )
        throw new AppError(
          "SHIPPING_CUSTOMS_DATA_MISMATCH",
          `Customs data for ${line.description} does not match the product record.`,
          422
        );
      if (
        supplied &&
        line.productItem?.countryOfOrigin &&
        supplied.countryOfOrigin !== line.productItem.countryOfOrigin
      )
        throw new AppError(
          "SHIPPING_CUSTOMS_DATA_MISMATCH",
          `Customs data for ${line.description} does not match the product record.`,
          422
        );
      if (supplied)
        normalized.push({
          description: line.description,
          quantity: supplied.quantity,
          hsTariffCode: line.productItem?.hsTariffCode ?? supplied.hsTariffCode,
          countryOfOrigin: line.productItem?.countryOfOrigin ?? supplied.countryOfOrigin,
          declaredValueMinor: supplied.declaredValueMinor,
          declaredCurrency: supplied.declaredCurrency
        });
    }
    if (missing.length)
      throw new AppError(
        "SHIPPING_CUSTOMS_DATA_REQUIRED",
        `Cross-border shipment requires operator-supplied customs data: ${missing.join("; ")}. PennyWise does not classify goods or calculate duty; the operator is the declarant.`,
        422
      );
    return normalized;
  }

  private async sourceLines(
    context: OrganizationContext,
    shipment: ShipmentWithRelations
  ): Promise<SourceLine[]> {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
      if (shipment.sourceInvoiceId) {
        const invoice = await tx.invoice.findFirst({
          where: { id: shipment.sourceInvoiceId, organizationId: context.organizationId },
          include: { lines: { include: { productItem: true } } }
        });
        return (invoice?.lines ?? []).map((line: any) => ({
          id: line.id,
          description: line.description,
          quantityMicros: line.quantityMicros,
          totalMinor: line.totalMinor,
          productItem: line.productItem
            ? {
                id: line.productItem.id,
                hsTariffCode: line.productItem.hsTariffCode,
                countryOfOrigin: line.productItem.countryOfOrigin
              }
            : null
        }));
      }
      const sale = await tx.posSale.findFirst({
        where: { id: shipment.sourceSaleId ?? "", organizationId: context.organizationId },
        include: { lines: { include: { productItem: true } } }
      });
      return (sale?.lines ?? []).map((line: any) => ({
        id: line.id,
        description: line.description,
        quantityMicros: line.quantityMicros,
        totalMinor: line.totalMinor,
        productItem: line.productItem
          ? {
              id: line.productItem.id,
              hsTariffCode: line.productItem.hsTariffCode,
              countryOfOrigin: line.productItem.countryOfOrigin
            }
          : null
      }));
    });
  }

  private carrierRequest(
    shipment: ShipmentWithRelations,
    serviceCode?: string | null
  ): CarrierShipmentRequest {
    const origin = addressFromJson(shipment.originAddress);
    const destination = addressFromJson(shipment.destinationAddress);
    if (!origin || !destination)
      throw new AppError(
        "SHIPPING_ADDRESS_INVALID",
        "The shipment addresses are incomplete or invalid.",
        422
      );
    return {
      purchaseKey: shipment.purchaseIdempotencyKey,
      origin,
      destination,
      serviceCode: serviceCode ?? shipment.serviceCode,
      serviceName: shipment.serviceName,
      parcels: shipment.parcels.map((parcel) => ({
        parcelNumber: parcel.parcelNumber,
        weightGrams: parcel.weightGrams,
        lengthMm: parcel.lengthMm,
        widthMm: parcel.widthMm,
        heightMm: parcel.heightMm,
        packageType: parcel.packageType,
        labelFormat: parcel.labelFormat,
        declaredValueMinor: parcel.declaredValueMinor?.toString() ?? null,
        declaredCurrency: parcel.declaredCurrency,
        customsLines: Array.isArray(parcel.customsLines)
          ? parcel.customsLines.filter(isCustomsLine)
          : null
      })),
      customsDeclaration: customsJson(shipment) as Readonly<Record<string, unknown>> | null
    };
  }

  private async findShipment(context: OrganizationContext, id: string) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx: any) => {
      const row = await tx.shipment.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      return row ? hydrateShipment(tx, row) : null;
    });
  }

  private adapter(key: string): CarrierAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter)
      throw new AppError(
        "SHIPPING_CARRIER_UNSUPPORTED",
        `Carrier ${key} is not configured for this deployment.`,
        422
      );
    return adapter;
  }

  private credentials(ciphertext: string | null): CarrierCredentials {
    if (!ciphertext)
      throw new AppError(
        "SHIPPING_CREDENTIALS_REQUIRED",
        "Connect an operator-owned carrier account before making a shipping request.",
        422
      );
    try {
      const value: unknown = JSON.parse(this.credentialProtector.reveal(ciphertext));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
      return value as CarrierCredentials;
    } catch {
      throw new AppError(
        "SHIPPING_CREDENTIALS_INVALID",
        "Carrier credentials could not be opened.",
        500
      );
    }
  }

  private async callCarrier<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof CarrierOperationError) {
        if (error.ambiguous) throw error;
        const status = error.code.includes("CREDENTIAL") ? 422 : error.retryable ? 502 : 422;
        throw new AppError(`SHIPPING_${error.code}`, error.message, status);
      }
      throw new AppError(
        "SHIPPING_CARRIER_REQUEST_FAILED",
        "The carrier request failed without a usable answer.",
        502
      );
    }
  }
}

async function hydrateShipment(tx: Tx, row: Record<string, any>): Promise<ShipmentWithRelations> {
  const [carrierAccount, parcels, labels, trackingEvents, voidAttempts, inventoryMovements] =
    await Promise.all([
      tx.carrierAccount.findUniqueOrThrow({ where: { id: row.carrierAccountId } }),
      tx.shipmentParcel.findMany({
        where: { shipmentId: row.id },
        orderBy: { parcelNumber: "asc" }
      }),
      tx.shipmentLabel.findMany({ where: { shipmentId: row.id }, orderBy: { createdAt: "asc" } }),
      tx.trackingEvent.findMany({ where: { shipmentId: row.id }, orderBy: { occurredAt: "asc" } }),
      tx.shipmentVoidAttempt.findMany({
        where: { shipmentId: row.id },
        orderBy: { attemptedAt: "asc" }
      }),
      tx.shipmentInventoryMovement.findMany({ where: { shipmentId: row.id } })
    ]);
  return {
    ...row,
    carrierAccount,
    parcels,
    labels,
    trackingEvents,
    voidAttempts,
    inventoryMovements
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
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

function carrierAccountDto(row: any) {
  return {
    id: row.id,
    carrierKey: row.carrierKey,
    displayName: row.displayName,
    environment: row.environment,
    externalAccountId: row.externalAccountId,
    status: row.status,
    credentialsConfigured: Boolean(row.credentialCiphertext),
    credentialVersion: row.credentialVersion,
    defaultLabelFormat: row.defaultLabelFormat,
    defaultLabelWidthMm: row.defaultLabelWidthMm,
    defaultLabelHeightMm: row.defaultLabelHeightMm,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function shipmentDto(row: any) {
  return {
    id: row.id,
    carrierAccount: carrierAccountDto(row.carrierAccount),
    sourceInvoiceId: row.sourceInvoiceId,
    sourceSaleId: row.sourceSaleId,
    status: row.status,
    purchaseIdempotencyKey: row.purchaseIdempotencyKey,
    version: row.version,
    serviceCode: row.serviceCode,
    serviceName: row.serviceName,
    quotedCostMinor: row.quotedCostMinor?.toString() ?? null,
    quotedCurrency: row.quotedCurrency,
    purchasedCostMinor: row.purchasedCostMinor?.toString() ?? null,
    purchasedCurrency: row.purchasedCurrency,
    providerShipmentId: row.providerShipmentId,
    trackingNumber: row.trackingNumber,
    originAddress: row.originAddress,
    destinationAddress: row.destinationAddress,
    customsDeclaration: row.customsDeclaration,
    shippingExpenseId: row.shippingExpenseId,
    reconcileRequired: row.reconcileRequired,
    lastProviderCode: row.lastProviderCode,
    lastErrorMessage: row.lastErrorMessage,
    purchasedAt: row.purchasedAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    parcels:
      row.parcels?.map((parcel: any) => ({
        ...parcel,
        declaredValueMinor: parcel.declaredValueMinor?.toString() ?? null,
        createdAt: parcel.createdAt.toISOString(),
        customsLines: parcel.customsLines
      })) ?? [],
    labels: row.labels?.map(labelDto) ?? [],
    trackingEvents:
      row.trackingEvents?.map((event: any) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
        createdAt: event.createdAt.toISOString()
      })) ?? [],
    voidAttempts:
      row.voidAttempts?.map((attempt: any) => ({
        ...attempt,
        attemptedAt: attempt.attemptedAt.toISOString(),
        completedAt: attempt.completedAt?.toISOString() ?? null
      })) ?? [],
    inventoryMovementIds:
      row.inventoryMovements?.map((movement: any) => movement.inventoryMovementId) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function labelDto(label: any) {
  return {
    id: label.id,
    shipmentId: label.shipmentId,
    parcelId: label.parcelId,
    format: label.format,
    mediaType: label.mediaType,
    storageKey: label.storageKey,
    contentHash: label.contentHash,
    byteSize: label.byteSize,
    providerLabelId: label.providerLabelId,
    createdAt: label.createdAt.toISOString()
  };
}

function addressFromCustomer(
  addresses: readonly any[],
  fallbackName: string
): ShippingAddress | null {
  const row =
    addresses.find((address) => address.role === "SHIPPING" && address.isDefault) ??
    addresses.find((address) => address.role === "SHIPPING");
  return row
    ? {
        name: row.recipientName ?? fallbackName,
        organization: row.organization,
        line1: row.line1 ?? "",
        line2: row.line2,
        city: row.city ?? "",
        subdivisionCode: row.subdivisionCode,
        postalCode: row.postalCode ?? "",
        countryCode: row.countryCode ?? "",
        phone: row.phone,
        email: row.email
      }
    : null;
}

function addressFromJson(value: unknown, fallbackName = "Shipping sender"): ShippingAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  const name =
    text("name") ??
    text("recipientName") ??
    text("displayName") ??
    text("legalName") ??
    fallbackName;
  const line1 = text("line1");
  const city = text("city");
  const postalCode = text("postalCode");
  const countryCode = (text("countryCode") ?? text("country"))?.toUpperCase();
  if (!name || !line1 || !city || !postalCode || !countryCode) return null;
  return {
    name,
    organization: text("organization"),
    line1,
    line2: text("line2"),
    city,
    subdivisionCode: text("subdivisionCode") ?? text("province"),
    postalCode,
    countryCode,
    phone: text("phone"),
    email: text("email")
  };
}

function validateAddress(address: ShippingAddress, label: string): void {
  if (
    !address.name ||
    !address.line1 ||
    !address.city ||
    !address.postalCode ||
    !/^[A-Z]{2}$/.test(address.countryCode)
  )
    throw new AppError(
      "SHIPPING_ADDRESS_INVALID",
      `The ${label} address is incomplete or invalid.`,
      422
    );
}

function addressJson(address: ShippingAddress): Prisma.InputJsonValue {
  return {
    name: address.name,
    organization: address.organization ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    subdivisionCode: address.subdivisionCode ?? null,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    phone: address.phone ?? null,
    email: address.email ?? null
  };
}

function customsJson(
  shipment: ShipmentWithRelations
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const customs = shipment.parcels.flatMap((parcel) =>
    Array.isArray(parcel.customsLines) ? parcel.customsLines.filter(isCustomsLine) : []
  );
  return customs.length
    ? {
        operatorDeclarant: true,
        dutyCalculated: false,
        lines: customs as unknown as Prisma.InputJsonValue[]
      }
    : Prisma.JsonNull;
}

function isCustomsLine(
  value: unknown
): value is CustomsLine & { readonly invoiceLineId?: string | null } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as any).description === "string" &&
    typeof (value as any).hsTariffCode === "string" &&
    typeof (value as any).countryOfOrigin === "string" &&
    typeof (value as any).declaredValueMinor === "string"
  );
}

function redactedError(error: unknown): string {
  if (error instanceof CarrierOperationError) return error.message.slice(0, 500);
  return "Carrier request failed without a safe diagnostic.";
}

function isUniqueError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
  );
}
