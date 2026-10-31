import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { describe, expect, it } from "vitest";
import { AesPaymentAccountProtector } from "./payment-provider.js";
import { emailDeliveryRuntimeFromEnvironment } from "./email-connection-service.js";
import {
  protectSmtpConnection,
  revealSmtpConnection,
  SmtpEmailProvider,
  SmtpTransport
} from "./smtp-email-provider.js";

class FixtureSmtpSocket extends EventEmitter {
  public readonly writes: string[] = [];
  public data = "";
  private awaitingData = false;

  public constructor(
    private readonly username: string,
    private readonly password: string,
    options: { readonly greeting?: boolean; readonly startTls?: boolean } = {}
  ) {
    super();
    if (options.greeting !== false) {
      setTimeout(() => this.emit("data", Buffer.from("220 fixture.smtp.test ESMTP ready\r\n")), 0);
    }
    this.startTls = options.startTls ?? false;
  }

  private readonly startTls: boolean;

  public write(value: string): boolean {
    this.writes.push(value);
    if (this.awaitingData) {
      if (value.endsWith("\r\n.\r\n")) {
        this.data = value;
        this.awaitingData = false;
        this.reply("250 message accepted");
      }
      return true;
    }
    const command = value.replace(/\r\n$/, "");
    if (command.startsWith("EHLO ")) {
      const capabilities = this.startTls
        ? "250-fixture.smtp.test\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n"
        : "250-fixture.smtp.test\r\n250 AUTH PLAIN\r\n";
      this.emit("data", Buffer.from(capabilities));
    } else if (command === "STARTTLS") {
      this.reply("220 begin TLS");
    } else if (command.startsWith("AUTH PLAIN ")) {
      const credential = Buffer.from(command.slice("AUTH PLAIN ".length), "base64").toString(
        "utf8"
      );
      this.reply(
        credential === `\u0000${this.username}\u0000${this.password}`
          ? "235 authenticated"
          : "535 invalid credentials"
      );
    } else if (command.startsWith("MAIL FROM:")) {
      this.reply("250 sender accepted");
    } else if (command.startsWith("RCPT TO:")) {
      this.reply("250 recipient accepted");
    } else if (command === "DATA") {
      this.awaitingData = true;
      this.reply("354 end with dot");
    } else if (command === "QUIT") {
      this.reply("221 goodbye");
    } else {
      this.reply("500 unsupported command");
    }
    return true;
  }

  public destroy(): this {
    return this;
  }

  private reply(line: string): void {
    this.emit("data", Buffer.from(`${line}\r\n`));
  }
}

const smtpConfig = {
  host: "mail.fixture.test",
  port: 465,
  tlsMode: "IMPLICIT_TLS" as const,
  username: "fixture-user",
  password: "fixture-password",
  fromAddress: "sender@example.test"
};

describe("SmtpEmailProvider", () => {
  it("enables SMTP only with explicit encrypted-delivery configuration", () => {
    expect(
      emailDeliveryRuntimeFromEnvironment(
        { EMAIL_DELIVERY_MODE: "smtp" },
        { providerConfigured: false, credentialEncryptionAvailable: true }
      )
    ).toEqual({ mode: "SMTP", enabled: true, reason: "ready" });
    expect(
      emailDeliveryRuntimeFromEnvironment(
        { EMAIL_DELIVERY_MODE: "smtp" },
        { providerConfigured: false, credentialEncryptionAvailable: false }
      )
    ).toEqual({ mode: "SMTP", enabled: false, reason: "credential-encryption-unavailable" });
    expect(
      emailDeliveryRuntimeFromEnvironment(
        { CLEARLEDGER_BETA_RUNTIME: "true", EMAIL_DELIVERY_MODE: "smtp" },
        { providerConfigured: false, credentialEncryptionAvailable: true }
      )
    ).toEqual({ mode: "SMTP", enabled: false, reason: "beta-approval-required" });
  });

  it("encrypts a relay configuration and sends a MIME-safe message through a local fixture", async () => {
    const protector = new AesPaymentAccountProtector("smtp-fixture-encryption-secret-20260911");
    const protectedConnection = protectSmtpConnection(smtpConfig, protector);
    expect(protectedConnection.credentialCiphertext).not.toContain(smtpConfig.password);
    expect(revealSmtpConnection(protectedConnection.credentialCiphertext, protector)).toEqual(
      smtpConfig
    );

    const socket = new FixtureSmtpSocket(smtpConfig.username, smtpConfig.password);
    const transport = new SmtpTransport({
      timeoutMs: 250,
      connectImplicitTls: () => Promise.resolve(socket as unknown as TLSSocket)
    });
    const delivery = await new SmtpEmailProvider(
      protectedConnection.credentialCiphertext,
      protector,
      transport
    ).send({
      to: "recipient@example.test",
      subject: "Invoice\r\nBcc: injected@example.test",
      message: "A line beginning with . must remain message content.\n.line two"
    });

    expect(delivery.providerMessageId).toContain("@mail.fixture.test");
    expect(socket.writes.join("")).toContain("AUTH PLAIN");
    expect(socket.data).toContain("Subject: Invoice Bcc: injected@example.test");
    expect(socket.data).not.toContain("\r\nBcc:");
  });

  it("does not send credentials until the STARTTLS upgrade has completed", async () => {
    const plainSocket = new FixtureSmtpSocket(smtpConfig.username, smtpConfig.password, {
      startTls: true
    });
    const tlsSocket = new FixtureSmtpSocket(smtpConfig.username, smtpConfig.password, {
      greeting: false
    });
    const transport = new SmtpTransport({
      timeoutMs: 250,
      connectPlain: () => Promise.resolve(plainSocket as unknown as Socket),
      upgradeToTls: () => Promise.resolve(tlsSocket as unknown as TLSSocket)
    });

    await transport.send(
      { ...smtpConfig, port: 587, tlsMode: "STARTTLS" },
      { to: "recipient@example.test", subject: "Test", message: "body" }
    );

    expect(plainSocket.writes.join("")).toContain("STARTTLS\r\n");
    expect(plainSocket.writes.join("")).not.toContain("AUTH PLAIN");
    expect(tlsSocket.writes.join("")).toContain("AUTH PLAIN");
  });

  it("reports a rejected SMTP password without silently accepting a connection", async () => {
    const socket = new FixtureSmtpSocket(smtpConfig.username, smtpConfig.password);
    const transport = new SmtpTransport({
      timeoutMs: 250,
      connectImplicitTls: () => Promise.resolve(socket as unknown as TLSSocket)
    });
    const protector = new AesPaymentAccountProtector("smtp-fixture-encryption-secret-20260911");
    const protectedConnection = protectSmtpConnection(
      { ...smtpConfig, password: "wrong-password" },
      protector
    );

    await expect(
      new SmtpEmailProvider(
        protectedConnection.credentialCiphertext,
        protector,
        transport
      ).sendTest("recipient@example.test")
    ).rejects.toMatchObject({ code: "SMTP_AUTH_FAILED", statusCode: 409 });
    expect(socket.writes.join("")).not.toContain("MAIL FROM:");
  });
});
