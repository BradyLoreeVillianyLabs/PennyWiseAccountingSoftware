import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { serializeDate } from "../utils/dates.js";
import {
  addressDto,
  addressSnapshot,
  assertCustomerAddress,
  type CustomerAddressInput,
  type NormalizedCustomerAddress
} from "./customer-address.js";

export interface CustomerInput {
  readonly customerNumber?: string | null | undefined;
  readonly legalName?: string | null | undefined;
  readonly displayName: string;
  readonly primaryContact?: string | null | undefined;
  readonly additionalContacts?:
    | readonly { name: string; email?: string | undefined; telephone?: string | undefined }[]
    | undefined;
  readonly addresses?: readonly CustomerAddressInput[] | undefined;
  readonly billingAddress?: CustomerAddressInput | null | undefined;
  readonly shippingAddress?: CustomerAddressInput | null | undefined;
  readonly serviceAddress?: CustomerAddressInput | null | undefined;
  readonly email?: string | null | undefined;
  readonly documentLanguage?: "en-CA" | "fr-CA" | "BILINGUAL" | null | undefined;
  readonly telephone?: string | null | undefined;
  readonly website?: string | null | undefined;
  readonly taxRegistrationIdentifiers?: Record<string, string> | undefined;
  readonly defaultPaymentTermsDays: number;
  readonly defaultTaxCodeId?: string | null | undefined;
  readonly defaultCurrency: string;
  readonly internalNotes?: string | null | undefined;
  readonly reminderDisabled?: boolean | undefined;
  readonly reminderTone?: "FRIENDLY" | "FIRM" | null | undefined;
  readonly reminderOffsets?: readonly number[] | null | undefined;
}

export interface CustomerContactInput {
  readonly name: string;
  readonly role?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly telephone?: string | null | undefined;
  readonly preferredChannel?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export type CustomerContactPatch = { readonly version: number } & {
  [Key in keyof CustomerContactInput]?: CustomerContactInput[Key] | undefined;
};

export interface CustomerActivityInput {
  readonly activityType: string;
  readonly category?: string | null | undefined;
  readonly subject?: string | null | undefined;
  readonly body: string;
  readonly happenedAt?: string | undefined;
  readonly contactId?: string | null | undefined;
  readonly relatedResourceType?: string | null | undefined;
  readonly relatedResourceId?: string | null | undefined;
}

export type CustomerPatch = { readonly version: number } & {
  [Key in keyof CustomerInput]?: CustomerInput[Key] | undefined;
};
type CustomerAddressRow = Prisma.CustomerAddressGetPayload<Prisma.CustomerAddressDefaultArgs>;
type CustomerRow = Prisma.CustomerGetPayload<Prisma.CustomerDefaultArgs> & {
  readonly addresses?: readonly CustomerAddressRow[];
};
type CustomerContactRow = Prisma.CustomerContactGetPayload<Prisma.CustomerContactDefaultArgs>;
type CustomerActivityRow = Prisma.CustomerActivityGetPayload<Prisma.CustomerActivityDefaultArgs>;

export class CustomerService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext, active?: boolean) {
    await this.authorization.assert(context, "customers:read", "Customer");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.customer.findMany({
        where: {
          organizationId: context.organizationId,
          ...(active === undefined ? {} : { active })
        },
        include: { addresses: { orderBy: { createdAt: "asc" } } },
        orderBy: [{ displayName: "asc" }, { customerNumber: "asc" }],
        take: 100
      });
      return rows.map(customerDto);
    });
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "customers:read", "Customer", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.customer.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { addresses: { orderBy: { createdAt: "asc" } } }
      })
    );
    if (!row) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
    return customerDto(row);
  }

  public async addressReview(context: OrganizationContext) {
    await this.authorization.assert(context, "customers:read", "CustomerAddress");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.customerAddress.findMany({
        where: { organizationId: context.organizationId, needsReview: true },
        include: {
          customer: { select: { id: true, customerNumber: true, displayName: true } }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 500
      });
      return {
        purpose:
          "These legacy address values require operator review before they are used for deliverability or shipping workflows.",
        addresses: rows.map(({ customer, ...address }) => ({
          customer,
          address: addressDto(address)
        }))
      };
    });
  }

  public async create(context: OrganizationContext, input: CustomerInput) {
    await this.authorization.assert(context, "customers:manage", "Customer");
    const requestedNumber = input.customerNumber?.trim() || null;
    const attempts = requestedNumber ? 1 : 4;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await withTenantTransaction(
          this.prisma,
          dbContext(context),
          async (tx) => {
            const customerNumber =
              requestedNumber ?? (await nextCustomerNumber(tx, context.organizationId));
            await this.assertTaxCode(tx, context.organizationId, input.defaultTaxCodeId);
            await assertCurrencyEnabled(tx, context.organizationId, input.defaultCurrency);
            const addresses = normalizedAddresses(input);
            const row = await tx.customer.create({
              data: {
                organizationId: context.organizationId,
                customerNumber,
                legalName: input.legalName ?? null,
                displayName: input.displayName,
                primaryContact: input.primaryContact ?? null,
                additionalContacts: json(input.additionalContacts),
                email: input.email ?? null,
                documentLanguage: input.documentLanguage ?? null,
                telephone: input.telephone ?? null,
                website: input.website ?? null,
                taxRegistrationIdentifiers: json(input.taxRegistrationIdentifiers),
                defaultPaymentTermsDays: input.defaultPaymentTermsDays,
                defaultTaxCodeId: input.defaultTaxCodeId ?? null,
                defaultCurrency: input.defaultCurrency,
                internalNotes: input.internalNotes ?? null,
                reminderDisabled: input.reminderDisabled ?? false,
                reminderTone: input.reminderTone ?? null,
                reminderOffsets: json(input.reminderOffsets),
                createdByUserId: context.user.id,
                updatedByUserId: context.user.id
              }
            });
            await writeAddresses(tx, context.organizationId, row.id, addresses);
            await audit(tx, context, "CUSTOMER_CREATED", row.id, {
              customerNumber: row.customerNumber
            });
            return customerDto(
              await tx.customer.findUniqueOrThrow({
                where: { id: row.id },
                include: { addresses: { orderBy: { createdAt: "asc" } } }
              })
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error) {
        if (isUnique(error) && requestedNumber)
          throw new AppError("CUSTOMER_NUMBER_EXISTS", "Customer number is already in use.", 409);
        if (!requestedNumber && isRetryableCustomerNumberConflict(error) && attempt < attempts - 1)
          continue;
        if (isUnique(error))
          throw new AppError(
            "CUSTOMER_NUMBER_GENERATION_CONFLICT",
            "PennyWise could not allocate a customer number. Try again.",
            409
          );
        throw error;
      }
    }
    throw new AppError(
      "CUSTOMER_NUMBER_GENERATION_CONFLICT",
      "PennyWise could not allocate a customer number. Try again.",
      409
    );
  }

  public async update(context: OrganizationContext, id: string, input: CustomerPatch) {
    await this.authorization.assert(context, "customers:manage", "Customer", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await this.assertTaxCode(tx, context.organizationId, input.defaultTaxCodeId);
      if (input.defaultCurrency !== undefined)
        await assertCurrencyEnabled(tx, context.organizationId, input.defaultCurrency);
      const current = await tx.customer.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      const addressChange = hasAddressChange(input);
      const addresses = input.addresses === undefined ? undefined : normalizedAddresses(input);
      const result = await tx.customer.updateMany({
        where: { id, organizationId: context.organizationId, version: input.version },
        data: {
          ...(input.customerNumber === undefined || input.customerNumber === null
            ? {}
            : { customerNumber: input.customerNumber }),
          ...(input.legalName === undefined ? {} : { legalName: input.legalName }),
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.primaryContact === undefined ? {} : { primaryContact: input.primaryContact }),
          ...(input.additionalContacts === undefined
            ? {}
            : { additionalContacts: json(input.additionalContacts) }),
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.documentLanguage === undefined
            ? {}
            : { documentLanguage: input.documentLanguage }),
          ...(input.telephone === undefined ? {} : { telephone: input.telephone }),
          ...(input.website === undefined ? {} : { website: input.website }),
          ...(input.taxRegistrationIdentifiers === undefined
            ? {}
            : { taxRegistrationIdentifiers: json(input.taxRegistrationIdentifiers) }),
          ...(input.defaultPaymentTermsDays === undefined
            ? {}
            : { defaultPaymentTermsDays: input.defaultPaymentTermsDays }),
          ...(input.defaultTaxCodeId === undefined
            ? {}
            : { defaultTaxCodeId: input.defaultTaxCodeId }),
          ...(input.defaultCurrency === undefined
            ? {}
            : { defaultCurrency: input.defaultCurrency }),
          ...(input.internalNotes === undefined ? {} : { internalNotes: input.internalNotes }),
          ...(input.reminderDisabled === undefined
            ? {}
            : { reminderDisabled: input.reminderDisabled }),
          ...(input.reminderTone === undefined ? {} : { reminderTone: input.reminderTone }),
          ...(input.reminderOffsets === undefined
            ? {}
            : { reminderOffsets: json(input.reminderOffsets) }),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError("STALE_CUSTOMER", "Customer was changed by another request.", 409);
      if (addressChange) {
        if (addresses !== undefined)
          await writeAddresses(tx, context.organizationId, id, addresses);
        else await updateCompatibilityAddresses(tx, context.organizationId, id, input);
      }
      const row = await tx.customer.findUniqueOrThrow({
        where: { id },
        include: { addresses: { orderBy: { createdAt: "asc" } } }
      });
      await audit(tx, context, "CUSTOMER_UPDATED", id, {
        changed: Object.keys(input).filter((key) => key !== "version")
      });
      return customerDto(row);
    });
  }

  public async archive(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "customers:manage", "Customer", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          customerId: id,
          status: { in: ["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED", "CREDITED"] }
        },
        select: {
          grandTotalMinor: true,
          amountPaidMinor: true,
          creditNotes: { where: { status: "POSTED" }, select: { grandTotalMinor: true } }
        }
      });
      const openBalance = invoices.reduce((balance, invoice) => {
        const credited = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
        const outstanding = invoice.grandTotalMinor - credited - invoice.amountPaidMinor;
        return balance + (outstanding > 0n ? outstanding : 0n);
      }, 0n);
      if (openBalance > 0n)
        throw new AppError(
          "CUSTOMER_OPEN_BALANCE",
          "A customer with an open receivables balance cannot be archived. Settle or credit the outstanding invoices first.",
          409
        );
      const result = await tx.customer.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: {
          active: false,
          archivedAt: new Date(),
          archivedByUserId: context.user.id,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError("STALE_CUSTOMER", "Customer was changed by another request.", 409);
      const row = await tx.customer.findUniqueOrThrow({
        where: { id },
        include: { addresses: { orderBy: { createdAt: "asc" } } }
      });
      await audit(tx, context, "CUSTOMER_ARCHIVED", id, {});
      return customerDto(row);
    });
  }

  public async listContacts(context: OrganizationContext, customerId: string) {
    await this.authorization.assert(context, "customers:read", "CustomerContact");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertActiveCustomer(tx, context.organizationId, customerId);
      const rows = await tx.customerContact.findMany({
        where: { organizationId: context.organizationId, customerId },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        take: 200
      });
      return rows.map(customerContactDto);
    });
  }

  public async createContact(
    context: OrganizationContext,
    customerId: string,
    input: CustomerContactInput
  ) {
    await this.authorization.assert(context, "customers:manage", "CustomerContact");
    const name = requiredText(input.name, "Contact name", 200);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertActiveCustomer(tx, context.organizationId, customerId);
      const row = await tx.customerContact.create({
        data: {
          organizationId: context.organizationId,
          customerId,
          name,
          role: optionalText(input.role, 120),
          email: optionalText(input.email, 320),
          telephone: optionalText(input.telephone, 40),
          preferredChannel: optionalText(input.preferredChannel, 80),
          notes: optionalText(input.notes, 4000),
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await auditResource(tx, context, "CUSTOMER_CONTACT_CREATED", "CustomerContact", row.id, {
        customerId
      });
      return customerContactDto(row);
    });
  }

  public async updateContact(
    context: OrganizationContext,
    contactId: string,
    input: CustomerContactPatch
  ) {
    await this.authorization.assert(context, "customers:manage", "CustomerContact", contactId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.customerContact.findFirst({
        where: { id: contactId, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("CUSTOMER_CONTACT_NOT_FOUND", "Customer contact was not found.", 404);
      if (!current.active)
        throw new AppError("CUSTOMER_CONTACT_ARCHIVED", "Archived contacts cannot be edited.", 409);
      const changed = await tx.customerContact.updateMany({
        where: { id: contactId, organizationId: context.organizationId, version: input.version },
        data: {
          ...(input.name === undefined
            ? {}
            : { name: requiredText(input.name, "Contact name", 200) }),
          ...(input.role === undefined ? {} : { role: optionalText(input.role, 120) }),
          ...(input.email === undefined ? {} : { email: optionalText(input.email, 320) }),
          ...(input.telephone === undefined
            ? {}
            : { telephone: optionalText(input.telephone, 40) }),
          ...(input.preferredChannel === undefined
            ? {}
            : { preferredChannel: optionalText(input.preferredChannel, 80) }),
          ...(input.notes === undefined ? {} : { notes: optionalText(input.notes, 4000) }),
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_CUSTOMER_CONTACT",
          "This contact changed in another session.",
          409
        );
      const row = await tx.customerContact.findUniqueOrThrow({ where: { id: contactId } });
      await auditResource(tx, context, "CUSTOMER_CONTACT_UPDATED", "CustomerContact", contactId, {
        changed: Object.keys(input).filter((key) => key !== "version")
      });
      return customerContactDto(row);
    });
  }

  public async archiveContact(context: OrganizationContext, contactId: string, version: number) {
    await this.authorization.assert(context, "customers:manage", "CustomerContact", contactId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const changed = await tx.customerContact.updateMany({
        where: { id: contactId, organizationId: context.organizationId, version, active: true },
        data: {
          active: false,
          archivedAt: new Date(),
          archivedByUserId: context.user.id,
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_CUSTOMER_CONTACT",
          "This contact changed in another session.",
          409
        );
      const row = await tx.customerContact.findUniqueOrThrow({ where: { id: contactId } });
      await auditResource(
        tx,
        context,
        "CUSTOMER_CONTACT_ARCHIVED",
        "CustomerContact",
        contactId,
        {}
      );
      return customerContactDto(row);
    });
  }

  public async createActivity(
    context: OrganizationContext,
    customerId: string,
    input: CustomerActivityInput
  ) {
    await this.authorization.assert(context, "customers:manage", "CustomerActivity");
    const activityType = requiredText(input.activityType, "Activity type", 80);
    const body = requiredText(input.body, "Activity notes", 10_000);
    const happenedAt = parseDateTime(input.happenedAt ?? new Date().toISOString(), "happenedAt");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertActiveCustomer(tx, context.organizationId, customerId);
      if (input.contactId)
        await assertActiveContact(tx, context.organizationId, customerId, input.contactId);
      await assertRelatedResource(
        tx,
        context.organizationId,
        customerId,
        input.relatedResourceType,
        input.relatedResourceId
      );
      const row = await tx.customerActivity.create({
        data: {
          organizationId: context.organizationId,
          customerId,
          contactId: input.contactId ?? null,
          activityType,
          category: optionalText(input.category, 80),
          subject: optionalText(input.subject, 240),
          body,
          happenedAt,
          relatedResourceType: optionalText(input.relatedResourceType, 80),
          relatedResourceId: input.relatedResourceId ?? null,
          createdByUserId: context.user.id
        }
      });
      await auditResource(tx, context, "CUSTOMER_ACTIVITY_RECORDED", "CustomerActivity", row.id, {
        customerId,
        activityType
      });
      return customerActivityDto(row);
    });
  }

  public async listTimeline(context: OrganizationContext, customerId: string) {
    await this.authorization.assert(context, "customers:read", "CustomerActivity");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { organizationId: context.organizationId, id: customerId },
        select: { id: true, displayName: true, customerNumber: true }
      });
      if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      const [activities, workItems] = await Promise.all([
        tx.customerActivity.findMany({
          where: { organizationId: context.organizationId, customerId },
          orderBy: [{ happenedAt: "desc" }, { id: "desc" }],
          take: 250
        }),
        tx.projectWorkItem.findMany({
          where: { organizationId: context.organizationId, customerId, archivedAt: null },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 250
        })
      ]);
      const timeline = [
        ...activities.map((activity) => ({
          id: activity.id,
          entryType: "ACTIVITY" as const,
          occurredAt: activity.happenedAt.toISOString(),
          title: activity.subject ?? activity.activityType,
          detail: activity.body,
          category: activity.category,
          activityType: activity.activityType,
          status: null,
          source: {
            type: "CUSTOMER_ACTIVITY" as const,
            id: activity.id,
            relatedResourceType: activity.relatedResourceType,
            relatedResourceId: activity.relatedResourceId
          }
        })),
        ...workItems.map((workItem) => ({
          id: workItem.id,
          entryType: "CALENDAR" as const,
          occurredAt: (
            workItem.startAt ??
            workItem.startDate ??
            workItem.dueDate ??
            workItem.createdAt
          ).toISOString(),
          title: workItem.title,
          detail: workItem.description,
          category: workItem.category,
          activityType: workItem.eventType,
          status: workItem.customStatus ?? workItem.status,
          source: {
            type: "PROJECT_WORK_ITEM" as const,
            id: workItem.id,
            relatedResourceType: workItem.relatedResourceType,
            relatedResourceId: workItem.relatedResourceId
          }
        }))
      ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
      return { customer, timeline: timeline.slice(0, 500) };
    });
  }

  private async assertTaxCode(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id?: string | null
  ) {
    if (!id) return;
    const taxCode = await tx.taxCode.findFirst({ where: { id, organizationId, active: true } });
    if (!taxCode) throw new AppError("TAX_CODE_NOT_FOUND", "Active tax code was not found.", 422);
  }
}

async function assertActiveCustomer(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string
) {
  const customer = await tx.customer.findFirst({
    where: { organizationId, id: customerId, active: true },
    select: { id: true }
  });
  if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
}

async function assertActiveContact(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
  contactId: string
) {
  const contact = await tx.customerContact.findFirst({
    where: { organizationId, id: contactId, customerId, active: true },
    select: { id: true }
  });
  if (!contact)
    throw new AppError(
      "CUSTOMER_CONTACT_NOT_FOUND",
      "The contact is not active for this customer.",
      422
    );
}

async function assertRelatedResource(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
  resourceType?: string | null,
  resourceId?: string | null
) {
  if (!resourceType && !resourceId) return;
  if (!resourceType || !resourceId)
    throw new AppError(
      "CUSTOMER_ACTIVITY_RESOURCE_INVALID",
      "A related resource type and ID are both required.",
      422
    );
  let exists: boolean;
  if (resourceType === "PROJECT")
    exists = Boolean(
      await tx.project.findFirst({
        where: { organizationId, id: resourceId, customerId },
        select: { id: true }
      })
    );
  else if (resourceType === "INVOICE")
    exists = Boolean(
      await tx.invoice.findFirst({
        where: { organizationId, id: resourceId, customerId },
        select: { id: true }
      })
    );
  else if (resourceType === "ESTIMATE")
    exists = Boolean(
      await tx.estimate.findFirst({
        where: { organizationId, id: resourceId, customerId },
        select: { id: true }
      })
    );
  else if (resourceType === "BILL")
    exists = Boolean(
      await tx.bill.findFirst({ where: { organizationId, id: resourceId }, select: { id: true } })
    );
  else
    throw new AppError(
      "CUSTOMER_ACTIVITY_RESOURCE_INVALID",
      "Unsupported related resource type.",
      422
    );
  if (!exists)
    throw new AppError(
      "CUSTOMER_ACTIVITY_RESOURCE_NOT_FOUND",
      "The related resource was not found for this organization.",
      422
    );
}

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength)
    throw new AppError(
      "CUSTOMER_RELATIONSHIP_TEXT_INVALID",
      `${field} must contain 1 to ${maxLength.toString()} characters.`,
      422
    );
  return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length > maxLength)
    throw new AppError(
      "CUSTOMER_RELATIONSHIP_TEXT_INVALID",
      `Text cannot exceed ${maxLength.toString()} characters.`,
      422
    );
  return normalized || null;
}

function parseDateTime(value: string, fieldName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new AppError("INVALID_DATE", `${fieldName} must be a valid RFC 3339 timestamp.`, 400, {
      fieldName
    });
  return date;
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function assertCurrencyEnabled(
  tx: Prisma.TransactionClient,
  organizationId: string,
  value: string
) {
  const currency = value.trim().toUpperCase();
  const rows = await tx.$queryRaw<{ enabled: boolean }[]>`
    SELECT "enabled" FROM "OrganizationCurrency"
    WHERE "organizationId" = ${organizationId}::uuid AND "currencyCode" = ${currency}
  `;
  if (!rows[0]?.enabled)
    throw new AppError(
      "CUSTOMER_CURRENCY_NOT_ENABLED",
      `Currency ${currency} is not enabled for this organization.`,
      400
    );
}
function json(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value == null ? Prisma.JsonNull : value;
}
function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isRetryableCustomerNumberConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

async function nextCustomerNumber(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<string> {
  const existing = await tx.customer.findMany({
    where: { organizationId, customerNumber: { startsWith: "CUST-" } },
    select: { customerNumber: true },
    take: 10_000
  });
  let next = 1;
  for (const customer of existing) {
    const match = /^CUST-(\d+)$/.exec(customer.customerNumber);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return `CUST-${String(next).padStart(4, "0")}`;
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
      targetType: "Customer",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

async function auditResource(
  tx: Prisma.TransactionClient,
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

function customerDto(row: CustomerRow) {
  const addresses = row.addresses ?? [];
  return {
    ...row,
    addresses: addresses.map(addressDto),
    billingAddress: addressSnapshot(addresses, "BILLING"),
    shippingAddress: addressSnapshot(addresses, "SHIPPING"),
    serviceAddress: addressSnapshot(addresses, "SERVICE"),
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
    archivedAt: row.archivedAt ? serializeDate(row.archivedAt) : null
  };
}

function normalizedAddresses(
  input: Pick<CustomerInput, "addresses" | "billingAddress" | "shippingAddress" | "serviceAddress">
): NormalizedCustomerAddress[] {
  const values: NormalizedCustomerAddress[] = [];
  if (input.addresses !== undefined) {
    for (const [index, address] of input.addresses.entries())
      values.push(assertCustomerAddress(address, `addresses.${String(index)}`));
  } else {
    for (const [role, address] of [
      ["BILLING", input.billingAddress],
      ["SHIPPING", input.shippingAddress],
      ["SERVICE", input.serviceAddress]
    ] as const) {
      if (address === undefined || address === null) continue;
      if (address.role && address.role !== role)
        throw new AppError(
          "ADDRESS_ROLE_INVALID",
          `${role.toLowerCase()}Address must have role ${role}.`,
          422,
          { field: `${role.toLowerCase()}Address.role` }
        );
      values.push(assertCustomerAddress({ ...address, role }, `${role.toLowerCase()}Address`));
    }
  }
  const roles = new Set(values.map((address) => address.role));
  for (const role of roles) {
    const roleValues = values.filter((address) => address.role === role);
    const defaults = roleValues.filter((address) => address.isDefault);
    if (defaults.length > 1)
      throw new AppError(
        "ADDRESS_DEFAULT_DUPLICATE",
        `Only one default ${role.toLowerCase()} address is allowed.`,
        422,
        { field: "addresses.isDefault", role }
      );
    if (defaults.length === 0) {
      const first = values.findIndex((address) => address.role === role);
      values[first] = { ...values[first]!, isDefault: true };
    }
  }
  return values;
}

function hasAddressChange(input: CustomerPatch): boolean {
  return (
    input.addresses !== undefined ||
    input.billingAddress !== undefined ||
    input.shippingAddress !== undefined ||
    input.serviceAddress !== undefined
  );
}

async function writeAddresses(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
  addresses: readonly NormalizedCustomerAddress[]
) {
  await tx.customerAddress.deleteMany({ where: { organizationId, customerId } });
  if (addresses.length === 0) return;
  await tx.customerAddress.createMany({
    data: addresses.map((address) => ({
      organizationId,
      customerId,
      role: address.role,
      recipientName: address.recipientName,
      organization: address.organization,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      subdivisionCode: address.subdivisionCode,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      phone: address.phone,
      email: address.email,
      isDefault: address.isDefault
    }))
  });
}

async function updateCompatibilityAddresses(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
  input: CustomerPatch
) {
  for (const [role, address] of [
    ["BILLING", input.billingAddress],
    ["SHIPPING", input.shippingAddress],
    ["SERVICE", input.serviceAddress]
  ] as const) {
    if (address === undefined) continue;
    await tx.customerAddress.deleteMany({ where: { organizationId, customerId, role } });
    if (address === null) continue;
    if (address.role && address.role !== role)
      throw new AppError(
        "ADDRESS_ROLE_INVALID",
        `${role.toLowerCase()}Address must have role ${role}.`,
        422,
        { field: `${role.toLowerCase()}Address.role` }
      );
    const normalized = assertCustomerAddress({ ...address, role }, `${role.toLowerCase()}Address`);
    await tx.customerAddress.create({
      data: {
        organizationId,
        customerId,
        role: normalized.role,
        recipientName: normalized.recipientName,
        organization: normalized.organization,
        line1: normalized.line1,
        line2: normalized.line2,
        city: normalized.city,
        subdivisionCode: normalized.subdivisionCode,
        postalCode: normalized.postalCode,
        countryCode: normalized.countryCode,
        phone: normalized.phone,
        email: normalized.email,
        isDefault: true
      }
    });
  }
}

function customerContactDto(row: CustomerContactRow) {
  return {
    ...row,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
    archivedAt: row.archivedAt ? serializeDate(row.archivedAt) : null
  };
}

function customerActivityDto(row: CustomerActivityRow) {
  return {
    ...row,
    happenedAt: serializeDate(row.happenedAt),
    createdAt: serializeDate(row.createdAt)
  };
}
