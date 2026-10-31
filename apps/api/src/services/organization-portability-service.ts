import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, RuntimePrisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import type { DocumentStorage } from "./invoice-render-service.js";

const exportLifetimeMs = 24 * 60 * 60 * 1000;
const retentionDays = 30;
const currentExportSchemaVersion = 3;

export class OrganizationPortabilityService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async requestExport(
    context: OrganizationContext,
    includeAttachments: boolean
  ): Promise<{ job: ReturnType<typeof exportJobDto>; downloadToken: string }> {
    await this.authorization.assert(context, "organization-exports:create", "OrganizationExport");
    const downloadToken = randomBytes(32).toString("base64url");
    const job = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.organizationExportJob.create({
        data: {
          organizationId: context.organizationId,
          includeAttachments,
          schemaVersion: currentExportSchemaVersion,
          downloadTokenHash: hash(downloadToken),
          expiresAt: new Date(Date.now() + exportLifetimeMs),
          requestedByUserId: context.user.id
        }
      });
      await audit(tx, context, "ORGANIZATION_EXPORT_REQUESTED", "OrganizationExportJob", row.id, {
        includeAttachments
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "organization.export.requested",
          aggregateType: "OrganizationExportJob",
          aggregateId: row.id,
          payload: { exportJobId: row.id }
        }
      });
      return row;
    });
    return { job: exportJobDto(job), downloadToken };
  }

  public async processExport(context: OrganizationContext, jobId: string) {
    const job = await this.exportJob(context, jobId);
    if (job.status === "READY") return exportJobDto(job);
    if (job.status !== "PENDING")
      throw new AppError("EXPORT_NOT_PROCESSABLE", "Export job is not pending.", 409);
    const claimed = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.organizationExportJob.updateMany({
        where: {
          id: job.id,
          organizationId: context.organizationId,
          status: "PENDING"
        },
        data: { status: "PROCESSING", startedAt: new Date() }
      })
    );
    if (claimed.count !== 1) {
      const current = await this.exportJob(context, jobId);
      if (current.status === "READY") return exportJobDto(current);
      throw new AppError("EXPORT_ALREADY_PROCESSING", "Export job is already processing.", 409);
    }
    try {
      const archive = await this.buildArchive(context, job.includeAttachments);
      const data = Buffer.from(JSON.stringify(archive), "utf8");
      const checksum = hash(data);
      const storageKey = `exports/${context.organizationId}/${job.id}/clearledger-export-v3.json`;
      await this.storage.put(storageKey, data, "application/json");
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const updated = await tx.organizationExportJob.update({
          where: { id: job.id },
          data: {
            status: "READY",
            storageKey,
            checksum,
            byteSize: data.length,
            completedAt: new Date()
          }
        });
        await audit(tx, context, "ORGANIZATION_EXPORT_READY", "OrganizationExportJob", job.id, {
          checksum,
          byteSize: data.length,
          fileCount: archive.manifest.files.length
        });
        await tx.outboxEvent.updateMany({
          where: {
            organizationId: context.organizationId,
            eventType: "organization.export.requested",
            aggregateType: "OrganizationExportJob",
            aggregateId: job.id,
            status: "PENDING"
          },
          data: {
            status: "DISPATCHED",
            attempts: { increment: 1 },
            dispatchedAt: new Date()
          }
        });
        return exportJobDto(updated);
      });
    } catch (error) {
      await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const failed = await tx.organizationExportJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Export failed."
          }
        });
        await tx.outboxEvent.updateMany({
          where: {
            organizationId: context.organizationId,
            eventType: "organization.export.requested",
            aggregateType: "OrganizationExportJob",
            aggregateId: job.id,
            status: "PENDING"
          },
          data: { status: "FAILED", attempts: { increment: 1 } }
        });
        return failed;
      });
      throw error;
    }
  }

  public async exportStatus(context: OrganizationContext, jobId: string) {
    await this.authorization.assert(context, "organization-exports:create", "OrganizationExport");
    const job = await this.exportJob(context, jobId);
    if (job.status === "READY" && job.expiresAt <= new Date()) {
      const expired = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.organizationExportJob.update({
          where: { id: job.id },
          data: { status: "EXPIRED" }
        })
      );
      return exportJobDto(expired);
    }
    return exportJobDto(job);
  }

  public async download(context: OrganizationContext, jobId: string, token: string) {
    await this.authorization.assert(
      context,
      "organization-exports:download",
      "OrganizationExport",
      jobId
    );
    const job = await this.exportJob(context, jobId);
    if (job.status !== "READY" || !job.storageKey || !job.checksum)
      throw new AppError("EXPORT_NOT_READY", "Export is not ready.", 409);
    if (job.expiresAt <= new Date())
      throw new AppError("EXPORT_EXPIRED", "Export download has expired.", 410);
    if (!secureEqual(job.downloadTokenHash, hash(token)))
      throw new AppError("EXPORT_TOKEN_INVALID", "Export download token is invalid.", 403);
    const data = await this.storage.get(job.storageKey);
    if (hash(data) !== job.checksum)
      throw new AppError("EXPORT_INTEGRITY_FAILED", "Export archive integrity check failed.", 500);
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      audit(tx, context, "ORGANIZATION_EXPORT_DOWNLOADED", "OrganizationExportJob", job.id, {
        checksum: job.checksum,
        byteSize: data.length
      })
    );
    return {
      data,
      checksum: job.checksum,
      fileName: `clearledger-${context.organizationId}-export-v3.json`
    };
  }

  public async requestClosure(
    context: OrganizationContext,
    input: { reason: string; exportJobId?: string | undefined; legalHold: boolean }
  ) {
    await this.authorization.assert(context, "organizations:close", "Organization");
    if (input.exportJobId) await this.exportJob(context, input.exportJobId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const request = await tx.organizationClosureRequest.create({
        data: {
          organizationId: context.organizationId,
          reason: input.reason,
          exportJobId: input.exportJobId ?? null,
          legalHold: input.legalHold,
          status: input.legalHold
            ? "LEGAL_HOLD"
            : input.exportJobId
              ? "REQUESTED"
              : "EXPORT_PENDING",
          requestedByUserId: context.user.id
        }
      });
      await audit(
        tx,
        context,
        "ORGANIZATION_CLOSURE_REQUESTED",
        "OrganizationClosureRequest",
        request.id,
        {
          exportJobId: request.exportJobId,
          legalHold: request.legalHold,
          reason: request.reason
        }
      );
      return closureDto(request);
    });
  }

  public async finalizeClosure(context: OrganizationContext, requestId: string) {
    await this.authorization.assert(
      context,
      "organizations:close",
      "OrganizationClosureRequest",
      requestId
    );
    const preflight = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.organizationClosureRequest.findFirst({
        where: { id: requestId, organizationId: context.organizationId },
        include: { exportJob: true }
      })
    );
    if (!preflight)
      throw new AppError("CLOSURE_REQUEST_NOT_FOUND", "Closure request was not found.", 404);
    if (preflight.status === "RETENTION_SCHEDULED") return closureDto(preflight);
    if (preflight.legalHold || preflight.status === "LEGAL_HOLD")
      throw new AppError(
        "ORGANIZATION_LEGAL_HOLD",
        "Legal hold prevents deletion scheduling.",
        409
      );
    assertReadyFullExport(preflight.exportJob);
    await this.assertStoredFullExport(context, preflight.exportJob!);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "OrganizationClosureRequest"
         WHERE id = ${requestId}::uuid
           AND "organizationId" = ${context.organizationId}::uuid
         FOR UPDATE
      `;
      const request = await tx.organizationClosureRequest.findFirst({
        where: { id: requestId, organizationId: context.organizationId },
        include: { exportJob: true }
      });
      if (!request)
        throw new AppError("CLOSURE_REQUEST_NOT_FOUND", "Closure request was not found.", 404);
      if (request.status === "RETENTION_SCHEDULED") return closureDto(request);
      if (request.legalHold || request.status === "LEGAL_HOLD")
        throw new AppError(
          "ORGANIZATION_LEGAL_HOLD",
          "Legal hold prevents deletion scheduling.",
          409
        );
      assertReadyFullExport(request.exportJob);
      const retentionUntil = new Date(Date.now() + retentionDays * 86_400_000);
      const updated = await tx.organizationClosureRequest.update({
        where: { id: request.id },
        data: {
          status: "RETENTION_SCHEDULED",
          retentionUntil,
          scheduledDeletionAt: retentionUntil
        }
      });
      const revokedSessions = await tx.$queryRaw<readonly { revoked: number }[]>`
        SELECT phase12_revoke_organization_sessions(
          ${context.organizationId}::uuid
        ) AS revoked
      `;
      await tx.paymentAccount.updateMany({
        where: { organizationId: context.organizationId, status: { not: "DISCONNECTED" } },
        data: {
          status: "DISCONNECTED",
          chargesEnabled: false,
          payoutsEnabled: false,
          disconnectedAt: new Date(),
          updatedByUserId: context.user.id
        }
      });
      await audit(
        tx,
        context,
        "ORGANIZATION_RETENTION_SCHEDULED",
        "OrganizationClosureRequest",
        request.id,
        {
          retentionUntil: retentionUntil.toISOString(),
          exportJobId: request.exportJob!.id,
          revokedSessions: revokedSessions[0]?.revoked ?? 0,
          hardDeletePerformed: false
        }
      );
      return closureDto(updated);
    });
  }

  private async assertStoredFullExport(
    context: OrganizationContext,
    job: {
      storageKey: string | null;
      checksum: string | null;
      schemaVersion: number;
    }
  ): Promise<void> {
    if (!job.storageKey || !job.checksum)
      throw new AppError(
        "CLOSURE_EXPORT_REQUIRED",
        "A current complete export with attachments is required before closure.",
        409
      );
    let data: Buffer;
    try {
      data = await this.storage.get(job.storageKey);
    } catch {
      throw new AppError(
        "CLOSURE_EXPORT_UNAVAILABLE",
        "The closure export cannot be read. Create and download a new full export before closure.",
        409
      );
    }
    if (hash(data) !== job.checksum)
      throw new AppError(
        "CLOSURE_EXPORT_INTEGRITY_FAILED",
        "The closure export failed its integrity check. Create and download a new full export.",
        409
      );
    let archive: unknown;
    try {
      archive = JSON.parse(data.toString("utf8"));
    } catch {
      throw new AppError(
        "CLOSURE_EXPORT_INTEGRITY_FAILED",
        "The closure export is not valid portable JSON. Create and download a new full export.",
        409
      );
    }
    if (!isCompleteArchive(archive, context.organizationId, job.schemaVersion))
      throw new AppError(
        "CLOSURE_EXPORT_INCOMPLETE",
        "The closure export is incomplete or from an older format. Create and download a new full export.",
        409
      );
  }

  private async exportJob(context: OrganizationContext, jobId: string) {
    const job = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.organizationExportJob.findFirst({
        where: { id: jobId, organizationId: context.organizationId }
      })
    );
    if (!job) throw new AppError("EXPORT_JOB_NOT_FOUND", "Export job was not found.", 404);
    return job;
  }

  private async buildArchive(context: OrganizationContext, includeAttachments: boolean) {
    if (schemaDrivenExportEnabled())
      return this.buildSchemaDrivenArchive(context, includeAttachments);

    const data = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [
        organization,
        memberships,
        accounts,
        periods,
        journals,
        customers,
        vendors,
        products,
        invoices,
        creditNotes,
        payments,
        paymentAccounts,
        bills,
        billPayments,
        vendorCredits,
        bankAccounts,
        bankImports,
        bankTransactions,
        bankMatches,
        bankCategorizations,
        bankReconciliations,
        inventoryLocations,
        inventoryBalances,
        inventoryMovements,
        taxCodes,
        taxRegistrations,
        auditEvents,
        invoiceAttachments,
        purchaseAttachments,
        template,
        importBatches
      ] = await Promise.all([
        tx.organization.findUniqueOrThrow({
          where: { id: context.organizationId },
          include: { settings: true, businessDefaults: true }
        }),
        tx.membership.findMany({
          where: { organizationId: context.organizationId },
          include: { user: { select: { email: true, displayName: true, status: true } } }
        }),
        tx.account.findMany({ where: { organizationId: context.organizationId } }),
        tx.fiscalPeriod.findMany({
          where: { organizationId: context.organizationId },
          include: { closeRecords: true }
        }),
        tx.journal.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true }
        }),
        tx.customer.findMany({ where: { organizationId: context.organizationId } }),
        tx.vendor.findMany({ where: { organizationId: context.organizationId } }),
        tx.productItem.findMany({ where: { organizationId: context.organizationId } }),
        tx.invoice.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true, paymentAllocations: true }
        }),
        tx.creditNote.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true }
        }),
        tx.payment.findMany({
          where: { organizationId: context.organizationId },
          include: { allocations: true, refunds: true, disputes: true, receipt: true }
        }),
        tx.paymentAccount.findMany({
          where: { organizationId: context.organizationId },
          select: {
            id: true,
            provider: true,
            status: true,
            chargesEnabled: true,
            payoutsEnabled: true,
            connectedAt: true,
            disconnectedAt: true,
            createdAt: true,
            updatedAt: true
          }
        }),
        tx.bill.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true }
        }),
        tx.billPayment.findMany({
          where: { organizationId: context.organizationId },
          include: { allocations: true }
        }),
        tx.vendorCredit.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true, applications: true }
        }),
        tx.bankAccount.findMany({ where: { organizationId: context.organizationId } }),
        tx.bankImportBatch.findMany({ where: { organizationId: context.organizationId } }),
        tx.bankImportedTransaction.findMany({
          where: { organizationId: context.organizationId }
        }),
        tx.bankTransactionMatch.findMany({ where: { organizationId: context.organizationId } }),
        tx.bankCategorization.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true }
        }),
        tx.bankReconciliation.findMany({
          where: { organizationId: context.organizationId },
          include: { items: true, snapshots: true }
        }),
        tx.inventoryLocation.findMany({ where: { organizationId: context.organizationId } }),
        tx.inventoryBalance.findMany({ where: { organizationId: context.organizationId } }),
        tx.inventoryMovement.findMany({ where: { organizationId: context.organizationId } }),
        tx.taxCode.findMany({
          where: { organizationId: context.organizationId },
          include: { versions: { include: { components: true } } }
        }),
        tx.taxRegistration.findMany({ where: { organizationId: context.organizationId } }),
        tx.auditEvent.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { createdAt: "asc" }
        }),
        tx.invoiceAttachment.findMany({ where: { organizationId: context.organizationId } }),
        tx.purchaseAttachment.findMany({ where: { organizationId: context.organizationId } }),
        tx.invoiceTemplateConfig.findUnique({ where: { organizationId: context.organizationId } }),
        tx.dataImportBatch.findMany({
          where: { organizationId: context.organizationId },
          include: { rows: true }
        })
      ]);
      const [
        paymentSettings,
        invoicePdfArtifacts,
        invoiceDeliveries,
        publicInvoiceLinks,
        immediateExpenses,
        bankRules,
        bankTransfers,
        logoAssets,
        manualJournalDrafts,
        reviewItemDismissals,
        historicalImportRecords,
        authenticationAuditEvents,
        organizationCurrencies,
        fxPolicies,
        fxRateSnapshots,
        fxRevaluationRuns,
        monetaryPositions
      ] = await Promise.all([
        tx.paymentSettings.findUnique({ where: { organizationId: context.organizationId } }),
        tx.invoicePdfArtifact.findMany({ where: { organizationId: context.organizationId } }),
        tx.invoiceDelivery.findMany({
          where: { organizationId: context.organizationId },
          include: { events: true }
        }),
        tx.publicInvoiceLink.findMany({ where: { organizationId: context.organizationId } }),
        tx.immediateExpense.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true }
        }),
        tx.bankRule.findMany({ where: { organizationId: context.organizationId } }),
        tx.bankTransfer.findMany({ where: { organizationId: context.organizationId } }),
        tx.logoAsset.findMany({ where: { organizationId: context.organizationId } }),
        tx.manualJournalDraft.findMany({
          where: { organizationId: context.organizationId },
          include: { lines: true }
        }),
        tx.reviewItemDismissal.findMany({ where: { organizationId: context.organizationId } }),
        tx.historicalImportRecord.findMany({ where: { organizationId: context.organizationId } }),
        tx.authenticationAuditEvent.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { createdAt: "asc" }
        }),
        tx.organizationCurrency.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { currencyCode: "asc" }
        }),
        tx.fxPolicy.findMany({ where: { organizationId: context.organizationId } }),
        tx.fxRateSnapshot.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }]
        }),
        tx.fxRevaluationRun.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ valuationDate: "asc" }, { createdAt: "asc" }]
        }),
        tx.monetaryPosition.findMany({
          where: { organizationId: context.organizationId },
          include: { events: { orderBy: { sequence: "asc" } } },
          orderBy: [{ asOfDate: "asc" }, { id: "asc" }]
        })
      ]);
      const attachmentSources: AttachmentManifestEntry[] = [
        ...invoiceAttachments.map((attachment) => ({
          ...attachment,
          entryId: attachment.id,
          sourceType: "Invoice",
          sourceId: attachment.invoiceId
        })),
        ...purchaseAttachments.map((attachment) => ({
          ...attachment,
          entryId: attachment.id,
          sourceType: attachment.billId
            ? "Bill"
            : attachment.vendorCreditId
              ? "VendorCredit"
              : "ImmediateExpense",
          sourceId: attachment.billId ?? attachment.vendorCreditId ?? attachment.immediateExpenseId!
        })),
        ...invoicePdfArtifacts.map((artifact) => ({
          entryId: artifact.id,
          sourceType: "InvoicePdf",
          sourceId: artifact.invoiceId,
          storageKey: artifact.storageKey,
          fileName: `invoice-${artifact.invoiceId}.pdf`,
          mediaType: artifact.mediaType,
          byteSize: artifact.byteSize,
          checksum: artifact.checksum,
          scanStatus: "CLEAN"
        })),
        ...logoAssets.map((logo) => ({
          entryId: logo.id,
          sourceType: "BrandLogo",
          sourceId: context.organizationId,
          storageKey: logo.storageKey,
          fileName: `logo-${logo.id}${extensionForMediaType(logo.mediaType)}`,
          mediaType: logo.mediaType,
          byteSize: logo.byteSize,
          checksum: logo.checksum,
          scanStatus: logo.scanStatus
        }))
      ];
      return {
        organization: redact(organization),
        memberships,
        accounts,
        fiscalPeriods: periods,
        journals,
        customers,
        vendors: vendors.map((vendor) => redact(vendor)),
        products,
        invoices,
        creditNotes,
        payments: payments.map((payment) => redact(payment)),
        paymentAccounts,
        paymentSettings,
        invoicePdfArtifacts: invoicePdfArtifacts.map((artifact) =>
          redact(withoutStorageKey(artifact))
        ),
        invoiceDeliveries: invoiceDeliveries.map((delivery) => redact(delivery)),
        publicInvoiceLinks: publicInvoiceLinks.map(withoutTokenHash),
        bills,
        billPayments,
        vendorCredits,
        immediateExpenses,
        bankAccounts: bankAccounts.map((account) => redact(account)),
        bankImports: bankImports.map((batch) => redact(batch)),
        bankTransactions,
        bankMatches,
        bankCategorizations,
        bankRules,
        bankTransfers,
        bankReconciliations,
        inventoryLocations,
        inventoryBalances,
        inventoryMovements,
        taxCodes,
        taxRegistrations: taxRegistrations.map((registration) => redact(registration)),
        auditEvents: auditEvents.map((event) => ({ ...event, metadata: redact(event.metadata) })),
        authenticationAuditEvents: authenticationAuditEvents.map((event) => redact(event)),
        attachmentManifest: attachmentSources.map(safeAttachmentManifestEntry),
        logoAssets: logoAssets.map((logo) => redact(withoutStorageKey(logo))),
        templateAndBranding: template,
        manualJournalDrafts,
        reviewItemDismissals,
        importBatches: importBatches.map((batch) => withoutStorageKey(batch)),
        historicalImportRecords,
        organizationCurrencies,
        fxPolicies,
        fxRateSnapshots,
        fxRevaluationRuns,
        monetaryPositions,
        attachmentSources
      };
    });
    const { attachmentSources, ...portableData } = data;
    const files: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(portableData))
      files[`data/${name}.json`] = serializable(value);
    const attachmentResults = includeAttachments
      ? await this.exportAttachments(attachmentSources)
      : [];
    for (const result of attachmentResults)
      if (result.dataBase64)
        files[result.path] = { mediaType: result.mediaType, dataBase64: result.dataBase64 };
    const descriptors = Object.entries(files).map(([path, value]) => {
      const bytes = Buffer.from(JSON.stringify(value), "utf8");
      return {
        path,
        mediaType: path.startsWith("attachments/")
          ? "application/octet-stream+base64"
          : "application/json",
        byteSize: bytes.length,
        sha256: hash(bytes),
        recordCount: Array.isArray(value) ? value.length : 1
      };
    });
    return {
      manifest: {
        schemaVersion: 2,
        product: "PennyWise Accounting",
        format: "clearledger-portable-json-archive",
        generatedAt: new Date().toISOString(),
        organizationId: context.organizationId,
        files: descriptors,
        attachmentResults: attachmentResults.map((result) => ({
          path: result.path,
          status: result.status,
          reason: result.reason,
          mediaType: result.mediaType
        })),
        exclusions: [
          "passwords",
          "session and invitation tokens",
          "OIDC identities and provider tokens",
          "payment provider ciphertext and lookup hashes",
          "full bank credentials and payment card details"
        ]
      },
      files
    };
  }

  private async buildSchemaDrivenArchive(
    context: OrganizationContext,
    includeAttachments: boolean
  ) {
    const snapshot = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [
        organization,
        memberships,
        tableExports,
        invoiceAttachments,
        purchaseAttachments,
        invoicePdfArtifacts,
        logoAssets
      ] = await Promise.all([
        tx.organization.findUniqueOrThrow({ where: { id: context.organizationId } }),
        tx.membership.findMany({
          where: { organizationId: context.organizationId },
          include: { user: { select: { email: true, displayName: true, status: true } } },
          orderBy: { id: "asc" }
        }),
        loadPortableOrganizationTables(tx, context.organizationId),
        tx.invoiceAttachment.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { id: "asc" }
        }),
        tx.purchaseAttachment.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { id: "asc" }
        }),
        tx.invoicePdfArtifact.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { id: "asc" }
        }),
        tx.logoAsset.findMany({
          where: { organizationId: context.organizationId },
          orderBy: { id: "asc" }
        })
      ]);
      const attachmentSources: AttachmentManifestEntry[] = [
        ...invoiceAttachments.map((attachment) => ({
          entryId: attachment.id,
          sourceType: "Invoice",
          sourceId: attachment.invoiceId,
          storageKey: attachment.storageKey,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
          byteSize: attachment.byteSize,
          checksum: attachment.checksum,
          scanStatus: attachment.scanStatus
        })),
        ...purchaseAttachments.map((attachment) => ({
          entryId: attachment.id,
          sourceType: attachment.billId
            ? "Bill"
            : attachment.vendorCreditId
              ? "VendorCredit"
              : "ImmediateExpense",
          sourceId:
            attachment.billId ?? attachment.vendorCreditId ?? attachment.immediateExpenseId!,
          storageKey: attachment.storageKey,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
          byteSize: attachment.byteSize,
          checksum: attachment.checksum,
          scanStatus: attachment.scanStatus
        })),
        ...invoicePdfArtifacts.map((artifact) => ({
          entryId: artifact.id,
          sourceType: "InvoicePdf",
          sourceId: artifact.invoiceId,
          storageKey: artifact.storageKey,
          fileName: `invoice-${artifact.invoiceId}.pdf`,
          mediaType: artifact.mediaType,
          byteSize: artifact.byteSize,
          checksum: artifact.checksum,
          scanStatus: "CLEAN"
        })),
        ...logoAssets.map((logo) => ({
          entryId: logo.id,
          sourceType: "BrandLogo",
          sourceId: context.organizationId,
          storageKey: logo.storageKey,
          fileName: `logo-${logo.id}${extensionForMediaType(logo.mediaType)}`,
          mediaType: logo.mediaType,
          byteSize: logo.byteSize,
          checksum: logo.checksum,
          scanStatus: logo.scanStatus
        }))
      ];
      return {
        organization: sanitizePortableValue(organization),
        memberships: sanitizePortableValue(memberships),
        tableExports,
        attachmentSources
      };
    });

    const files: Record<string, unknown> = {
      "data/organization.json": canonicalPortableValue(snapshot.organization),
      "data/memberships.json": canonicalPortableValue(snapshot.memberships)
    };
    for (const table of snapshot.tableExports)
      files[table.path] = canonicalPortableValue(table.rows);

    const attachmentManifest = snapshot.attachmentSources.map(safeAttachmentManifestEntry);
    files["data/attachment-manifest.json"] = canonicalPortableValue(attachmentManifest);
    const attachmentResults = includeAttachments
      ? await this.exportAttachments(snapshot.attachmentSources)
      : [];
    const failedAttachmentCount = attachmentResults.filter(
      (result) => result.status === "FAILED"
    ).length;
    if (failedAttachmentCount > 0)
      throw new AppError(
        "EXPORT_ATTACHMENT_INTEGRITY_FAILED",
        `${String(failedAttachmentCount)} requested attachment(s) were missing or failed checksum verification.`,
        409
      );
    for (const result of attachmentResults)
      if (result.dataBase64)
        files[result.path] = canonicalPortableValue({
          mediaType: result.mediaType,
          dataBase64: result.dataBase64
        });

    const descriptors = Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, value]) => {
        const bytes = Buffer.from(JSON.stringify(value), "utf8");
        return {
          path,
          mediaType: path.startsWith("attachments/")
            ? "application/octet-stream+base64"
            : "application/json",
          byteSize: bytes.length,
          sha256: hash(bytes),
          recordCount: Array.isArray(value) ? value.length : 1
        };
      });
    const tableCoverage = snapshot.tableExports.map((table) => ({
      table: table.table,
      path: table.path,
      recordCount: table.rows.length,
      includedColumns: table.includedColumns,
      excludedSensitiveColumns: table.excludedColumns
    }));
    const manifest = {
      schemaVersion: currentExportSchemaVersion,
      product: "PennyWise Accounting",
      format: "clearledger-portable-json-archive",
      generatedAt: new Date().toISOString(),
      organizationId: context.organizationId,
      exportScope: "ALL_PORTABLE_ORGANIZATION_MODELS_IN_CURRENT_PRISMA_SCHEMA",
      restoreSupport: "EXTERNAL_READABLE_NO_IN_PRODUCT_FULL_RESTORE",
      files: descriptors,
      tableCoverage,
      totals: {
        tenantTableCount: tableCoverage.length,
        tenantTableRecordCount: tableCoverage.reduce(
          (total, table) => total + table.recordCount,
          0
        ),
        attachmentManifestCount: attachmentManifest.length,
        includedAttachmentCount: attachmentResults.filter((result) => result.status === "INCLUDED")
          .length,
        excludedAttachmentCount: attachmentResults.filter((result) => result.status === "EXCLUDED")
          .length,
        failedAttachmentCount
      },
      completeness: {
        status: "COMPLETE",
        attachmentsRequested: includeAttachments,
        allPortableOrganizationModelsIncluded: true,
        missingOrCorruptAttachmentCount: failedAttachmentCount
      },
      attachmentResults: attachmentResults.map((result) => ({
        path: result.path,
        status: result.status,
        reason: result.reason,
        mediaType: result.mediaType
      })),
      exclusions: [
        "global user identities and sessions",
        "internal authentication and access locator records",
        "passwords and authentication challenges",
        "session, invitation, public-link, API, OAuth, webhook, and lease token material",
        "provider credential ciphertext and lookup hashes",
        "encrypted payroll government identifiers and bank-account ciphertext",
        "internal object-storage keys",
        "quarantined attachment content"
      ]
    };
    return { manifest, files };
  }

  private async exportAttachments(entries: readonly AttachmentManifestEntry[]) {
    const results = [];
    for (const entry of entries) {
      const path = `attachments/${safeSegment(entry.sourceType)}/${safeSegment(entry.sourceId)}/${safeSegment(entry.entryId)}-${safeSegment(entry.fileName)}`;
      if (entry.scanStatus !== "CLEAN") {
        results.push({
          path,
          status: "EXCLUDED",
          reason: "Attachment is not clean.",
          mediaType: entry.mediaType
        });
        continue;
      }
      try {
        const data = await this.storage.get(entry.storageKey);
        results.push({
          path,
          status: hash(data) === entry.checksum ? "INCLUDED" : "FAILED",
          reason: hash(data) === entry.checksum ? null : "Checksum mismatch.",
          mediaType: entry.mediaType,
          ...(hash(data) === entry.checksum ? { dataBase64: data.toString("base64") } : {})
        });
      } catch {
        results.push({
          path,
          status: "FAILED",
          reason: "Stored attachment is missing.",
          mediaType: entry.mediaType
        });
      }
    }
    return results;
  }
}

interface AttachmentManifestEntry {
  readonly entryId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly scanStatus: string;
  readonly byteSize: number;
}

function safeAttachmentManifestEntry(entry: AttachmentManifestEntry) {
  return {
    entryId: entry.entryId,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    fileName: safeSegment(entry.fileName),
    mediaType: entry.mediaType,
    byteSize: entry.byteSize,
    checksum: entry.checksum,
    scanStatus: entry.scanStatus
  };
}

interface PortableTableCatalogRow {
  readonly tableName: string;
  readonly columns: readonly string[];
}

interface PortableTableExport {
  readonly table: string;
  readonly path: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly includedColumns: readonly string[];
  readonly excludedColumns: readonly string[];
}

const sensitivePortableColumn =
  /(password|secret|token|authorization|api[_-]?key|credential|private[_-]?key|ciphertext|lookuphash|creationkeyhash|codehash|storagekey)/i;
const portableUrlColumn = /(url|uri|endpoint)s?$/i;
const nonPortableSecurityTables = new Set([
  "InvitationTokenLocator",
  "MembershipAccessLocator",
  "OrganizationBootstrapGrant"
]);

function schemaDrivenExportEnabled(): boolean {
  return currentExportSchemaVersion >= Number.parseInt("3", 10);
}

async function loadPortableOrganizationTables(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<readonly PortableTableExport[]> {
  const catalog = await tx.$queryRaw<readonly PortableTableCatalogRow[]>`
    SELECT columns.table_name::text AS "tableName",
           array_agg(columns.column_name::text ORDER BY columns.ordinal_position) AS columns
      FROM information_schema.columns AS columns
      JOIN information_schema.tables AS tables
        ON tables.table_schema = columns.table_schema
       AND tables.table_name = columns.table_name
     WHERE columns.table_schema = 'public'
       AND tables.table_type = 'BASE TABLE'
       AND EXISTS (
         SELECT 1
           FROM information_schema.columns AS tenant_column
          WHERE tenant_column.table_schema = columns.table_schema
            AND tenant_column.table_name = columns.table_name
            AND tenant_column.column_name = 'organizationId'
       )
     GROUP BY columns.table_name
     ORDER BY columns.table_name
  `;
  const exports: PortableTableExport[] = [];
  for (const table of catalog) {
    assertSafeDatabaseIdentifier(table.tableName);
    if (nonPortableSecurityTables.has(table.tableName)) continue;
    const includedColumns = table.columns.filter((column) => !sensitivePortableColumn.test(column));
    const excludedColumns = table.columns.filter((column) => sensitivePortableColumn.test(column));
    if (!includedColumns.includes("organizationId"))
      throw new Error(`Portable table ${table.tableName} lost its tenant key.`);
    for (const column of includedColumns) assertSafeDatabaseIdentifier(column);
    const rows = await tx.$queryRaw<readonly Record<string, unknown>[]>(RuntimePrisma.sql`
      SELECT ${RuntimePrisma.join(includedColumns.map((column) => RuntimePrisma.raw(quoteIdentifier(column))))}
        FROM ${RuntimePrisma.raw(`${quoteIdentifier("public")}.${quoteIdentifier(table.tableName)}`)}
       WHERE "organizationId" = ${organizationId}::uuid
    `);
    const portableRows = rows
      .map((row) => sanitizePortableValue(row))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    exports.push({
      table: table.tableName,
      path: `data/tables/${safeSegment(table.tableName)}.json`,
      rows: portableRows,
      includedColumns: [...includedColumns],
      excludedColumns: [...excludedColumns]
    });
  }
  return exports;
}

function assertSafeDatabaseIdentifier(identifier: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier))
    throw new Error("Portable export discovered an unsafe database identifier.");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sanitizePortableValue<T>(value: T, parentKey?: string): T {
  if (typeof value === "bigint") return value.toString() as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (typeof value === "string" && parentKey && portableUrlColumn.test(parentKey))
    return sanitizePortableUrl(value) as T;
  if (Array.isArray(value)) {
    const entries: readonly unknown[] = value;
    return entries.map((entry) => sanitizePortableValue(entry, parentKey)) as T;
  }
  if (!value || typeof value !== "object") return value;
  if (
    value.constructor.name === "Decimal" &&
    "toString" in value &&
    typeof value.toString === "function"
  )
    return value.toString() as T;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitivePortableColumn.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sanitizePortableValue(entry, key)])
  ) as T;
}

function canonicalPortableValue(value: unknown): unknown {
  return sanitizePortableValue(value);
}

function sanitizePortableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[REDACTED_INVALID_URL]";
  }
}

function assertReadyFullExport(
  job: {
    status: string;
    includeAttachments: boolean;
    schemaVersion: number;
    expiresAt: Date;
    storageKey: string | null;
    checksum: string | null;
  } | null
): void {
  if (
    !job ||
    job.status !== "READY" ||
    !job.includeAttachments ||
    job.schemaVersion !== currentExportSchemaVersion ||
    job.expiresAt <= new Date() ||
    !job.storageKey ||
    !job.checksum
  )
    throw new AppError(
      "CLOSURE_EXPORT_REQUIRED",
      "A current complete export with attachments is required before closure.",
      409
    );
}

function isCompleteArchive(value: unknown, organizationId: string, schemaVersion: number): boolean {
  if (!value || typeof value !== "object") return false;
  const manifest = (value as { manifest?: unknown }).manifest;
  if (!manifest || typeof manifest !== "object") return false;
  const candidate = manifest as {
    schemaVersion?: unknown;
    organizationId?: unknown;
    format?: unknown;
    tableCoverage?: unknown;
    completeness?: {
      status?: unknown;
      attachmentsRequested?: unknown;
      allPortableOrganizationModelsIncluded?: unknown;
      missingOrCorruptAttachmentCount?: unknown;
    };
  };
  return (
    candidate.schemaVersion === schemaVersion &&
    schemaVersion === currentExportSchemaVersion &&
    candidate.organizationId === organizationId &&
    candidate.format === "clearledger-portable-json-archive" &&
    Array.isArray(candidate.tableCoverage) &&
    candidate.tableCoverage.length > 0 &&
    candidate.completeness?.status === "COMPLETE" &&
    candidate.completeness.attachmentsRequested === true &&
    candidate.completeness.allPortableOrganizationModelsIncluded === true &&
    candidate.completeness.missingOrCorruptAttachmentCount === 0
  );
}

function withoutStorageKey<T extends { storageKey: string }>(value: T): Omit<T, "storageKey"> {
  const { storageKey, ...safe } = value;
  void storageKey;
  return safe;
}

function withoutTokenHash<T extends { tokenHash: string }>(value: T): Omit<T, "tokenHash"> {
  const { tokenHash, ...safe } = value;
  void tokenHash;
  return safe;
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";
  return ".bin";
}

function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /(password|token|secret|ciphertext|lookuphash|businessidentifier|registrationnumber|accountnumber|rawcontent|payload)/i.test(
        key
      )
        ? "[REDACTED]"
        : redact(entry)
    ])
  ) as T;
}

function serializable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, entry: unknown) =>
      typeof entry === "bigint" ? entry.toString() : entry
    )
  );
}

function safeSegment(value: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return safe && safe !== "." && safe !== ".." ? safe : "unnamed";
}

function hash(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

function exportJobDto(job: {
  id: string;
  organizationId: string;
  status: string;
  includeAttachments: boolean;
  schemaVersion: number;
  checksum: string | null;
  byteSize: number | null;
  expiresAt: Date;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}) {
  return {
    ...job,
    expiresAt: job.expiresAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null
  };
}

function closureDto(request: {
  id: string;
  organizationId: string;
  status: string;
  reason: string;
  exportJobId: string | null;
  legalHold: boolean;
  retentionUntil: Date | null;
  scheduledDeletionAt: Date | null;
  requestedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...request,
    retentionUntil: request.retentionUntil?.toISOString() ?? null,
    scheduledDeletionAt: request.scheduledDeletionAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString()
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

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
