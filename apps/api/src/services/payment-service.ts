import { createHash, randomUUID } from "node:crypto";
import {
  allocateMinorUnits,
  convertMinorUnits,
  parseMinorUnit,
  serializeMinorUnit
} from "@clearledger/accounting-core";
import {
  Prisma,
  withPublicInvoiceTransaction,
  withPaymentWebhookLookupTransaction,
  withPaymentWebhookTransaction,
  withTenantTransaction,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { hashOpaqueToken } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import { assertCustomerFacingPaymentUrl } from "./invoice-render-service.js";
import { JournalService, type PostJournalInput } from "./journal-service.js";
import { MonetaryPositionService, type PositionSettlement } from "./monetary-position-service.js";
import { assertSafePaymentReference } from "./payment-reference.js";
import {
  AesPaymentAccountProtector,
  StripeTestModeAdapter,
  type PaymentWebhookInput,
  type PaymentAccountProtector,
  type PaymentProviderAdapter,
  type NormalizedProviderEvent
} from "./payment-provider.js";
import {
  createOwnAccountPaymentProvider,
  type OwnAccountPaymentProviderFactory,
  type OwnAccountPaymentProviderKind,
  type OwnAccountPaymentStatus
} from "./own-account-payment-provider.js";
import { environmentValueOrDefault } from "../environment.js";

export type TransactionClient = Prisma.TransactionClient;
export type HostedPaymentProvider = "STRIPE" | "PAYPAL" | "SQUARE";

export interface ManualPaymentInput {
  readonly customerId: string;
  readonly receivingAccountId: string;
  readonly paymentDate: string;
  readonly amountMinor: string;
  readonly currency?: string | undefined;
  readonly fxRateSnapshotId?: string | undefined;
  readonly methodCategory: "CASH" | "CHEQUE" | "ELECTRONIC_TRANSFER" | "EXTERNAL_CARD" | "OTHER";
  readonly reference?: string | undefined;
  readonly allocations: readonly { readonly invoiceId: string; readonly amountMinor: string }[];
}

export interface PublicCheckoutInput {
  readonly partialAmountMinor?: string | undefined;
}

export interface PaymentSettingsInput {
  readonly clearingAccountId: string;
  readonly feeExpenseAccountId: string;
  readonly allowPartialPayments: boolean;
  readonly minimumPartialMinor: string;
  readonly version?: number | undefined;
}

export interface RefundInput {
  readonly amountMinor: string;
  readonly reason: string;
  readonly treatment: "CUSTOMER_CREDIT" | "CREDIT_NOTE_AND_REFUND" | "UNAPPLIED_PAYMENT";
  readonly creditNoteId?: string | undefined;
}

export interface OwnAccountPaymentAccountInput {
  readonly provider: OwnAccountPaymentProviderKind;
  readonly credential: string;
  readonly mode: "test" | "live";
  readonly locationId?: string | undefined;
}

/** Posts manual receipts atomically with allocations, invoice status, journal, audit, and outbox rows. */
export class PaymentService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;
  private readonly monetaryPositions: MonetaryPositionService;
  private readonly provider: PaymentProviderAdapter;
  private readonly providerKind: HostedPaymentProvider;
  private readonly protector: PaymentAccountProtector;
  private readonly ownAccountProviderFactory: OwnAccountPaymentProviderFactory;
  private readonly publicCheckoutHits = new Map<string, { count: number; startedAt: number }>();

  public constructor(
    private readonly prisma: PrismaClient,
    provider?: PaymentProviderAdapter,
    protector?: PaymentAccountProtector,
    private readonly betaRuntime = process.env.CLEARLEDGER_BETA_RUNTIME === "true",
    providerKind: HostedPaymentProvider = "STRIPE",
    ownAccountProviderFactory: OwnAccountPaymentProviderFactory = createOwnAccountPaymentProvider
  ) {
    if (process.env.NODE_ENV === "production" && (!provider || !protector)) {
      throw new Error(
        "Production payments require an explicitly configured provider adapter and account protector."
      );
    }
    this.provider =
      provider ??
      new StripeTestModeAdapter(
        environmentValueOrDefault(
          process.env.PAYMENT_WEBHOOK_SECRET,
          "development-payment-webhook-secret"
        )
      );
    this.providerKind = providerKind;
    this.ownAccountProviderFactory = ownAccountProviderFactory;
    this.protector =
      protector ??
      new AesPaymentAccountProtector(
        environmentValueOrDefault(
          process.env.PAYMENT_ACCOUNT_ENCRYPTION_SECRET,
          "development-payment-account-encryption-secret"
        )
      );
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
    this.monetaryPositions = new MonetaryPositionService();
  }

  public async createPublicCheckout(
    token: string,
    input: PublicCheckoutInput,
    idempotencyKey: string | undefined
  ) {
    this.assertHostedPaymentsEnabled();
    if (!idempotencyKey || idempotencyKey.length < 16)
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    const tokenHash = hashOpaqueToken(token);
    this.assertPublicCheckoutRateLimit(tokenHash);
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    try {
      return await withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
        const link = await tx.publicInvoiceLink.findFirst({
          where: {
            tokenHash,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
          }
        });
        if (!link)
          throw new AppError(
            "PUBLIC_INVOICE_LINK_INVALID",
            "Invoice link is invalid or expired.",
            404
          );
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
        const existing = await tx.paymentCheckoutSession.findFirst({
          where: {
            organizationId: link.organizationId,
            invoiceId: link.invoiceId,
            idempotencyKeyHash: keyHash
          }
        });
        if (existing) {
          if (existing.expiresAt <= new Date() || existing.cancelledAt)
            throw new AppError(
              "PAYMENT_CHECKOUT_EXPIRED",
              "Checkout session is no longer active.",
              409
            );
          return {
            checkoutSessionId: existing.id,
            checkoutUrl: existing.providerCheckoutUrl,
            expiresAt: existing.expiresAt.toISOString()
          };
        }
        const invoice = await tx.invoice.findFirst({
          where: { id: link.invoiceId, organizationId: link.organizationId },
          include: { creditNotes: { where: { status: "POSTED" } } }
        });
        if (!invoice) throw new AppError("PUBLIC_INVOICE_NOT_FOUND", "Invoice was not found.", 404);
        const credits = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
        const outstanding = invoice.grandTotalMinor - credits - invoice.amountPaidMinor;
        if (
          !["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status) ||
          outstanding <= 0n
        )
          throw new AppError("PAYMENT_INVOICE_NOT_ELIGIBLE", "This invoice cannot be paid.", 409);
        const settings = await tx.paymentSettings.findFirst({
          where: { organizationId: link.organizationId }
        });
        const account = await tx.paymentAccount.findFirst({
          where: {
            organizationId: link.organizationId,
            provider: this.providerKind,
            status: "CONNECTED",
            chargesEnabled: true
          }
        });
        if (!settings || !account || !account.providerAccountCiphertext)
          throw new AppError(
            "PAYMENT_ACCOUNT_UNAVAILABLE",
            "Online payment is not available for this invoice.",
            409
          );
        const requested = input.partialAmountMinor
          ? parseMinorUnit(input.partialAmountMinor, "partialAmountMinor")
          : outstanding;
        if (requested <= 0n || requested > outstanding)
          throw new AppError("PAYMENT_AMOUNT_INVALID", "Payment amount is not eligible.", 422);
        if (
          requested !== outstanding &&
          (!settings.allowPartialPayments || requested < settings.minimumPartialMinor)
        )
          throw new AppError(
            "PAYMENT_PARTIAL_NOT_ALLOWED",
            "Partial payment is not available for this invoice.",
            422
          );
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        const checkoutSessionId = randomUUID();
        const publicInvoiceUrl = `${paymentPublicBaseUrl()}/public/invoices/${encodeURIComponent(token)}`;
        const providerSession = await this.provider.createHostedCheckout({
          connectedAccountId: this.protector.reveal(account.providerAccountCiphertext),
          idempotencyKey: `checkout:${link.organizationId}:${keyHash}`,
          amountMinor: requested,
          currency: invoice.currency,
          customerEmail: invoice.customerEmailSnapshot,
          metadata: {
            checkout_session_id: checkoutSessionId,
            invoice_public_link_id: link.id,
            organization_id: link.organizationId,
            invoice_id: invoice.id
          },
          expiresAt,
          // PayPal returns an approved order, rather than a capture. Carry only our
          // opaque checkout UUID back to the public invoice page so that page can make
          // an explicit, token-bound POST capture request. Never capture on a GET:
          // link previews and browser prefetches are not payment authorization.
          successUrl: `${publicInvoiceUrl}?payment=success&checkout=${encodeURIComponent(checkoutSessionId)}`,
          cancelUrl: `${publicInvoiceUrl}?payment=cancelled`
        });
        const created = await tx.paymentCheckoutSession.create({
          data: {
            id: checkoutSessionId,
            organizationId: link.organizationId,
            invoiceId: invoice.id,
            paymentAccountId: account.id,
            providerSessionId: providerSession.providerSessionId,
            providerCheckoutUrl: providerSession.url,
            idempotencyKeyHash: keyHash,
            requestedAmountMinor: requested,
            currency: invoice.currency,
            expiresAt: providerSession.expiresAt
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: link.organizationId,
            actorUserId: null,
            action: "PUBLIC_PAYMENT_CHECKOUT_CREATED",
            targetType: "PaymentCheckoutSession",
            targetId: created.id,
            metadata: { invoiceId: invoice.id, requestedAmountMinor: requested.toString() }
          }
        });
        return {
          checkoutSessionId: created.id,
          checkoutUrl: providerSession.url,
          expiresAt: providerSession.expiresAt.toISOString()
        };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
        const link = await tx.publicInvoiceLink.findFirst({
          where: {
            tokenHash,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
          }
        });
        if (!link)
          throw new AppError(
            "PUBLIC_INVOICE_LINK_INVALID",
            "Invoice link is invalid or expired.",
            404
          );
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
        const existing = await tx.paymentCheckoutSession.findFirst({
          where: {
            organizationId: link.organizationId,
            invoiceId: link.invoiceId,
            idempotencyKeyHash: keyHash
          }
        });
        if (!existing || existing.expiresAt <= new Date() || existing.cancelledAt)
          throw new AppError(
            "PAYMENT_CHECKOUT_EXPIRED",
            "Checkout session is no longer active.",
            409
          );
        return {
          checkoutSessionId: existing.id,
          checkoutUrl: existing.providerCheckoutUrl,
          expiresAt: existing.expiresAt.toISOString()
        };
      });
    }
  }

  /**
   * Requests a provider-side capture after its hosted checkout has returned to the
   * public invoice. This deliberately does not create a Payment or mark the checkout
   * complete: only a verified provider webhook is allowed to post accounting records.
   */
  public async capturePublicCheckout(token: string, checkoutSessionId: string) {
    this.assertHostedPaymentsEnabled();
    if (!this.provider.captureHostedCheckout)
      throw new AppError(
        "PAYMENT_CAPTURE_NOT_REQUIRED",
        "This payment provider does not require a return-page capture.",
        409
      );
    const tokenHash = hashOpaqueToken(token);
    this.assertPublicCheckoutRateLimit(tokenHash);
    const checkout = await withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.publicInvoiceLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_INVALID",
          "Invoice link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const session = await tx.paymentCheckoutSession.findFirst({
        where: {
          id: checkoutSessionId,
          organizationId: link.organizationId,
          invoiceId: link.invoiceId
        },
        include: { paymentAccount: true }
      });
      if (!session)
        throw new AppError(
          "PAYMENT_CHECKOUT_NOT_FOUND",
          "Checkout session was not found for this invoice.",
          404
        );
      if (session.completedAt)
        return { alreadyCompleted: true as const, checkoutSessionId: session.id };
      if (session.cancelledAt || session.expiresAt <= new Date())
        throw new AppError(
          "PAYMENT_CHECKOUT_EXPIRED",
          "Checkout session is no longer active.",
          409
        );
      const account = session.paymentAccount;
      if (
        account.provider !== this.providerKind ||
        account.status !== "CONNECTED" ||
        !account.chargesEnabled ||
        !account.providerAccountCiphertext
      )
        throw new AppError(
          "PAYMENT_ACCOUNT_UNAVAILABLE",
          "Online payment is not available for this invoice.",
          409
        );
      return {
        alreadyCompleted: false as const,
        checkoutSessionId: session.id,
        providerSessionId: session.providerSessionId,
        connectedAccountId: this.protector.reveal(account.providerAccountCiphertext)
      };
    });
    if (checkout.alreadyCompleted)
      return {
        status: "ALREADY_COMPLETED" as const,
        checkoutSessionId: checkout.checkoutSessionId
      };
    // The key is stable across browser retries. Providers which implement capture must
    // make this idempotent; we do not rely on a redirect being delivered exactly once.
    await this.provider.captureHostedCheckout(
      checkout.connectedAccountId,
      checkout.providerSessionId,
      `capture:${checkout.checkoutSessionId}`
    );
    return { status: "CAPTURE_REQUESTED" as const, checkoutSessionId: checkout.checkoutSessionId };
  }

  public async publicCheckoutEligibility(token: string) {
    const tokenHash = hashOpaqueToken(token);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.publicInvoiceLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_INVALID",
          "Invoice link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const invoice = await tx.invoice.findFirst({
        where: { id: link.invoiceId, organizationId: link.organizationId },
        include: { creditNotes: { where: { status: "POSTED" } } }
      });
      const settings = await tx.paymentSettings.findFirst({
        where: { organizationId: link.organizationId }
      });
      const account = await tx.paymentAccount.findFirst({
        where: {
          organizationId: link.organizationId,
          provider: this.providerKind,
          status: "CONNECTED",
          chargesEnabled: true
        }
      });
      if (!invoice) throw new AppError("PUBLIC_INVOICE_NOT_FOUND", "Invoice was not found.", 404);
      const credits = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
      const outstanding = invoice.grandTotalMinor - credits - invoice.amountPaidMinor;
      const eligible =
        !this.betaRuntime &&
        ["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status) &&
        outstanding > 0n &&
        Boolean(settings && account?.providerAccountCiphertext);
      return {
        eligible,
        captureRequired: typeof this.provider.captureHostedCheckout === "function",
        outstandingMinor: serializeMinorUnit(outstanding > 0n ? outstanding : 0n),
        currency: invoice.currency,
        allowPartialPayments: eligible && Boolean(settings?.allowPartialPayments),
        minimumPartialMinor: serializeMinorUnit(settings?.minimumPartialMinor ?? 0n)
      };
    });
  }

  public async publicPaymentStatus(token: string) {
    const tokenHash = hashOpaqueToken(token);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.publicInvoiceLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_INVALID",
          "Invoice link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const payments = await tx.payment.findMany({
        where: {
          organizationId: link.organizationId,
          allocations: { some: { invoiceId: link.invoiceId } }
        },
        select: { amountMinor: true, refundedMinor: true, status: true, methodCategory: true }
      });
      return payments.map((payment) => ({
        amountMinor: serializeMinorUnit(payment.amountMinor),
        refundedMinor: serializeMinorUnit(payment.refundedMinor),
        status: payment.status,
        methodCategory: payment.methodCategory
      }));
    });
  }

  public async publicReceipt(token: string, receiptNumber: string) {
    const tokenHash = hashOpaqueToken(token);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.publicInvoiceLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_INVALID",
          "Invoice link is invalid or expired.",
          404
        );
      const receipt = await tx.paymentReceipt.findFirst({
        where: {
          organizationId: link.organizationId,
          receiptNumber,
          payment: { allocations: { some: { invoiceId: link.invoiceId } } }
        },
        select: { receiptNumber: true, renderData: true, renderDataHash: true, createdAt: true }
      });
      if (!receipt)
        throw new AppError("PAYMENT_RECEIPT_NOT_FOUND", "Payment receipt was not found.", 404);
      return {
        receiptNumber: receipt.receiptNumber,
        renderData: receipt.renderData,
        renderDataHash: receipt.renderDataHash,
        createdAt: receipt.createdAt.toISOString()
      };
    });
  }

  public async settings(context: OrganizationContext) {
    await this.authorization.assert(context, "payments:read", "PaymentSettings");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const settings = await tx.paymentSettings.findFirst({
        where: { organizationId: context.organizationId }
      });
      return settings ? paymentSettingsDto(settings) : null;
    });
  }

  public async configureSettings(context: OrganizationContext, input: PaymentSettingsInput) {
    await this.authorization.assert(context, "payments:configure", "PaymentSettings");
    const minimumPartialMinor = parseMinorUnit(input.minimumPartialMinor, "minimumPartialMinor");
    if (minimumPartialMinor <= 0n)
      throw new AppError(
        "PAYMENT_MINIMUM_INVALID",
        "Minimum partial payment must be positive.",
        422
      );
    if (input.clearingAccountId === input.feeExpenseAccountId)
      throw new AppError("PAYMENT_ACCOUNT_INVALID", "Clearing and fee accounts must differ.", 422);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const accounts = await tx.account.findMany({
        where: {
          organizationId: context.organizationId,
          id: { in: [input.clearingAccountId, input.feeExpenseAccountId] },
          isArchived: false
        }
      });
      const clearing = accounts.find((account) => account.id === input.clearingAccountId);
      const fee = accounts.find((account) => account.id === input.feeExpenseAccountId);
      if (!clearing || !fee || clearing.type !== "ASSET" || fee.type !== "EXPENSE")
        throw new AppError(
          "PAYMENT_ACCOUNT_INVALID",
          "Configure an active asset clearing account and expense fee account.",
          422
        );
      const current = await tx.paymentSettings.findFirst({
        where: { organizationId: context.organizationId }
      });
      if (current && input.version !== current.version)
        throw new AppError("STALE_PAYMENT_SETTINGS", "Payment settings have changed.", 409);
      const settings = current
        ? await tx.paymentSettings.update({
            where: { id: current.id },
            data: {
              clearingAccountId: clearing.id,
              feeExpenseAccountId: fee.id,
              allowPartialPayments: input.allowPartialPayments,
              minimumPartialMinor,
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            }
          })
        : await tx.paymentSettings.create({
            data: {
              organizationId: context.organizationId,
              clearingAccountId: clearing.id,
              feeExpenseAccountId: fee.id,
              allowPartialPayments: input.allowPartialPayments,
              minimumPartialMinor,
              updatedByUserId: context.user.id
            }
          });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_SETTINGS_CONFIGURED",
          targetType: "PaymentSettings",
          targetId: settings.id,
          metadata: withAuditOrigin(context, {
            clearingAccountId: clearing.id,
            feeExpenseAccountId: fee.id,
            allowPartialPayments: settings.allowPartialPayments,
            minimumPartialMinor: settings.minimumPartialMinor.toString()
          })
        }
      });
      return paymentSettingsDto(settings);
    });
  }

  public async connectAccount(context: OrganizationContext, returnUrl: string) {
    this.assertHostedPaymentsEnabled();
    await this.authorization.assert(context, "payments:connect", "PaymentAccount");
    if (!returnUrl.startsWith("http://") && !returnUrl.startsWith("https://"))
      throw new AppError("PAYMENT_RETURN_URL_INVALID", "Payment return URL is invalid.", 422);
    const organization = await withTenantTransaction(this.prisma, dbContext(context), async (tx) =>
      tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { displayName: true }
      })
    );
    // Provider calls may involve an authorization round trip. Never hold a tenant
    // transaction open while waiting on the provider; the database update below
    // remains one short, audited transaction.
    const connectedAccountId = await this.provider.createConnectedAccount({
      organizationId: context.organizationId,
      contactEmail: context.user.email,
      displayName: organization.displayName,
      country: "CA",
      idempotencyKey: `payment-account:${context.organizationId}:${this.providerKind.toLowerCase()}`
    });
    const providerStatus = await this.provider.retrieveAccount(connectedAccountId);
    const account = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const connected = await tx.paymentAccount.upsert({
        where: {
          organizationId_provider: {
            organizationId: context.organizationId,
            provider: this.providerKind
          }
        },
        create: {
          organizationId: context.organizationId,
          provider: this.providerKind,
          providerAccountCiphertext: this.protector.protect(connectedAccountId),
          providerAccountLookupHash: providerAccountLookupHash(connectedAccountId),
          status: providerStatus.chargesEnabled ? "CONNECTED" : "PENDING_ONBOARDING",
          chargesEnabled: providerStatus.chargesEnabled,
          payoutsEnabled: providerStatus.payoutsEnabled,
          requirementsDue: [...providerStatus.requirementsDue],
          connectedAt: providerStatus.chargesEnabled ? new Date() : null,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        },
        update: {
          providerAccountCiphertext: this.protector.protect(connectedAccountId),
          providerAccountLookupHash: providerAccountLookupHash(connectedAccountId),
          status: providerStatus.chargesEnabled ? "CONNECTED" : "PENDING_ONBOARDING",
          chargesEnabled: providerStatus.chargesEnabled,
          payoutsEnabled: providerStatus.payoutsEnabled,
          requirementsDue: [...providerStatus.requirementsDue],
          connectedAt: providerStatus.chargesEnabled ? new Date() : null,
          disconnectedAt: null,
          updatedByUserId: context.user.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_ACCOUNT_CONNECTED",
          targetType: "PaymentAccount",
          targetId: connected.id,
          metadata: withAuditOrigin(context, {
            provider: connected.provider,
            status: connected.status
          })
        }
      });
      return connected;
    });
    const onboardingUrl = await this.provider.createOnboardingLink(
      connectedAccountId,
      returnUrl,
      returnUrl
    );
    return { account: paymentAccountDto(account), onboardingUrl };
  }

  public async paymentAccount(context: OrganizationContext) {
    await this.authorization.assert(context, "payments:read", "PaymentAccount");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const account = await tx.paymentAccount.findFirst({
        where: { organizationId: context.organizationId, provider: this.providerKind }
      });
      return account ? paymentAccountDto(account) : null;
    });
  }

  public async paymentAccounts(context: OrganizationContext) {
    await this.authorization.assert(context, "payments:read", "PaymentAccount");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const accounts = await tx.paymentAccount.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { provider: "asc" }
      });
      return accounts.map(paymentAccountDto);
    });
  }

  public async saveOwnAccount(context: OrganizationContext, input: OwnAccountPaymentAccountInput) {
    await this.authorization.assert(context, "payments:connect", "PaymentAccount");
    const provider = this.ownAccountProviderFactory(input.provider, input.credential, {
      mode: input.mode,
      locationId: input.locationId
    });
    let connection;
    try {
      connection = await provider.testConnection();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "PAYMENT_ACCOUNT_CONNECTION_FAILED",
        "The payment provider account could not be verified. Check the credential and try again.",
        502
      );
    }
    const account = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const saved = await tx.paymentAccount.upsert({
        where: {
          organizationId_provider: {
            organizationId: context.organizationId,
            provider: input.provider
          }
        },
        create: {
          organizationId: context.organizationId,
          provider: input.provider,
          accountMode: "OWN_ACCOUNT",
          providerAccountCiphertext: this.protector.protect(connection.accountId),
          credentialCiphertext: this.protector.protect(input.credential),
          providerDisplayName: connection.displayName,
          providerLocationId: connection.locationId ?? input.locationId ?? null,
          providerEnvironment: input.mode,
          providerAccountLookupHash: providerAccountLookupHash(connection.accountId),
          status: "CONNECTED",
          chargesEnabled: true,
          payoutsEnabled: true,
          requirementsDue: [],
          connectedAt: new Date(),
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        },
        update: {
          accountMode: "OWN_ACCOUNT",
          providerAccountCiphertext: this.protector.protect(connection.accountId),
          credentialCiphertext: this.protector.protect(input.credential),
          providerDisplayName: connection.displayName,
          providerLocationId: connection.locationId ?? input.locationId ?? null,
          providerEnvironment: input.mode,
          providerAccountLookupHash: providerAccountLookupHash(connection.accountId),
          status: "CONNECTED",
          chargesEnabled: true,
          payoutsEnabled: true,
          requirementsDue: [],
          connectedAt: new Date(),
          disconnectedAt: null,
          updatedByUserId: context.user.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_OWN_ACCOUNT_CONNECTED",
          targetType: "PaymentAccount",
          targetId: saved.id,
          metadata: withAuditOrigin(context, {
            provider: input.provider,
            mode: input.mode,
            locationId: connection.locationId ?? input.locationId ?? null
          })
        }
      });
      return saved;
    });
    return {
      account: paymentAccountDto(account),
      connection: { displayName: connection.displayName }
    };
  }

  public async createDurablePaymentLink(
    context: OrganizationContext,
    invoiceId: string,
    providerKind: OwnAccountPaymentProviderKind,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "payments:connect", "PaymentLink", invoiceId);
    if (!idempotencyKey || idempotencyKey.length < 16)
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required.", 400);
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const source = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.paymentLink.findFirst({
        where: { organizationId: context.organizationId, invoiceId, idempotencyKeyHash: keyHash }
      });
      if (existing) return { existing } as const;
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: context.organizationId },
        include: { creditNotes: { where: { status: "POSTED" } } }
      });
      if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
      if (!["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status))
        throw new AppError(
          "INVOICE_NOT_ISSUED",
          "Only posted invoices can have payment links.",
          409
        );
      const credits = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
      const outstanding = invoice.grandTotalMinor - credits - invoice.amountPaidMinor;
      if (outstanding <= 0n)
        throw new AppError("PAYMENT_INVOICE_NOT_ELIGIBLE", "This invoice has no balance due.", 409);
      const account = await tx.paymentAccount.findFirst({
        where: {
          organizationId: context.organizationId,
          provider: providerKind,
          accountMode: "OWN_ACCOUNT",
          status: "CONNECTED",
          chargesEnabled: true
        }
      });
      if (!account?.credentialCiphertext)
        throw new AppError(
          "PAYMENT_ACCOUNT_UNAVAILABLE",
          "Connect an own-account provider first.",
          409
        );
      const activeLinks = await tx.paymentLink.findMany({
        where: { organizationId: context.organizationId, invoiceId, status: "ACTIVE" },
        include: { paymentAccount: true },
        orderBy: { createdAt: "asc" }
      });
      return { invoice, account, outstanding, activeLinks } as const;
    });
    if ("existing" in source) return { paymentLink: paymentLinkDto(source.existing) };
    for (const oldLink of source.activeLinks) {
      const rawProviderKind = oldLink.paymentAccount.provider;
      if (rawProviderKind !== "STRIPE" && rawProviderKind !== "SQUARE")
        throw new AppError(
          "PAYMENT_LINK_REISSUE_UNSUPPORTED",
          "This payment link cannot be safely reissued by the local provider adapter.",
          409
        );
      const oldProviderKind = rawProviderKind;
      if (!oldLink.paymentAccount.credentialCiphertext)
        throw new AppError(
          "PAYMENT_ACCOUNT_UNAVAILABLE",
          "The previous payment account credential is unavailable.",
          409
        );
      const oldProvider = this.ownAccountProviderFactory(
        oldProviderKind,
        this.protector.reveal(oldLink.paymentAccount.credentialCiphertext),
        {
          mode: oldLink.paymentAccount.providerEnvironment === "live" ? "live" : "test",
          locationId: oldLink.paymentAccount.providerLocationId ?? undefined
        }
      );
      try {
        await oldProvider.deactivatePaymentLink(oldLink.providerLinkId);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          "PAYMENT_LINK_REISSUE_FAILED",
          "The previous payment link could not be deactivated, so no replacement was created.",
          502
        );
      }
    }
    if (source.activeLinks.length) {
      await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.paymentLink.updateMany({
          where: {
            organizationId: context.organizationId,
            id: { in: source.activeLinks.map((link) => link.id) },
            status: "ACTIVE"
          },
          data: { status: "DEACTIVATED", deactivatedAt: new Date(), nextPollAt: null }
        })
      );
    }
    const credential = this.protector.reveal(source.account.credentialCiphertext!);
    const provider = this.ownAccountProviderFactory(providerKind, credential, {
      mode: source.account.providerEnvironment === "live" ? "live" : "test",
      locationId: source.account.providerLocationId ?? undefined
    });
    let link;
    try {
      link = await provider.createPaymentLink({
        amountMinor: source.outstanding,
        currency: source.invoice.currency,
        invoiceId: source.invoice.id,
        invoiceNumber: source.invoice.invoiceNumber ?? source.invoice.provisionalIdentifier,
        customerEmail: source.invoice.customerEmailSnapshot,
        idempotencyKey
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "PAYMENT_LINK_CREATE_FAILED",
        "The payment provider could not create a payment link. Check the account and try again.",
        502
      );
    }
    assertCustomerFacingPaymentUrl(link.url);
    const created = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.paymentLink.create({
        data: {
          organizationId: context.organizationId,
          invoiceId: source.invoice.id,
          paymentAccountId: source.account.id,
          providerLinkId: link.providerLinkId,
          providerLinkUrl: link.url,
          idempotencyKeyHash: keyHash,
          requestedAmountMinor: source.outstanding,
          currency: source.invoice.currency,
          nextPollAt: new Date(),
          createdByUserId: context.user.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_DURABLE_LINK_CREATED",
          targetType: "PaymentLink",
          targetId: row.id,
          metadata: withAuditOrigin(context, {
            invoiceId: source.invoice.id,
            provider: providerKind,
            amountMinor: source.outstanding.toString()
          })
        }
      });
      return row;
    });
    return { paymentLink: paymentLinkDto(created) };
  }

  public async listDurablePaymentLinks(context: OrganizationContext, invoiceId?: string) {
    await this.authorization.assert(context, "payments:read", "PaymentLink");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const links = await tx.paymentLink.findMany({
        where: { organizationId: context.organizationId, ...(invoiceId ? { invoiceId } : {}) },
        orderBy: { createdAt: "desc" }
      });
      return links.map(paymentLinkDto);
    });
  }

  public async pollDurablePaymentLinks(context: OrganizationContext, limit = 20) {
    await this.authorization.assert(context, "payments:read", "PaymentLink");
    const links = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.paymentLink.findMany({
        where: {
          organizationId: context.organizationId,
          status: "ACTIVE",
          OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }]
        },
        include: { paymentAccount: true },
        orderBy: { nextPollAt: "asc" },
        take: limit
      })
    );
    let succeeded = 0;
    for (const link of links) {
      try {
        if (!link.paymentAccount.credentialCiphertext)
          throw new AppError(
            "PAYMENT_ACCOUNT_UNAVAILABLE",
            "Payment account credential is unavailable.",
            409
          );
        const provider = this.ownAccountProviderFactory(
          link.paymentAccount.provider as OwnAccountPaymentProviderKind,
          this.protector.reveal(link.paymentAccount.credentialCiphertext),
          {
            mode: link.paymentAccount.providerEnvironment === "live" ? "live" : "test",
            locationId: link.paymentAccount.providerLocationId ?? undefined
          }
        );
        const status = await provider.retrievePaymentStatus(link.providerLinkId);
        await this.applyDurablePaymentStatus(
          context,
          link.id,
          link.paymentAccount.provider as OwnAccountPaymentProviderKind,
          status
        );
        if (status.status === "SUCCEEDED") succeeded++;
      } catch (error) {
        await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
          tx.paymentLink.update({
            where: { id: link.id },
            data: {
              pollAttempts: { increment: 1 },
              lastPolledAt: new Date(),
              nextPollAt: new Date(Date.now() + 60_000),
              lastErrorCode: error instanceof AppError ? error.code : "PAYMENT_PROVIDER_ERROR"
            }
          })
        );
      }
    }
    return { checked: links.length, succeeded };
  }

  private async applyDurablePaymentStatus(
    context: OrganizationContext,
    paymentLinkId: string,
    providerKind: OwnAccountPaymentProviderKind,
    status: OwnAccountPaymentStatus
  ): Promise<void> {
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const link = await tx.paymentLink.findFirst({
        where: { id: paymentLinkId, organizationId: context.organizationId },
        include: { invoice: { include: { creditNotes: { where: { status: "POSTED" } } } } }
      });
      if (!link || link.status !== "ACTIVE") return;
      const pollData = {
        pollAttempts: { increment: 1 },
        lastPolledAt: new Date(),
        nextPollAt: new Date(Date.now() + 60_000)
      };
      if (status.status !== "SUCCEEDED") {
        await tx.paymentLink.update({
          where: { id: link.id },
          data: {
            ...pollData,
            ...(status.status === "CANCELLED"
              ? { status: "DEACTIVATED", deactivatedAt: new Date() }
              : {})
          }
        });
        return;
      }
      if (
        !status.providerPaymentId ||
        status.amountMinor !== link.requestedAmountMinor ||
        status.currency !== link.currency ||
        status.feeMinor < 0n ||
        status.feeMinor > status.amountMinor
      ) {
        await tx.paymentLink.update({
          where: { id: link.id },
          data: {
            ...pollData,
            status: "REVIEW_REQUIRED",
            lastErrorCode: "PAYMENT_PROVIDER_MISMATCH"
          }
        });
        throw new AppError(
          "PAYMENT_PROVIDER_MISMATCH",
          "The provider payment does not match this invoice link.",
          422
        );
      }
      const existing = await tx.payment.findFirst({
        where: {
          organizationId: context.organizationId,
          provider: providerKind,
          providerPaymentId: status.providerPaymentId
        }
      });
      if (existing) {
        await tx.paymentLink.update({
          where: { id: link.id },
          data: {
            ...pollData,
            status: "PAID",
            providerPaymentId: status.providerPaymentId,
            completedAt: new Date(),
            lastErrorCode: null
          }
        });
        return;
      }
      const settings = await tx.paymentSettings.findFirst({
        where: { organizationId: context.organizationId }
      });
      const ar = await tx.account.findFirst({
        where: {
          organizationId: context.organizationId,
          systemPurpose: "accounts-receivable",
          isControl: true,
          isArchived: false
        }
      });
      if (!settings || !ar)
        throw new AppError(
          "PAYMENT_CONFIGURATION_REQUIRED",
          "Payment accounting is not configured.",
          422
        );
      const credits = link.invoice.creditNotes.reduce(
        (sum, note) => sum + note.grandTotalMinor,
        0n
      );
      if (
        !["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(link.invoice.status) ||
        link.invoice.amountPaidMinor + status.amountMinor > link.invoice.grandTotalMinor - credits
      )
        throw new AppError(
          "PAYMENT_INVOICE_NOT_ELIGIBLE",
          "Invoice cannot receive this payment.",
          409
        );
      const occurredAt = new Date();
      const payment = await tx.payment.create({
        data: {
          organizationId: context.organizationId,
          customerId: link.invoice.customerId,
          paymentAccountId: link.paymentAccountId,
          provider: providerKind,
          providerPaymentId: status.providerPaymentId,
          amountMinor: status.amountMinor,
          feeMinor: status.feeMinor,
          netMinor: status.amountMinor - status.feeMinor,
          currency: status.currency,
          status: "SUCCEEDED",
          paymentDate: new Date(occurredAt.toISOString().slice(0, 10)),
          methodCategory: "CARD",
          source: "HOSTED_CHECKOUT",
          createdByUserId: context.user.id
        }
      });
      const journal = await this.journals.postJournalInTransaction(
        tx,
        context,
        hostedJournal(
          payment.id,
          occurredAt,
          settings.clearingAccountId,
          settings.feeExpenseAccountId,
          ar.id,
          status.amountMinor,
          status.feeMinor
        ),
        true
      );
      await tx.payment.update({ where: { id: payment.id }, data: { journalId: journal.id } });
      await tx.paymentAllocation.create({
        data: {
          organizationId: context.organizationId,
          paymentId: payment.id,
          invoiceId: link.invoiceId,
          amountMinor: status.amountMinor
        }
      });
      const paid = link.invoice.amountPaidMinor + status.amountMinor;
      await tx.invoice.update({
        where: { id: link.invoiceId },
        data: {
          amountPaidMinor: paid,
          status: paid + credits >= link.invoice.grandTotalMinor ? "PAID" : "PARTIALLY_PAID",
          version: { increment: 1 }
        }
      });
      await tx.paymentLink.update({
        where: { id: link.id },
        data: {
          ...pollData,
          status: "PAID",
          providerPaymentId: status.providerPaymentId,
          completedAt: occurredAt,
          nextPollAt: null,
          lastErrorCode: null
        }
      });
      await this.createReceipt(tx, context.organizationId, payment.id);
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_DURABLE_LINK_POSTED",
          targetType: "Payment",
          targetId: payment.id,
          metadata: withAuditOrigin(context, {
            paymentLinkId: link.id,
            providerPaymentId: status.providerPaymentId,
            amountMinor: status.amountMinor.toString(),
            feeMinor: status.feeMinor.toString()
          })
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "payment.hosted-posted",
          aggregateType: "Payment",
          aggregateId: payment.id,
          payload: { paymentId: payment.id, journalId: journal.id, paymentLinkId: link.id }
        }
      });
    });
  }

  public async disconnectAccount(context: OrganizationContext) {
    await this.authorization.assert(context, "payments:disconnect", "PaymentAccount");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const account = await tx.paymentAccount.findFirst({
        where: { organizationId: context.organizationId, provider: this.providerKind }
      });
      if (!account)
        throw new AppError("PAYMENT_ACCOUNT_NOT_FOUND", "Payment account was not found.", 404);
      const disconnected = await tx.paymentAccount.update({
        where: { id: account.id },
        data: {
          status: "DISCONNECTED",
          chargesEnabled: false,
          payoutsEnabled: false,
          disconnectedAt: new Date(),
          updatedByUserId: context.user.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_ACCOUNT_DISCONNECTED",
          targetType: "PaymentAccount",
          targetId: account.id,
          metadata: withAuditOrigin(context, { provider: account.provider })
        }
      });
      return paymentAccountDto(disconnected);
    });
  }

  public async processStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    return this.processPaymentWebhook(rawBody, signature);
  }

  public async processPaymentWebhook(rawBody: Buffer, headers: PaymentWebhookInput) {
    this.assertHostedPaymentsEnabled();
    const event = await this.provider.verifyWebhook(rawBody, headers);
    const connectedAccountId = event.connectedAccountId;
    if (!connectedAccountId)
      throw new AppError(
        "PAYMENT_WEBHOOK_ACCOUNT_UNKNOWN",
        "Webhook did not include a recognizable payment account.",
        404
      );
    const account = await withPaymentWebhookLookupTransaction(
      this.prisma,
      providerAccountLookupHash(connectedAccountId),
      (tx) =>
        tx.paymentAccount.findFirst({
          where: {
            provider: this.providerKind,
            providerAccountLookupHash: providerAccountLookupHash(connectedAccountId)
          }
        })
    );
    if (!account)
      throw new AppError(
        "PAYMENT_WEBHOOK_ACCOUNT_UNKNOWN",
        "Webhook account is not recognized.",
        404
      );
    let webhook: {
      id: string;
      status: "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED";
      paymentId: string | null;
    };
    try {
      webhook = await withPaymentWebhookTransaction(
        this.prisma,
        dbContext(webhookContext(account.organizationId, account.createdByUserId)),
        async (tx) => {
          const created = await tx.paymentWebhookEvent.create({
            data: {
              organizationId: account.organizationId,
              paymentAccountId: account.id,
              provider: this.providerKind,
              providerEventId: event.eventId,
              eventType: event.eventType,
              payloadRedacted: {
                ...webhookEventPayload(event)
              }
            }
          });
          await tx.outboxEvent.create({
            data: {
              organizationId: account.organizationId,
              eventType: "payment.webhook-received",
              aggregateType: "PaymentWebhookEvent",
              aggregateId: created.id,
              payload: {
                webhookEventId: created.id,
                provider: this.providerKind,
                eventType: event.eventType,
                providerEventId: event.eventId
              }
            }
          });
          return { id: created.id, status: created.status, paymentId: created.paymentId };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const context = webhookContext(account.organizationId, account.createdByUserId);
      const existing = await withPaymentWebhookTransaction(this.prisma, dbContext(context), (tx) =>
        tx.paymentWebhookEvent.findFirst({
          where: {
            organizationId: account.organizationId,
            provider: this.providerKind,
            providerEventId: event.eventId
          }
        })
      );
      if (!existing) throw error;
      if (existing.status !== "FAILED") {
        if (existing.status === "RECEIVED" && process.env.NODE_ENV === "production")
          this.scheduleWebhookProcessing(
            account.organizationId,
            account.createdByUserId,
            existing.id
          );
        return { duplicate: true, paymentId: existing.paymentId };
      }
      webhook = await withPaymentWebhookTransaction(this.prisma, dbContext(context), async (tx) => {
        const replay = await tx.paymentWebhookEvent.update({
          where: { id: existing.id },
          data: {
            status: "RECEIVED",
            processingError: null,
            payloadRedacted: webhookEventPayload(event)
          }
        });
        await tx.outboxEvent.updateMany({
          where: {
            organizationId: account.organizationId,
            eventType: "payment.webhook-received",
            aggregateType: "PaymentWebhookEvent",
            aggregateId: existing.id,
            status: "FAILED"
          },
          data: { status: "PENDING", dispatchedAt: null }
        });
        return { id: replay.id, status: replay.status, paymentId: replay.paymentId };
      });
    }
    if (process.env.NODE_ENV === "production") {
      this.scheduleWebhookProcessing(account.organizationId, account.createdByUserId, webhook.id);
      return { duplicate: false, paymentId: null, accepted: true };
    }
    return this.processWebhookEvent(account.organizationId, account.createdByUserId, webhook.id);
  }

  private scheduleWebhookProcessing(
    organizationId: string,
    actorUserId: string,
    webhookId: string
  ): void {
    setImmediate(() => {
      void this.processWebhookEvent(organizationId, actorUserId, webhookId).catch(() => {
        // The durable webhook and outbox rows retain a redacted failure for replay.
      });
    });
  }

  /** A durable worker invokes this after an event has been persisted and enqueued. */
  public async processWebhookEvent(organizationId: string, actorUserId: string, webhookId: string) {
    const context = webhookContext(organizationId, actorUserId);
    const hydratedEvent = await this.hydrateProviderPaymentEvent(context, webhookId);
    try {
      return await withPaymentWebhookTransaction(
        this.prisma,
        dbContext(context),
        async (tx) => {
          const webhook = await tx.paymentWebhookEvent.findFirst({
            where: { id: webhookId, organizationId },
            include: { paymentAccount: true }
          });
          if (!webhook)
            throw new AppError("PAYMENT_WEBHOOK_NOT_FOUND", "Webhook event was not found.", 404);
          if (webhook.status === "PROCESSED" || webhook.status === "IGNORED")
            return { duplicate: true, paymentId: webhook.paymentId };
          const event = hydratedEvent ?? parseWebhookEventPayload(webhook.payloadRedacted);
          if (event.eventType === "payment_succeeded") {
            if (!event.providerSessionId)
              throw new AppError(
                "PAYMENT_WEBHOOK_INVALID",
                "Webhook checkout session is required.",
                422
              );
            const result = await this.postHostedPayment(
              tx,
              context,
              webhook.paymentAccountId,
              event
            );
            await tx.paymentWebhookEvent.update({
              where: { id: webhook.id },
              data: {
                paymentId: result.paymentId,
                status: "PROCESSED",
                processingError: null,
                processedAt: new Date()
              }
            });
            return { duplicate: false, paymentId: result.paymentId };
          }
          if (event.eventType === "refund_succeeded" || event.eventType === "refund_failed") {
            const paymentId = await this.recordRefundEvent(tx, context, event);
            await tx.paymentWebhookEvent.update({
              where: { id: webhook.id },
              data: {
                paymentId,
                status: "PROCESSED",
                processingError: null,
                processedAt: new Date()
              }
            });
            return { duplicate: false, paymentId };
          }
          if (event.eventType === "dispute_created" || event.eventType === "dispute_updated") {
            const paymentId = await this.recordDisputeEvent(tx, context, event);
            await tx.paymentWebhookEvent.update({
              where: { id: webhook.id },
              data: {
                paymentId,
                status: "PROCESSED",
                processingError: null,
                processedAt: new Date()
              }
            });
            return { duplicate: false, paymentId };
          }
          await tx.paymentWebhookEvent.update({
            where: { id: webhook.id },
            data: { status: "IGNORED", processingError: null, processedAt: new Date() }
          });
          return { duplicate: false, paymentId: null };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      await withPaymentWebhookTransaction(this.prisma, dbContext(context), (tx) =>
        tx.paymentWebhookEvent.update({
          where: { id: webhookId },
          data: { status: "FAILED", processingError: paymentWebhookErrorCode(error) }
        })
      );
      throw error;
    }
  }

  private async hydrateProviderPaymentEvent(
    context: OrganizationContext,
    webhookId: string
  ): Promise<NormalizedProviderEvent | null> {
    const snapshot = await withPaymentWebhookTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        const webhook = await tx.paymentWebhookEvent.findFirst({
          where: { id: webhookId, organizationId: context.organizationId },
          include: { paymentAccount: true }
        });
        if (!webhook || webhook.status !== "RECEIVED") return null;
        const event = parseWebhookEventPayload(webhook.payloadRedacted);
        if (
          event.eventType !== "payment_succeeded" ||
          event.feeMinor !== 0n ||
          !webhook.paymentAccount.providerAccountCiphertext
        )
          return null;
        return {
          event,
          connectedAccountId: this.protector.reveal(
            webhook.paymentAccount.providerAccountCiphertext
          )
        };
      }
    );
    if (!snapshot) return null;
    const [status, settlement] = await Promise.all([
      this.provider.retrievePaymentStatus(
        snapshot.connectedAccountId,
        snapshot.event.providerPaymentId
      ),
      this.provider.retrieveFeeAndSettlementMetadata(
        snapshot.connectedAccountId,
        snapshot.event.providerPaymentId
      )
    ]);
    if (
      status.status !== "SUCCEEDED" ||
      status.amountMinor !== snapshot.event.amountMinor ||
      status.currency !== snapshot.event.currency ||
      settlement.feeMinor < 0n ||
      settlement.feeMinor > snapshot.event.amountMinor ||
      settlement.netMinor !== snapshot.event.amountMinor - settlement.feeMinor
    )
      throw new AppError(
        "PAYMENT_WEBHOOK_PROVIDER_MISMATCH",
        "Webhook payment does not match verified provider state.",
        422
      );
    return { ...snapshot.event, feeMinor: settlement.feeMinor };
  }

  public async recordManual(
    context: OrganizationContext,
    input: ManualPaymentInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "payments:record", "Payment");
    assertSafePaymentReference(input.reference);
    const amountMinor = parseMinorUnit(input.amountMinor, "amountMinor");
    if (amountMinor <= 0n)
      throw new AppError("PAYMENT_AMOUNT_INVALID", "Payment amount must be positive.", 422);
    if (input.allocations.length === 0)
      throw new AppError(
        "PAYMENT_ALLOCATION_REQUIRED",
        "At least one invoice allocation is required.",
        422
      );
    const allocations = input.allocations.map((item) => ({
      invoiceId: item.invoiceId,
      amountMinor: parseMinorUnit(item.amountMinor, "allocation.amountMinor")
    }));
    if (allocations.some((item) => item.amountMinor <= 0n))
      throw new AppError("PAYMENT_ALLOCATION_INVALID", "Allocation amounts must be positive.", 422);
    if (new Set(allocations.map((item) => item.invoiceId)).size !== allocations.length)
      throw new AppError(
        "PAYMENT_ALLOCATION_DUPLICATE",
        "An invoice may be allocated once per payment.",
        422
      );
    const allocated = allocations.reduce((sum, item) => sum + item.amountMinor, 0n);
    if (allocated > amountMinor)
      throw new AppError(
        "PAYMENT_ALLOCATION_EXCEEDS_PAYMENT",
        "Allocations exceed the payment amount.",
        422
      );

    return runIdempotent(
      this.prisma,
      context,
      "payment.manual.record",
      idempotencyKey,
      input,
      async (tx) => {
        const duplicateReference = input.reference?.trim()
          ? await tx.payment.findFirst({
              where: {
                organizationId: context.organizationId,
                customerId: input.customerId,
                source: "MANUAL",
                reference: input.reference.trim()
              },
              select: { id: true }
            })
          : null;
        const result = await this.recordManualInTransaction(
          tx,
          context,
          input,
          amountMinor,
          allocations,
          allocated
        );
        return {
          statusCode: 201,
          body: {
            payment: result,
            warnings: duplicateReference
              ? [
                  {
                    code: "DUPLICATE_PAYMENT_REFERENCE",
                    existingPaymentId: duplicateReference.id
                  }
                ]
              : []
          },
          resourceId: result.id
        };
      }
    );
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "payments:read", "Payment");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const payments = await tx.payment.findMany({
        where: { organizationId: context.organizationId },
        include: { allocations: true, receipt: true },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }]
      });
      return payments.map(paymentDto);
    });
  }

  public async get(context: OrganizationContext, paymentId: string) {
    await this.authorization.assert(context, "payments:read", "Payment", paymentId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, organizationId: context.organizationId },
        include: {
          allocations: true,
          receipt: true,
          refunds: { orderBy: { createdAt: "asc" } }
        }
      });
      if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "Payment was not found.", 404);
      return {
        ...paymentDto(payment),
        receiptNumber: payment.receipt?.receiptNumber ?? null,
        refunds: payment.refunds.map(refundDto)
      };
    });
  }

  public async listDisputes(context: OrganizationContext) {
    await this.authorization.assert(context, "payments:disputes", "PaymentDispute");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const disputes = await tx.paymentDispute.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ createdAt: "desc" }]
      });
      return disputes.map((dispute) => ({
        id: dispute.id,
        paymentId: dispute.paymentId,
        amountMinor: serializeMinorUnit(dispute.amountMinor),
        status: dispute.status,
        reasonCategory: dispute.reasonCategory,
        evidenceDueAt: dispute.evidenceDueAt?.toISOString() ?? null,
        createdAt: dispute.createdAt.toISOString(),
        resolvedAt: dispute.resolvedAt?.toISOString() ?? null
      }));
    });
  }

  public async updateDisputeStatus(
    context: OrganizationContext,
    disputeId: string,
    status: "UNDER_REVIEW" | "WON" | "LOST" | "CLOSED"
  ) {
    await this.authorization.assert(context, "payments:disputes", "PaymentDispute", disputeId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const dispute = await tx.paymentDispute.findFirst({
        where: { id: disputeId, organizationId: context.organizationId }
      });
      if (!dispute)
        throw new AppError("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute was not found.", 404);
      if (!canTransitionDispute(dispute.status, status))
        throw new AppError(
          "PAYMENT_DISPUTE_TRANSITION_INVALID",
          "The dispute status transition is not allowed.",
          409
        );
      const updated = await tx.paymentDispute.update({
        where: { id: dispute.id },
        data: { status, resolvedAt: ["WON", "LOST", "CLOSED"].includes(status) ? new Date() : null }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_DISPUTE_STATUS_UPDATED",
          targetType: "PaymentDispute",
          targetId: dispute.id,
          metadata: withAuditOrigin(context, { previousStatus: dispute.status, status })
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "payment.dispute-status-updated",
          aggregateType: "PaymentDispute",
          aggregateId: dispute.id,
          payload: { disputeId: dispute.id, status }
        }
      });
      return {
        id: updated.id,
        status: updated.status,
        resolvedAt: updated.resolvedAt?.toISOString() ?? null
      };
    });
  }

  public async receipt(context: OrganizationContext, paymentId: string) {
    await this.authorization.assert(context, "payments:read", "PaymentReceipt", paymentId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const receipt = await tx.paymentReceipt.findFirst({
        where: { organizationId: context.organizationId, paymentId }
      });
      if (!receipt)
        throw new AppError("PAYMENT_RECEIPT_NOT_FOUND", "Payment receipt was not found.", 404);
      return {
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        renderData: receipt.renderData,
        renderDataHash: receipt.renderDataHash,
        createdAt: receipt.createdAt.toISOString()
      };
    });
  }

  public async resendReceipt(
    context: OrganizationContext,
    paymentId: string,
    idempotencyKey: string | undefined
  ) {
    this.assertEmailDeliveryEnabled();
    await this.authorization.assert(
      context,
      "payments:receipt-resend",
      "PaymentReceipt",
      paymentId
    );
    return runIdempotent(
      this.prisma,
      context,
      "payment.receipt.resend",
      idempotencyKey,
      { paymentId },
      async (tx) => {
        const receipt = await tx.paymentReceipt.findFirst({
          where: { organizationId: context.organizationId, paymentId },
          include: { payment: { include: { customer: true } } }
        });
        if (!receipt)
          throw new AppError("PAYMENT_RECEIPT_NOT_FOUND", "Payment receipt was not found.", 404);
        if (!receipt.payment.customer.email)
          throw new AppError(
            "PAYMENT_RECEIPT_EMAIL_UNAVAILABLE",
            "The customer does not have a receipt email address.",
            422
          );
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "payment.receipt-email-requested",
            aggregateType: "PaymentReceipt",
            aggregateId: receipt.id,
            payload: {
              receiptId: receipt.id,
              paymentId,
              recipientEmail: receipt.payment.customer.email
            }
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "PAYMENT_RECEIPT_RESEND_QUEUED",
            targetType: "PaymentReceipt",
            targetId: receipt.id,
            metadata: withAuditOrigin(context, { paymentId })
          }
        });
        return {
          statusCode: 202,
          body: { receiptId: receipt.id, queued: true },
          resourceId: receipt.id
        };
      }
    );
  }

  public async refund(
    context: OrganizationContext,
    paymentId: string,
    input: RefundInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "payments:refund", "Payment", paymentId);
    assertSafePaymentReference(input.reason);
    const amountMinor = parseMinorUnit(input.amountMinor, "amountMinor");
    if (amountMinor <= 0n)
      throw new AppError("PAYMENT_REFUND_AMOUNT_INVALID", "Refund amount must be positive.", 422);
    if (input.reason.trim().length === 0)
      throw new AppError("PAYMENT_REFUND_REASON_REQUIRED", "Refund reason is required.", 422);
    return runIdempotent<{
      refund: {
        id: string;
        paymentId: string;
        amountMinor: string;
        status: string;
        journalId: string | null;
      };
    }>(this.prisma, context, "payment.refund", idempotencyKey, { paymentId, input }, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, organizationId: context.organizationId }
      });
      if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "Payment was not found.", 404);
      // Hosted funds can only be refunded through the processor that received
      // them. A reconfigured application must fail closed rather than create a
      // local refund journal without returning money through that processor.
      if (payment.source === "HOSTED_CHECKOUT" && payment.provider !== this.providerKind)
        throw new AppError(
          "PAYMENT_REFUND_PROVIDER_MISMATCH",
          "This hosted payment must be refunded by its original payment provider.",
          409
        );
      const pendingRefunds = await tx.paymentRefund.aggregate({
        where: { organizationId: context.organizationId, paymentId, status: "PENDING" },
        _sum: { amountMinor: true }
      });
      const pendingRefundMinor = pendingRefunds._sum.amountMinor ?? 0n;
      if (
        !["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status) ||
        payment.refundedMinor + pendingRefundMinor + amountMinor > payment.amountMinor
      )
        throw new AppError(
          "PAYMENT_REFUND_NOT_ELIGIBLE",
          "Payment is not eligible for this refund.",
          409
        );
      if (input.treatment === "CREDIT_NOTE_AND_REFUND") {
        if (!input.creditNoteId)
          throw new AppError(
            "PAYMENT_REFUND_CREDIT_NOTE_REQUIRED",
            "A posted credit note is required for this refund treatment.",
            422
          );
        const creditNote = await tx.creditNote.findFirst({
          where: {
            id: input.creditNoteId,
            organizationId: context.organizationId,
            status: "POSTED"
          }
        });
        const allocation = creditNote
          ? await tx.paymentAllocation.findFirst({
              where: {
                paymentId,
                organizationId: context.organizationId,
                invoiceId: creditNote.invoiceId
              }
            })
          : null;
        if (!creditNote || !allocation)
          throw new AppError(
            "PAYMENT_REFUND_CREDIT_NOTE_INVALID",
            "The credit note must be posted for an invoice allocated by this payment.",
            409
          );
      } else {
        const pendingUnapplied = await tx.paymentRefund.aggregate({
          where: {
            organizationId: context.organizationId,
            paymentId,
            status: "PENDING",
            treatment: { in: ["CUSTOMER_CREDIT", "UNAPPLIED_PAYMENT"] }
          },
          _sum: { amountMinor: true }
        });
        if (
          input.creditNoteId ||
          payment.unappliedMinor - (pendingUnapplied._sum.amountMinor ?? 0n) < amountMinor
        )
          throw new AppError(
            "PAYMENT_REFUND_NOT_ELIGIBLE",
            "Only available unapplied customer credit can be refunded using this treatment.",
            409
          );
      }
      const receivingAccountId =
        payment.source === "MANUAL"
          ? payment.receivingAccountId
          : (
              await tx.paymentSettings.findFirst({
                where: { organizationId: context.organizationId }
              })
            )?.clearingAccountId;
      if (!receivingAccountId)
        throw new AppError(
          "PAYMENT_REFUND_ACCOUNT_REQUIRED",
          "Refund account is not configured.",
          422
        );
      let providerRefundId: string | null = null;
      let providerStatus: "PENDING" | "SUCCEEDED" | "FAILED" = "SUCCEEDED";
      if (payment.source === "HOSTED_CHECKOUT") {
        this.assertHostedPaymentsEnabled();
        const account = await tx.paymentAccount.findFirst({
          where: {
            ...(payment.paymentAccountId ? { id: payment.paymentAccountId } : {}),
            organizationId: context.organizationId,
            provider: this.providerKind
          }
        });
        if (!account?.providerAccountCiphertext || !payment.providerPaymentId)
          throw new AppError(
            "PAYMENT_REFUND_PROVIDER_UNAVAILABLE",
            "Payment provider refund is unavailable.",
            409
          );
        const providerRefund = await this.provider.createRefund({
          connectedAccountId: this.protector.reveal(account.providerAccountCiphertext),
          providerPaymentId: payment.providerPaymentId,
          amountMinor,
          idempotencyKey: idempotencyKey ?? `refund:${paymentId}:${amountMinor.toString()}`
        });
        providerRefundId = providerRefund.providerRefundId;
        providerStatus = providerRefund.status;
      }
      const refund = await tx.paymentRefund.create({
        data: {
          organizationId: context.organizationId,
          paymentId,
          creditNoteId:
            input.treatment === "CREDIT_NOTE_AND_REFUND" ? (input.creditNoteId ?? null) : null,
          providerRefundId,
          amountMinor,
          currency: payment.currency,
          status: "PENDING",
          treatment: input.treatment,
          reason: input.reason.trim(),
          requestedByUserId: context.user.id
        }
      });
      if (providerStatus === "FAILED") {
        const completedAt = new Date();
        await tx.paymentRefund.update({
          where: { id: refund.id },
          data: { status: "FAILED", completedAt }
        });
        await this.recordRefundAuditAndOutbox(
          tx,
          context,
          refund.id,
          paymentId,
          "PAYMENT_REFUND_FAILED",
          "payment.refund-failed",
          { amountMinor: amountMinor.toString(), treatment: input.treatment }
        );
        return {
          statusCode: 422,
          body: {
            refund: {
              id: refund.id,
              paymentId,
              amountMinor: serializeMinorUnit(amountMinor),
              status: "FAILED",
              journalId: null
            }
          },
          resourceId: refund.id
        };
      }
      if (providerStatus === "PENDING") {
        await this.recordRefundAuditAndOutbox(
          tx,
          context,
          refund.id,
          paymentId,
          "PAYMENT_REFUND_REQUESTED",
          "payment.refund-requested",
          { amountMinor: amountMinor.toString(), treatment: input.treatment }
        );
        return {
          statusCode: 202,
          body: {
            refund: {
              id: refund.id,
              paymentId,
              amountMinor: serializeMinorUnit(amountMinor),
              status: "PENDING",
              journalId: null
            }
          },
          resourceId: refund.id
        };
      }
      const completed = await this.completeRefundInTransaction(
        tx,
        context,
        refund.id,
        receivingAccountId,
        new Date()
      );
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_REFUND_POSTED",
          targetType: "PaymentRefund",
          targetId: refund.id,
          metadata: withAuditOrigin(context, {
            paymentId,
            journalId: completed.journalId,
            amountMinor: amountMinor.toString(),
            treatment: input.treatment
          })
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "payment.refund-posted",
          aggregateType: "PaymentRefund",
          aggregateId: refund.id,
          payload: { refundId: refund.id, paymentId, journalId: completed.journalId }
        }
      });
      return {
        statusCode: 201,
        body: {
          refund: {
            id: refund.id,
            paymentId,
            amountMinor: serializeMinorUnit(amountMinor),
            status: "SUCCEEDED",
            journalId: completed.journalId
          }
        },
        resourceId: refund.id
      };
    });
  }

  private assertHostedPaymentsEnabled(): void {
    if (!this.betaRuntime) return;
    throw new AppError(
      "BETA_HOSTED_PAYMENTS_DISABLED",
      "Hosted payments are disabled in this beta. Record a manual payment or refund only after funds move outside PennyWise Accounting.",
      409
    );
  }

  private assertEmailDeliveryEnabled(): void {
    if (!this.betaRuntime) return;
    throw new AppError(
      "BETA_EMAIL_DELIVERY_DISABLED",
      "Email delivery is disabled in this beta. Open the receipt and send it through your own email service.",
      409
    );
  }

  private async completeRefundInTransaction(
    tx: TransactionClient,
    context: OrganizationContext,
    refundId: string,
    receivingAccountId: string | null,
    occurredAt: Date
  ): Promise<{ paymentId: string; journalId: string }> {
    const refund = await tx.paymentRefund.findFirst({
      where: { id: refundId, organizationId: context.organizationId },
      include: { payment: true, creditNote: true }
    });
    if (!refund)
      throw new AppError("PAYMENT_REFUND_NOT_FOUND", "Payment refund was not found.", 404);
    if (refund.status === "SUCCEEDED" && refund.journalId)
      return { paymentId: refund.paymentId, journalId: refund.journalId };
    if (refund.status !== "PENDING")
      throw new AppError(
        "PAYMENT_REFUND_STATUS_INVALID",
        "Payment refund cannot be completed from its current status.",
        409
      );
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${refund.paymentId}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
    const payment = await tx.payment.findFirstOrThrow({
      where: { id: refund.paymentId, organizationId: context.organizationId }
    });
    const refundAccountId =
      receivingAccountId ??
      (payment.source === "MANUAL"
        ? payment.receivingAccountId
        : (
            await tx.paymentSettings.findFirst({
              where: { organizationId: context.organizationId }
            })
          )?.clearingAccountId);
    if (!refundAccountId)
      throw new AppError(
        "PAYMENT_REFUND_ACCOUNT_REQUIRED",
        "Refund account is not configured.",
        422
      );
    const ar = await tx.account.findFirst({
      where: {
        organizationId: context.organizationId,
        systemPurpose: "accounts-receivable",
        isControl: true,
        isArchived: false
      }
    });
    if (!ar)
      throw new AppError(
        "RECEIVABLE_CONTROL_ACCOUNT_REQUIRED",
        "Accounts-receivable control account is not configured.",
        422
      );
    const journal = await this.journals.postJournalInTransaction(
      tx,
      context,
      refundJournal(refund.id, occurredAt, ar.id, refundAccountId, refund.amountMinor),
      true
    );
    await tx.paymentRefund.update({
      where: { id: refund.id },
      data: {
        status: "SUCCEEDED",
        journalId: journal.id,
        completedAt: occurredAt
      }
    });
    const refundedMinor = payment.refundedMinor + refund.amountMinor;
    if (refundedMinor > payment.amountMinor)
      throw new AppError(
        "PAYMENT_REFUND_NOT_ELIGIBLE",
        "Confirmed refunds exceed the payment amount.",
        409
      );
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedMinor,
        unappliedMinor:
          refund.treatment === "CREDIT_NOTE_AND_REFUND"
            ? payment.unappliedMinor
            : payment.unappliedMinor - refund.amountMinor,
        status: refundedMinor === payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
        version: { increment: 1 }
      }
    });
    if (refund.creditNote) {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: refund.creditNote.invoiceId,
          organizationId: context.organizationId
        },
        include: { creditNotes: { where: { status: "POSTED" } } }
      });
      if (!invoice || invoice.amountPaidMinor < refund.amountMinor)
        throw new AppError(
          "PAYMENT_REFUND_CREDIT_NOTE_INVALID",
          "The payment allocation cannot be reduced by this refund.",
          409
        );
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaidMinor: invoice.amountPaidMinor - refund.amountMinor,
          version: { increment: 1 }
        }
      });
    }
    return { paymentId: payment.id, journalId: journal.id };
  }

  private async recordRefundEvent(
    tx: TransactionClient,
    context: OrganizationContext,
    event: NormalizedProviderEvent
  ): Promise<string> {
    if (!event.providerRefundId)
      throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook refund identifier is required.", 422);
    const refund = await tx.paymentRefund.findFirst({
      where: {
        organizationId: context.organizationId,
        providerRefundId: event.providerRefundId
      }
    });
    if (!refund || refund.amountMinor !== event.amountMinor || refund.currency !== event.currency)
      throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook refund is not recognized.", 422);
    if (refund.status === "SUCCEEDED" || refund.status === "FAILED") return refund.paymentId;
    if (event.eventType === "refund_failed") {
      await tx.paymentRefund.update({
        where: { id: refund.id },
        data: { status: "FAILED", completedAt: event.occurredAt }
      });
      await this.recordRefundAuditAndOutbox(
        tx,
        context,
        refund.id,
        refund.paymentId,
        "PAYMENT_REFUND_FAILED",
        "payment.refund-failed",
        { providerRefundId: event.providerRefundId }
      );
      return refund.paymentId;
    }
    const completed = await this.completeRefundInTransaction(
      tx,
      context,
      refund.id,
      null,
      event.occurredAt
    );
    await this.recordRefundAuditAndOutbox(
      tx,
      context,
      refund.id,
      refund.paymentId,
      "PAYMENT_REFUND_POSTED",
      "payment.refund-posted",
      { providerRefundId: event.providerRefundId, journalId: completed.journalId }
    );
    return completed.paymentId;
  }

  private async recordRefundAuditAndOutbox(
    tx: TransactionClient,
    context: OrganizationContext,
    refundId: string,
    paymentId: string,
    action: string,
    eventType: string,
    metadata: Prisma.InputJsonObject
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        action,
        targetType: "PaymentRefund",
        targetId: refundId,
        metadata: withAuditOrigin(context, metadata)
      }
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: context.organizationId,
        eventType,
        aggregateType: "PaymentRefund",
        aggregateId: refundId,
        payload: { refundId, paymentId, ...metadata }
      }
    });
  }

  /**
   * Posts a manual receipt inside a caller-owned transaction. This is public
   * only for atomic workflows such as bank-deposit confirmation; callers must
   * supply a transaction and must not invoke it outside a transaction.
   */
  public async recordManualInTransaction(
    tx: TransactionClient,
    context: OrganizationContext,
    input: ManualPaymentInput,
    amountMinor: bigint,
    allocations: readonly { invoiceId: string; amountMinor: bigint }[],
    allocated: bigint
  ) {
    const receiving = await tx.account.findFirst({
      where: {
        id: input.receivingAccountId,
        organizationId: context.organizationId,
        isArchived: false
      }
    });
    if (!receiving)
      throw new AppError("RECEIVING_ACCOUNT_NOT_FOUND", "Receiving account was not found.", 422);
    if (receiving.type !== "ASSET")
      throw new AppError(
        "RECEIVING_ACCOUNT_INVALID",
        "Customer payments must be received into an asset account.",
        422
      );
    const ar = await tx.account.findFirst({
      where: {
        organizationId: context.organizationId,
        systemPurpose: "accounts-receivable",
        isControl: true,
        isArchived: false
      }
    });
    if (!ar)
      throw new AppError(
        "RECEIVABLE_CONTROL_ACCOUNT_REQUIRED",
        "Accounts-receivable control account is not configured.",
        422
      );

    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
      select: { currency: true }
    });
    const paymentDate = parseDate(input.paymentDate, "paymentDate");
    let paymentCurrency: string | null = input.currency?.trim().toUpperCase() ?? null;
    let settlementRate: {
      id: string;
      transactionCurrency: string;
      baseCurrency: string;
      transactionExponent: number;
      baseExponent: number;
      numerator: bigint;
      denominator: bigint;
    } | null = null;
    let receivableCarryingMinor = 0n;
    let receivableCarryingBaseMinor = 0n;
    let realizedGainAccountId: string | null = null;
    let realizedLossAccountId: string | null = null;
    let positionSettlements: {
      allocation: { invoiceId: string; amountMinor: bigint };
      quote: PositionSettlement;
    }[] = [];
    for (const allocation of [...allocations].sort((a, b) =>
      a.invoiceId.localeCompare(b.invoiceId)
    )) {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${allocation.invoiceId}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: { id: allocation.invoiceId, organizationId: context.organizationId },
        include: { creditNotes: { where: { status: "POSTED" } } }
      });
      if (!invoice || invoice.customerId !== input.customerId)
        throw new AppError(
          "PAYMENT_ALLOCATION_INVALID",
          "Allocations must belong to the payment customer.",
          422
        );
      const invoiceCurrency = invoice.currency.trim();
      if (paymentCurrency && paymentCurrency !== invoiceCurrency)
        throw new AppError(
          "PAYMENT_CURRENCY_MISMATCH",
          "All payment allocations must use one currency.",
          422
        );
      paymentCurrency = invoiceCurrency;
      receivableCarryingMinor += allocation.amountMinor;
      if (invoiceCurrency === organization.currency.trim()) {
        receivableCarryingBaseMinor += allocation.amountMinor;
      } else {
        if (!invoice.fxRateSnapshotId)
          throw new AppError(
            "FX_RATE_REQUIRED",
            "The foreign invoice is missing its original rate snapshot.",
            422
          );
        const invoiceRate = await tx.fxRateSnapshot.findFirst({
          where: { id: invoice.fxRateSnapshotId, organizationId: context.organizationId },
          select: {
            transactionCurrency: true,
            baseCurrency: true,
            transactionExponent: true,
            baseExponent: true,
            numerator: true,
            denominator: true
          }
        });
        if (!invoiceRate)
          throw new AppError("FX_RATE_NOT_FOUND", "The invoice rate snapshot was not found.", 422);
        receivableCarryingBaseMinor += convertMinorUnits(
          allocation.amountMinor,
          {
            code: invoiceCurrency,
            exponent: invoiceRate.transactionExponent,
            name: invoiceCurrency
          },
          {
            code: organization.currency.trim(),
            exponent: invoiceRate.baseExponent,
            name: organization.currency.trim()
          },
          { numerator: invoiceRate.numerator, denominator: invoiceRate.denominator }
        );
      }
      const credits = invoice.creditNotes.reduce((sum, item) => sum + item.grandTotalMinor, 0n);
      if (
        !["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status) ||
        invoice.amountPaidMinor + allocation.amountMinor > invoice.grandTotalMinor - credits
      )
        throw new AppError(
          "PAYMENT_ALLOCATION_INVALID",
          "Invoice is not eligible for this allocation.",
          422
        );
    }

    paymentCurrency ??= organization.currency.trim();
    if (paymentCurrency !== organization.currency.trim()) {
      if (amountMinor !== allocated)
        throw new AppError(
          "FOREIGN_PAYMENT_UNAPPLIED_UNSUPPORTED",
          "Foreign-currency payments must be fully allocated in the first release.",
          422
        );
      if (!input.fxRateSnapshotId)
        throw new AppError(
          "FX_RATE_REQUIRED",
          "A settlement FX rate snapshot is required for a foreign-currency payment.",
          422
        );
      const snapshot = await tx.fxRateSnapshot.findFirst({
        where: { id: input.fxRateSnapshotId, organizationId: context.organizationId },
        select: {
          id: true,
          transactionCurrency: true,
          baseCurrency: true,
          transactionExponent: true,
          baseExponent: true,
          numerator: true,
          denominator: true,
          purpose: true,
          effectiveAt: true
        }
      });
      if (
        !snapshot ||
        snapshot.transactionCurrency.trim() !== paymentCurrency ||
        snapshot.baseCurrency.trim() !== organization.currency.trim() ||
        !["TRANSACTION", "ACTUAL_SETTLEMENT"].includes(snapshot.purpose) ||
        snapshot.effectiveAt.toISOString().slice(0, 10) !== input.paymentDate
      )
        throw new AppError(
          "FX_RATE_CURRENCY_MISMATCH",
          "Settlement FX rate does not match the payment currency.",
          422
        );
      settlementRate = {
        ...snapshot,
        transactionCurrency: snapshot.transactionCurrency.trim(),
        baseCurrency: snapshot.baseCurrency.trim()
      };
      realizedGainAccountId =
        (
          await tx.account.findFirst({
            where: {
              organizationId: context.organizationId,
              systemPurpose: "realized-fx-gain",
              isArchived: false
            },
            select: { id: true }
          })
        )?.id ?? null;
      realizedLossAccountId =
        (
          await tx.account.findFirst({
            where: {
              organizationId: context.organizationId,
              systemPurpose: "realized-fx-loss",
              isArchived: false
            },
            select: { id: true }
          })
        )?.id ?? null;
      if (
        amountMinor !== receivableCarryingMinor ||
        !realizedGainAccountId ||
        !realizedLossAccountId
      )
        throw new AppError(
          "FX_SETTLEMENT_ACCOUNTS_REQUIRED",
          "Foreign settlement requires a fully allocated payment and realized FX accounts.",
          422
        );
      const settlementBaseMinor = convertMinorUnits(
        amountMinor,
        {
          code: paymentCurrency,
          exponent: settlementRate.transactionExponent,
          name: paymentCurrency
        },
        {
          code: settlementRate.baseCurrency,
          exponent: settlementRate.baseExponent,
          name: settlementRate.baseCurrency
        },
        { numerator: settlementRate.numerator, denominator: settlementRate.denominator }
      );
      const settlementAllocations = allocateMinorUnits(
        settlementBaseMinor,
        allocations.map((allocation) => ({ weight: allocation.amountMinor }))
      );
      positionSettlements = [];
      receivableCarryingBaseMinor = 0n;
      for (const [index, allocation] of allocations.entries()) {
        const quote = await this.monetaryPositions.quoteSettlement(tx, {
          organizationId: context.organizationId,
          positionSourceType: "invoice",
          positionSourceId: allocation.invoiceId,
          transactionMinor: allocation.amountMinor,
          settlementBaseMinor: settlementAllocations[index]!,
          eventDate: paymentDate
        });
        receivableCarryingBaseMinor += quote.carryingBaseRelievedMinor;
        positionSettlements.push({ allocation, quote });
      }
    }

    const payment = await tx.payment.create({
      data: {
        organizationId: context.organizationId,
        customerId: input.customerId,
        provider: "MANUAL",
        amountMinor,
        feeMinor: 0n,
        netMinor: amountMinor,
        unappliedMinor: amountMinor,
        currency: paymentCurrency,
        fxRateSnapshotId: settlementRate?.id ?? null,
        status: "SUCCEEDED",
        paymentDate,
        methodCategory: input.methodCategory,
        source: "MANUAL",
        receivingAccountId: receiving.id,
        reference: input.reference?.trim() || null,
        createdByUserId: context.user.id
      }
    });
    const journal = await this.journals.postJournalInTransaction(
      tx,
      context,
      manualJournal(
        payment.id,
        input.paymentDate,
        receiving.id,
        ar.id,
        amountMinor,
        paymentCurrency,
        settlementRate,
        receivableCarryingMinor,
        receivableCarryingBaseMinor,
        realizedGainAccountId,
        realizedLossAccountId
      ),
      true
    );
    await tx.payment.update({
      where: { id: payment.id },
      data: { journalId: journal.id, unappliedMinor: amountMinor - allocated }
    });
    if (settlementRate) {
      for (const settlement of positionSettlements) {
        await this.monetaryPositions.settle(tx, {
          organizationId: context.organizationId,
          positionSourceType: "invoice",
          positionSourceId: settlement.allocation.invoiceId,
          transactionMinor: settlement.allocation.amountMinor,
          settlementBaseMinor: settlement.quote.settlementBaseMinor,
          eventDate: paymentDate,
          rateSnapshotId: settlementRate.id,
          journalId: journal.id,
          sourceType: "customer_payment",
          sourceId: `${payment.id}:${settlement.allocation.invoiceId}`
        });
      }
      await this.monetaryPositions.recognize(tx, {
        organizationId: context.organizationId,
        accountId: receiving.id,
        kind: "BANK",
        currency: paymentCurrency,
        sourceType: "foreign_receipt",
        sourceId: payment.id,
        transactionMinor: amountMinor,
        baseMinor: positionSettlements.reduce(
          (sum, settlement) => sum + settlement.quote.settlementBaseMinor,
          0n
        ),
        eventDate: paymentDate,
        rateSnapshotId: settlementRate.id,
        journalId: journal.id
      });
    }
    for (const allocation of allocations) {
      const positionSettlement = positionSettlements.find(
        (candidate) => candidate.allocation.invoiceId === allocation.invoiceId
      );
      await tx.paymentAllocation.create({
        data: {
          organizationId: context.organizationId,
          paymentId: payment.id,
          invoiceId: allocation.invoiceId,
          amountMinor: allocation.amountMinor,
          carryingBaseRelievedMinor:
            positionSettlement?.quote.carryingBaseRelievedMinor ?? allocation.amountMinor,
          settlementBaseMinor:
            positionSettlement?.quote.settlementBaseMinor ?? allocation.amountMinor,
          realizedFxBaseMinor: positionSettlement?.quote.realizedFxBaseMinor ?? 0n
        }
      });
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: allocation.invoiceId },
        include: { creditNotes: { where: { status: "POSTED" } } }
      });
      const paid = invoice.amountPaidMinor + allocation.amountMinor;
      const credits = invoice.creditNotes.reduce((sum, item) => sum + item.grandTotalMinor, 0n);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaidMinor: paid,
          status: paid + credits >= invoice.grandTotalMinor ? "PAID" : "PARTIALLY_PAID",
          version: { increment: 1 }
        }
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        action: "PAYMENT_MANUAL_RECORDED",
        targetType: "Payment",
        targetId: payment.id,
        metadata: withAuditOrigin(context, {
          amountMinor: amountMinor.toString(),
          allocationCount: allocations.length,
          journalId: journal.id
        })
      }
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: context.organizationId,
        eventType: "payment.manual-recorded",
        aggregateType: "Payment",
        aggregateId: payment.id,
        payload: { paymentId: payment.id, journalId: journal.id }
      }
    });
    await this.createReceipt(tx, context.organizationId, payment.id);
    const complete = await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { allocations: true }
    });
    return paymentDto(complete);
  }

  private assertPublicCheckoutRateLimit(tokenHash: string): void {
    const now = Date.now();
    const existing = this.publicCheckoutHits.get(tokenHash);
    if (!existing || now - existing.startedAt >= 60_000) {
      this.publicCheckoutHits.set(tokenHash, { count: 1, startedAt: now });
      return;
    }
    existing.count += 1;
    if (existing.count > 10)
      throw new AppError("PAYMENT_CHECKOUT_RATE_LIMITED", "Too many checkout requests.", 429);
  }

  private async recordDisputeEvent(
    tx: TransactionClient,
    context: OrganizationContext,
    event: NormalizedProviderEvent
  ): Promise<string> {
    if (!event.providerDisputeId)
      throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook dispute identifier is required.", 422);
    const payment = await tx.payment.findFirst({
      where: {
        organizationId: context.organizationId,
        provider: this.providerKind,
        providerPaymentId: event.providerPaymentId
      }
    });
    if (!payment)
      throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook payment is not recognized.", 422);
    const existing = await tx.paymentDispute.findFirst({
      where: { organizationId: context.organizationId, providerDisputeId: event.providerDisputeId }
    });
    const nextStatus = event.disputeStatus ?? "REVIEW_REQUIRED";
    const terminal = existing && ["WON", "LOST", "CLOSED"].includes(existing.status);
    const disputeData = {
      amountMinor: event.amountMinor,
      reasonCategory: event.reasonCategory ?? null,
      evidenceDueAt: event.evidenceDueAt ?? null,
      status: terminal ? existing.status : nextStatus,
      resolvedAt:
        terminal || ["WON", "LOST", "CLOSED"].includes(nextStatus)
          ? (existing?.resolvedAt ?? event.occurredAt)
          : null
    };
    const dispute = existing
      ? await tx.paymentDispute.update({ where: { id: existing.id }, data: disputeData })
      : await tx.paymentDispute.create({
          data: {
            organizationId: context.organizationId,
            paymentId: payment.id,
            providerDisputeId: event.providerDisputeId,
            ...disputeData
          }
        });
    if (
      ["REVIEW_REQUIRED", "UNDER_REVIEW"].includes(dispute.status) &&
      ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)
    ) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "DISPUTED", version: { increment: 1 } }
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        action:
          dispute.status === "WON" || dispute.status === "LOST"
            ? `PAYMENT_DISPUTE_${dispute.status}`
            : "PAYMENT_DISPUTE_REVIEW_REQUIRED",
        targetType: "PaymentDispute",
        targetId: dispute.id,
        metadata: withAuditOrigin(context, {
          paymentId: payment.id,
          providerDisputeId: event.providerDisputeId,
          amountMinor: event.amountMinor.toString()
        })
      }
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: context.organizationId,
        eventType: "payment.dispute-review-required",
        aggregateType: "PaymentDispute",
        aggregateId: dispute.id,
        payload: { disputeId: dispute.id, paymentId: payment.id }
      }
    });
    return payment.id;
  }

  private async postHostedPayment(
    tx: TransactionClient,
    context: OrganizationContext,
    paymentAccountId: string,
    event: NormalizedProviderEvent
  ) {
    const checkout = await tx.paymentCheckoutSession.findFirst({
      where: {
        organizationId: context.organizationId,
        paymentAccountId,
        ...(isUuid(event.providerSessionId!)
          ? {
              OR: [
                { id: event.providerSessionId! },
                { providerSessionId: event.providerSessionId! }
              ]
            }
          : { providerSessionId: event.providerSessionId! }),
        completedAt: null,
        cancelledAt: null,
        expiresAt: { gt: new Date() }
      },
      include: { invoice: { include: { creditNotes: { where: { status: "POSTED" } } } } }
    });
    if (
      !checkout ||
      checkout.currency !== event.currency ||
      checkout.requestedAmountMinor !== event.amountMinor
    )
      throw new AppError(
        "PAYMENT_WEBHOOK_INVALID",
        "Webhook does not match an active checkout session.",
        422
      );
    const settings = await tx.paymentSettings.findFirst({
      where: { organizationId: context.organizationId }
    });
    const ar = await tx.account.findFirst({
      where: {
        organizationId: context.organizationId,
        systemPurpose: "accounts-receivable",
        isControl: true,
        isArchived: false
      }
    });
    if (!settings || !ar)
      throw new AppError(
        "PAYMENT_CONFIGURATION_REQUIRED",
        "Payment accounting is not configured.",
        422
      );
    const invoice = checkout.invoice;
    const credits = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
    if (
      !["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status) ||
      invoice.amountPaidMinor + event.amountMinor > invoice.grandTotalMinor - credits
    )
      throw new AppError(
        "PAYMENT_INVOICE_NOT_ELIGIBLE",
        "Invoice cannot receive this payment.",
        409
      );
    const payment = await tx.payment.create({
      data: {
        organizationId: context.organizationId,
        customerId: invoice.customerId,
        paymentAccountId,
        provider: this.providerKind,
        providerPaymentId: event.providerPaymentId,
        amountMinor: event.amountMinor,
        feeMinor: event.feeMinor,
        netMinor: event.amountMinor - event.feeMinor,
        unappliedMinor: 0n,
        currency: event.currency,
        status: "SUCCEEDED",
        paymentDate: new Date(event.occurredAt.toISOString().slice(0, 10)),
        methodCategory: "CARD",
        source: "HOSTED_CHECKOUT",
        createdByUserId: context.user.id
      }
    });
    const journal = await this.journals.postJournalInTransaction(
      tx,
      context,
      hostedJournal(
        payment.id,
        event.occurredAt,
        settings.clearingAccountId,
        settings.feeExpenseAccountId,
        ar.id,
        event.amountMinor,
        event.feeMinor
      ),
      true
    );
    await tx.payment.update({ where: { id: payment.id }, data: { journalId: journal.id } });
    await tx.paymentAllocation.create({
      data: {
        organizationId: context.organizationId,
        paymentId: payment.id,
        invoiceId: invoice.id,
        amountMinor: event.amountMinor
      }
    });
    const paid = invoice.amountPaidMinor + event.amountMinor;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaidMinor: paid,
        status: paid + credits >= invoice.grandTotalMinor ? "PAID" : "PARTIALLY_PAID",
        version: { increment: 1 }
      }
    });
    await tx.paymentCheckoutSession.update({
      where: { id: checkout.id },
      data: { completedAt: new Date() }
    });
    await this.createReceipt(tx, context.organizationId, payment.id);
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        action: "PAYMENT_HOSTED_POSTED",
        targetType: "Payment",
        targetId: payment.id,
        metadata: {
          providerPaymentId: event.providerPaymentId,
          journalId: journal.id,
          amountMinor: event.amountMinor.toString(),
          feeMinor: event.feeMinor.toString()
        }
      }
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: context.organizationId,
        eventType: "payment.hosted-posted",
        aggregateType: "Payment",
        aggregateId: payment.id,
        payload: { paymentId: payment.id, journalId: journal.id }
      }
    });
    return { paymentId: payment.id };
  }

  private async createReceipt(tx: TransactionClient, organizationId: string, paymentId: string) {
    const existing = await tx.paymentReceipt.findFirst({ where: { organizationId, paymentId } });
    if (existing) return existing;
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, organizationId },
      include: { allocations: { include: { invoice: true } } }
    });
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "Payment was not found.", 404);
    const receiptNumber = await allocateReceiptNumber(tx, organizationId);
    const renderData = {
      receiptNumber,
      paymentDate: payment.paymentDate.toISOString().slice(0, 10),
      amountMinor: payment.amountMinor.toString(),
      methodCategory: payment.methodCategory,
      currency: payment.currency,
      refundedMinor: payment.refundedMinor.toString(),
      allocations: payment.allocations.map((allocation) => ({
        invoiceNumber: allocation.invoice.invoiceNumber,
        amountMinor: allocation.amountMinor.toString(),
        remainingMinor: (
          allocation.invoice.grandTotalMinor - allocation.invoice.amountPaidMinor
        ).toString()
      }))
    } as Prisma.InputJsonObject;
    return tx.paymentReceipt.create({
      data: {
        organizationId,
        paymentId,
        receiptNumber,
        renderData,
        renderDataHash: createHash("sha256").update(JSON.stringify(renderData)).digest("hex")
      }
    });
  }
}

async function allocateReceiptNumber(tx: TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<readonly { allocatedValue: bigint }[]>`
    INSERT INTO "PaymentReceiptSequence" ("organizationId", "nextValue")
    VALUES (${organizationId}::uuid, 2)
    ON CONFLICT ("organizationId")
    DO UPDATE SET
      "nextValue" = "PaymentReceiptSequence"."nextValue" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "nextValue" - 1 AS "allocatedValue"
  `;
  const allocatedValue = rows[0]?.allocatedValue;
  if (!allocatedValue || allocatedValue <= 0n)
    throw new AppError(
      "PAYMENT_RECEIPT_NUMBER_UNAVAILABLE",
      "Receipt number allocation failed.",
      500
    );
  return `RCT-${allocatedValue.toString().padStart(12, "0")}`;
}

function manualJournal(
  paymentId: string,
  paymentDate: string,
  receivingAccountId: string,
  arAccountId: string,
  amountMinor: bigint,
  currency: string,
  settlementRate: PaymentRate | null,
  receivableCarryingMinor: bigint,
  receivableCarryingBaseMinor: bigint,
  realizedGainAccountId: string | null,
  realizedLossAccountId: string | null
): PostJournalInput {
  const foreign = settlementRate && currency.trim() !== settlementRate.baseCurrency.trim();
  if (!foreign) {
    return {
      description: `Manual customer payment ${paymentId}`,
      effectiveDate: paymentDate,
      sourceType: "manual_payment",
      sourceId: paymentId,
      postingKey: `payment:${paymentId}`,
      allowControlAccountPosting: true,
      lines: [
        {
          accountId: receivingAccountId,
          description: "Customer payment received",
          debitMinor: amountMinor.toString(),
          creditMinor: "0"
        },
        {
          accountId: arAccountId,
          description: "Accounts receivable payment",
          debitMinor: "0",
          creditMinor: amountMinor.toString()
        }
      ]
    };
  }
  const settlementBaseMinor = convertMinorUnits(
    amountMinor,
    { code: currency, exponent: settlementRate.transactionExponent, name: currency },
    {
      code: settlementRate.baseCurrency,
      exponent: settlementRate.baseExponent,
      name: settlementRate.baseCurrency
    },
    { numerator: settlementRate.numerator, denominator: settlementRate.denominator }
  );
  const realizedDelta = settlementBaseMinor - receivableCarryingBaseMinor;
  const lines: PostJournalInput["lines"][number][] = [
    {
      accountId: receivingAccountId,
      description: "Foreign-currency customer payment received",
      debitMinor: settlementBaseMinor.toString(),
      creditMinor: "0",
      transactionMinor: amountMinor.toString()
    },
    {
      accountId: arAccountId,
      description: "Accounts receivable carrying value",
      debitMinor: "0",
      creditMinor: receivableCarryingBaseMinor.toString(),
      transactionMinor: (-receivableCarryingMinor).toString(),
      conversionPolicy: "CARRYING_VALUE"
    }
  ];
  if (realizedDelta > 0n) {
    lines.push({
      accountId: realizedGainAccountId!,
      description: "Realized FX gain",
      debitMinor: "0",
      creditMinor: realizedDelta.toString()
    });
  } else if (realizedDelta < 0n) {
    lines.push({
      accountId: realizedLossAccountId!,
      description: "Realized FX loss",
      debitMinor: (-realizedDelta).toString(),
      creditMinor: "0"
    });
  }
  return {
    description: `Manual customer payment ${paymentId}`,
    effectiveDate: paymentDate,
    sourceType: "manual_payment",
    sourceId: paymentId,
    postingKey: `payment:${paymentId}`,
    transactionCurrency: currency,
    fxRateSnapshotId: settlementRate.id,
    allowControlAccountPosting: true,
    lines
  };
}

interface PaymentRate {
  readonly id: string;
  readonly transactionCurrency: string;
  readonly baseCurrency: string;
  readonly transactionExponent: number;
  readonly baseExponent: number;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function hostedJournal(
  paymentId: string,
  occurredAt: Date,
  clearingAccountId: string,
  feeExpenseAccountId: string,
  arAccountId: string,
  amountMinor: bigint,
  feeMinor: bigint
): PostJournalInput {
  const lines: PostJournalInput["lines"][number][] = [
    {
      accountId: clearingAccountId,
      description: "Card payment clearing",
      debitMinor: amountMinor.toString(),
      creditMinor: "0"
    },
    {
      accountId: arAccountId,
      description: "Accounts receivable payment",
      debitMinor: "0",
      creditMinor: amountMinor.toString()
    }
  ];
  if (feeMinor > 0n)
    lines.push(
      {
        accountId: feeExpenseAccountId,
        description: "Payment processing fee",
        debitMinor: feeMinor.toString(),
        creditMinor: "0"
      },
      {
        accountId: clearingAccountId,
        description: "Payment processing fee",
        debitMinor: "0",
        creditMinor: feeMinor.toString()
      }
    );
  return {
    description: `Hosted card payment ${paymentId}`,
    effectiveDate: occurredAt.toISOString().slice(0, 10),
    sourceType: "hosted_payment",
    sourceId: paymentId,
    postingKey: `payment:${paymentId}`,
    allowControlAccountPosting: true,
    lines
  };
}

function refundJournal(
  refundId: string,
  occurredAt: Date,
  arAccountId: string,
  receivingAccountId: string,
  amountMinor: bigint
): PostJournalInput {
  return {
    description: `Customer payment refund ${refundId}`,
    effectiveDate: occurredAt.toISOString().slice(0, 10),
    sourceType: "payment_refund",
    sourceId: refundId,
    postingKey: `payment-refund:${refundId}`,
    allowControlAccountPosting: true,
    lines: [
      {
        accountId: arAccountId,
        description: "Customer credit refund",
        debitMinor: amountMinor.toString(),
        creditMinor: "0"
      },
      {
        accountId: receivingAccountId,
        description: "Customer payment refund",
        debitMinor: "0",
        creditMinor: amountMinor.toString()
      }
    ]
  };
}

function paymentDto(payment: {
  id: string;
  journalId: string | null;
  currency: string;
  fxRateSnapshotId: string | null;
  paymentDate: Date;
  amountMinor: bigint;
  unappliedMinor: bigint;
  refundedMinor: bigint;
  status: string;
  allocations: readonly {
    invoiceId: string;
    amountMinor: bigint;
    carryingBaseRelievedMinor: bigint;
    settlementBaseMinor: bigint;
    realizedFxBaseMinor: bigint;
  }[];
}) {
  return {
    id: payment.id,
    journalId: payment.journalId,
    status: payment.status,
    currency: payment.currency.trim(),
    fxRateSnapshotId: payment.fxRateSnapshotId,
    paymentDate: payment.paymentDate.toISOString().slice(0, 10),
    amountMinor: serializeMinorUnit(payment.amountMinor),
    unappliedMinor: serializeMinorUnit(payment.unappliedMinor),
    refundedMinor: serializeMinorUnit(payment.refundedMinor),
    allocations: payment.allocations.map((item) => ({
      invoiceId: item.invoiceId,
      amountMinor: serializeMinorUnit(item.amountMinor),
      carryingBaseRelievedMinor: serializeMinorUnit(item.carryingBaseRelievedMinor),
      settlementBaseMinor: serializeMinorUnit(item.settlementBaseMinor),
      realizedFxBaseMinor: serializeMinorUnit(item.realizedFxBaseMinor)
    }))
  };
}

function refundDto(refund: {
  id: string;
  amountMinor: bigint;
  status: string;
  treatment: string;
  reason: string;
  creditNoteId: string | null;
  journalId: string | null;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: refund.id,
    amountMinor: serializeMinorUnit(refund.amountMinor),
    status: refund.status,
    treatment: refund.treatment,
    reason: refund.reason,
    creditNoteId: refund.creditNoteId,
    journalId: refund.journalId,
    completedAt: refund.completedAt?.toISOString() ?? null,
    createdAt: refund.createdAt.toISOString()
  };
}

function canTransitionDispute(
  current: string,
  next: "UNDER_REVIEW" | "WON" | "LOST" | "CLOSED"
): boolean {
  const transitions: Readonly<Record<string, readonly string[]>> = {
    REVIEW_REQUIRED: ["UNDER_REVIEW", "WON", "LOST", "CLOSED"],
    UNDER_REVIEW: ["WON", "LOST", "CLOSED"],
    WON: ["CLOSED"],
    LOST: ["CLOSED"],
    CLOSED: []
  };
  return transitions[current]?.includes(next) ?? false;
}

function paymentSettingsDto(settings: {
  clearingAccountId: string;
  feeExpenseAccountId: string;
  allowPartialPayments: boolean;
  minimumPartialMinor: bigint;
  version: number;
}) {
  return {
    clearingAccountId: settings.clearingAccountId,
    feeExpenseAccountId: settings.feeExpenseAccountId,
    allowPartialPayments: settings.allowPartialPayments,
    minimumPartialMinor: serializeMinorUnit(settings.minimumPartialMinor),
    version: settings.version
  };
}

function paymentAccountDto(account: {
  id: string;
  provider: string;
  accountMode: string;
  providerDisplayName: string | null;
  providerLocationId: string | null;
  providerEnvironment: string;
  credentialCiphertext?: string | null;
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: Prisma.JsonValue | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}) {
  return {
    id: account.id,
    provider: account.provider,
    accountMode: account.accountMode,
    providerDisplayName: account.providerDisplayName,
    providerLocationId: account.providerLocationId,
    providerEnvironment: account.providerEnvironment,
    credentialConfigured: Boolean(account.credentialCiphertext),
    status: account.status,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    requirementsDue: account.requirementsDue,
    connectedAt: account.connectedAt?.toISOString() ?? null,
    disconnectedAt: account.disconnectedAt?.toISOString() ?? null
  };
}

function paymentLinkDto(link: {
  id: string;
  invoiceId: string;
  paymentAccountId: string;
  providerLinkId: string;
  providerPaymentId: string | null;
  providerLinkUrl: string;
  requestedAmountMinor: bigint;
  currency: string;
  status: string;
  pollAttempts: number;
  nextPollAt: Date | null;
  lastPolledAt: Date | null;
  lastErrorCode: string | null;
  completedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: link.id,
    invoiceId: link.invoiceId,
    paymentAccountId: link.paymentAccountId,
    providerLinkId: link.providerLinkId,
    providerPaymentId: link.providerPaymentId,
    providerLinkUrl: link.providerLinkUrl,
    requestedAmountMinor: serializeMinorUnit(link.requestedAmountMinor),
    currency: link.currency,
    status: link.status,
    pollAttempts: link.pollAttempts,
    nextPollAt: link.nextPollAt?.toISOString() ?? null,
    lastPolledAt: link.lastPolledAt?.toISOString() ?? null,
    lastErrorCode: link.lastErrorCode,
    completedAt: link.completedAt?.toISOString() ?? null,
    deactivatedAt: link.deactivatedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString()
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function providerAccountLookupHash(providerAccountId: string): string {
  return createHash("sha256").update(providerAccountId).digest("hex");
}

function paymentPublicBaseUrl(): string {
  const configured = environmentValueOrDefault(
    process.env.PAYMENT_PUBLIC_BASE_URL,
    "http://localhost:3000"
  );
  const url = new URL(configured);
  if (
    process.env.NODE_ENV === "production" &&
    (url.protocol !== "https:" || url.username || url.password)
  )
    throw new Error("PAYMENT_PUBLIC_BASE_URL must be an HTTPS origin in production.");
  return url.origin;
}

function webhookEventPayload(event: NormalizedProviderEvent): Prisma.InputJsonObject {
  return {
    eventType: event.eventType,
    providerPaymentId: event.providerPaymentId,
    providerSessionId: event.providerSessionId ?? null,
    providerRefundId: event.providerRefundId ?? null,
    providerDisputeId: event.providerDisputeId ?? null,
    amountMinor: event.amountMinor.toString(),
    feeMinor: event.feeMinor.toString(),
    currency: event.currency,
    occurredAt: event.occurredAt.toISOString(),
    reasonCategory: event.reasonCategory ?? null,
    evidenceDueAt: event.evidenceDueAt?.toISOString() ?? null,
    disputeStatus: event.disputeStatus ?? null
  };
}

function parseWebhookEventPayload(value: Prisma.JsonValue): NormalizedProviderEvent {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("PAYMENT_WEBHOOK_INVALID", "Stored webhook payload is invalid.", 422);
  const payload = value as Record<string, unknown>;
  const eventType = payload.eventType;
  if (
    eventType !== "payment_succeeded" &&
    eventType !== "payment_failed" &&
    eventType !== "refund_succeeded" &&
    eventType !== "refund_failed" &&
    eventType !== "dispute_created" &&
    eventType !== "dispute_updated"
  )
    throw new AppError("PAYMENT_WEBHOOK_INVALID", "Stored webhook event type is invalid.", 422);
  const occurredAt = new Date(requiredWebhookField(payload.occurredAt, "occurredAt"));
  if (Number.isNaN(occurredAt.getTime()))
    throw new AppError("PAYMENT_WEBHOOK_INVALID", "Stored webhook date is invalid.", 422);
  return {
    eventId: "stored-webhook-event",
    eventType,
    connectedAccountId: "",
    providerPaymentId: requiredWebhookField(payload.providerPaymentId, "providerPaymentId"),
    ...(optionalWebhookField(payload.providerSessionId)
      ? { providerSessionId: optionalWebhookField(payload.providerSessionId)! }
      : {}),
    ...(optionalWebhookField(payload.providerRefundId)
      ? { providerRefundId: optionalWebhookField(payload.providerRefundId)! }
      : {}),
    ...(optionalWebhookField(payload.providerDisputeId)
      ? { providerDisputeId: optionalWebhookField(payload.providerDisputeId)! }
      : {}),
    amountMinor: BigInt(requiredWebhookField(payload.amountMinor, "amountMinor")),
    feeMinor: BigInt(requiredWebhookField(payload.feeMinor, "feeMinor")),
    currency: requiredWebhookField(payload.currency, "currency"),
    methodCategory: "CARD",
    occurredAt,
    ...(optionalWebhookField(payload.reasonCategory)
      ? { reasonCategory: optionalWebhookField(payload.reasonCategory)! }
      : {}),
    ...(optionalWebhookField(payload.evidenceDueAt)
      ? { evidenceDueAt: new Date(optionalWebhookField(payload.evidenceDueAt)!) }
      : {}),
    ...(isStoredDisputeStatus(payload.disputeStatus)
      ? { disputeStatus: payload.disputeStatus }
      : {})
  };
}

function requiredWebhookField(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new AppError("PAYMENT_WEBHOOK_INVALID", `Stored webhook ${name} is invalid.`, 422);
  return value;
}

function optionalWebhookField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isStoredDisputeStatus(
  value: unknown
): value is NonNullable<NormalizedProviderEvent["disputeStatus"]> {
  return (
    value === "REVIEW_REQUIRED" ||
    value === "UNDER_REVIEW" ||
    value === "WON" ||
    value === "LOST" ||
    value === "CLOSED"
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function webhookContext(organizationId: string, userId: string): OrganizationContext {
  return {
    requestId: "payment-webhook",
    organizationId,
    membershipId: "payment-webhook",
    role: "OWNER",
    sessionId: null,
    recentAuthAt: new Date(),
    mfaAuthenticated: true,
    authenticationMethod: "OIDC",
    auditOrigin: { ipAddress: null, userAgent: null },
    user: {
      id: userId,
      email: "payment-webhook@clearledger.invalid",
      displayName: null,
      emailVerifiedAt: new Date()
    }
  };
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function paymentWebhookErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `DATABASE_${error.code}`;
  return "PAYMENT_WEBHOOK_PROCESSING_FAILED";
}
