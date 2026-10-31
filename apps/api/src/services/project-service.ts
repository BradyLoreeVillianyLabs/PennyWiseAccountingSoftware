import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import {
  allowedAttachmentMediaTypes,
  inspectAttachmentBytes,
  normalizeAttachmentFileName,
  type AttachmentScanner,
  DevelopmentAttachmentScanner,
  type DocumentStorage,
  DevelopmentDocumentStorage
} from "./invoice-document-service.js";
import { LocalCaptureExtractionService } from "./local-capture-extraction-service.js";
import { createHash, randomUUID } from "node:crypto";

export interface ProjectInput {
  readonly customerId: string;
  readonly projectNumber: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly billingMethod: "FIXED" | "TIME_AND_MATERIALS" | "NON_BILLABLE";
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly budgetMinor?: string | null | undefined;
  readonly tags: readonly string[];
}

export interface ProjectPatch {
  readonly version: number;
  readonly customerId?: string | undefined;
  readonly projectNumber?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly billingMethod?: ProjectInput["billingMethod"] | undefined;
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly budgetMinor?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface TimeEntryInput {
  readonly entryDate: string;
  readonly durationMicros: string;
  readonly rateMinor: string;
  readonly description?: string | null | undefined;
  readonly billable: boolean;
  readonly startedAt?: string | null | undefined;
  readonly endedAt?: string | null | undefined;
}

export interface MileageInput {
  readonly projectId?: string | null | undefined;
  readonly entryDate: string;
  readonly purpose: string;
  readonly distanceMicros: string;
  readonly vehicleLabel?: string | null | undefined;
  readonly reimbursementRateMinor: string;
  readonly attachmentReference?: string | null | undefined;
}

export interface CaptureInput {
  readonly projectId?: string | null | undefined;
  readonly kind: "RECEIPT" | "BILL";
  readonly storageKey: string;
  readonly checksum: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly scanStatus: "PENDING" | "CLEAN" | "REJECTED";
  readonly ocrProvider?: string | null | undefined;
  readonly ocrVersion?: string | null | undefined;
  readonly ocrConfidence?: number | null | undefined;
  readonly extractedData?: Record<string, unknown> | null | undefined;
}

export interface CaptureListFilters {
  readonly projectId?: string | undefined;
  readonly status?: "RECEIVED" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED" | undefined;
  readonly kind?: "RECEIPT" | "BILL" | undefined;
  readonly conversion?: "LINKED" | "UNLINKED" | undefined;
}

export class ProjectService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage = new DevelopmentDocumentStorage(),
    private readonly attachmentScanner: AttachmentScanner = new DevelopmentAttachmentScanner(),
    private readonly captureExtraction: LocalCaptureExtractionService = new LocalCaptureExtractionService()
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "projects:read", "Project");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.project.findMany({
        where: { organizationId: context.organizationId },
        include: { customer: { select: { displayName: true } } },
        orderBy: [{ status: "asc" }, { name: "asc" }],
        take: 200
      });
      return rows.map((row) => ({ ...projectDto(row), customerName: row.customer.displayName }));
    });
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "projects:read", "Project", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.project.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          customer: { select: { id: true, displayName: true } },
          timeEntries: { orderBy: { entryDate: "desc" }, take: 100 },
          mileageLogs: { orderBy: { entryDate: "desc" }, take: 100 },
          captureReviews: {
            include: { conversion: true },
            orderBy: { createdAt: "desc" },
            take: 100
          }
        }
      })
    );
    if (!row) throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
    return {
      ...projectDto(row),
      customerId: row.customer.id,
      customerName: row.customer.displayName,
      description: row.description,
      tags: row.tags,
      timeEntries: row.timeEntries.map(timeEntryDto),
      mileageLogs: row.mileageLogs.map(mileageDto),
      captureReviews: row.captureReviews.map(captureDto)
    };
  }

  public async create(context: OrganizationContext, input: ProjectInput) {
    await this.authorization.assert(context, "projects:manage", "Project");
    const dates = datesFor(input.startDate, input.endDate);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: context.organizationId, active: true }
      });
      if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      const row = await tx.project.create({
        data: {
          organizationId: context.organizationId,
          customerId: input.customerId,
          projectNumber: input.projectNumber,
          name: input.name,
          description: input.description ?? null,
          billingMethod: input.billingMethod,
          startDate: dates.startDate,
          endDate: dates.endDate,
          budgetMinor:
            input.budgetMinor === null || input.budgetMinor === undefined
              ? null
              : BigInt(input.budgetMinor),
          tags: input.tags,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "PROJECT_CREATED", "Project", row.id, {
        projectNumber: row.projectNumber
      });
      return projectDto(row);
    });
  }

  public async update(context: OrganizationContext, id: string, input: ProjectPatch) {
    await this.authorization.assert(context, "projects:manage", "Project", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.project.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current) throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
      const dates = datesFor(
        input.startDate === undefined
          ? current.startDate?.toISOString().slice(0, 10)
          : input.startDate,
        input.endDate === undefined ? current.endDate?.toISOString().slice(0, 10) : input.endDate
      );
      const changed = await tx.project.updateMany({
        where: { id, organizationId: context.organizationId, version: input.version },
        data: {
          ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
          ...(input.projectNumber === undefined ? {} : { projectNumber: input.projectNumber }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.billingMethod === undefined ? {} : { billingMethod: input.billingMethod }),
          ...(input.startDate === undefined ? {} : { startDate: dates.startDate }),
          ...(input.endDate === undefined ? {} : { endDate: dates.endDate }),
          ...(input.budgetMinor === undefined
            ? {}
            : { budgetMinor: input.budgetMinor === null ? null : BigInt(input.budgetMinor) }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError("STALE_PROJECT", "Project was changed by another request.", 409);
      return projectDto(await tx.project.findUniqueOrThrow({ where: { id } }));
    });
  }

  public async setStatus(
    context: OrganizationContext,
    id: string,
    status: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED",
    version: number
  ) {
    await this.authorization.assert(context, "projects:manage", "Project", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const changed = await tx.project.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: { status, version: { increment: 1 }, updatedByUserId: context.user.id }
      });
      if (changed.count !== 1)
        throw new AppError("STALE_PROJECT", "Project was changed by another request.", 409);
      await audit(tx, context, `PROJECT_${status}`, "Project", id, {});
      return projectDto(await tx.project.findUniqueOrThrow({ where: { id } }));
    });
  }

  public async createTimeEntry(
    context: OrganizationContext,
    projectId: string,
    input: TimeEntryInput
  ) {
    await this.authorization.assert(context, "time:manage", "ProjectTimeEntry");
    const durationMicros = BigInt(input.durationMicros);
    const rateMinor = BigInt(input.rateMinor);
    if (durationMicros <= 0n || rateMinor < 0n)
      throw new AppError(
        "TIME_ENTRY_VALUE_INVALID",
        "Time duration and rate must be valid positive values.",
        422
      );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertProject(tx, context.organizationId, projectId);
      const row = await tx.projectTimeEntry.create({
        data: {
          organizationId: context.organizationId,
          projectId,
          entryDate: parseDate(input.entryDate, "entryDate"),
          durationMicros,
          rateMinor,
          amountMinor: (durationMicros * rateMinor) / 1_000_000n,
          description: input.description ?? null,
          billable: input.billable,
          startedAt: input.startedAt ? new Date(input.startedAt) : null,
          endedAt: input.endedAt ? new Date(input.endedAt) : null,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "TIME_ENTRY_CREATED", "ProjectTimeEntry", row.id, { projectId });
      return timeEntryDto(row);
    });
  }

  public async listTimeEntries(context: OrganizationContext, projectId?: string) {
    await this.authorization.assert(context, "time:read", "ProjectTimeEntry");
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.projectTimeEntry
        .findMany({
          where: { organizationId: context.organizationId, ...(projectId ? { projectId } : {}) },
          orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
          take: 500
        })
        .then((rows) => rows.map(timeEntryDto))
    );
  }

  public async listCaptures(context: OrganizationContext, filters: CaptureListFilters = {}) {
    await this.authorization.assert(context, "captures:read", "CaptureReview");
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.captureReview
        .findMany({
          where: {
            organizationId: context.organizationId,
            ...(filters.projectId ? { projectId: filters.projectId } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.kind ? { kind: filters.kind } : {}),
            ...(filters.conversion
              ? { conversion: filters.conversion === "LINKED" ? { isNot: null } : { is: null } }
              : {})
          },
          include: { conversion: true },
          orderBy: { createdAt: "desc" },
          take: 500
        })
        .then((rows) => rows.map(captureDto))
    );
  }

  public async approveTimeEntry(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "time:approve", "ProjectTimeEntry", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const changed = await tx.projectTimeEntry.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version,
          status: { in: ["DRAFT", "SUBMITTED"] }
        },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedByUserId: context.user.id,
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "TIME_ENTRY_APPROVAL_CONFLICT",
          "Time entry cannot be approved in its current state.",
          409
        );
      await audit(tx, context, "TIME_ENTRY_APPROVED", "ProjectTimeEntry", id, {});
      return timeEntryDto(await tx.projectTimeEntry.findUniqueOrThrow({ where: { id } }));
    });
  }

  public async createMileage(context: OrganizationContext, input: MileageInput) {
    await this.authorization.assert(context, "mileage:manage", "MileageLog");
    const distanceMicros = BigInt(input.distanceMicros);
    const reimbursementRateMinor = BigInt(input.reimbursementRateMinor);
    if (distanceMicros <= 0n || reimbursementRateMinor < 0n)
      throw new AppError("MILEAGE_VALUE_INVALID", "Mileage values are invalid.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (input.projectId) await assertProject(tx, context.organizationId, input.projectId);
      const row = await tx.mileageLog.create({
        data: {
          organizationId: context.organizationId,
          projectId: input.projectId ?? null,
          entryDate: parseDate(input.entryDate, "entryDate"),
          purpose: input.purpose,
          distanceMicros,
          vehicleLabel: input.vehicleLabel ?? null,
          reimbursementRateMinor,
          amountMinor: (distanceMicros * reimbursementRateMinor) / 1_000_000n,
          attachmentReference: input.attachmentReference ?? null,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      return mileageDto(row);
    });
  }

  public async createCapture(context: OrganizationContext, input: CaptureInput) {
    await this.authorization.assert(context, "captures:manage", "CaptureReview");
    if (input.scanStatus === "REJECTED")
      throw new AppError("CAPTURE_REJECTED", "Rejected files cannot enter review.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (input.projectId) await assertProject(tx, context.organizationId, input.projectId);
      try {
        const row = await tx.captureReview.create({
          data: {
            organizationId: context.organizationId,
            projectId: input.projectId ?? null,
            kind: input.kind,
            storageKey: input.storageKey,
            checksum: input.checksum,
            mediaType: input.mediaType,
            byteSize: input.byteSize,
            scanStatus: input.scanStatus,
            ocrProvider: input.ocrProvider ?? null,
            ocrVersion: input.ocrVersion ?? null,
            ocrConfidence: input.ocrConfidence ?? null,
            extractedData:
              input.extractedData === null || input.extractedData === undefined
                ? Prisma.JsonNull
                : (input.extractedData as Prisma.InputJsonObject),
            status: input.scanStatus === "CLEAN" ? "REVIEW_REQUIRED" : "RECEIVED",
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "CAPTURE_REVIEW_CREATED", "CaptureReview", row.id, {
          kind: row.kind
        });
        return captureDto(row);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
          throw new AppError(
            "CAPTURE_DUPLICATE",
            "This file has already been captured for the organization.",
            409
          );
        throw error;
      }
    });
  }

  public async uploadCapture(
    context: OrganizationContext,
    input: {
      readonly projectId?: string | null | undefined;
      readonly kind: "RECEIPT" | "BILL";
      readonly fileName: string;
      readonly mediaType: string;
      readonly data: Buffer;
    }
  ) {
    await this.authorization.assert(context, "captures:manage", "CaptureReview");
    if (input.data.length === 0 || input.data.length > 10 * 1024 * 1024)
      throw new AppError(
        "CAPTURE_SIZE_INVALID",
        "Capture files must be between 1 byte and 10 MB.",
        422
      );
    const mediaType = input.mediaType.toLowerCase();
    if (
      !allowedAttachmentMediaTypes.has(mediaType) ||
      !inspectAttachmentBytes(input.data, mediaType)
    )
      throw new AppError(
        "CAPTURE_CONTENT_INVALID",
        "The file type or file contents are not supported.",
        422
      );
    const fileName = normalizeAttachmentFileName(input.fileName);
    this.captureExtraction.validateEnvelope({ mediaType, data: input.data });
    const scanStatus = await this.attachmentScanner.scan(input.data, mediaType);
    if (scanStatus !== "CLEAN")
      throw new AppError(
        "CAPTURE_MALWARE_REJECTED",
        "The captured file failed security scanning.",
        422
      );
    const checksum = createHash("sha256").update(input.data).digest("hex");
    const existing = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.captureReview.findFirst({ where: { organizationId: context.organizationId, checksum } })
    );
    if (existing)
      throw new AppError(
        "CAPTURE_DUPLICATE",
        "This file has already been captured for the organization.",
        409
      );
    const storageKey = `${context.organizationId}/captures/${randomUUID()}-${fileName}`;
    await this.storage.put(storageKey, input.data, mediaType);
    const extraction = await this.captureExtraction.extract({
      kind: input.kind,
      fileName,
      mediaType,
      data: input.data
    });
    return this.createCapture(context, {
      projectId: input.projectId,
      kind: input.kind,
      storageKey,
      checksum,
      mediaType,
      byteSize: input.data.length,
      scanStatus: "CLEAN",
      ocrProvider: extraction.engine.name,
      ocrVersion: extraction.engine.version,
      ocrConfidence: extraction.confidence,
      extractedData: {
        fileName,
        checksum,
        localExtraction: extraction as unknown as Prisma.InputJsonObject
      }
    });
  }

  public async processCapture(context: OrganizationContext, id: string, version?: number) {
    await this.authorization.assert(context, "captures:manage", "CaptureReview", id);
    const current = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.captureReview.findFirst({ where: { id, organizationId: context.organizationId } })
    );
    if (!current) throw new AppError("CAPTURE_NOT_FOUND", "Capture review was not found.", 404);
    if (version !== undefined && current.version !== version) {
      if (captureProcessingState(current.extractedData) !== "CAPTURED") return captureDto(current);
      throw new AppError(
        "STALE_CAPTURE_REVIEW",
        "Capture review was changed by another request.",
        409
      );
    }
    if (current.status === "REJECTED")
      throw new AppError("CAPTURE_REJECTED", "Rejected captures cannot be processed again.", 409);
    let data: Buffer;
    try {
      data = await this.storage.get(current.storageKey);
    } catch {
      throw new AppError(
        "CAPTURE_CONTENT_UNAVAILABLE",
        "The retained source evidence could not be read for processing.",
        422
      );
    }
    const extractedFileName =
      current.extractedData &&
      typeof current.extractedData === "object" &&
      !Array.isArray(current.extractedData)
        ? (current.extractedData as Record<string, unknown>).fileName
        : "capture";
    const extraction = await this.captureExtraction.extract({
      kind: current.kind,
      fileName: typeof extractedFileName === "string" ? extractedFileName : "capture",
      mediaType: current.mediaType,
      data
    });
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const currentData =
        current.extractedData &&
        typeof current.extractedData === "object" &&
        !Array.isArray(current.extractedData)
          ? (current.extractedData as Prisma.InputJsonObject)
          : {};
      const changed = await tx.captureReview.updateMany({
        where: { id, organizationId: context.organizationId, version: current.version },
        data: {
          extractedData: {
            ...currentData,
            localExtraction: extraction as unknown as Prisma.InputJsonObject
          },
          ocrProvider: extraction.engine.name,
          ocrVersion: extraction.engine.version,
          ocrConfidence: extraction.confidence,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_CAPTURE_REVIEW",
          "Capture review was changed by another request.",
          409
        );
      const row = await tx.captureReview.findUniqueOrThrow({
        where: { id },
        include: { conversion: true }
      });
      await audit(tx, context, "CAPTURE_REVIEW_PROCESSED", "CaptureReview", id, {
        processingState: extraction.processingState,
        engine: extraction.engine.name,
        reviewReasons: extraction.reviewReasons
      });
      return captureDto(row);
    });
  }

  public async reviewCapture(
    context: OrganizationContext,
    id: string,
    status: "REVIEW_REQUIRED" | "APPROVED" | "REJECTED",
    reviewNotes: string | null | undefined,
    version?: number
  ) {
    await this.authorization.assert(context, "captures:manage", "CaptureReview", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.captureReview.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { conversion: true }
      });
      if (!current) throw new AppError("CAPTURE_NOT_FOUND", "Capture review was not found.", 404);
      if (current.conversion)
        throw new AppError(
          "CAPTURE_ALREADY_CONVERTED",
          "A converted capture review can no longer be changed.",
          409
        );
      const changed = await tx.captureReview.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          ...(version === undefined ? {} : { version })
        },
        data: {
          status,
          reviewNotes: reviewNotes ?? null,
          reviewedByUserId: context.user.id,
          reviewedAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_CAPTURE_REVIEW",
          "Capture review was changed by another request.",
          409
        );
      const row = await tx.captureReview.findUniqueOrThrow({
        where: { id },
        include: { conversion: true }
      });
      await audit(tx, context, "CAPTURE_REVIEW_UPDATED", "CaptureReview", id, { status });
      return captureDto(row);
    });
  }

  public async getCaptureContent(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "captures:read", "CaptureReview", id);
    const capture = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.captureReview.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { conversion: true }
      })
    );
    if (!capture) throw new AppError("CAPTURE_NOT_FOUND", "Capture review was not found.", 404);
    const extractedFileName =
      capture.extractedData &&
      typeof capture.extractedData === "object" &&
      !Array.isArray(capture.extractedData)
        ? (capture.extractedData as Record<string, unknown>).fileName
        : null;
    const fileName = typeof extractedFileName === "string" ? extractedFileName : "capture";
    return {
      capture: captureDto(capture),
      fileName,
      data: await this.storage.get(capture.storageKey)
    };
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function datesFor(startDate?: string | null, endDate?: string | null) {
  const start = startDate ? parseDate(startDate, "startDate") : null;
  const end = endDate ? parseDate(endDate, "endDate") : null;
  if (start && end && end < start)
    throw new AppError(
      "PROJECT_DATE_INVALID",
      "Project end date cannot precede its start date.",
      422
    );
  return { startDate: start, endDate: end };
}

async function assertProject(
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string
) {
  const project = await tx.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  if (project.status === "ARCHIVED")
    throw new AppError("PROJECT_ARCHIVED", "Archived projects cannot receive new activity.", 409);
  return project;
}

function projectDto(row: {
  id: string;
  customerId: string;
  projectNumber: string;
  name: string;
  status: string;
  billingMethod: string;
  startDate: Date | null;
  endDate: Date | null;
  budgetMinor: bigint | null;
  version: number;
}) {
  return {
    id: row.id,
    customerId: row.customerId,
    projectNumber: row.projectNumber,
    name: row.name,
    status: row.status,
    billingMethod: row.billingMethod,
    startDate: row.startDate ? serializeDate(row.startDate) : null,
    endDate: row.endDate ? serializeDate(row.endDate) : null,
    budgetMinor: row.budgetMinor?.toString() ?? null,
    version: row.version
  };
}

function timeEntryDto(row: {
  id: string;
  projectId: string;
  entryDate: Date;
  durationMicros: bigint;
  rateMinor: bigint;
  amountMinor: bigint;
  status: string;
  billable: boolean;
  description: string | null;
  version: number;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    entryDate: serializeDate(row.entryDate),
    durationMicros: row.durationMicros.toString(),
    rateMinor: row.rateMinor.toString(),
    amountMinor: row.amountMinor.toString(),
    status: row.status,
    billable: row.billable,
    description: row.description,
    version: row.version
  };
}

function mileageDto(row: {
  id: string;
  projectId: string | null;
  entryDate: Date;
  purpose: string;
  distanceMicros: bigint;
  reimbursementRateMinor: bigint;
  amountMinor: bigint;
  status: string;
  version: number;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    entryDate: serializeDate(row.entryDate),
    purpose: row.purpose,
    distanceMicros: row.distanceMicros.toString(),
    reimbursementRateMinor: row.reimbursementRateMinor.toString(),
    amountMinor: row.amountMinor.toString(),
    status: row.status,
    version: row.version
  };
}

function captureDto(row: {
  id: string;
  projectId: string | null;
  kind: string;
  status: string;
  scanStatus: string;
  checksum: string;
  byteSize: number;
  mediaType: string;
  ocrProvider: string | null;
  ocrVersion: string | null;
  ocrConfidence: Prisma.Decimal | null;
  extractedData: Prisma.JsonValue | null;
  reviewNotes: string | null;
  createdAt: Date;
  version: number;
  conversion?:
    | {
        id: string;
        targetType: string;
        billId: string | null;
        immediateExpenseDraftId: string | null;
        captureReviewVersion: number;
        createdAt: Date;
      }
    | null
    | undefined;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    scanStatus: row.scanStatus,
    checksum: row.checksum,
    byteSize: row.byteSize,
    mediaType: row.mediaType,
    ocrProvider: row.ocrProvider,
    ocrVersion: row.ocrVersion,
    ocrConfidence: row.ocrConfidence?.toString() ?? null,
    extractedData: row.extractedData,
    processingState: captureProcessingState(row.extractedData),
    reviewReasons: captureReviewReasons(row.extractedData),
    reviewNotes: row.reviewNotes,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    conversion: row.conversion
      ? {
          id: row.conversion.id,
          targetType: row.conversion.targetType,
          targetId: row.conversion.billId ?? row.conversion.immediateExpenseDraftId,
          billId: row.conversion.billId,
          immediateExpenseDraftId: row.conversion.immediateExpenseDraftId,
          captureReviewVersion: row.conversion.captureReviewVersion,
          createdAt: row.conversion.createdAt.toISOString()
        }
      : null
  };
}

function captureProcessingState(value: Prisma.JsonValue | null): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "CAPTURED";
  const extraction = (value as Record<string, unknown>).localExtraction;
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return "CAPTURED";
  const state = (extraction as Record<string, unknown>).processingState;
  return typeof state === "string" ? state : "CAPTURED";
}

function captureReviewReasons(value: Prisma.JsonValue | null): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const extraction = (value as Record<string, unknown>).localExtraction;
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return [];
  const reasons = (extraction as Record<string, unknown>).reviewReasons;
  return Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
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
