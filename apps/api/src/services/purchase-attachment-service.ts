import { createHash, randomUUID } from "node:crypto";
import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import {
  allowedAttachmentMediaTypes,
  inspectAttachmentBytes,
  normalizeAttachmentFileName,
  type AttachmentScanner,
  type DocumentStorage
} from "./invoice-document-service.js";

type Parent =
  | { readonly type: "bill"; readonly id: string }
  | { readonly type: "vendor-credit"; readonly id: string }
  | { readonly type: "immediate-expense"; readonly id: string };

export class PurchaseAttachmentService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage,
    private readonly scanner: AttachmentScanner
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async add(
    context: OrganizationContext,
    parent: Parent,
    input: { readonly fileName: string; readonly mediaType: string; readonly data: Buffer }
  ) {
    await this.authorization.assert(context, "purchases:attachments", "PurchaseAttachment");
    if (input.data.length === 0 || input.data.length > 10 * 1024 * 1024)
      throw new AppError(
        "PURCHASE_ATTACHMENT_SIZE_INVALID",
        "Attachment size is not supported.",
        422
      );
    const fileName = normalizeAttachmentFileName(input.fileName);
    if (!allowedAttachmentMediaTypes.has(input.mediaType))
      throw new AppError(
        "PURCHASE_ATTACHMENT_TYPE_INVALID",
        "Attachment type is not supported.",
        422
      );
    if (!inspectAttachmentBytes(input.data, input.mediaType))
      throw new AppError(
        "PURCHASE_ATTACHMENT_CONTENT_INVALID",
        "Attachment bytes do not match the declared file type.",
        422
      );
    if ((await this.scanner.scan(input.data, input.mediaType)) !== "CLEAN")
      throw new AppError(
        "PURCHASE_ATTACHMENT_MALWARE_REJECTED",
        "Attachment failed security scanning.",
        422
      );
    await this.assertParent(context, parent);
    const storageKey = `${context.organizationId}/purchases/${parent.type}/${parent.id}/${randomUUID()}-${fileName}`;
    const checksum = createHash("sha256").update(input.data).digest("hex");
    await this.storage.put(storageKey, input.data, input.mediaType);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const attachment = await tx.purchaseAttachment.create({
        data: {
          organizationId: context.organizationId,
          billId: parent.type === "bill" ? parent.id : null,
          vendorCreditId: parent.type === "vendor-credit" ? parent.id : null,
          immediateExpenseId: parent.type === "immediate-expense" ? parent.id : null,
          storageKey,
          fileName,
          mediaType: input.mediaType,
          byteSize: input.data.length,
          checksum,
          scanStatus: "CLEAN",
          createdByUserId: context.user.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PURCHASE_ATTACHMENT_ADDED",
          targetType: "PurchaseAttachment",
          targetId: attachment.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            parentType: parent.type,
            parentId: parent.id,
            checksum,
            byteSize: input.data.length
          })
        }
      });
      return dto(attachment);
    });
  }

  public async list(context: OrganizationContext, parent: Parent) {
    await this.authorization.assert(context, "bills:read", "PurchaseAttachment");
    await this.assertParent(context, parent);
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.purchaseAttachment.findMany({
        where: {
          organizationId: context.organizationId,
          ...(parent.type === "bill" ? { billId: parent.id } : {}),
          ...(parent.type === "vendor-credit" ? { vendorCreditId: parent.id } : {}),
          ...(parent.type === "immediate-expense" ? { immediateExpenseId: parent.id } : {})
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    );
    return rows.map(dto);
  }

  public async read(context: OrganizationContext, attachmentId: string) {
    await this.authorization.assert(context, "bills:read", "PurchaseAttachment", attachmentId);
    const attachment = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.purchaseAttachment.findFirst({
        where: { id: attachmentId, organizationId: context.organizationId, scanStatus: "CLEAN" }
      })
    );
    if (!attachment)
      throw new AppError("PURCHASE_ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
    return { attachment: dto(attachment), data: await this.storage.get(attachment.storageKey) };
  }

  private async assertParent(context: OrganizationContext, parent: Parent) {
    const exists = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (parent.type === "bill")
        return !!(await tx.bill.findFirst({
          where: { id: parent.id, organizationId: context.organizationId }
        }));
      if (parent.type === "vendor-credit")
        return !!(await tx.vendorCredit.findFirst({
          where: { id: parent.id, organizationId: context.organizationId }
        }));
      return !!(await tx.immediateExpense.findFirst({
        where: { id: parent.id, organizationId: context.organizationId }
      }));
    });
    if (!exists)
      throw new AppError("PURCHASE_DOCUMENT_NOT_FOUND", "Purchase document was not found.", 404);
  }
}

function dto(row: {
  id: string;
  billId: string | null;
  vendorCreditId: string | null;
  immediateExpenseId: string | null;
  fileName: string;
  mediaType: string;
  byteSize: number;
  checksum: string;
  scanStatus: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    billId: row.billId,
    vendorCreditId: row.vendorCreditId,
    immediateExpenseId: row.immediateExpenseId,
    fileName: row.fileName,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    checksum: row.checksum,
    scanStatus: row.scanStatus,
    createdAt: row.createdAt.toISOString(),
    downloadUrl: `/v1/purchase-attachments/${row.id}`
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
