import { Prisma, type PrismaClient } from "../generated-client/index.js";

export type RuntimeTransaction = Prisma.TransactionClient;

export interface TenantDatabaseContext {
  readonly organizationId: string;
  readonly actorUserId: string;
  /** Optional legal-company selector for company-aware transactions. */
  readonly companyId?: string | null | undefined;
}

interface TransactionOptions {
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
  readonly maxWait?: number;
  readonly timeout?: number;
}

const defaultOptions: Required<TransactionOptions> = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 15_000
};

export async function withRuntimeTransaction<T>(
  prisma: PrismaClient,
  actorUserId: string | null,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const transactionOptions = {
    isolationLevel: options.isolationLevel ?? defaultOptions.isolationLevel,
    maxWait: options.maxWait ?? defaultOptions.maxWait,
    timeout: options.timeout ?? defaultOptions.timeout
  };
  return prisma.$transaction(async (tx: RuntimeTransaction) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${actorUserId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.organization_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.company_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.access_mode', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.invitation_token_hash', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.public_invoice_token_hash', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.api_credential_secret_hash', '', true)`;
    await resetOAuthLookupContext(tx);
    await resetConnectorWebhookContext(tx);
    return work(tx);
  }, transactionOptions);
}

export async function withTenantTransaction<T>(
  prisma: PrismaClient,
  context: TenantDatabaseContext,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const transactionOptions = {
    isolationLevel: options.isolationLevel ?? defaultOptions.isolationLevel,
    maxWait: options.maxWait ?? defaultOptions.maxWait,
    timeout: options.timeout ?? defaultOptions.timeout
  };
  return prisma.$transaction(async (tx: RuntimeTransaction) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${context.organizationId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.company_id', ${context.companyId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${context.actorUserId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.access_mode', 'membership', true)`;
    await tx.$executeRaw`SELECT set_config('app.invitation_token_hash', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.public_invoice_token_hash', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.api_credential_secret_hash', '', true)`;
    await resetOAuthLookupContext(tx);
    await resetConnectorWebhookContext(tx);
    return work(tx);
  }, transactionOptions);
}

export async function withPublicInvoiceTransaction<T>(
  prisma: PrismaClient,
  tokenHash: string,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const transactionOptions = {
    isolationLevel: options.isolationLevel ?? defaultOptions.isolationLevel,
    maxWait: options.maxWait ?? defaultOptions.maxWait,
    timeout: options.timeout ?? defaultOptions.timeout
  };
  return prisma.$transaction(async (tx: RuntimeTransaction) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.organization_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.company_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.access_mode', 'public_invoice', true)`;
    await tx.$executeRaw`SELECT set_config('app.public_invoice_token_hash', ${tokenHash}, true)`;
    await tx.$executeRaw`SELECT set_config('app.api_credential_secret_hash', '', true)`;
    await resetOAuthLookupContext(tx);
    await resetConnectorWebhookContext(tx);
    return work(tx);
  }, transactionOptions);
}

/** Resolves one encrypted provider account by a one-way lookup hash after signature verification. */
export async function withPaymentWebhookLookupTransaction<T>(
  prisma: PrismaClient,
  providerAccountLookupHash: string,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const transactionOptions = {
    isolationLevel: options.isolationLevel ?? defaultOptions.isolationLevel,
    maxWait: options.maxWait ?? defaultOptions.maxWait,
    timeout: options.timeout ?? defaultOptions.timeout
  };
  return prisma.$transaction(async (tx: RuntimeTransaction) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.organization_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.company_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.access_mode', 'payment_webhook_lookup', true)`;
    await tx.$executeRaw`SELECT set_config('app.payment_account_lookup_hash', ${providerAccountLookupHash}, true)`;
    await resetOAuthLookupContext(tx);
    await resetConnectorWebhookContext(tx);
    return work(tx);
  }, transactionOptions);
}

/** Resolves one connector installation by a one-way webhook lookup hash. */
export async function withConnectorWebhookLookupTransaction<T>(
  prisma: PrismaClient,
  webhookLookupHash: string,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const transactionOptions = {
    isolationLevel: options.isolationLevel ?? defaultOptions.isolationLevel,
    maxWait: options.maxWait ?? defaultOptions.maxWait,
    timeout: options.timeout ?? defaultOptions.timeout
  };
  return prisma.$transaction(async (tx: RuntimeTransaction) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.organization_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.company_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.access_mode', 'connector_webhook_lookup', true)`;
    await tx.$executeRaw`SELECT set_config('app.connector_webhook_lookup_hash', ${webhookLookupHash}, true)`;
    await tx.$executeRaw`SELECT set_config('app.public_invoice_token_hash', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.api_credential_secret_hash', '', true)`;
    await resetOAuthLookupContext(tx);
    return work(tx);
  }, transactionOptions);
}

/** Applies a verified provider event inside one tenant-scoped, non-user transaction. */
export async function withPaymentWebhookTransaction<T>(
  prisma: PrismaClient,
  context: TenantDatabaseContext,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  return withSpecialTenantTransaction(prisma, context, "payment_webhook", "", work, options);
}

/** Applies a verified commerce event in a short tenant-scoped transaction. */
export async function withCommerceWebhookTransaction<T>(
  prisma: PrismaClient,
  context: TenantDatabaseContext,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  return withSpecialTenantTransaction(prisma, context, "commerce_webhook", "", work, options);
}

export async function withOrganizationBootstrapTransaction<T>(
  prisma: PrismaClient,
  context: TenantDatabaseContext,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  return withSpecialTenantTransaction(prisma, context, "organization_bootstrap", "", work, options);
}

export async function withInvitationAcceptanceTransaction<T>(
  prisma: PrismaClient,
  context: TenantDatabaseContext,
  invitationTokenHash: string,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  return withSpecialTenantTransaction(
    prisma,
    context,
    "invitation_acceptance",
    invitationTokenHash,
    work,
    options
  );
}

async function withSpecialTenantTransaction<T>(
  prisma: PrismaClient,
  context: TenantDatabaseContext,
  accessMode: string,
  invitationTokenHash: string,
  work: (tx: RuntimeTransaction) => Promise<T>,
  options: TransactionOptions
): Promise<T> {
  const transactionOptions = {
    isolationLevel: options.isolationLevel ?? defaultOptions.isolationLevel,
    maxWait: options.maxWait ?? defaultOptions.maxWait,
    timeout: options.timeout ?? defaultOptions.timeout
  };
  return prisma.$transaction(async (tx: RuntimeTransaction) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${context.organizationId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.company_id', ${context.companyId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.actor_user_id', ${context.actorUserId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.access_mode', ${accessMode}, true)`;
    await tx.$executeRaw`SELECT set_config('app.invitation_token_hash', ${invitationTokenHash}, true)`;
    await tx.$executeRaw`SELECT set_config('app.public_invoice_token_hash', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.api_credential_secret_hash', '', true)`;
    await resetOAuthLookupContext(tx);
    await resetConnectorWebhookContext(tx);
    return work(tx);
  }, transactionOptions);
}

async function resetOAuthLookupContext(tx: RuntimeTransaction): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.oauth_client_id', '', true)`;
  await tx.$executeRaw`SELECT set_config('app.oauth_client_secret_hash', '', true)`;
  await tx.$executeRaw`SELECT set_config('app.oauth_authorization_code_hash', '', true)`;
  await tx.$executeRaw`SELECT set_config('app.oauth_access_token_hash', '', true)`;
  await tx.$executeRaw`SELECT set_config('app.oauth_refresh_token_hash', '', true)`;
}

async function resetConnectorWebhookContext(tx: RuntimeTransaction): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.connector_webhook_lookup_hash', '', true)`;
}

export async function verifyRuntimeDatabaseRole(prisma: PrismaClient): Promise<void> {
  const loginRoles = await prisma.$queryRaw<
    readonly {
      ismember: boolean;
      owns_public_tables: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolreplication: boolean;
      rolsuper: boolean;
    }[]
  >`
    SELECT
      pg_has_role(session_user, 'clearledger_runtime', 'MEMBER') AS ismember,
      EXISTS (
        SELECT 1
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE relation.relowner = role_record.oid
          AND namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
      ) AS owns_public_tables,
      role_record.rolbypassrls,
      role_record.rolcreatedb,
      role_record.rolcreaterole,
      role_record.rolinherit,
      role_record.rolreplication,
      role_record.rolsuper
    FROM pg_roles role_record
    WHERE role_record.rolname = session_user
  `;
  const loginRole = loginRoles[0];
  if (
    !loginRole ||
    !loginRole.ismember ||
    loginRole.owns_public_tables ||
    loginRole.rolbypassrls ||
    loginRole.rolcreatedb ||
    loginRole.rolcreaterole ||
    loginRole.rolinherit ||
    loginRole.rolreplication ||
    loginRole.rolsuper
  ) {
    throw new Error(
      "The production database login must be an unprivileged NOINHERIT member of clearledger_runtime."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clearledger_runtime");
    const roles = await tx.$queryRaw<
      readonly { rolbypassrls: boolean; rolcreaterole: boolean; rolsuper: boolean }[]
    >`SELECT rolbypassrls, rolcreaterole, rolsuper FROM pg_roles WHERE rolname = current_user`;
    const role = roles[0];

    if (!role || role.rolbypassrls || role.rolcreaterole || role.rolsuper) {
      throw new Error(
        "The ClearLedger runtime database role is missing or privileged to bypass RLS."
      );
    }
  });
}
