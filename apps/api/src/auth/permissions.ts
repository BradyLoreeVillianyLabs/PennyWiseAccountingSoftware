import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { MembershipRole, OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { withAuditOrigin } from "../utils/audit.js";

export type Permission =
  | "accounts:read"
  | "accounts:write"
  | "control-accounts:post"
  | "journals:post"
  | "journals:reverse"
  | "members:invite"
  | "members:read"
  | "members:revoke"
  | "members:roles"
  | "organizations:access"
  | "automations:manage"
  | "companies:manage"
  | "intercompany:read"
  | "intercompany:manage"
  | "consolidation:read"
  | "consolidation:manage"
  | "organizations:switch"
  | "integrations:read"
  | "integrations:manage"
  | "shipping:read"
  | "shipping:manage"
  | "shipping:quote"
  | "shipping:purchase"
  | "shipping:void"
  | "shipping:track"
  | "commerce:read"
  | "commerce:review"
  | "webhooks:read"
  | "webhooks:manage"
  | "periods:manage"
  | "reports:read"
  | "settings:read"
  | "settings:write"
  | "product-analytics:read"
  | "taxes:configure"
  | "presets:apply"
  | "opening-balances:manage"
  | "branding:manage"
  | "setup:complete"
  | "customers:read"
  | "customers:manage"
  | "products:read"
  | "products:manage"
  | "invoices:read"
  | "invoices:create"
  | "invoices:post"
  | "credit-notes:create"
  | "invoices:correct"
  | "receivables:read"
  | "invoice-templates:read"
  | "invoice-templates:manage"
  | "invoices:preview"
  | "invoices:pdf"
  | "invoices:send"
  | "invoices:resend"
  | "invoices:public-link"
  | "invoices:delivery-read"
  | "invoices:attachments"
  | "estimates:read"
  | "estimates:create"
  | "estimates:manage"
  | "recurring-schedules:read"
  | "recurring-schedules:manage"
  | "communications:read"
  | "contracts:read"
  | "contracts:manage"
  | "contracts:ready"
  | "email-connections:read"
  | "email-connections:manage"
  | "projects:read"
  | "projects:manage"
  | "time:read"
  | "time:manage"
  | "time:approve"
  | "mileage:manage"
  | "captures:read"
  | "captures:manage"
  | "planning:read"
  | "planning:manage"
  | "purchase-requests:read"
  | "purchase-requests:create"
  | "purchase-requests:approve"
  | "customer-deposits:read"
  | "customer-deposits:manage"
  | "customer-deposits:approve"
  | "progress-billing:read"
  | "progress-billing:manage"
  | "progress-billing:approve"
  | "fixed-assets:read"
  | "fixed-assets:manage"
  | "fixed-assets:approve"
  | "fixed-assets:configure"
  | "payroll:read"
  | "payroll:manage"
  | "payroll:review"
  | "payroll:approve"
  | "payroll:post"
  | "payroll:payments"
  | "payroll:configure"
  | "payroll:automation"
  | "migration-runs:read"
  | "migration-runs:manage"
  | "commercial:read"
  | "commercial:manage"
  | "payments:configure"
  | "payments:connect"
  | "payments:disconnect"
  | "payments:read"
  | "payments:record"
  | "payments:allocate"
  | "payments:refund"
  | "payments:refund-approve"
  | "payments:disputes"
  | "payments:receipt-resend"
  | "vendors:read"
  | "vendors:manage"
  | "bills:read"
  | "bills:create"
  | "bills:post"
  | "bills:pay"
  | "vendor-credits:create"
  | "vendor-credits:apply"
  | "expenses:record"
  | "payables:read"
  | "purchases:attachments"
  | "bank-accounts:manage"
  | "bank-feeds:manage"
  | "bank-imports:create"
  | "bank-duplicates:review"
  | "bank-transactions:match"
  | "bank-transactions:categorize"
  | "bank-rules:manage"
  | "bank-transfers:create"
  | "bank-reconciliations:manage"
  | "bank-reconciliations:reopen"
  | "bank-reports:read"
  | "inventory:read"
  | "inventory:configure"
  | "inventory:receive"
  | "inventory:adjust"
  | "inventory:transfer"
  | "inventory:returns"
  | "inventory:reports"
  | "inventory:reserve"
  | "inventory:count"
  | "inventory:costs"
  | "inventory:recall"
  | "pos:read"
  | "pos:configure"
  | "pos:sell"
  | "pos:discount"
  | "pos:price-override"
  | "pos:tax-override"
  | "pos:shift"
  | "pos:cash-events"
  | "pos:return"
  | "pos:refund"
  | "tax-reports:read"
  | "report-exports:create"
  | "dashboard:read"
  | "accountant-view:read"
  | "manual-journals:create"
  | "manual-journals:post"
  | "periods:close"
  | "periods:reopen"
  | "audit:read"
  | "audit:export"
  | "review-items:resolve"
  | "data-imports:master"
  | "data-imports:financial"
  | "data-imports:approve"
  | "organization-exports:create"
  | "organization-exports:download"
  | "organizations:close";

const permissionRoles: Readonly<Record<Permission, ReadonlySet<MembershipRole>>> = {
  "accounts:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "PURCHASES",
    "INVENTORY",
    "READ_ONLY"
  ),
  "accounts:write": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "control-accounts:post": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "journals:post": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "journals:reverse": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "members:invite": roles("OWNER", "ADMIN"),
  "members:read": roles("OWNER", "ADMIN"),
  "members:revoke": roles("OWNER", "ADMIN"),
  "members:roles": roles("OWNER", "ADMIN"),
  "organizations:access": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "PURCHASES",
    "INVENTORY",
    "READ_ONLY"
  ),
  "automations:manage": roles("OWNER", "ADMIN"),
  "companies:manage": roles("OWNER", "ADMIN"),
  "intercompany:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "intercompany:manage": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "consolidation:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "consolidation:manage": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "organizations:switch": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "PURCHASES",
    "INVENTORY",
    "READ_ONLY"
  ),
  "integrations:read": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "integrations:manage": roles("OWNER", "ADMIN"),
  "shipping:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "INVENTORY",
    "READ_ONLY"
  ),
  "shipping:manage": roles("OWNER", "ADMIN"),
  "shipping:quote": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "INVENTORY"),
  "shipping:purchase": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "shipping:void": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "shipping:track": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "INVENTORY",
    "READ_ONLY"
  ),
  "commerce:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "commerce:review": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "webhooks:read": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "webhooks:manage": roles("OWNER", "ADMIN"),
  "periods:manage": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "reports:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "settings:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "settings:write": roles("OWNER", "ADMIN"),
  "product-analytics:read": roles("OWNER", "ADMIN"),
  "taxes:configure": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "presets:apply": roles("OWNER", "ADMIN"),
  "opening-balances:manage": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "branding:manage": roles("OWNER", "ADMIN"),
  "setup:complete": roles("OWNER", "ADMIN"),
  "customers:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "customers:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "products:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "INVENTORY",
    "READ_ONLY"
  ),
  "products:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "INVENTORY"),
  "invoices:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "invoices:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "invoices:post": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "credit-notes:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "invoices:correct": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "receivables:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "invoice-templates:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "READ_ONLY"
  ),
  "invoice-templates:manage": roles("OWNER", "ADMIN"),
  "invoices:preview": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "invoices:pdf": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "invoices:send": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "invoices:resend": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "invoices:public-link": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "invoices:delivery-read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "READ_ONLY"
  ),
  "invoices:attachments": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "estimates:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "estimates:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "estimates:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "recurring-schedules:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "READ_ONLY"
  ),
  "recurring-schedules:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "communications:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "contracts:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "contracts:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "contracts:ready": roles("OWNER", "ADMIN", "SALES"),
  "email-connections:read": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "email-connections:manage": roles("OWNER", "ADMIN"),
  "projects:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "projects:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "time:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "time:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "time:approve": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "mileage:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "captures:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES",
    "SALES",
    "READ_ONLY"
  ),
  "captures:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES", "SALES"),
  "planning:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "planning:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "purchase-requests:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES",
    "READ_ONLY"
  ),
  "purchase-requests:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "purchase-requests:approve": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "customer-deposits:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "READ_ONLY"
  ),
  "customer-deposits:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "customer-deposits:approve": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "progress-billing:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "READ_ONLY"
  ),
  "progress-billing:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "progress-billing:approve": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "fixed-assets:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES",
    "READ_ONLY"
  ),
  "fixed-assets:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "fixed-assets:approve": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "fixed-assets:configure": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "payroll:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "payroll:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "payroll:review": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "payroll:approve": roles("OWNER", "ADMIN"),
  "payroll:post": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "payroll:payments": roles("OWNER", "ADMIN"),
  "payroll:configure": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "payroll:automation": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "migration-runs:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "migration-runs:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "commercial:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "commercial:manage": roles("OWNER", "ADMIN"),
  "payments:configure": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "payments:connect": roles("OWNER", "ADMIN"),
  "payments:disconnect": roles("OWNER", "ADMIN"),
  "payments:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "payments:record": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "payments:allocate": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "payments:refund": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "payments:refund-approve": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "payments:disputes": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "payments:receipt-resend": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "vendors:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES", "READ_ONLY"),
  "vendors:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "bills:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES", "READ_ONLY"),
  "bills:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "bills:post": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "bills:pay": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "vendor-credits:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "vendor-credits:apply": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "expenses:record": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "payables:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES", "READ_ONLY"),
  "purchases:attachments": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PURCHASES"),
  "bank-accounts:manage": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "bank-feeds:manage": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "bank-imports:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "bank-duplicates:review": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "bank-transactions:match": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "bank-transactions:categorize": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "bank-rules:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "bank-transfers:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "bank-reconciliations:manage": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "bank-reconciliations:reopen": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "bank-reports:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "inventory:read": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "PURCHASES",
    "INVENTORY",
    "READ_ONLY"
  ),
  "inventory:configure": roles("OWNER", "ADMIN", "ACCOUNTANT", "INVENTORY"),
  "inventory:receive": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "PURCHASES",
    "INVENTORY"
  ),
  "inventory:adjust": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "INVENTORY"),
  "inventory:transfer": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "INVENTORY"),
  "inventory:returns": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "SALES",
    "PURCHASES",
    "INVENTORY"
  ),
  "inventory:reports": roles(
    "OWNER",
    "ADMIN",
    "ACCOUNTANT",
    "BOOKKEEPER",
    "INVENTORY",
    "READ_ONLY"
  ),
  "inventory:reserve": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "INVENTORY"),
  "inventory:count": roles("OWNER", "ADMIN", "ACCOUNTANT", "INVENTORY"),
  "inventory:costs": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "inventory:recall": roles("OWNER", "ADMIN", "ACCOUNTANT", "INVENTORY"),
  "pos:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES", "READ_ONLY"),
  "pos:configure": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "pos:sell": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "pos:discount": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "pos:price-override": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "pos:tax-override": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "pos:shift": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES"),
  "pos:cash-events": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  // A POS return posts a credit note and may refund a payment. Keep this role
  // boundary aligned with both of those underlying accounting permissions.
  "pos:return": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "pos:refund": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "tax-reports:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "report-exports:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "dashboard:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "accountant-view:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "manual-journals:create": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "manual-journals:post": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "periods:close": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "periods:reopen": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "audit:read": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"),
  "audit:export": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "review-items:resolve": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "data-imports:master": roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"),
  "data-imports:financial": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "data-imports:approve": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "organization-exports:create": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "organization-exports:download": roles("OWNER", "ADMIN", "ACCOUNTANT"),
  "organizations:close": roles("OWNER")
};

const recentAuthenticationPermissions = new Set<Permission>([
  "members:invite",
  "members:revoke",
  "members:roles",
  "settings:write",
  "presets:apply",
  "setup:complete",
  "invoices:post",
  "credit-notes:create",
  "invoices:correct",
  "invoice-templates:manage",
  "invoices:pdf",
  "invoices:send",
  "invoices:resend",
  "invoices:public-link",
  "invoices:attachments",
  "estimates:manage",
  "recurring-schedules:manage",
  "projects:manage",
  "time:approve",
  "captures:manage",
  "planning:manage",
  "purchase-requests:approve",
  "customer-deposits:approve",
  "progress-billing:approve",
  "fixed-assets:approve",
  "fixed-assets:configure",
  "payroll:approve",
  "payroll:post",
  "payroll:payments",
  "payroll:configure",
  "migration-runs:manage",
  "commercial:manage",
  "payments:configure",
  "payments:connect",
  "payments:disconnect",
  "payments:record",
  "payments:allocate",
  "payments:refund",
  "payments:refund-approve",
  "payments:receipt-resend",
  "bills:post",
  "bills:pay",
  "vendor-credits:create",
  "vendor-credits:apply",
  "expenses:record",
  "purchases:attachments",
  "bank-accounts:manage",
  "bank-feeds:manage",
  "bank-imports:create",
  "bank-duplicates:review",
  "bank-transactions:match",
  "bank-transactions:categorize",
  "bank-rules:manage",
  "bank-transfers:create",
  "bank-reconciliations:manage",
  "bank-reconciliations:reopen",
  "inventory:configure",
  "inventory:receive",
  "inventory:adjust",
  "inventory:transfer",
  "inventory:returns",
  "inventory:reserve",
  "inventory:count",
  "inventory:costs",
  "inventory:recall",
  "pos:configure",
  "pos:sell",
  "pos:discount",
  "pos:price-override",
  "pos:tax-override",
  "pos:shift",
  "pos:cash-events",
  "pos:return",
  "pos:refund",
  "report-exports:create",
  "manual-journals:post",
  "periods:close",
  "periods:reopen",
  "audit:export",
  "review-items:resolve",
  "data-imports:financial",
  "data-imports:approve",
  "organization-exports:create",
  "organization-exports:download",
  "organizations:close",
  "companies:manage",
  "intercompany:manage",
  "consolidation:manage",
  "integrations:manage",
  "shipping:manage",
  "shipping:purchase",
  "shipping:void",
  "webhooks:manage"
]);
const mfaRequiredRoles = roles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER");
const recentAuthenticationLifetimeMs = 10 * 60 * 1000;

export function hasPermission(role: MembershipRole, permission: string): boolean {
  const registeredPermissions = permissionRoles as Partial<
    Record<string, ReadonlySet<MembershipRole>>
  >;
  return registeredPermissions[permission]?.has(role) ?? false;
}

export function assertPermission(role: MembershipRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
  }
}

export function roleRequiresMfa(role: MembershipRole): boolean {
  return mfaRequiredRoles.has(role);
}

export class AuthorizationService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async assert(
    context: OrganizationContext,
    permission: Permission,
    targetType: string,
    targetId: string | null = null
  ): Promise<void> {
    if (!hasPermission(context.role, permission)) {
      await this.auditDenial(context, permission, targetType, targetId, "ROLE_DENIED");
      throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
    }

    const delegatedScopes = context.apiCredentialScopes ?? context.oauthScopes;
    if (delegatedScopes && !delegatedScopes.includes(permission)) {
      await this.auditDenial(context, permission, targetType, targetId, "API_SCOPE_DENIED");
      throw new AppError("FORBIDDEN", "The API credential does not include this scope.", 403);
    }

    if (
      recentAuthenticationPermissions.has(permission) &&
      Date.now() - context.recentAuthAt.getTime() > recentAuthenticationLifetimeMs
    ) {
      await this.auditDenial(context, permission, targetType, targetId, "RECENT_AUTH_REQUIRED");
      throw new AppError(
        "RECENT_AUTHENTICATION_REQUIRED",
        "Recent authentication is required for this action.",
        403
      );
    }

    if (
      recentAuthenticationPermissions.has(permission) &&
      context.authenticationMethod === "OIDC" &&
      (context.role === "OWNER" || context.role === "ADMIN") &&
      !context.mfaAuthenticated
    ) {
      await this.auditDenial(context, permission, targetType, targetId, "MFA_REQUIRED");
      throw new AppError("MFA_REQUIRED", "Multi-factor authentication is required.", 403);
    }
  }

  public async assertIdentityAssurance(context: OrganizationContext): Promise<void> {
    if (
      context.authenticationMethod === "OIDC" &&
      roleRequiresMfa(context.role) &&
      !context.mfaAuthenticated
    ) {
      await this.auditDenial(
        context,
        "organizations:access",
        "Organization",
        context.organizationId,
        "MFA_REQUIRED"
      );
      throw new AppError("MFA_REQUIRED", "Multi-factor authentication is required.", 403);
    }
  }

  private async auditDenial(
    context: OrganizationContext,
    permission: Permission,
    targetType: string,
    targetId: string | null,
    reason: string
  ): Promise<void> {
    await withTenantTransaction(
      this.prisma,
      { organizationId: context.organizationId, actorUserId: context.user.id },
      (tx) =>
        tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "AUTHORIZATION_DENIED",
            targetType,
            targetId,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, {
              permission,
              actorRole: context.role,
              reason
            })
          }
        })
    );
  }
}

function roles(...values: MembershipRole[]): ReadonlySet<MembershipRole> {
  return new Set(values);
}
