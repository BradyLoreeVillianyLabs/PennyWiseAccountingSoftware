import type { PrismaClient } from "../generated-client/index.js";

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "OrganizationBootstrapGrant",
      "InvitationTokenLocator",
      "MembershipAccessLocator",
      "AuthenticationAuditEvent",
      "OrganizationInvitation",
      "OidcAuthorizationRequest",
      "Session",
      "CompanyMembership",
      "Company",
      "ExternalIdentity",
      "WebhookDelivery",
      "WebhookEndpoint",
      "OutboxEvent",
      "IdempotencyRecord",
      "AuditEvent",
  "PublicInvoiceLink",
  "InvoiceAttachment",
      "InvoiceDeliveryEvent",
      "InvoiceDelivery",
      "InvoicePdfArtifact",
      "InvoiceTemplateConfig",
      "CreditNoteLine",
      "CreditNote",
      "InvoiceLine",
      "Invoice",
      "CustomerAddress",
      "ProductItem",
      "Customer",
      "JournalLine",
      "Journal",
      "FiscalPeriod",
      "Account",
      "Membership",
      "Organization",
      "User"
    RESTART IDENTITY CASCADE
  `);
}
