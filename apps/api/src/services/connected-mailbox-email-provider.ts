import { randomUUID } from "node:crypto";
import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import { AppError } from "@clearledger/shared";
import type { EmailMessage, EmailProvider } from "./invoice-document-service.js";
import type { PaymentAccountProtector } from "./payment-provider.js";
import { SmtpEmailProvider, SmtpTransport } from "./smtp-email-provider.js";
import type {
  EmailConnectionRuntimeConfig,
  EmailProviderRuntimeConfig,
  OAuthEmailConnectionProvider
} from "./email-connection-service.js";

interface StoredMailboxCredential {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly tokenExpiresAt: string | null;
}

export interface EmailDeliveryHttpClient {
  request(input: {
    readonly url: string;
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string | undefined;
  }): Promise<{
    readonly status: number;
    readonly body: unknown;
    readonly headers?: Readonly<Record<string, string>> | undefined;
  }>;
}

export class FetchEmailDeliveryHttpClient implements EmailDeliveryHttpClient {
  public async request(input: {
    readonly url: string;
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string | undefined;
  }) {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body ? { body: input.body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Provider error bodies are not trusted and are never returned to the browser.
    }
    return {
      status: response.status,
      body,
      headers: Object.fromEntries(response.headers.entries())
    };
  }
}

/**
 * Delivers an explicit customer document through the organization's selected
 * OAuth mailbox or explicitly selected SMTP relay. It never falls back to a
 * development provider or another tenant's connection.
 */
export class ConnectedMailboxEmailProvider implements EmailProvider {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly config: EmailConnectionRuntimeConfig,
    private readonly protector: PaymentAccountProtector,
    private readonly httpClient: EmailDeliveryHttpClient = new FetchEmailDeliveryHttpClient(),
    private readonly smtpTransport: SmtpTransport = new SmtpTransport()
  ) {}

  public async send(message: EmailMessage): Promise<{ readonly providerMessageId: string }> {
    const context = requireDispatchContext(message);
    const connection = await withTenantTransaction(this.prisma, context, (tx) =>
      tx.emailConnection.findFirst({
        where: {
          organizationId: context.organizationId,
          status: "CONNECTED",
          isDefaultSender: true,
          credentialCiphertext: { not: null }
        }
      })
    );
    if (!connection)
      throw new AppError(
        "EMAIL_DEFAULT_CONNECTION_REQUIRED",
        "Connect a mailbox and select it as the default sending mailbox before emailing a customer.",
        409
      );
    const provider = connection.provider;
    if (provider === "SMTP") {
      try {
        const delivery = await new SmtpEmailProvider(
          connection.credentialCiphertext!,
          this.protector,
          this.smtpTransport
        ).send(message);
        await this.clearProviderError(context, connection.id);
        return delivery;
      } catch (error) {
        await this.recordProviderFailure(context, connection.id, "SMTP_DELIVERY_FAILED");
        throw error;
      }
    }
    const providerConfig = this.config.providers[provider];
    if (!providerConfig)
      throw new AppError(
        "EMAIL_PROVIDER_RUNTIME_UNAVAILABLE",
        "The connected mailbox provider is no longer configured in this PennyWise environment.",
        503
      );
    const credential = parseCredential(this.protector.reveal(connection.credentialCiphertext!));
    const freshCredential = await this.refreshWhenNeeded({
      context,
      connection: {
        id: connection.id,
        provider,
        tokenExpiresAt: connection.tokenExpiresAt,
        credentialVersion: connection.credentialVersion
      },
      providerConfig,
      credential
    });
    const result = await this.sendThroughProvider({
      provider,
      accessToken: freshCredential.accessToken,
      senderEmail: connection.senderEmail,
      message
    });
    if (result.status < 200 || result.status >= 300) {
      const errorCode =
        result.status === 401 || result.status === 403
          ? "EMAIL_PROVIDER_AUTHORIZATION_FAILED"
          : "EMAIL_PROVIDER_SEND_FAILED";
      await this.recordProviderFailure(context, connection.id, errorCode, result.status);
      throw new AppError(
        errorCode,
        "The selected mailbox could not deliver this email. Reconnect it and try again.",
        502
      );
    }
    await this.clearProviderError(context, connection.id);
    return { providerMessageId: providerMessageId(provider, result) };
  }

  private async refreshWhenNeeded(input: {
    readonly context: DispatchContext;
    readonly connection: {
      readonly id: string;
      readonly provider: OAuthEmailConnectionProvider;
      readonly tokenExpiresAt: Date | null;
      readonly credentialVersion: number;
    };
    readonly providerConfig: EmailProviderRuntimeConfig;
    readonly credential: StoredMailboxCredential;
  }): Promise<StoredMailboxCredential> {
    const expiresAt =
      input.connection.tokenExpiresAt ?? parseExpiry(input.credential.tokenExpiresAt);
    if (!expiresAt || expiresAt.getTime() > Date.now() + 60_000) return input.credential;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.credential.refreshToken,
      client_id: input.providerConfig.clientId,
      client_secret: input.providerConfig.clientSecret
    });
    let response: Awaited<ReturnType<EmailDeliveryHttpClient["request"]>>;
    try {
      response = await this.httpClient.request({
        url: input.providerConfig.tokenEndpoint,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json"
        },
        body: body.toString()
      });
    } catch {
      await this.recordProviderFailure(
        input.context,
        input.connection.id,
        "EMAIL_TOKEN_REFRESH_UNAVAILABLE"
      );
      throw new AppError(
        "EMAIL_TOKEN_REFRESH_UNAVAILABLE",
        "The selected mailbox could not refresh its sending permission. Reconnect it and try again.",
        502
      );
    }
    const refreshed = parseRefreshResponse(response.body, input.credential);
    if (response.status < 200 || response.status >= 300 || !refreshed) {
      await this.recordProviderFailure(
        input.context,
        input.connection.id,
        "EMAIL_TOKEN_REFRESH_REJECTED",
        response.status
      );
      throw new AppError(
        "EMAIL_TOKEN_REFRESH_REJECTED",
        "The selected mailbox needs to be reconnected before it can send email.",
        409
      );
    }
    await withTenantTransaction(this.prisma, input.context, (tx) =>
      tx.emailConnection.update({
        where: { id: input.connection.id },
        data: {
          credentialCiphertext: this.protector.protect(JSON.stringify(refreshed)),
          credentialVersion: { increment: 1 },
          tokenExpiresAt: parseExpiry(refreshed.tokenExpiresAt),
          lastErrorCode: null
        }
      })
    );
    return refreshed;
  }

  private sendThroughProvider(input: {
    readonly provider: OAuthEmailConnectionProvider;
    readonly accessToken: string;
    readonly senderEmail: string | null;
    readonly message: EmailMessage;
  }) {
    if (input.provider === "GMAIL") {
      return this.httpClient.request({
        url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({ raw: buildGmailRawMessage(input.message, input.senderEmail) })
      });
    }
    return this.httpClient.request({
      url: "https://graph.microsoft.com/v1.0/me/sendMail",
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
        "client-request-id": randomUUID(),
        "return-client-request-id": "true"
      },
      body: JSON.stringify(buildMicrosoftMessage(input.message))
    });
  }

  private async recordProviderFailure(
    context: DispatchContext,
    connectionId: string,
    errorCode: string,
    providerStatus?: number
  ) {
    await withTenantTransaction(this.prisma, context, async (tx) => {
      const connection = await tx.emailConnection.findFirst({
        where: { id: connectionId, organizationId: context.organizationId }
      });
      if (!connection) return;
      await tx.emailConnection.update({
        where: { id: connection.id },
        data: {
          status:
            errorCode === "EMAIL_PROVIDER_AUTHORIZATION_FAILED" ||
            errorCode === "EMAIL_TOKEN_REFRESH_REJECTED" ||
            errorCode === "SMTP_DELIVERY_FAILED"
              ? "ERROR"
              : "CONNECTED",
          lastErrorCode: errorCode,
          updatedByUserId: context.actorUserId
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.actorUserId,
          action: "EMAIL_CONNECTION_DELIVERY_ERROR",
          targetType: "EmailConnection",
          targetId: connection.id,
          requestId: context.requestId,
          metadata: {
            errorCode,
            ...(providerStatus ? { providerStatus } : {})
          }
        }
      });
    });
  }

  private async clearProviderError(context: DispatchContext, connectionId: string) {
    await withTenantTransaction(this.prisma, context, (tx) =>
      tx.emailConnection.updateMany({
        where: { id: connectionId, organizationId: context.organizationId },
        data: { lastErrorCode: null, updatedByUserId: context.actorUserId }
      })
    );
  }
}

interface DispatchContext {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

function requireDispatchContext(message: EmailMessage): DispatchContext {
  if (!message.organizationId || !message.actorUserId || !message.requestId)
    throw new AppError(
      "EMAIL_DELIVERY_CONTEXT_MISSING",
      "Email delivery requires an organization-scoped request context.",
      500
    );
  return {
    organizationId: message.organizationId,
    actorUserId: message.actorUserId,
    requestId: message.requestId
  };
}

function parseCredential(value: string): StoredMailboxCredential {
  try {
    const parsed = JSON.parse(value) as Partial<StoredMailboxCredential>;
    if (
      typeof parsed.accessToken !== "string" ||
      !parsed.accessToken ||
      typeof parsed.refreshToken !== "string" ||
      !parsed.refreshToken
    )
      throw new Error("credential fields missing");
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      tokenType: typeof parsed.tokenType === "string" ? parsed.tokenType : "Bearer",
      tokenExpiresAt: typeof parsed.tokenExpiresAt === "string" ? parsed.tokenExpiresAt : null
    };
  } catch {
    throw new AppError(
      "EMAIL_CONNECTION_CREDENTIAL_INVALID",
      "The selected mailbox needs to be reconnected before it can send email.",
      409
    );
  }
}

function parseRefreshResponse(
  body: unknown,
  existing: StoredMailboxCredential
): StoredMailboxCredential | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (typeof value.access_token !== "string" || !value.access_token) return null;
  const expiresIn =
    typeof value.expires_in === "number" ? value.expires_in : Number(value.expires_in ?? NaN);
  return {
    accessToken: value.access_token,
    refreshToken:
      typeof value.refresh_token === "string" && value.refresh_token
        ? value.refresh_token
        : existing.refreshToken,
    tokenType: typeof value.token_type === "string" ? value.token_type : existing.tokenType,
    tokenExpiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + Math.min(expiresIn, 31_536_000) * 1000).toISOString()
        : null
  };
}

function parseExpiry(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildGmailRawMessage(message: EmailMessage, senderEmail: string | null): string {
  const boundary = `pennywise-${randomUUID().replaceAll("-", "")}`;
  const lines = [
    ...(validEmail(senderEmail) ? [`From: ${senderEmail}`] : []),
    `To: ${message.to}`,
    `Subject: ${mimeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(
      Buffer.from(
        message.message ?? "Please find your PennyWise Accounting document attached.",
        "utf8"
      ).toString("base64")
    )
  ];
  if (message.pdf) {
    lines.push(
      `--${boundary}`,
      'Content-Type: application/pdf; name="document.pdf"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="document.pdf"',
      "",
      foldBase64(message.pdf.toString("base64"))
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function buildMicrosoftMessage(message: EmailMessage) {
  return {
    message: {
      subject: headerSafeText(message.subject),
      body: {
        contentType: "Text",
        content: message.message ?? "Please find your PennyWise Accounting document attached."
      },
      toRecipients: [{ emailAddress: { address: message.to } }],
      ...(message.pdf
        ? {
            attachments: [
              {
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: "document.pdf",
                contentType: "application/pdf",
                contentBytes: message.pdf.toString("base64")
              }
            ]
          }
        : {})
    },
    saveToSentItems: true
  };
}

function providerMessageId(
  provider: OAuthEmailConnectionProvider,
  result: Awaited<ReturnType<EmailDeliveryHttpClient["request"]>>
): string {
  if (provider === "GMAIL" && result.body && typeof result.body === "object") {
    const id = (result.body as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  const headerId = result.headers?.["request-id"] ?? result.headers?.["client-request-id"];
  return headerId || `${provider.toLowerCase()}-${randomUUID()}`;
}

function validEmail(value: string | null): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function mimeHeader(value: string): string {
  const text = headerSafeText(value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function headerSafeText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}
