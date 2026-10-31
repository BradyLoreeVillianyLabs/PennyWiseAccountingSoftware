import { withRuntimeTransaction, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { randomUUID } from "node:crypto";
import { EstimateEmailService } from "../services/estimate-email-service.js";
import { InvoiceDocumentService } from "../services/invoice-document-service.js";
import { PaymentCheckoutExpiryWorker } from "../services/payment-checkout-expiry-worker.js";
import { PaymentService } from "../services/payment-service.js";
import { PaymentOutboxWorker } from "../services/payment-outbox-worker.js";
import { PayrollService } from "../services/payroll-service.js";
import { RecurringInvoiceService } from "../services/recurring-invoice-service.js";
import { ReminderService } from "../services/reminder-service.js";
import { WebhookService } from "../services/webhook-service.js";

const LEASE_MS = 2 * 60_000;
const MAX_FAILURES = 5;
const STALE_DELIVERY_MS = 15 * 60_000;

export const AUTOMATION_JOB_DEFINITIONS = [
  {
    name: "payment-webhook-retry",
    label: "Payment webhook retry",
    intervalMs: 30_000,
    batchSize: 20
  },
  {
    name: "payment-receipt-email",
    label: "Payment receipt email",
    intervalMs: 60_000,
    batchSize: 20
  },
  {
    name: "outbound-webhook-dispatch",
    label: "Outbound webhook dispatch",
    intervalMs: 60_000,
    batchSize: 20
  },
  {
    name: "invoice-email-delivery",
    label: "Invoice email delivery",
    intervalMs: 60_000,
    batchSize: 20
  },
  {
    name: "estimate-email-delivery",
    label: "Estimate email delivery",
    intervalMs: 60_000,
    batchSize: 20
  },
  {
    name: "payroll-due-drafts",
    label: "Payroll due drafts",
    intervalMs: 5 * 60_000,
    batchSize: 200
  },
  {
    name: "payment-checkout-expiry",
    label: "Expired payment checkouts",
    intervalMs: 5 * 60_000,
    batchSize: 20
  },
  {
    name: "payment-link-polling",
    label: "Own-account payment link polling",
    intervalMs: 60_000,
    batchSize: 20
  },
  {
    name: "recurring-invoice-generation",
    label: "Recurring invoice generation",
    intervalMs: 5 * 60_000,
    batchSize: 20
  },
  {
    name: "customer-reminders",
    label: "Customer reminders",
    intervalMs: 5 * 60_000,
    batchSize: 20
  }
] as const;

type JobName = (typeof AUTOMATION_JOB_DEFINITIONS)[number]["name"];

interface DiscoveredOrganization {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly ownerUserId: string;
  readonly ownerEmail: string;
  readonly ownerDisplayName: string | null;
  readonly displayName: string;
}

interface JobCounts {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
}

interface ActiveLease {
  readonly organizationId: string;
  readonly jobName: string;
  readonly token: string;
}

interface JobRunResult {
  readonly jobName: string;
  readonly status: "started" | "skipped" | "unavailable" | "paused";
  readonly runId?: string;
  readonly counts?: JobCounts;
  readonly reason?: string;
}

export interface AutomationRunnerStatus {
  readonly enabled: boolean;
  readonly state: "starting" | "running" | "stopped" | "disabled" | "failed";
  readonly recoveryComplete: boolean;
  readonly lastError: string | null;
}

export class AutomationJobRunner {
  private readonly definitions = new Map(
    AUTOMATION_JOB_DEFINITIONS.map((definition) => [definition.name, definition])
  );
  private readonly activeLeases = new Map<string, ActiveLease>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private status: AutomationRunnerStatus = {
    enabled: process.env.JOBS_ENABLED !== "false",
    state: process.env.JOBS_ENABLED === "false" ? "disabled" : "stopped",
    recoveryComplete: process.env.JOBS_ENABLED === "false",
    lastError: null
  };

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly paymentOutbox: PaymentOutboxWorker,
    private readonly webhookService: WebhookService,
    private readonly invoiceDocumentService: InvoiceDocumentService,
    private readonly estimateEmailService: EstimateEmailService,
    private readonly payrollService: PayrollService,
    private readonly recurringInvoiceService: RecurringInvoiceService,
    private readonly reminderService: ReminderService,
    private readonly paymentCheckoutExpiry?: PaymentCheckoutExpiryWorker,
    private readonly paymentService?: PaymentService,
    private readonly emailDeliveryAvailable = false
  ) {}

  public currentStatus(): AutomationRunnerStatus {
    return { ...this.status };
  }

  public async start(): Promise<void> {
    if (!this.status.enabled) return;
    if (this.running) return;
    this.running = true;
    this.status = { ...this.status, state: "starting", recoveryComplete: false };
    try {
      await this.tick(true);
      this.status = { ...this.status, state: "running", recoveryComplete: true, lastError: null };
    } catch (error) {
      this.status = {
        ...this.status,
        state: "failed",
        recoveryComplete: false,
        lastError: errorMessage(error)
      };
    }
    this.scheduleNextTick();
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const leases = [...this.activeLeases.values()];
    this.activeLeases.clear();
    await Promise.all(leases.map((lease) => this.releaseLease(lease).catch(() => undefined)));
    if (this.status.enabled) this.status = { ...this.status, state: "stopped" };
  }

  public async list(context: OrganizationContext) {
    const [leases, runs] = await withTenantTransaction(
      this.prisma,
      tenantDbContext(context),
      async (tx) =>
        Promise.all([
          tx.automationJobLease.findMany({ where: { organizationId: context.organizationId } }),
          tx.automationJobRun.findMany({
            where: { organizationId: context.organizationId },
            orderBy: { startedAt: "desc" },
            take: 100
          })
        ])
    );
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!latest.has(run.jobName)) latest.set(run.jobName, run);
    return {
      status: this.currentStatus(),
      jobs: AUTOMATION_JOB_DEFINITIONS.map((definition) => {
        const lease = leases.find((candidate) => candidate.jobName === definition.name);
        const lastRun = latest.get(definition.name);
        const available = this.isAvailable(definition.name);
        return {
          name: definition.name,
          label: definition.label,
          intervalMs: definition.intervalMs,
          batchSize: definition.batchSize,
          available,
          unavailableReason: available ? null : this.unavailableReason(definition.name),
          paused: lease?.paused ?? false,
          deadLettered: Boolean(lease?.deadLetteredAt),
          nextRunAt: lease?.nextRunAt?.toISOString() ?? null,
          lastRun: lastRun
            ? {
                id: lastRun.id,
                status: lastRun.status,
                startedAt: lastRun.startedAt.toISOString(),
                finishedAt: lastRun.finishedAt?.toISOString() ?? null,
                claimed: lastRun.claimedCount,
                succeeded: lastRun.succeededCount,
                failed: lastRun.failedCount,
                errorCode: lastRun.errorCode
              }
            : null
        };
      })
    };
  }

  public async setPaused(context: OrganizationContext, jobName: string, paused: boolean) {
    const definition = this.definition(jobName);
    await withTenantTransaction(this.prisma, tenantDbContext(context), (tx) =>
      tx.automationJobLease.upsert({
        where: {
          organizationId_jobName: {
            organizationId: context.organizationId,
            jobName: definition.name
          }
        },
        create: {
          organizationId: context.organizationId,
          jobName: definition.name,
          nextRunAt: new Date(),
          paused
        },
        update: { paused, ...(paused ? {} : { deadLetteredAt: null, failureCount: 0 }) }
      })
    );
    return this.list(context);
  }

  public async runNow(context: OrganizationContext, jobName: string): Promise<JobRunResult> {
    const definition = this.definition(jobName);
    if (!this.status.enabled)
      return { jobName: definition.name, status: "unavailable", reason: "JOBS_ENABLED=false" };
    if (!this.isAvailable(definition.name))
      return {
        jobName: definition.name,
        status: "unavailable",
        reason: this.unavailableReason(definition.name)
      };
    return this.execute(definition.name, context, true);
  }

  private async tick(force: boolean): Promise<void> {
    const organizations = await this.discoverOrganizations();
    for (const organization of organizations) {
      const context = jobContext(organization);
      for (const definition of AUTOMATION_JOB_DEFINITIONS) {
        if (!this.isAvailable(definition.name)) continue;
        await this.execute(definition.name, context, force);
      }
    }
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    const interval = Math.min(
      ...AUTOMATION_JOB_DEFINITIONS.map((definition) => definition.intervalMs)
    );
    this.timer = setTimeout(() => {
      void this.tick(false)
        .catch((error: unknown) => {
          this.status = { ...this.status, state: "failed", lastError: errorMessage(error) };
        })
        .finally(() => {
          if (this.status.state === "failed" && this.status.recoveryComplete)
            this.status = { ...this.status, state: "running" };
          this.scheduleNextTick();
        });
    }, interval);
  }

  private async execute(
    jobName: JobName,
    context: OrganizationContext,
    force: boolean
  ): Promise<JobRunResult> {
    const definition = this.definition(jobName);
    const lease = await this.beginRun(context, definition, force);
    if (!lease) {
      const state = await this.leaseState(context, definition.name);
      return {
        jobName: definition.name,
        status: state === "paused" ? "paused" : "skipped",
        reason: state
      };
    }
    const runContext = { ...context, requestId: lease.runId };
    try {
      const counts = await this.perform(definition.name, runContext, definition.batchSize);
      await this.finishRun(runContext, lease, counts);
      return { jobName: definition.name, status: "started", runId: lease.runId, counts };
    } catch (error) {
      await this.failRun(runContext, lease, error);
      throw error;
    }
  }

  private async perform(
    jobName: JobName,
    context: OrganizationContext,
    batchSize: number
  ): Promise<JobCounts> {
    if (jobName === "payment-webhook-retry") {
      const claimed = await this.paymentOutbox.processPendingWebhookEvents(
        context.organizationId,
        context.user.id,
        batchSize
      );
      return { claimed, succeeded: claimed, failed: 0 };
    }
    if (jobName === "payment-receipt-email") {
      const claimed = await this.paymentOutbox.processPendingReceiptEmails(
        context.organizationId,
        context.user.id,
        batchSize
      );
      return { claimed, succeeded: claimed, failed: 0 };
    }
    if (jobName === "outbound-webhook-dispatch") {
      const fannedOut = await this.webhookService.fanOutPendingOutbox(context, batchSize);
      const attempted = await this.webhookService.processPendingDeliveries(context, batchSize);
      return { claimed: fannedOut + attempted, succeeded: attempted, failed: 0 };
    }
    if (jobName === "invoice-email-delivery") return this.dispatchInvoices(context, batchSize);
    if (jobName === "estimate-email-delivery") return this.dispatchEstimates(context, batchSize);
    if (jobName === "payroll-due-drafts") {
      const result = await this.payrollService.generateDueScheduledDrafts(
        context,
        new Date().toISOString().slice(0, 10)
      );
      return {
        claimed: result.checked,
        succeeded: result.created.length + result.alreadyPrepared.length,
        failed: result.blocked.length
      };
    }
    if (jobName === "payment-checkout-expiry") {
      if (!this.paymentCheckoutExpiry)
        throw new AppError(
          "AUTOMATION_UNAVAILABLE",
          "Payment checkout expiry is not configured.",
          409
        );
      const result = await this.paymentCheckoutExpiry.sweep(
        context.organizationId,
        context.user.id,
        batchSize
      );
      return { claimed: result.claimed, succeeded: result.cancelled, failed: result.failed };
    }
    if (jobName === "payment-link-polling") {
      if (!this.paymentService)
        throw new AppError(
          "AUTOMATION_UNAVAILABLE",
          "Payment link polling is not configured.",
          409
        );
      const result = await this.paymentService.pollDurablePaymentLinks(context, batchSize);
      return {
        claimed: result.checked,
        succeeded: result.succeeded,
        failed: result.checked - result.succeeded
      };
    }
    if (jobName === "recurring-invoice-generation") {
      const result = await this.recurringInvoiceService.materializeDue(context, batchSize);
      return {
        claimed: result.checked,
        succeeded: result.created + result.skipped,
        failed: result.failed + result.blocked
      };
    }
    const result = await this.reminderService.sendDue(context, batchSize);
    return {
      claimed: result.checked,
      succeeded: result.sent,
      failed: result.failed
    };
    throw new AppError(
      "AUTOMATION_NOT_IMPLEMENTED",
      "This automation is reserved for a later phase.",
      409
    );
  }

  private async dispatchInvoices(context: OrganizationContext, limit: number): Promise<JobCounts> {
    const ids = await withTenantTransaction(this.prisma, tenantDbContext(context), async (tx) => {
      await tx.invoiceDelivery.updateMany({
        where: {
          organizationId: context.organizationId,
          status: "SENDING",
          updatedAt: { lt: new Date(Date.now() - STALE_DELIVERY_MS) }
        },
        data: {
          status: "FAILED",
          lastError: "Recovered stale automation claim.",
          failedAt: new Date()
        }
      });
      const rows = await tx.invoiceDelivery.findMany({
        where: {
          organizationId: context.organizationId,
          status: { in: ["QUEUED", "FAILED"] },
          attempts: { lt: 5 }
        },
        orderBy: { queuedAt: "asc" },
        take: limit,
        select: { id: true }
      });
      return rows.map((row) => row.id);
    });
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.invoiceDocumentService.dispatchDelivery(context, id);
        succeeded++;
      } catch {
        failed++;
      }
    }
    return { claimed: ids.length, succeeded, failed };
  }

  private async dispatchEstimates(context: OrganizationContext, limit: number): Promise<JobCounts> {
    const ids = await withTenantTransaction(this.prisma, tenantDbContext(context), async (tx) => {
      await tx.estimateDelivery.updateMany({
        where: {
          organizationId: context.organizationId,
          status: "SENDING",
          updatedAt: { lt: new Date(Date.now() - STALE_DELIVERY_MS) }
        },
        data: {
          status: "FAILED",
          lastError: "Recovered stale automation claim.",
          failedAt: new Date()
        }
      });
      const rows = await tx.estimateDelivery.findMany({
        where: {
          organizationId: context.organizationId,
          status: { in: ["QUEUED", "FAILED"] },
          attempts: { lt: 5 }
        },
        orderBy: { queuedAt: "asc" },
        take: limit,
        select: { id: true }
      });
      return rows.map((row) => row.id);
    });
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.estimateEmailService.dispatchDelivery(context, id);
        succeeded++;
      } catch {
        failed++;
      }
    }
    return { claimed: ids.length, succeeded, failed };
  }

  private async discoverOrganizations(): Promise<readonly DiscoveredOrganization[]> {
    return withRuntimeTransaction(
      this.prisma,
      null,
      (tx) =>
        tx.$queryRaw<
          readonly DiscoveredOrganization[]
        >`SELECT * FROM list_automation_organizations()`
    );
  }

  private async beginRun(
    context: OrganizationContext,
    definition: (typeof AUTOMATION_JOB_DEFINITIONS)[number],
    force: boolean
  ): Promise<{ runId: string; token: string } | null> {
    const token = randomUUID();
    const runId = randomUUID();
    const dueAt = force ? new Date(0) : new Date();
    const leaseExpiry = new Date(Date.now() + LEASE_MS);
    return withTenantTransaction(this.prisma, tenantDbContext(context), async (tx) => {
      const claimed = await tx.$queryRaw<readonly { id: string }[]>`
        INSERT INTO "AutomationJobLease" (
          "id", "organizationId", "jobName", "leaseToken", "leaseExpiresAt", "nextRunAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}::uuid, ${context.organizationId}::uuid, ${definition.name}, ${token},
          ${leaseExpiry}, ${dueAt}, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("organizationId", "jobName") DO UPDATE
        SET "leaseToken" = ${token},
            "leaseExpiresAt" = ${leaseExpiry},
            "nextRunAt" = ${new Date(Date.now() + definition.intervalMs)},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "AutomationJobLease"."paused" = false
          AND "AutomationJobLease"."deadLetteredAt" IS NULL
          AND ("AutomationJobLease"."leaseExpiresAt" IS NULL OR "AutomationJobLease"."leaseExpiresAt" <= CURRENT_TIMESTAMP)
          AND (${force} OR "AutomationJobLease"."nextRunAt" IS NULL OR "AutomationJobLease"."nextRunAt" <= CURRENT_TIMESTAMP)
        RETURNING "id"
      `;
      if (!claimed.length) return null;
      await tx.automationJobRun.create({
        data: {
          id: runId,
          organizationId: context.organizationId,
          jobName: definition.name,
          status: "RUNNING"
        }
      });
      this.activeLeases.set(runId, {
        organizationId: context.organizationId,
        jobName: definition.name,
        token
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "AUTOMATION_JOB_STARTED",
          targetType: "AutomationJobRun",
          targetId: runId,
          requestId: runId,
          metadata: { jobName: definition.name, batchSize: definition.batchSize }
        }
      });
      return { runId, token };
    });
  }

  private async finishRun(
    context: OrganizationContext,
    lease: { runId: string; token: string },
    counts: JobCounts
  ): Promise<void> {
    const active = this.activeLeases.get(lease.runId);
    if (!active) return;
    await withTenantTransaction(this.prisma, tenantDbContext(context), async (tx) => {
      await tx.automationJobRun.update({
        where: { id: lease.runId },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          claimedCount: counts.claimed,
          succeededCount: counts.succeeded,
          failedCount: counts.failed
        }
      });
      await tx.automationJobLease.updateMany({
        where: {
          organizationId: active.organizationId,
          jobName: active.jobName,
          leaseToken: active.token
        },
        data: {
          leaseToken: null,
          leaseExpiresAt: new Date(),
          nextRunAt: new Date(Date.now() + this.definition(active.jobName).intervalMs),
          lastRunAt: new Date(),
          failureCount: 0,
          lastErrorCode: null
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "AUTOMATION_JOB_COMPLETED",
          targetType: "AutomationJobRun",
          targetId: lease.runId,
          requestId: lease.runId,
          metadata: { jobName: active.jobName, ...counts }
        }
      });
    });
    this.activeLeases.delete(lease.runId);
  }

  private async failRun(
    context: OrganizationContext,
    lease: { runId: string; token: string },
    error: unknown
  ): Promise<void> {
    const active = this.activeLeases.get(lease.runId);
    if (!active) return;
    const errorCode = errorCodeFrom(error);
    await withTenantTransaction(this.prisma, tenantDbContext(context), async (tx) => {
      const current = await tx.automationJobLease.findFirst({
        where: { organizationId: active.organizationId, jobName: active.jobName }
      });
      const failures = (current?.failureCount ?? 0) + 1;
      const deadLettered = failures >= MAX_FAILURES;
      await tx.automationJobRun.update({
        where: { id: lease.runId },
        data: {
          status: deadLettered ? "DEAD_LETTER" : "FAILED",
          finishedAt: new Date(),
          errorCode,
          failedCount: 1
        }
      });
      await tx.automationJobLease.updateMany({
        where: {
          organizationId: active.organizationId,
          jobName: active.jobName,
          leaseToken: active.token
        },
        data: {
          leaseToken: null,
          leaseExpiresAt: new Date(),
          failureCount: failures,
          lastErrorCode: errorCode,
          deadLetteredAt: deadLettered ? new Date() : null,
          nextRunAt: deadLettered
            ? null
            : new Date(Date.now() + 30_000 * 2 ** Math.min(failures - 1, 4))
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: deadLettered ? "AUTOMATION_JOB_DEAD_LETTERED" : "AUTOMATION_JOB_FAILED",
          targetType: "AutomationJobRun",
          targetId: lease.runId,
          requestId: lease.runId,
          metadata: { jobName: active.jobName, errorCode, failureCount: failures }
        }
      });
    });
    this.activeLeases.delete(lease.runId);
  }

  private async releaseLease(lease: ActiveLease): Promise<void> {
    const organizations = await this.discoverOrganizations();
    const organization = organizations.find(
      (candidate) => candidate.organizationId === lease.organizationId
    );
    if (!organization) return;
    await withTenantTransaction(
      this.prisma,
      { organizationId: lease.organizationId, actorUserId: organization.ownerUserId },
      (tx) =>
        tx.automationJobLease.updateMany({
          where: {
            organizationId: lease.organizationId,
            jobName: lease.jobName,
            leaseToken: lease.token
          },
          data: { leaseToken: null, leaseExpiresAt: new Date() }
        })
    );
  }

  private async leaseState(context: OrganizationContext, jobName: JobName): Promise<string> {
    const lease = await withTenantTransaction(this.prisma, tenantDbContext(context), (tx) =>
      tx.automationJobLease.findUnique({
        where: { organizationId_jobName: { organizationId: context.organizationId, jobName } }
      })
    );
    if (lease?.paused) return "paused";
    if (lease?.deadLetteredAt) return "dead_lettered";
    return "leased_by_another_runner_or_not_due";
  }

  private definition(name: string) {
    const definition = this.definitions.get(name as JobName);
    if (!definition)
      throw new AppError("AUTOMATION_NOT_FOUND", "Automation job was not found.", 404);
    return definition;
  }

  private isAvailable(name: JobName): boolean {
    if (name === "customer-reminders") return this.emailDeliveryAvailable;
    if (name === "payment-checkout-expiry") return Boolean(this.paymentCheckoutExpiry);
    if (name === "payment-link-polling") return Boolean(this.paymentService);
    if (name === "invoice-email-delivery" || name === "estimate-email-delivery")
      return this.emailDeliveryAvailable;
    return true;
  }

  private unavailableReason(name: JobName): string {
    if (name === "customer-reminders")
      return "Email delivery is not enabled for this installation.";
    if (name === "payment-checkout-expiry") return "A hosted payment provider is not configured.";
    if (name === "payment-link-polling") return "Payment link polling is not configured.";
    if (name === "invoice-email-delivery" || name === "estimate-email-delivery")
      return "Email delivery is not enabled for this installation.";
    return "Automation is unavailable.";
  }
}

function tenantDbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function jobContext(organization: DiscoveredOrganization): OrganizationContext {
  return {
    requestId: `automation-discovery:${organization.organizationId}`,
    user: {
      id: organization.ownerUserId,
      email: organization.ownerEmail,
      displayName: organization.ownerDisplayName,
      emailVerifiedAt: new Date()
    },
    organizationId: organization.organizationId,
    membershipId: organization.membershipId,
    role: "OWNER",
    sessionId: null,
    recentAuthAt: new Date(),
    mfaAuthenticated: true,
    authenticationMethod: "DEVELOPMENT",
    auditOrigin: { ipAddress: null, userAgent: "PennyWise automation runner" }
  };
}

function errorCodeFrom(error: unknown): string {
  if (error instanceof AppError) return error.code.slice(0, 160);
  if (error instanceof Error) return error.name.slice(0, 160);
  return "AUTOMATION_JOB_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Automation runner failed.";
}
