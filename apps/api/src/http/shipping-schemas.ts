import { z } from "zod";
import {
  dateStringSchema,
  idSchema,
  minorUnitStringSchema,
  nonEmptyStringSchema
} from "./schemas.js";

export const shippingAddressSchema = z
  .object({
    name: nonEmptyStringSchema.max(200),
    organization: nonEmptyStringSchema.max(200).nullable().optional(),
    line1: nonEmptyStringSchema.max(200),
    line2: nonEmptyStringSchema.max(200).nullable().optional(),
    city: nonEmptyStringSchema.max(120),
    subdivisionCode: nonEmptyStringSchema.max(40).nullable().optional(),
    postalCode: nonEmptyStringSchema.max(40),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    phone: nonEmptyStringSchema.max(80).nullable().optional(),
    email: z.email().max(320).nullable().optional()
  })
  .strict();

export const shippingCustomsLineSchema = z
  .object({
    invoiceLineId: idSchema.nullable().optional(),
    description: nonEmptyStringSchema.max(500),
    quantity: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
    hsTariffCode: nonEmptyStringSchema.max(40),
    countryOfOrigin: z.string().regex(/^[A-Z]{2}$/),
    declaredValueMinor: minorUnitStringSchema,
    declaredCurrency: z.string().regex(/^[A-Z]{3}$/)
  })
  .strict();

export const shippingParcelSchema = z
  .object({
    parcelNumber: z.number().int().positive().max(100),
    weightGrams: z.number().int().positive().max(1_000_000),
    lengthMm: z.number().int().positive().max(10_000),
    widthMm: z.number().int().positive().max(10_000),
    heightMm: z.number().int().positive().max(10_000),
    packageType: nonEmptyStringSchema.max(80).nullable().optional(),
    labelFormat: z.enum(["PDF", "ZPL"]).optional(),
    declaredValueMinor: minorUnitStringSchema.nullable().optional(),
    declaredCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    customsLines: z.array(shippingCustomsLineSchema).max(100).nullable().optional()
  })
  .strict();

export const carrierAccountCreateSchema = z
  .object({
    carrierKey: z.enum(["FIXTURE", "CANADA_POST"]),
    displayName: nonEmptyStringSchema.max(160),
    environment: z.enum(["TEST", "PRODUCTION"]),
    credentials: z.record(z.string(), z.unknown()),
    externalAccountId: nonEmptyStringSchema.max(160).nullable().optional(),
    defaultLabelFormat: z.enum(["PDF", "ZPL"]).default("PDF"),
    defaultLabelWidthMm: z.number().int().positive().max(10_000).default(101),
    defaultLabelHeightMm: z.number().int().positive().max(10_000).default(152)
  })
  .strict();

export const shipmentCreateSchema = z
  .object({
    carrierAccountId: idSchema,
    parcels: z.array(shippingParcelSchema).min(1).max(100),
    destinationAddress: shippingAddressSchema.optional()
  })
  .strict();

export const shipmentQuoteSchema = z
  .object({
    version: z.number().int().positive(),
    serviceCode: nonEmptyStringSchema.max(80).optional()
  })
  .strict();

export const shipmentPurchaseSchema = z
  .object({
    version: z.number().int().positive(),
    confirmed: z.literal(true),
    serviceCode: nonEmptyStringSchema.max(80),
    quotedCostMinor: minorUnitStringSchema,
    quotedCurrency: z.string().regex(/^[A-Z]{3}$/),
    expenseAccountId: idSchema,
    payingAccountId: idSchema,
    expenseMethod: z.enum([
      "CASH",
      "CHEQUE",
      "ELECTRONIC_TRANSFER",
      "CREDIT_CARD",
      "OWNER_PAID",
      "OTHER"
    ]),
    expenseDate: dateStringSchema
  })
  .strict();

export const shipmentVoidSchema = z
  .object({ version: z.number().int().positive(), reason: nonEmptyStringSchema.max(1000) })
  .strict();
