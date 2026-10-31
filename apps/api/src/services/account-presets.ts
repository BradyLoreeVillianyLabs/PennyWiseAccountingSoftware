import { type AccountType, type NormalBalance, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { runIdempotent } from "./idempotency-service.js";
import { seedWorkflowPreferencesFromAccountPreset } from "./workflow-preferences-service.js";

export const presetKeys = [
  "general-service",
  "contractor-trades",
  "ranch-agriculture",
  "repair-business",
  "tourism-experiences",
  "small-product-seller"
] as const;
export type PresetKey = (typeof presetKeys)[number];

interface PresetAccount {
  purpose: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  normalBalance: NormalBalance;
  control: boolean;
  active: boolean;
  reuseCompatibleExistingAccount: boolean;
}

const base: readonly PresetAccount[] = [
  account("cash", "1000", "Cash", "ASSET", "Cash and cash equivalents", "DEBIT"),
  account(
    "accounts-receivable",
    "1100",
    "Accounts receivable",
    "ASSET",
    "Receivables",
    "DEBIT",
    true
  ),
  account(
    "tax-recoverable",
    "1200",
    "Sales tax recoverable",
    "ASSET",
    "Tax recoverable",
    "DEBIT",
    true
  ),
  account("equipment", "1500", "Equipment", "ASSET", "Property and equipment", "DEBIT"),
  account("accounts-payable", "2000", "Accounts payable", "LIABILITY", "Payables", "CREDIT", true),
  account("tax-payable", "2100", "Sales tax payable", "LIABILITY", "Tax payable", "CREDIT", true),
  account("loan-payable", "2300", "Loans payable", "LIABILITY", "Loans", "CREDIT"),
  account("opening-equity", "3000", "Opening balance equity", "EQUITY", "Opening equity", "CREDIT"),
  account(
    "retained-earnings",
    "3100",
    "Retained earnings",
    "EQUITY",
    "Retained earnings",
    "CREDIT"
  ),
  account("sales", "4000", "Sales", "REVENUE", "Operating revenue", "CREDIT"),
  account("general-expense", "6000", "General expenses", "EXPENSE", "Operating expense", "DEBIT"),
  account(
    "unrealized-fx-loss",
    "7200",
    "Unrealized foreign-exchange loss",
    "EXPENSE",
    "Foreign-exchange revaluation",
    "DEBIT"
  ),
  account(
    "unrealized-fx-gain",
    "7201",
    "Unrealized foreign-exchange gain",
    "REVENUE",
    "Foreign-exchange revaluation",
    "CREDIT"
  ),
  account(
    "realized-fx-loss",
    "7210",
    "Realized foreign-exchange loss",
    "EXPENSE",
    "Foreign-exchange settlement",
    "DEBIT"
  ),
  account(
    "realized-fx-gain",
    "7211",
    "Realized foreign-exchange gain",
    "REVENUE",
    "Foreign-exchange settlement",
    "CREDIT"
  )
];

const specialties: Readonly<Record<PresetKey, readonly PresetAccount[]>> = {
  "general-service": [
    account(
      "professional-services",
      "4100",
      "Service revenue",
      "REVENUE",
      "Services",
      "CREDIT",
      false,
      true
    )
  ],
  "contractor-trades": [
    account(
      "contract-revenue",
      "4100",
      "Contract revenue",
      "REVENUE",
      "Construction",
      "CREDIT",
      false,
      true
    ),
    account(
      "job-materials",
      "5100",
      "Job materials",
      "EXPENSE",
      "Direct costs",
      "DEBIT",
      false,
      true
    )
  ],
  "ranch-agriculture": [
    account(
      "farm-revenue",
      "4100",
      "Farm revenue",
      "REVENUE",
      "Agriculture",
      "CREDIT",
      false,
      true
    ),
    account(
      "feed-supplies",
      "5100",
      "Feed and supplies",
      "EXPENSE",
      "Agriculture inputs",
      "DEBIT",
      false,
      true
    )
  ],
  "repair-business": [
    account(
      "repair-revenue",
      "4100",
      "Repair revenue",
      "REVENUE",
      "Repairs",
      "CREDIT",
      false,
      true
    ),
    account("parts-cost", "5100", "Parts cost", "EXPENSE", "Direct costs", "DEBIT", false, true)
  ],
  "tourism-experiences": [
    account(
      "experience-revenue",
      "4100",
      "Experience revenue",
      "REVENUE",
      "Tourism",
      "CREDIT",
      false,
      true
    ),
    account(
      "guest-supplies",
      "5100",
      "Guest supplies",
      "EXPENSE",
      "Direct costs",
      "DEBIT",
      false,
      true
    )
  ],
  "small-product-seller": [
    account("inventory", "1300", "Inventory", "ASSET", "Inventory", "DEBIT", true),
    account("product-sales", "4100", "Product sales", "REVENUE", "Products", "CREDIT", false, true),
    // Shipping charged to a customer is revenue, not an offset against what the
    // carrier charges. Store orders create a shipping line with no product item,
    // so without this account those amounts fell into the general sales account
    // and could not be reported separately.
    account(
      "shipping-revenue",
      "4110",
      "Shipping revenue",
      "REVENUE",
      "Products",
      "CREDIT",
      false,
      true
    ),
    account(
      "cost-of-goods",
      "5000",
      "Cost of goods sold",
      "EXPENSE",
      "Cost of sales",
      "DEBIT",
      false,
      true
    )
  ]
};

// Version 2 added the shipping revenue account to the product-seller preset.
export const PRESET_VERSION = 2;

export class AccountPresetService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public preview(key: PresetKey) {
    return { key, version: PRESET_VERSION, accounts: [...base, ...specialties[key]] };
  }

  public async apply(context: OrganizationContext, key: PresetKey, idempotencyKey?: string) {
    await this.authorization.assert(context, "presets:apply", "AppliedAccountPreset");
    const definition = this.preview(key);
    return runIdempotent(
      this.prisma,
      context,
      "account-preset.apply",
      idempotencyKey,
      definition,
      async (tx) => {
        const existingApplication = await tx.appliedAccountPreset.findUnique({
          where: {
            organizationId_presetKey_presetVersion: {
              organizationId: context.organizationId,
              presetKey: key,
              presetVersion: PRESET_VERSION
            }
          }
        });
        if (existingApplication) {
          await seedWorkflowPreferencesFromAccountPreset(tx, context, key);
          return { statusCode: 200, body: { preset: definition, createdCount: 0, reusedCount: 0 } };
        }

        let createdCount = 0;
        const reusedAccountCodes: string[] = [];
        for (const entry of definition.accounts) {
          const existingPurpose = await tx.account.findFirst({
            where: {
              organizationId: context.organizationId,
              ...companyScope(context),
              systemPurpose: entry.purpose
            }
          });
          if (existingPurpose) continue;
          const codeOwner = await tx.account.findFirst({
            where: {
              organizationId: context.organizationId,
              ...companyScope(context),
              code: entry.code
            }
          });
          if (codeOwner) {
            if (canReuseExistingAccount(codeOwner, entry)) {
              await tx.account.update({
                where: { id: codeOwner.id },
                data: {
                  systemPurpose: entry.purpose,
                  normalBalance: entry.normalBalance,
                  presetKey: key,
                  presetVersion: PRESET_VERSION
                }
              });
              reusedAccountCodes.push(entry.code);
              continue;
            }
            throw new AppError(
              "PRESET_ACCOUNT_CODE_CONFLICT",
              `Account code ${entry.code} cannot be safely used by this preset.`,
              409,
              { code: entry.code, purpose: entry.purpose }
            );
          }
          await tx.account.create({
            data: {
              organizationId: context.organizationId,
              companyId: context.companyId ?? null,
              code: entry.code,
              name: entry.name,
              type: entry.type,
              subtype: entry.subtype,
              isControl: entry.control,
              isArchived: !entry.active,
              systemPurpose: entry.purpose,
              normalBalance: entry.normalBalance,
              presetKey: key,
              presetVersion: PRESET_VERSION
            }
          });
          createdCount += 1;
        }

        const application = await tx.appliedAccountPreset.create({
          data: {
            organizationId: context.organizationId,
            presetKey: key,
            presetVersion: PRESET_VERSION,
            appliedByUserId: context.user.id
          }
        });
        await tx.organizationSettings.update({
          where: { organizationId: context.organizationId },
          data: { industryPresetKey: key, version: { increment: 1 } }
        });
        await seedWorkflowPreferencesFromAccountPreset(tx, context, key);
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "ACCOUNT_PRESET_APPLIED",
            targetType: "AppliedAccountPreset",
            targetId: application.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, {
              presetKey: key,
              presetVersion: PRESET_VERSION,
              createdCount,
              reusedAccountCodes
            })
          }
        });
        return {
          statusCode: 201,
          body: { preset: definition, createdCount, reusedCount: reusedAccountCodes.length },
          resourceId: application.id
        };
      }
    );
  }
}

function account(
  purpose: string,
  code: string,
  name: string,
  type: AccountType,
  subtype: string,
  normalBalance: NormalBalance,
  control = false,
  reuseCompatibleExistingAccount = false
): PresetAccount {
  return {
    purpose,
    code,
    name,
    type,
    subtype,
    normalBalance,
    control,
    active: true,
    reuseCompatibleExistingAccount
  };
}

function companyScope(context: OrganizationContext) {
  return context.companyId ? { companyId: context.companyId } : {};
}

function canReuseExistingAccount(
  existing: {
    type: AccountType;
    isControl: boolean;
    isArchived: boolean;
    systemPurpose: string | null;
  },
  entry: PresetAccount
) {
  return (
    entry.reuseCompatibleExistingAccount &&
    !entry.control &&
    existing.type === entry.type &&
    !existing.isControl &&
    !existing.isArchived &&
    existing.systemPurpose === null
  );
}
