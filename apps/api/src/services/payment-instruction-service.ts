import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { AesPaymentAccountProtector } from "./payment-provider.js";
import { environmentValueOrDefault } from "../environment.js";

export const paymentInstructionKeys = [
  "E_TRANSFER",
  "EFT",
  "CHEQUE",
  "PAY_ONLINE",
  "CASH",
  "OTHER"
] as const;
export type PaymentInstructionKey = (typeof paymentInstructionKeys)[number];

export interface PaymentInstructionMethodInput {
  readonly key: PaymentInstructionKey;
  readonly position?: number | undefined;
  readonly recipientEmail?: string | null | undefined;
  readonly autodeposit?: boolean | undefined;
  readonly institution?: string | null | undefined;
  readonly transitNumber?: string | null | undefined;
  readonly accountNumber?: string | null | undefined;
  readonly payableTo?: string | null | undefined;
  readonly mailingAddress?: string | null | undefined;
  readonly url?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export interface PaymentInstructionUpdateInput {
  readonly version?: number | undefined;
  readonly legacyInstructions?: string | null | undefined;
  readonly methods: readonly PaymentInstructionMethodInput[];
}

export interface RenderPaymentInstructions {
  readonly legacyInstructions: string | null;
  readonly methods: readonly RenderPaymentInstructionMethod[];
}

export interface RenderPaymentInstructionMethod {
  readonly key: PaymentInstructionKey;
  readonly position: number;
  readonly recipientEmail?: string;
  readonly autodeposit?: boolean;
  readonly institution?: string;
  readonly transitNumber?: string;
  readonly accountNumber?: string;
  readonly payableTo?: string;
  readonly mailingAddress?: string;
  readonly url?: string;
  readonly description?: string;
}

interface StoredPaymentInstructionMethod {
  readonly key: PaymentInstructionKey;
  readonly position: number;
  readonly recipientEmail?: string;
  readonly autodeposit?: boolean;
  readonly institution?: string;
  readonly transitCiphertext?: string;
  readonly accountCiphertext?: string;
  readonly payableTo?: string;
  readonly mailingAddress?: string;
  readonly url?: string;
  readonly description?: string;
}

export class PaymentInstructionService {
  private readonly authorization: AuthorizationService;
  private readonly protector: AesPaymentAccountProtector;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.protector = new AesPaymentAccountProtector(
      environmentValueOrDefault(
        process.env.PAYMENT_ACCOUNT_ENCRYPTION_SECRET,
        "development-payment-account-encryption-secret"
      )
    );
  }

  public async get(context: OrganizationContext) {
    await this.authorization.assert(context, "payments:read", "PaymentInstructionSettings");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const settings = await tx.paymentInstructionSettings.findUnique({
        where: { organizationId: context.organizationId }
      });
      const fallback = settings
        ? null
        : await tx.businessDefaults.findUnique({
            where: { organizationId: context.organizationId },
            select: { paymentInstructions: true, paymentMethods: true }
          });
      const methods = settings
        ? this.readStored(settings.methods)
        : legacyMethods(fallback?.paymentMethods);
      return {
        version: settings?.version ?? 0,
        legacyInstructions: settings?.legacyInstructions ?? fallback?.paymentInstructions ?? null,
        methods: methods.map((method) => this.mask(method))
      };
    });
  }

  public async update(context: OrganizationContext, input: PaymentInstructionUpdateInput) {
    await this.authorization.assert(context, "branding:manage", "PaymentInstructionSettings");
    const legacyInstructions = normalizeText(input.legacyInstructions, 4000);
    const methods = input.methods.map((method, index) => this.normalize(method, index));
    if (new Set(methods.map((method) => method.key)).size !== methods.length)
      throw new AppError(
        "PAYMENT_INSTRUCTION_DUPLICATE_METHOD",
        "Each payment method may be configured only once.",
        422
      );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.paymentInstructionSettings.findUnique({
        where: { organizationId: context.organizationId }
      });
      if (current && input.version !== current.version)
        throw new AppError(
          "STALE_PAYMENT_INSTRUCTIONS",
          "Payment instructions were changed by another request.",
          409
        );
      const stored = methods.map((method) => this.protect(method));
      const settings = current
        ? await tx.paymentInstructionSettings.update({
            where: { id: current.id },
            data: {
              version: { increment: 1 },
              legacyInstructions,
              methods: stored as unknown as Prisma.InputJsonValue,
              updatedByUserId: context.user.id
            }
          })
        : await tx.paymentInstructionSettings.create({
            data: {
              organizationId: context.organizationId,
              legacyInstructions,
              methods: stored as unknown as Prisma.InputJsonValue,
              updatedByUserId: context.user.id
            }
          });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PAYMENT_INSTRUCTIONS_UPDATED",
          targetType: "PaymentInstructionSettings",
          targetId: settings.id,
          metadata: withAuditOrigin(context, {
            version: settings.version,
            methodKeys: methods.map((method) => method.key),
            hasLegacyInstructions: Boolean(legacyInstructions)
          })
        }
      });
      return {
        version: settings.version,
        legacyInstructions,
        methods: stored.map((method) => this.mask(method))
      };
    });
  }

  public async renderSnapshot(
    context: OrganizationContext,
    selectedKeys?: readonly string[] | null
  ): Promise<RenderPaymentInstructions> {
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.renderSnapshotInTransaction(tx, context.organizationId, selectedKeys)
    );
  }

  public async renderSnapshotInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    selectedKeys?: readonly string[] | null
  ): Promise<RenderPaymentInstructions> {
    const settings = await tx.paymentInstructionSettings.findUnique({
      where: { organizationId }
    });
    const fallback = settings
      ? null
      : await tx.businessDefaults.findUnique({
          where: { organizationId },
          select: { paymentInstructions: true, paymentMethods: true }
        });
    const all = settings
      ? this.readStored(settings.methods)
      : legacyMethods(fallback?.paymentMethods);
    const selected = selectedKeys?.length
      ? new Set(selectedKeys.filter((key): key is PaymentInstructionKey => isPaymentKey(key)))
      : null;
    return {
      legacyInstructions: settings?.legacyInstructions ?? fallback?.paymentInstructions ?? null,
      methods: all
        .filter((method) => !selected || selected.has(method.key))
        .sort((a, b) => a.position - b.position)
        .map((method) => this.reveal(method))
    };
  }

  private normalize(
    input: PaymentInstructionMethodInput,
    index: number
  ): StoredPaymentInstructionMethod {
    if (input.key === "E_TRANSFER") {
      if (!input.recipientEmail || !/^\S+@\S+\.\S+$/.test(input.recipientEmail.trim()))
        throw new AppError(
          "PAYMENT_INSTRUCTION_EMAIL_INVALID",
          "An e-Transfer email is required.",
          422
        );
    }
    if (input.key === "EFT" && (!input.institution || !input.transitNumber || !input.accountNumber))
      throw new AppError(
        "PAYMENT_INSTRUCTION_EFT_INCOMPLETE",
        "Institution, transit, and account numbers are required for EFT.",
        422
      );
    if (input.key === "CHEQUE" && (!input.payableTo || !input.mailingAddress))
      throw new AppError(
        "PAYMENT_INSTRUCTION_CHEQUE_INCOMPLETE",
        "Payable-to name and mailing address are required for cheques.",
        422
      );
    if (input.key === "PAY_ONLINE") validatePaymentInstructionUrl(input.url ?? undefined);
    return {
      key: input.key,
      position: Number.isInteger(input.position) && input.position! >= 0 ? input.position! : index,
      ...(input.recipientEmail ? { recipientEmail: input.recipientEmail.trim() } : {}),
      ...(input.autodeposit === undefined ? {} : { autodeposit: input.autodeposit }),
      ...(input.institution ? { institution: normalizeText(input.institution, 160)! } : {}),
      ...(input.transitNumber ? { transitCiphertext: input.transitNumber.trim() } : {}),
      ...(input.accountNumber ? { accountCiphertext: input.accountNumber.trim() } : {}),
      ...(input.payableTo ? { payableTo: normalizeText(input.payableTo, 200)! } : {}),
      ...(input.mailingAddress
        ? { mailingAddress: normalizeText(input.mailingAddress, 1000)! }
        : {}),
      ...(input.url ? { url: input.url.trim() } : {}),
      ...(input.description ? { description: normalizeText(input.description, 1000)! } : {})
    };
  }

  private protect(method: StoredPaymentInstructionMethod): StoredPaymentInstructionMethod {
    return {
      ...method,
      ...(method.transitCiphertext
        ? { transitCiphertext: this.protector.protect(method.transitCiphertext) }
        : {}),
      ...(method.accountCiphertext
        ? { accountCiphertext: this.protector.protect(method.accountCiphertext) }
        : {})
    };
  }

  private reveal(method: StoredPaymentInstructionMethod): RenderPaymentInstructionMethod {
    return {
      ...method,
      ...(method.transitCiphertext
        ? { transitNumber: this.protector.reveal(method.transitCiphertext) }
        : {}),
      ...(method.accountCiphertext
        ? { accountNumber: this.protector.reveal(method.accountCiphertext) }
        : {})
    };
  }

  private readStored(value: Prisma.JsonValue | null): StoredPaymentInstructionMethod[] {
    if (!value || typeof value !== "object") return [];
    const methods = Array.isArray(value) ? value : (value as { methods?: unknown }).methods;
    return Array.isArray(methods) ? methods.filter(isStoredMethod) : [];
  }

  private mask(method: StoredPaymentInstructionMethod | PaymentInstructionMethodInput) {
    const accountNumber =
      "accountCiphertext" in method
        ? method.accountCiphertext
          ? this.protector.reveal(method.accountCiphertext)
          : undefined
        : "accountNumber" in method
          ? method.accountNumber
          : undefined;
    const transitNumber =
      "transitCiphertext" in method
        ? method.transitCiphertext
          ? this.protector.reveal(method.transitCiphertext)
          : undefined
        : "transitNumber" in method
          ? method.transitNumber
          : undefined;
    return {
      key: method.key,
      position: method.position ?? 0,
      ...(method.recipientEmail ? { recipientEmail: method.recipientEmail } : {}),
      ...(method.autodeposit === undefined ? {} : { autodeposit: method.autodeposit }),
      ...(method.institution ? { institution: method.institution } : {}),
      ...(transitNumber ? { transitNumber: maskSecret(transitNumber) } : {}),
      ...(accountNumber ? { accountNumber: maskSecret(accountNumber) } : {}),
      ...(method.payableTo ? { payableTo: method.payableTo } : {}),
      ...(method.mailingAddress ? { mailingAddress: method.mailingAddress } : {}),
      ...(method.url ? { url: method.url } : {}),
      ...(method.description ? { description: method.description } : {})
    };
  }
}

function isPaymentKey(value: string): value is PaymentInstructionKey {
  return (paymentInstructionKeys as readonly string[]).includes(value);
}

function isStoredMethod(value: unknown): value is StoredPaymentInstructionMethod {
  return Boolean(
    value &&
      typeof value === "object" &&
      isPaymentKey((value as { key?: unknown }).key as string) &&
      Number.isInteger((value as { position?: unknown }).position)
  );
}

function legacyMethods(
  value: Prisma.JsonValue | null | undefined
): StoredPaymentInstructionMethod[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((key): key is string => typeof key === "string" && isPaymentKey(key))
    .map((key, position) => ({
      key: key as PaymentInstructionKey,
      position
    }));
}

function normalizeText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.trim();
  if (text.length > max)
    throw new AppError(
      "PAYMENT_INSTRUCTION_TEXT_TOO_LONG",
      "Payment instructions are too long.",
      422
    );
  return text || null;
}

function maskSecret(value: string): string {
  return value.length <= 4
    ? "••••"
    : `${"•".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

export function validatePaymentInstructionUrl(value: string | undefined): void {
  if (!value)
    throw new AppError(
      "PAYMENT_INSTRUCTION_URL_REQUIRED",
      "An https payment URL is required.",
      422
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("PAYMENT_INSTRUCTION_URL_INVALID", "The payment URL is invalid.", 422);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(host);
  const privateIpv6 =
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:");
  if (url.protocol !== "https:" || host === "localhost" || privateIpv4 || privateIpv6)
    throw new AppError(
      "PAYMENT_INSTRUCTION_URL_INVALID",
      "Payment links must use https and a public host.",
      422
    );
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    userId: context.user.id,
    actorUserId: context.user.id,
    requestId: context.requestId
  };
}
