import {
  Prisma,
  withTenantTransaction,
  type AccountType,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { serializeDate } from "../utils/dates.js";

type TransactionClient = Prisma.TransactionClient;

export interface CreateAccountInput {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly subtype?: string | undefined;
  readonly isControl: boolean;
}

export interface PatchAccountInput {
  readonly name?: string | undefined;
  readonly subtype?: string | null | undefined;
}

export class AccountService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listAccounts(context: OrganizationContext) {
    await this.authorization.assert(context, "accounts:read", "Account");

    const accounts = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.account.findMany({
        where: { organizationId: context.organizationId, ...companyScope(context) },
        orderBy: [{ code: "asc" }, { name: "asc" }]
      })
    );

    return accounts.map((account) => this.accountDto(account));
  }

  public async createAccount(context: OrganizationContext, input: CreateAccountInput) {
    await this.authorization.assert(context, "accounts:write", "Account");

    try {
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const account = await tx.account.create({
          data: {
            organizationId: context.organizationId,
            companyId: context.companyId ?? null,
            code: input.code,
            name: input.name,
            type: input.type,
            subtype: input.subtype ?? null,
            isControl: input.isControl
          }
        });

        await this.writeAuditEvent(tx, context, "ACCOUNT_CREATED", "Account", account.id, {
          code: account.code,
          type: account.type,
          isControl: account.isControl
        });

        return this.accountDto(account);
      });
    } catch (error) {
      await this.throwDuplicateAccountCodeIfPresent(context, input.code, error);
      throw error;
    }
  }

  public async patchAccount(
    context: OrganizationContext,
    accountId: string,
    input: PatchAccountInput
  ) {
    await this.authorization.assert(context, "accounts:write", "Account", accountId);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.account.findFirst({
        where: {
          id: accountId,
          organizationId: context.organizationId,
          ...companyScope(context)
        }
      });

      if (!existing) {
        throw new AppError("ACCOUNT_NOT_FOUND", "Account was not found.", 404);
      }

      if (existing.isArchived) {
        throw new AppError("ACCOUNT_ARCHIVED", "Archived accounts cannot be edited.", 409);
      }

      const updateData: Prisma.AccountUpdateInput = {};
      if (input.name !== undefined) {
        updateData.name = input.name;
      }
      if (input.subtype !== undefined) {
        updateData.subtype = input.subtype;
      }

      const account = await tx.account.update({
        where: { id: existing.id },
        data: updateData
      });

      await this.writeAuditEvent(tx, context, "ACCOUNT_UPDATED", "Account", account.id, {
        before: {
          name: existing.name,
          subtype: existing.subtype
        },
        after: {
          name: account.name,
          subtype: account.subtype
        }
      });

      return this.accountDto(account);
    });
  }

  public async archiveAccount(context: OrganizationContext, accountId: string) {
    await this.authorization.assert(context, "accounts:write", "Account", accountId);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.account.findFirst({
        where: {
          id: accountId,
          organizationId: context.organizationId,
          ...companyScope(context)
        }
      });

      if (!existing) {
        throw new AppError("ACCOUNT_NOT_FOUND", "Account was not found.", 404);
      }

      const account = await tx.account.update({
        where: { id: existing.id },
        data: { isArchived: true }
      });

      await this.writeAuditEvent(tx, context, "ACCOUNT_ARCHIVED", "Account", account.id, {
        code: account.code
      });

      return this.accountDto(account);
    });
  }

  private accountDto(account: {
    id: string;
    organizationId: string;
    companyId: string | null;
    code: string;
    name: string;
    type: AccountType;
    subtype: string | null;
    isControl: boolean;
    isArchived: boolean;
    systemPurpose: string | null;
    normalBalance: string | null;
    presetKey: string | null;
    presetVersion: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: account.id,
      organizationId: account.organizationId,
      companyId: account.companyId,
      code: account.code,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      isControl: account.isControl,
      isArchived: account.isArchived,
      systemPurpose: account.systemPurpose,
      normalBalance: account.normalBalance,
      presetKey: account.presetKey,
      presetVersion: account.presetVersion,
      createdAt: serializeDate(account.createdAt),
      updatedAt: serializeDate(account.updatedAt)
    };
  }

  private async writeAuditEvent(
    tx: TransactionClient,
    context: OrganizationContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonObject
  ): Promise<void> {
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

  private async throwDuplicateAccountCodeIfPresent(
    context: OrganizationContext,
    code: string,
    error: unknown
  ): Promise<void> {
    if (error instanceof AppError || !isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.account.findFirst({
        where: {
          organizationId: context.organizationId,
          code,
          ...companyScope(context)
        },
        select: {
          id: true,
          code: true
        }
      })
    );

    if (!existing) {
      throw error;
    }

    throw new AppError("ACCOUNT_CODE_ALREADY_EXISTS", "Account code already exists.", 409, {
      accountId: existing.id,
      code: existing.code
    });
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function companyScope(context: OrganizationContext) {
  return context.companyId ? { companyId: context.companyId } : {};
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
