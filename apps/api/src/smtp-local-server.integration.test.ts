import { connect, createServer } from "node:tls";
import { describe, expect, it } from "vitest";
import { SmtpTransport } from "./services/smtp-email-provider.js";

// Test-only localhost certificate. Its private key cannot authenticate a real
// server and is intentionally trusted only by the connector below.
const LOCAL_SMTP_SERVER_PFX =
  "MIIDrwIBAzCCA2sGCSqGSIb3DQEHAaCCA1wEggNYMIIDVDCCAW0GCSqGSIb3DQEHAaCCAV4EggFaMIIBVjCCAVIGCyqGSIb3DQEMCgECoIHMMIHJMBwGCiqGSIb3DQEMAQMwDgQIEOogfaIpM1MCAgfQBIGoVJpWiyWIAdS53FNMM0P1rI0ItPklisIHd4SSURM/pZF2YZDbPZdMBJnHtkQTHe1fIxXPuYaEmkm1YBFHzglcgWItfSNUAHmsYzDbCeduntWlAOOiWJ2JnxvlXz0qtMauOpDe6Sq5vWqUJqmW3vTB08IxOXD54OxObT0WC+Qi28M5gDaAT7zKg+pBZvx3aXJL6gvm/Ilv9jSbMs87irdVj3YEf2P4voCDMXQwEwYJKoZIhvcNAQkVMQYEBAEAAAAwXQYJKwYBBAGCNxEBMVAeTgBNAGkAYwByAG8AcwBvAGYAdAAgAFMAbwBmAHQAdwBhAHIAZQAgAEsAZQB5ACAAUwB0AG8AcgBhAGcAZQAgAFAAcgBvAHYAaQBkAGUAcjCCAd8GCSqGSIb3DQEHBqCCAdAwggHMAgEAMIIBxQYJKoZIhvcNAQcBMBwGCiqGSIb3DQEMAQMwDgQI5QEb7HZPsKkCAgfQgIIBmLGGe2SQtwC2mKZrwUDu+9kA3L+6DyKpDoTOS4mZoXYKfkj4rw0z1o9sdMTMx4hetqbhIxudj1IXx7MVE0988zgmLwhMNnsBplJBaA5oI3ADBQZA3l9KiWHk+VPzYSCGKtkilrtfwe1VIVuH9pZ1XdJg/xQZdlpBmc7uLf7q9ixlcym7rC71IeOUwNBPw/uIDmrxYVwkmL+F0YGX37hnI7T+hBWq0w46gr3elwnh3ehmLOMx6/coAG+0x9bGDE1QMmo8f2YpL7hkRS9CPEZnsotkIY4MGgyG+Mlx3vil0TuJFrd1ZANDKDM7du/blkfKRzTualUMIraxxAwyFTDNqz2A+N6UThgSZdMRchOj11FSiVSUZfCrU61iUcXacu7Hsk9rq87whyf0SZnMWeq4lAZvkP5u5fm9jPl/ZCfD+h1iKJlBIIVNLx06vEQI2Ye1XWW6arNAbXknkA5MCVw02Q7G0GVKhOUNI8JYOPBq+tR9/JrHbm4vv6jHSwcb5jWlYKqFhPGb/Aj95fDCCBLWrXo/RJK/KH4BLjA7MB8wBwYFKw4DAhoEFCl0GeA5xiOQt+Bkl1dDcnXdWaweBBTJAZ00JSiGFFevIYlPTEp1j+npEwICB9A=";

interface LocalSmtpServer {
  readonly port: number;
  readonly commands: readonly string[];
  readonly messages: readonly string[];
  close(): Promise<void>;
}

async function startLocalSmtpServer(username: string, password: string): Promise<LocalSmtpServer> {
  const commands: string[] = [];
  const messages: string[] = [];
  const server = createServer(
    {
      pfx: Buffer.from(LOCAL_SMTP_SERVER_PFX, "base64"),
      passphrase: "test-only",
      minVersion: "TLSv1.2"
    },
    (socket) => {
      let buffer = "";
      let dataLines: string[] | undefined;
      socket.setEncoding("utf8");
      socket.write("220 localhost ESMTP test server ready\r\n");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let end = buffer.indexOf("\r\n");
        while (end >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (dataLines) {
            if (line === ".") {
              messages.push(dataLines.join("\r\n"));
              dataLines = undefined;
              socket.write("250 message accepted\r\n");
            } else {
              dataLines.push(line);
            }
          } else if (line.startsWith("EHLO ")) {
            commands.push(line);
            socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          } else if (line.startsWith("AUTH PLAIN ")) {
            commands.push(line);
            const credentials = Buffer.from(line.slice("AUTH PLAIN ".length), "base64").toString(
              "utf8"
            );
            socket.write(
              credentials === `\u0000${username}\u0000${password}`
                ? "235 authenticated\r\n"
                : "535 invalid credentials\r\n"
            );
          } else if (line.startsWith("MAIL FROM:")) {
            commands.push(line);
            socket.write("250 sender accepted\r\n");
          } else if (line.startsWith("RCPT TO:")) {
            commands.push(line);
            socket.write("250 recipient accepted\r\n");
          } else if (line === "DATA") {
            commands.push(line);
            dataLines = [];
            socket.write("354 end with <CR><LF>.<CR><LF>\r\n");
          } else if (line === "QUIT") {
            commands.push(line);
            socket.end("221 goodbye\r\n");
          } else {
            socket.write("500 unsupported command\r\n");
          }
          end = buffer.indexOf("\r\n");
        }
      });
    }
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local SMTP server has no TCP address.");
  return {
    port: address.port,
    commands,
    messages,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

describe("local implicit-TLS SMTP acceptance", () => {
  it("completes an encrypted authenticated SMTP submission over a real local socket", async () => {
    const username = "local-fixture-user";
    const password = "local-fixture-password";
    const server = await startLocalSmtpServer(username, password);
    try {
      const transport = new SmtpTransport({
        timeoutMs: 2_000,
        // A local self-signed test server is never a production trust decision.
        connectImplicitTls: ({ host, port }) =>
          new Promise((resolve, reject) => {
            const socket = connect({
              host,
              port,
              rejectUnauthorized: false,
              minVersion: "TLSv1.2"
            });
            socket.once("error", reject);
            socket.once("secureConnect", () => {
              socket.off("error", reject);
              resolve(socket);
            });
          })
      });

      await transport.send(
        {
          host: "127.0.0.1",
          port: server.port,
          tlsMode: "IMPLICIT_TLS",
          username,
          password,
          fromAddress: "sender@example.test"
        },
        {
          to: "recipient@example.test",
          subject: "Local SMTP acceptance",
          message: "A real local TLS SMTP server received this message."
        }
      );

      expect(server.commands).toEqual([
        "EHLO clearledger.local",
        `AUTH PLAIN ${Buffer.from(`\u0000${username}\u0000${password}`, "utf8").toString("base64")}`,
        "MAIL FROM:<sender@example.test>",
        "RCPT TO:<recipient@example.test>",
        "DATA",
        "QUIT"
      ]);
      expect(server.messages).toHaveLength(1);
      expect(server.messages[0]).toContain("Subject: Local SMTP acceptance");
      expect(server.messages[0]).toContain(
        Buffer.from("A real local TLS SMTP server received this message.", "utf8").toString(
          "base64"
        )
      );
    } finally {
      await server.close();
    }
  });
});
