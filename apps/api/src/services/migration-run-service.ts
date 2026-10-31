import {
  Prisma,
  withTenantTransaction,
  type PrismaClient,
  type MigrationRunStatus
} from "@clearledger/db";
import {
  canonicalMigrationEntities,
  validateMigrationManifest,
  type MigrationManifestEntry,
  type OrganizationContext
} from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

export interface MigrationRunInput {
  readonly sourceSystem: string;
  readonly entries: readonly MigrationManifestEntry[];
}

export class MigrationRunService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "migration-runs:read", "MigrationRun");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const runs = await tx.migrationRun.findMany({
        where: { organizationId: context.organizationId },
        include: { entries: { orderBy: { entity: "asc" } } },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return runs.map(migrationRunDto);
    });
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "migration-runs:read", "MigrationRun", id);
    const run = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.migrationRun.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { entries: { orderBy: { entity: "asc" } } }
      })
    );
    if (!run) throw new AppError("MIGRATION_RUN_NOT_FOUND", "Migration run was not found.", 404);
    return migrationRunDto(run);
  }

  public async create(context: OrganizationContext, input: MigrationRunInput) {
    await this.authorization.assert(context, "migration-runs:manage", "MigrationRun");
    const sourceSystem = input.sourceSystem.trim();
    if (!sourceSystem) throw new AppError("MIGRATION_SOURCE_REQUIRED", "Source is required.", 422);
    if (input.entries.length === 0)
      throw new AppError(
        "MIGRATION_MANIFEST_EMPTY",
        "At least one migration entity is required.",
        422
      );
    try {
      validateMigrationManifest(input.entries);
    } catch (error) {
      throw new AppError(
        "MIGRATION_MANIFEST_INVALID",
        error instanceof Error ? error.message : "Migration manifest is invalid.",
        422
      );
    }
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const run = await tx.migrationRun.create({
        data: {
          organizationId: context.organizationId,
          sourceSystem,
          manifest: input.entries as unknown as Prisma.InputJsonArray,
          createdByUserId: context.user.id,
          entries: {
            create: input.entries.map((entry) => ({
              entity: entry.entity,
              source: entry.source,
              rowCount: entry.rowCount,
              supported: entry.supported,
              unsupportedReason: entry.unsupportedReason ?? null
            }))
          }
        },
        include: { entries: { orderBy: { entity: "asc" } } }
      });
      await audit(tx, context, "MIGRATION_RUN_CREATED", "MigrationRun", run.id, {
        sourceSystem,
        entityCount: input.entries.length
      });
      return migrationRunDto(run);
    });
  }

  public async transition(
    context: OrganizationContext,
    id: string,
    next: Exclude<MigrationRunStatus, "DRAFT">,
    version: number,
    errorMessage?: string | null
  ) {
    await this.authorization.assert(context, "migration-runs:manage", "MigrationRun", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.migrationRun.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError("MIGRATION_RUN_NOT_FOUND", "Migration run was not found.", 404);
      const allowed: Readonly<Record<MigrationRunStatus, readonly MigrationRunStatus[]>> = {
        DRAFT: ["VALIDATED", "CANCELLED"],
        VALIDATED: ["RUNNING", "CANCELLED"],
        RUNNING: ["COMPLETED", "FAILED", "CANCELLED"],
        COMPLETED: ["COMPLETED"],
        FAILED: ["FAILED"],
        CANCELLED: ["CANCELLED"]
      };
      if (!allowed[current.status].includes(next))
        throw new AppError(
          "MIGRATION_RUN_TRANSITION_INVALID",
          `Migration run cannot move from ${current.status} to ${next}.`,
          409
        );
      const now = new Date();
      const updated = await tx.migrationRun.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: {
          status: next,
          version: { increment: 1 },
          ...(next === "RUNNING" ? { startedAt: now } : {}),
          ...(next === "COMPLETED" || next === "FAILED" || next === "CANCELLED"
            ? { completedAt: now }
            : {}),
          ...(next === "FAILED" ? { errorMessage: errorMessage ?? "Migration failed." } : {}),
          updatedAt: now
        }
      });
      if (updated.count !== 1)
        throw new AppError(
          "STALE_MIGRATION_RUN",
          "Migration run was changed by another request.",
          409
        );
      await audit(tx, context, `MIGRATION_RUN_${next}`, "MigrationRun", id, {
        errorMessage: errorMessage ?? null
      });
      return tx.migrationRun
        .findUniqueOrThrow({
          where: { id },
          include: { entries: { orderBy: { entity: "asc" } } }
        })
        .then(migrationRunDto);
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

function migrationRunDto(row: {
  id: string;
  sourceSystem: string;
  status: string;
  manifest: Prisma.JsonValue;
  errorMessage: string | null;
  version: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  entries: readonly {
    entity: string;
    source: string;
    rowCount: number;
    supported: boolean;
    unsupportedReason: string | null;
  }[];
}) {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    status: row.status,
    manifest: row.manifest,
    errorMessage: row.errorMessage,
    version: row.version,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    entries: row.entries
  };
}

async function audit(
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

export { canonicalMigrationEntities };
