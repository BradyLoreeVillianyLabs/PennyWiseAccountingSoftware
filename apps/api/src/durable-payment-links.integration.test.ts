import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import {
  createOwnAccountPaymentProvider,
  type OwnAccountPaymentProviderFactory
} from "./services/own-account-payment-provider.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const owner = "durable-payment-links-owner@example.test";
let app: ReturnType<typeof buildApp>;
let emulator: ReturnType<typeof createServer>;
let emulatorBaseUrl = "";
let createLinkCalls = 0;

function headers(organizationId?: string, key?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": owner,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

beforeAll(async () => {
  await prisma.$connect();
  emulator = await startStripeEmulator();
  const factory: OwnAccountPaymentProviderFactory = (provider, credential, options) =>
    createOwnAccountPaymentProvider(provider, credential, { ...options, apiBase: emulatorBaseUrl });
  app = buildApp({ prisma, ownAccountPaymentProviderFactory: factory });
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  createLinkCalls = 0;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) =>
    emulator.close((error) => (error ? reject(error) : resolve()))
  );
});

describe("durable own-account payment links", () => {
  it("creates, renders, polls, and idempotently posts one payment", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const chart = await accounts(organizationId);
    const customer = await createCustomer(organizationId);
    const draft = await createInvoice(organizationId, customer.id);
    const posted = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/post`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: draft.version }
    });
    expect(posted.statusCode, posted.body).toBe(201);

    const settings = await app.inject({
      method: "PUT",
      url: "/v1/payment-settings",
      headers: headers(organizationId),
      payload: {
        clearingAccountId: chart.find((account) => account.systemPurpose === "cash")!.id,
        feeExpenseAccountId: chart.find((account) => account.systemPurpose === "general-expense")!
          .id,
        allowPartialPayments: false,
        minimumPartialMinor: "100"
      }
    });
    expect(settings.statusCode, settings.body).toBe(200);

    const connected = await app.inject({
      method: "POST",
      url: "/v1/payment-accounts/own",
      headers: headers(organizationId),
      payload: { provider: "STRIPE", credential: "sk_test_emulator", mode: "test" }
    });
    expect(connected.statusCode, connected.body).toBe(201);
    expect(connected.body).not.toContain("sk_test_emulator");

    const idempotencyKey = "durable-payment-link-integration-1";
    const created = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/payment-links`,
      headers: headers(organizationId, idempotencyKey),
      payload: { provider: "STRIPE" }
    });
    expect(created.statusCode, created.body).toBe(201);
    const createdBody = created.json<{
      paymentLink: { id: string; providerLinkUrl: string; status: string };
      pdf: { id: string };
    }>();
    expect(createdBody.paymentLink.providerLinkUrl).toBe(
      "https://checkout.stripe.test/pay/plink_service"
    );
    expect(createdBody.paymentLink.status).toBe("ACTIVE");
    expect(createdBody.pdf.id).toBeTruthy();
    expect(createLinkCalls).toBe(1);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draft.id}/payment-links`,
      headers: headers(organizationId, idempotencyKey),
      payload: { provider: "STRIPE" }
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json<{ paymentLink: { id: string } }>().paymentLink.id).toBe(
      createdBody.paymentLink.id
    );
    expect(createLinkCalls).toBe(1);

    const firstPoll = await app.inject({
      method: "POST",
      url: "/v1/payment-links/poll",
      headers: headers(organizationId),
      payload: { limit: 20 }
    });
    expect(firstPoll.statusCode, firstPoll.body).toBe(200);
    expect(firstPoll.json<{ result: { checked: number; succeeded: number } }>().result).toEqual({
      checked: 1,
      succeeded: 1
    });
    expect(await prisma.payment.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.paymentLink.count({ where: { organizationId, status: "PAID" } })).toBe(1);
    expect((await prisma.invoice.findFirstOrThrow({ where: { organizationId } })).status).toBe(
      "PAID"
    );

    const secondPoll = await app.inject({
      method: "POST",
      url: "/v1/payment-links/poll",
      headers: headers(organizationId),
      payload: { limit: 20 }
    });
    expect(secondPoll.statusCode, secondPoll.body).toBe(200);
    expect(secondPoll.json<{ result: { checked: number; succeeded: number } }>().result).toEqual({
      checked: 0,
      succeeded: 0
    });
    expect(await prisma.payment.count({ where: { organizationId } })).toBe(1);
  });
});

async function createOrganization(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "Durable Payments Ltd.", displayName: "Durable Payments" }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configure(organizationId: string): Promise<void> {
  const setup = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  const version = setup.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  const profile = await app.inject({
    method: "PATCH",
    url: "/v1/setup/profile",
    headers: headers(organizationId),
    payload: {
      version,
      legalName: "Durable Payments Ltd.",
      displayName: "Durable Payments",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      baseCurrency: "CAD",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      accountingStartDate: "2026-01-01"
    }
  });
  expect(profile.statusCode, profile.body).toBe(200);
  const preset = await app.inject({
    method: "POST",
    url: "/v1/setup/presets/general-service/apply",
    headers: headers(organizationId, randomUUID()),
    payload: {}
  });
  expect(preset.statusCode, preset.body).toBe(201);
  const fiscalYear = await app.inject({
    method: "POST",
    url: "/v1/setup/fiscal-year/initialize",
    headers: headers(organizationId),
    payload: {}
  });
  expect(fiscalYear.statusCode, fiscalYear.body).toBe(200);
}

async function accounts(organizationId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId)
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{
    accounts: Array<{ id: string; systemPurpose: string | null }>;
  }>().accounts;
}

async function createCustomer(organizationId: string): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: headers(organizationId),
    payload: {
      displayName: "Durable Payments Customer",
      email: "customer@example.test",
      defaultPaymentTermsDays: 30,
      defaultCurrency: "CAD"
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ customer: { id: string } }>().customer;
}

async function createInvoice(organizationId: string, customerId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: headers(organizationId),
    payload: {
      customerId,
      issueDate: "2026-09-12",
      dueDate: "2026-10-12",
      currency: "CAD",
      lines: [{ description: "Emulated online service", quantity: "1", unitPriceMinor: "1000" }]
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ invoice: { id: string; version: number } }>().invoice;
}

async function startStripeEmulator(): Promise<ReturnType<typeof createServer>> {
  const server = createServer((request, response) => {
    void readBody(request)
      .then(() => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        let body: unknown;
        if (request.method === "GET" && url.pathname === "/v1/account")
          body = { id: "acct_service_1", business_profile: { name: "Durable Payments" } };
        else if (request.method === "POST" && url.pathname === "/v1/payment_links") {
          createLinkCalls += 1;
          body = {
            id: "plink_service",
            url: "https://checkout.stripe.test/pay/plink_service",
            currency: "cad"
          };
        } else if (request.method === "GET" && url.pathname === "/v1/payment_links/plink_service")
          body = { id: "plink_service", active: true, currency: "cad" };
        else if (request.method === "GET" && url.pathname === "/v1/checkout/sessions")
          body = {
            object: "list",
            data: [
              {
                id: "cs_service",
                payment_status: "paid",
                payment_intent: "pi_service",
                amount_total: 1000,
                currency: "cad"
              }
            ],
            has_more: false
          };
        else if (request.method === "GET" && url.pathname === "/v1/payment_intents/pi_service")
          body = {
            id: "pi_service",
            latest_charge: {
              id: "ch_service",
              balance_transaction: { id: "txn_service", fee: 25 }
            }
          };
        else if (request.method === "POST" && url.pathname === "/v1/payment_links/plink_service")
          body = { id: "plink_service", active: false };
        else {
          response.statusCode = 404;
          body = { error: { message: "emulator route not found" } };
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(body));
      })
      .catch(() => {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "emulator failure" }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  emulatorBaseUrl = `http://127.0.0.1:${address.port.toString()}`;
  return server;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
