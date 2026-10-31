import { randomUUID } from "node:crypto";
import { connect as connectTcp, isIP, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { AppError } from "@clearledger/shared";
import type { EmailMessage, EmailProvider } from "./invoice-document-service.js";
import type { PaymentAccountProtector } from "./payment-provider.js";

const SMTP_TIMEOUT_MS = 15_000;
const SMTP_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

export const smtpTlsModes = ["STARTTLS", "IMPLICIT_TLS"] as const;
export type SmtpTlsMode = (typeof smtpTlsModes)[number];

/**
 * The plaintext is accepted only long enough to encrypt it through the
 * established account-credential protector. It must never be logged or
 * returned to a caller.
 */
export interface SmtpConnectionInput {
  readonly host: string;
  readonly port: number;
  readonly tlsMode: SmtpTlsMode;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
}

/** Safe connection metadata for API/UI responses; it has no password. */
export interface SmtpConnectionSummary {
  readonly provider: "SMTP";
  readonly host: string;
  readonly port: number;
  readonly tlsMode: SmtpTlsMode;
  readonly username: string;
  readonly fromAddress: string;
}

export interface ProtectedSmtpConnection {
  readonly credentialCiphertext: string;
  readonly summary: SmtpConnectionSummary;
}

export interface SmtpTransportOptions {
  /** Test seam only. Production uses a verified native TCP connection. */
  readonly connectPlain?: ((input: SmtpConnectInput) => Promise<Socket>) | undefined;
  /** Test seam only. Production uses verified native implicit TLS. */
  readonly connectImplicitTls?: ((input: SmtpConnectInput) => Promise<TLSSocket>) | undefined;
  /** Test seam only. Production preserves certificate verification on upgrade. */
  readonly upgradeToTls?: ((input: SmtpUpgradeInput) => Promise<TLSSocket>) | undefined;
  readonly timeoutMs?: number | undefined;
}

interface SmtpConnectInput {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
}

interface SmtpUpgradeInput extends SmtpConnectInput {
  readonly socket: Socket;
}

type SmtpSocket = Socket | TLSSocket;

class SmtpTransportError extends Error {
  public constructor(readonly code: string) {
    super(code);
    this.name = "SmtpTransportError";
  }
}

/**
 * Encrypts the complete SMTP connection shape, not only the password. Keeping
 * the host, username, and sender together prevents accidental persistence of a
 * partially protected connection configuration.
 */
export function protectSmtpConnection(
  input: SmtpConnectionInput,
  protector: PaymentAccountProtector
): ProtectedSmtpConnection {
  const config = normalizeSmtpConnection(input);
  return {
    credentialCiphertext: protector.protect(JSON.stringify({ version: 1, ...config })),
    summary: smtpConnectionSummary(config)
  };
}

export function revealSmtpConnection(
  credentialCiphertext: string,
  protector: PaymentAccountProtector
): SmtpConnectionInput {
  try {
    const parsed: unknown = JSON.parse(protector.reveal(credentialCiphertext));
    if (!isRecord(parsed) || parsed.version !== 1 || !isSmtpConnectionInput(parsed))
      throw new Error("SMTP credential version is invalid.");
    return normalizeSmtpConnection(parsed);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "SMTP_CONFIGURATION_UNREADABLE",
      "The SMTP connection configuration cannot be read. Configure and test it again.",
      409
    );
  }
}

export function smtpConnectionSummary(input: SmtpConnectionInput): SmtpConnectionSummary {
  const config = normalizeSmtpConnection(input);
  return {
    provider: "SMTP",
    host: config.host,
    port: config.port,
    tlsMode: config.tlsMode,
    username: config.username,
    fromAddress: config.fromAddress
  };
}

/**
 * Native SMTP submission transport. It has no plaintext mode: credentials are
 * sent only after implicit TLS or a successful STARTTLS upgrade.
 */
export class SmtpTransport {
  private readonly timeoutMs: number;
  private readonly plainConnector: (input: SmtpConnectInput) => Promise<Socket>;
  private readonly implicitTlsConnector: (input: SmtpConnectInput) => Promise<TLSSocket>;
  private readonly tlsUpgrader: (input: SmtpUpgradeInput) => Promise<TLSSocket>;

  public constructor(options: SmtpTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? SMTP_TIMEOUT_MS;
    this.plainConnector = options.connectPlain ?? connectPlain;
    this.implicitTlsConnector = options.connectImplicitTls ?? connectWithImplicitTls;
    this.tlsUpgrader = options.upgradeToTls ?? upgradeToTls;
  }

  public async send(
    input: SmtpConnectionInput,
    message: EmailMessage
  ): Promise<{ readonly providerMessageId: string }> {
    const config = normalizeSmtpConnection(input);
    const messageId = smtpMessageId(config.host);
    const data = buildSmtpMessage(config, message, messageId);
    if (Buffer.byteLength(data, "utf8") > SMTP_MAX_MESSAGE_BYTES)
      throw new AppError(
        "SMTP_MESSAGE_TOO_LARGE",
        "The email attachment is too large for safe SMTP delivery.",
        422
      );

    let socket: SmtpSocket | null = null;
    try {
      socket =
        config.tlsMode === "IMPLICIT_TLS"
          ? await this.implicitTlsConnector({
              host: config.host,
              port: config.port,
              timeoutMs: this.timeoutMs
            })
          : await this.plainConnector({
              host: config.host,
              port: config.port,
              timeoutMs: this.timeoutMs
            });
      let session = new SmtpSession(socket, this.timeoutMs);
      expectResponse(await session.readResponse(), [220], "SMTP_CONNECTION_REJECTED");

      let capabilities = await this.ehlo(session);
      if (config.tlsMode === "STARTTLS") {
        if (!hasCapability(capabilities, "STARTTLS"))
          throw new SmtpTransportError("SMTP_TLS_UNAVAILABLE");
        expectResponse(await session.command("STARTTLS"), [220], "SMTP_TLS_UPGRADE_REJECTED");
        const plainSocket = socket;
        session.detach();
        socket = await this.tlsUpgrader({
          host: config.host,
          port: config.port,
          timeoutMs: this.timeoutMs,
          socket: plainSocket
        });
        session = new SmtpSession(socket, this.timeoutMs);
        capabilities = await this.ehlo(session);
      }

      if (!hasAuthPlainCapability(capabilities))
        throw new SmtpTransportError("SMTP_AUTH_UNSUPPORTED");
      const authPayload = Buffer.from(
        `\u0000${config.username}\u0000${config.password}`,
        "utf8"
      ).toString("base64");
      expectResponse(await session.command(`AUTH PLAIN ${authPayload}`), [235], "SMTP_AUTH_FAILED");
      expectResponse(
        await session.command(`MAIL FROM:<${config.fromAddress}>`),
        [250],
        "SMTP_SENDER_REJECTED"
      );
      expectResponse(
        await session.command(`RCPT TO:<${requireEmail(message.to, "recipient")}>`),
        [250, 251],
        "SMTP_RECIPIENT_REJECTED"
      );
      expectResponse(await session.command("DATA"), [354], "SMTP_DATA_REJECTED");
      expectResponse(await session.data(data), [250], "SMTP_MESSAGE_REJECTED");
      try {
        expectResponse(await session.command("QUIT"), [221], "SMTP_QUIT_FAILED");
      } catch {
        // Delivery was accepted already; a failed QUIT cannot undo it.
      }
      return { providerMessageId: messageId };
    } catch (error) {
      socket?.destroy();
      if (error instanceof AppError || error instanceof SmtpTransportError) throw error;
      throw new SmtpTransportError("SMTP_CONNECTION_FAILED");
    }
  }

  private async ehlo(session: SmtpSession): Promise<readonly string[]> {
    const response = await session.command("EHLO clearledger.local");
    expectResponse(response, [250], "SMTP_ESMTP_UNAVAILABLE");
    return response.lines;
  }
}

/**
 * Email-provider wrapper used after an organization has stored the encrypted
 * SMTP configuration. It keeps the cleartext config in memory only while a
 * single delivery is being made.
 */
export class SmtpEmailProvider implements EmailProvider {
  public constructor(
    private readonly credentialCiphertext: string,
    private readonly protector: PaymentAccountProtector,
    private readonly transport: SmtpTransport = new SmtpTransport()
  ) {}

  public async send(message: EmailMessage): Promise<{ readonly providerMessageId: string }> {
    try {
      return await this.transport.send(
        revealSmtpConnection(this.credentialCiphertext, this.protector),
        message
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof SmtpTransportError) throw smtpDeliveryError(error.code);
      throw new AppError(
        "SMTP_DELIVERY_UNAVAILABLE",
        "The SMTP server could not be reached. Check the server settings and try again.",
        502
      );
    }
  }

  public sendTest(recipient: string): Promise<{ readonly providerMessageId: string }> {
    return this.send({
      to: recipient,
      subject: "ClearLedger SMTP connection test",
      message:
        "This confirms that ClearLedger can deliver email through the configured SMTP server."
    });
  }
}

class SmtpSession {
  private buffer = "";
  private readonly responses: SmtpResponse[] = [];
  private current: { code: number; lines: string[] } | null = null;
  private waiter: {
    readonly resolve: (response: SmtpResponse) => void;
    readonly reject: (error: Error) => void;
  } | null = null;
  private readonly onData = (chunk: Buffer | string) => this.consume(chunk.toString("utf8"));
  private readonly onError = () => this.fail(new SmtpTransportError("SMTP_CONNECTION_FAILED"));
  private readonly onClose = () => this.fail(new SmtpTransportError("SMTP_CONNECTION_CLOSED"));

  public constructor(
    private readonly socket: SmtpSocket,
    private readonly timeoutMs: number
  ) {
    socket.on("data", this.onData);
    socket.once("error", this.onError);
    socket.once("close", this.onClose);
  }

  public async command(value: string): Promise<SmtpResponse> {
    this.write(`${value}\r\n`);
    return this.readResponse();
  }

  public async data(value: string): Promise<SmtpResponse> {
    const normalized = normalizeData(value);
    this.write(`${normalized}\r\n.\r\n`);
    return this.readResponse();
  }

  public readResponse(): Promise<SmtpResponse> {
    const queued = this.responses.shift();
    if (queued) return Promise.resolve(queued);
    if (this.waiter) return Promise.reject(new SmtpTransportError("SMTP_PROTOCOL_ERROR"));
    return new Promise<SmtpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter?.resolve !== resolve) return;
        this.waiter = null;
        reject(new SmtpTransportError("SMTP_TIMEOUT"));
      }, this.timeoutMs);
      this.waiter = {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      };
    });
  }

  public detach(): void {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
  }

  private write(value: string): void {
    if (!this.socket.write(value, "utf8")) {
      // Backpressure is handled by Node's socket buffer. The SMTP response
      // timeout still bounds a non-responsive peer.
    }
  }

  private consume(value: string): void {
    this.buffer += value;
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        this.fail(new SmtpTransportError("SMTP_PROTOCOL_ERROR"));
        return;
      }
      const code = Number(match[1]);
      const separator = match[2];
      const text = match[3] ?? "";
      if (!this.current) this.current = { code, lines: [] };
      if (this.current.code !== code) {
        this.fail(new SmtpTransportError("SMTP_PROTOCOL_ERROR"));
        return;
      }
      this.current.lines.push(text);
      if (separator === " ") {
        this.enqueue(this.current);
        this.current = null;
      }
    }
  }

  private enqueue(response: SmtpResponse): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.resolve(response);
      return;
    }
    this.responses.push(response);
  }

  private fail(error: Error): void {
    if (!this.waiter) return;
    const waiter = this.waiter;
    this.waiter = null;
    waiter.reject(error);
  }
}

interface SmtpResponse {
  readonly code: number;
  readonly lines: readonly string[];
}

function expectResponse(
  response: SmtpResponse,
  accepted: readonly number[],
  errorCode: string
): void {
  if (!accepted.includes(response.code)) throw new SmtpTransportError(errorCode);
}

function hasCapability(lines: readonly string[], expected: string): boolean {
  return lines.some((line) => line.trim().toUpperCase() === expected);
}

function hasAuthPlainCapability(lines: readonly string[]): boolean {
  return lines.some((line) => {
    const capability = line.trim().toUpperCase();
    return (
      capability === "AUTH PLAIN" ||
      capability.startsWith("AUTH PLAIN ") ||
      (capability.startsWith("AUTH ") && capability.split(/\s+/).includes("PLAIN")) ||
      (capability.startsWith("AUTH=") && capability.slice(5).split(/\s+/).includes("PLAIN"))
    );
  });
}

function normalizeSmtpConnection(input: SmtpConnectionInput): SmtpConnectionInput {
  const host = requiredText(input.host, "SMTP host", 255).toLowerCase();
  if (!/^[a-z0-9.-]+$/i.test(host) || host.startsWith(".") || host.endsWith("."))
    throw new AppError("SMTP_CONFIGURATION_INVALID", "Enter a valid SMTP server host.", 422);
  const port = input.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new AppError("SMTP_CONFIGURATION_INVALID", "Enter a valid SMTP server port.", 422);
  if (!smtpTlsModes.includes(input.tlsMode))
    throw new AppError(
      "SMTP_CONFIGURATION_INVALID",
      "Choose STARTTLS or implicit TLS for SMTP delivery.",
      422
    );
  const username = requiredText(input.username, "SMTP username", 320);
  const password = requiredText(input.password, "SMTP password", 4_096);
  const fromAddress = requireEmail(input.fromAddress, "from address");
  return { host, port, tlsMode: input.tlsMode, username, password, fromAddress };
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string")
    throw new AppError("SMTP_CONFIGURATION_INVALID", `Enter a valid ${label}.`, 422);
  const text = value.trim();
  if (!text || text.length > maxLength || hasUnsafeSmtpControl(text))
    throw new AppError("SMTP_CONFIGURATION_INVALID", `Enter a valid ${label}.`, 422);
  return text;
}

function hasUnsafeSmtpControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0 || codePoint === 10 || codePoint === 13) return true;
  }
  return false;
}

function requireEmail(value: unknown, label: string): string {
  const email = requiredText(value, label, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AppError("SMTP_CONFIGURATION_INVALID", `Enter a valid ${label}.`, 422);
  return email;
}

function buildSmtpMessage(
  config: SmtpConnectionInput,
  message: EmailMessage,
  messageId: string
): string {
  const boundary = `clearledger-${randomUUID().replaceAll("-", "")}`;
  const lines = [
    `From: ${config.fromAddress}`,
    `To: ${requireEmail(message.to, "recipient")}`,
    `Subject: ${mimeHeader(message.subject)}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(
      Buffer.from(
        message.message ?? "Please find your ClearLedger Accounting document attached.",
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
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

function normalizeData(value: string): string {
  const normalized = value.replace(/\r?\n/g, "\r\n");
  return normalized
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function smtpMessageId(host: string): string {
  const domain = isIP(host) ? "clearledger.local" : host;
  return `clearledger-${randomUUID()}@${domain}`;
}

function mimeHeader(value: string): string {
  const text = value.replace(/[\r\n]+/g, " ").trim();
  if (!text) return "ClearLedger document";
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function smtpDeliveryError(code: string): AppError {
  const messages: Readonly<
    Record<string, { readonly message: string; readonly statusCode: number }>
  > = {
    SMTP_AUTH_FAILED: {
      message:
        "The SMTP server rejected the configured username or password. Check the credentials and test again.",
      statusCode: 409
    },
    SMTP_AUTH_UNSUPPORTED: {
      message:
        "The SMTP server does not support the required encrypted SMTP authentication method.",
      statusCode: 422
    },
    SMTP_TLS_UNAVAILABLE: {
      message:
        "The SMTP server did not offer STARTTLS. ClearLedger will not send credentials without TLS.",
      statusCode: 422
    },
    SMTP_TLS_UPGRADE_REJECTED: {
      message:
        "The SMTP server rejected the STARTTLS upgrade. Check the TLS settings and test again.",
      statusCode: 502
    },
    SMTP_SENDER_REJECTED: {
      message: "The SMTP server rejected the configured from address.",
      statusCode: 422
    },
    SMTP_RECIPIENT_REJECTED: {
      message: "The SMTP server rejected the test recipient.",
      statusCode: 422
    },
    SMTP_MESSAGE_REJECTED: {
      message: "The SMTP server rejected the email message.",
      statusCode: 502
    }
  };
  const mapped = messages[code] ?? {
    message:
      "The SMTP server could not complete delivery. Check the server settings and try again.",
    statusCode: 502
  };
  return new AppError(code, mapped.message, mapped.statusCode);
}

function connectPlain(input: SmtpConnectInput): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host: input.host, port: input.port });
    const timer = setTimeout(() => fail(new SmtpTransportError("SMTP_TIMEOUT")), input.timeoutMs);
    const fail = (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.once("error", () => fail(new SmtpTransportError("SMTP_CONNECTION_FAILED")));
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
  });
}

function connectWithImplicitTls(input: SmtpConnectInput): Promise<TLSSocket> {
  return connectTlsSocket({ ...input, socket: undefined });
}

function upgradeToTls(input: SmtpUpgradeInput): Promise<TLSSocket> {
  return connectTlsSocket(input);
}

function connectTlsSocket(
  input: SmtpConnectInput & { readonly socket: Socket | undefined }
): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host: input.socket ? undefined : input.host,
      port: input.socket ? undefined : input.port,
      ...(input.socket ? { socket: input.socket } : {}),
      ...(isIP(input.host) ? {} : { servername: input.host }),
      minVersion: "TLSv1.2",
      rejectUnauthorized: true
    });
    const timer = setTimeout(() => fail(new SmtpTransportError("SMTP_TIMEOUT")), input.timeoutMs);
    const fail = (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.once("error", () => fail(new SmtpTransportError("SMTP_TLS_UPGRADE_FAILED")));
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSmtpConnectionInput(value: unknown): value is SmtpConnectionInput {
  if (!isRecord(value)) return false;
  return (
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    (value.tlsMode === "STARTTLS" || value.tlsMode === "IMPLICIT_TLS") &&
    typeof value.username === "string" &&
    typeof value.password === "string" &&
    typeof value.fromAddress === "string"
  );
}
