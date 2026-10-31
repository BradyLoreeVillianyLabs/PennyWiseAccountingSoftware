import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { hashJson, type JsonObject } from "../utils/json.js";

type TransactionClient = Prisma.TransactionClient;

export interface IdempotentResult<TBody extends JsonObject> {
  readonly statusCode: number;
  readonly body: TBody;
  readonly resourceId?: string | undefined;
  readonly replayed?: boolean | undefined;
}

export async function runIdempotent<TBody extends JsonObject>(
  prisma: PrismaClient,
  context: OrganizationContext,
  operation: string,
  key: string | undefined,
  requestPayload: unknown,
  work: (tx: TransactionClient) => Promise<IdempotentResult<TBody>>
): Promise<IdempotentResult<TBody>> {
  if (!key?.trim()) {
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.", 400);
  }

  const normalizedKey = key.trim();
  const requestHash = hashJson(requestPayload);
  const existing = await readExistingIdempotencyRecord<TBody>(
    prisma,
    context,
    operation,
    normalizedKey,
    requestHash
  );

  if (existing) {
    return existing;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withTenantTransaction(
        prisma,
        { organizationId: context.organizationId, actorUserId: context.user.id },
        async (tx) => {
          const idempotencyRecord = await tx.idempotencyRecord.create({
            data: {
              organizationId: context.organizationId,
              operation,
              key: normalizedKey,
              requestHash
            }
          });

          const result = await work(tx);

          await tx.idempotencyRecord.update({
            where: { id: idempotencyRecord.id },
            data: {
              responseStatus: result.statusCode,
              responseBody: result.body as Prisma.InputJsonObject,
              resourceId: result.resourceId ?? null
            }
          });

          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const replay = await readExistingIdempotencyRecord<TBody>(
          prisma,
          context,
          operation,
          normalizedKey,
          requestHash
        );

        if (replay) return replay;
        if (attempt < 2) {
          await sleep(25 * (attempt + 1));
          continue;
        }
      }
      if (isSerializationConflict(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError(
    "IDEMPOTENCY_RETRY_EXHAUSTED",
    "The operation could not be committed safely.",
    409
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readExistingIdempotencyRecord<TBody extends JsonObject>(
  prisma: PrismaClient,
  context: OrganizationContext,
  operation: string,
  key: string,
  requestHash: string
): Promise<IdempotentResult<TBody> | undefined> {
  const existing = await withTenantTransaction(
    prisma,
    { organizationId: context.organizationId, actorUserId: context.user.id },
    (tx) =>
      tx.idempotencyRecord.findUnique({
        where: {
          organizationId_operation_key: {
            organizationId: context.organizationId,
            operation,
            key
          }
        }
      })
  );

  if (!existing) {
    return undefined;
  }

  if (existing.requestHash !== requestHash) {
    throw new AppError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used for a different request.",
      409
    );
  }

  if (existing.responseStatus !== null && existing.responseBody !== null) {
    const result: IdempotentResult<TBody> = {
      statusCode: existing.responseStatus,
      body: existing.responseBody as TBody,
      replayed: true
    };

    if (existing.resourceId) {
      return { ...result, resourceId: existing.resourceId };
    }

    return result;
  }

  throw new AppError("IDEMPOTENCY_IN_PROGRESS", "The original request is still in progress.", 409);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const metadata = error.meta as { readonly code?: unknown };
  return metadata.code === "40001" || metadata.code === "40P01";
}
