import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "@clearledger/db";
import type { IdentityAdapter } from "../auth/identity-adapter.js";
import { requireOrganizationContext } from "./request-context.js";
import {
  carrierAccountCreateSchema,
  shipmentCreateSchema,
  shipmentPurchaseSchema,
  shipmentQuoteSchema,
  shipmentVoidSchema
} from "./shipping-schemas.js";
import { ShippingService } from "../services/shipping/shipping-service.js";

const idParam = z.object({ id: z.uuid() }).strict();

export function registerShippingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  shipping: ShippingService
): void {
  app.get("/v1/shipping/carrier-accounts", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    return { carrierAccounts: await shipping.listCarrierAccounts(context) };
  });
  app.post("/v1/shipping/carrier-accounts", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const account = await shipping.createCarrierAccount(
      context,
      carrierAccountCreateSchema.parse(request.body)
    );
    return reply.code(201).send({ carrierAccount: account });
  });
  app.post("/v1/shipping/carrier-accounts/:id/deactivate", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return { carrierAccount: await shipping.deactivateCarrierAccount(context, id) };
  });

  app.post("/v1/invoices/:id/shipment", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return reply.code(201).send({
      shipment: await shipping.createShipmentFromInvoice(
        context,
        id,
        shipmentCreateSchema.parse(request.body)
      )
    });
  });
  app.post("/v1/pos/sales/:id/shipment", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return reply.code(201).send({
      shipment: await shipping.createShipmentFromSale(
        context,
        id,
        shipmentCreateSchema.parse(request.body)
      )
    });
  });
  app.get("/v1/shipments/:id", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return { shipment: await shipping.getShipment(context, id) };
  });
  app.post("/v1/shipments/:id/quote", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return {
      shipment: await shipping.quoteShipment(context, id, shipmentQuoteSchema.parse(request.body))
    };
  });
  app.post("/v1/shipments/:id/purchase", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return {
      shipment: await shipping.purchaseShipment(
        context,
        id,
        shipmentPurchaseSchema.parse(request.body)
      )
    };
  });
  app.post("/v1/shipments/:id/void", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return {
      shipment: await shipping.voidShipment(context, id, shipmentVoidSchema.parse(request.body))
    };
  });
  app.post("/v1/shipments/:id/track", async (request) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    return { shipment: await shipping.trackShipment(context, id) };
  });
  app.get("/v1/shipment-labels/:id", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const { id } = idParam.parse(request.params);
    const label = await shipping.getLabel(context, id);
    return reply.type(label.mediaType).header("content-disposition", "inline").send(label.data);
  });
}
