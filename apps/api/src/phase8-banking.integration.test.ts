import { randomUUID } from "node:crypto";
import { PrismaClient, withRuntimeTransaction, withTenantTransaction } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase8-owner@example.test";

function headers(organizationId?: string, email = owner, key?: string) {
  return {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(key ? { "idempotency-key": key } : {})
  };
}

async function createOrganization(email = owner) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(undefined, email),
    payload: { legalName: "Phase Eight Ltd", displayName: "Phase Eight" }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configure(organizationId: string, email = owner) {
  const state = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId, email)
  });
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/setup/profile",
        headers: headers(organizationId, email),
        payload: {
          version,
          legalName: "Phase Eight Ltd",
          displayName: "Phase Eight",
          locale: "en-CA",
          timeZone: "America/Edmonton",
          baseCurrency: "CAD",
          fiscalYearEndMonth: 12,
          fiscalYearEndDay: 31,
          accountingStartDate: "2026-01-01"
        }
      })
    ).statusCode
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/presets/general-service/apply",
        headers: headers(organizationId, email, randomUUID()),
        payload: {}
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/fiscal-year/initialize",
        headers: headers(organizationId, email),
        payload: {}
      })
    ).statusCode
  ).toBe(200);
}

async function chart(organizationId: string, email = owner) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId, email)
  });
  return response.json<{
    accounts: Array<{
      id: string;
      type: string;
      code: string;
      systemPurpose: string | null;
      isControl: boolean;
    }>;
  }>().accounts;
}

async function ledgerAccount(
  organizationId: string,
  code: string,
  type: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE"
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    headers: headers(organizationId),
    payload: { code, name: code, type, isControl: false }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

async function bankAccount(
  organizationId: string,
  linkedLedgerAccountId: string,
  accountKind: "BANK" | "CREDIT_CARD" = "BANK",
  displayName = "Operating"
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/bank-accounts",
    headers: headers(organizationId),
    payload: {
      displayName,
      accountKind,
      maskedAccountReference: `****${accountKind === "BANK" ? "1234" : "9876"}`,
      financialInstitutionName: "Test Financial",
      currency: "CAD",
      linkedLedgerAccountId,
      openingDate: "2026-01-01"
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ bankAccount: { id: string; version: number } }>().bankAccount;
}

function csv(rows: readonly string[]): string {
  return `date,description,amount,currency,reference\n${rows.join("\n")}\n`;
}

async function preview(
  organizationId: string,
  bankAccountId: string,
  content: string,
  fileName = `${randomUUID()}.csv`
) {
  return app.inject({
    method: "POST",
    url: "/v1/bank-imports/preview",
    headers: headers(organizationId),
    payload: {
      bankAccountId,
      fileName,
      format: "CSV",
      contentBase64: Buffer.from(content).toString("base64")
    }
  });
}

async function importCsv(
  organizationId: string,
  bankAccountId: string,
  content: string,
  fileName = `${randomUUID()}.csv`
) {
  const previewed = await preview(organizationId, bankAccountId, content, fileName);
  expect(previewed.statusCode).toBe(201);
  const batch = previewed.json<{ batch: { id: string; version: number } }>().batch;
  const committed = await app.inject({
    method: "POST",
    url: `/v1/bank-imports/${batch.id}/commit`,
    headers: headers(organizationId, owner, randomUUID()),
    payload: { version: batch.version }
  });
  expect(committed.statusCode, committed.body).toBe(201);
  return committed.json<{
    batch: { id: string; version: number };
    transactions: Array<{
      id: string;
      version: number;
      amountMinor: string;
      status: string;
      duplicateStatus: string;
    }>;
  }>();
}

async function categorize(
  organizationId: string,
  transaction: { id: string; version: number },
  accountId: string,
  amountMinor: string,
  taxCodeId?: string
) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/bank-transactions/${transaction.id}/categorize`,
    headers: headers(organizationId, owner, randomUUID()),
    payload: {
      version: transaction.version,
      lines: [{ accountId, amountMinor, ...(taxCodeId ? { taxCodeId } : {}) }]
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{
    transaction: { id: string; version: number; status: string };
    categorization: { id: string; journalId: string };
  }>();
}

async function journal(
  organizationId: string,
  bankLedgerId: string,
  offsetAccountId: string,
  amountMinor: string,
  direction: "DEBIT" | "CREDIT",
  sourceType = "MANUAL",
  sourceId = randomUUID()
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/journals",
    headers: headers(organizationId, owner, randomUUID()),
    payload: {
      effectiveDate: "2026-04-01",
      description: sourceType,
      sourceType,
      sourceId,
      postingKey: `${sourceType}:${sourceId}`,
      allowControlAccountPosting: false,
      lines:
        direction === "CREDIT"
          ? [
              { accountId: bankLedgerId, debitMinor: amountMinor, creditMinor: "0" },
              { accountId: offsetAccountId, debitMinor: "0", creditMinor: amountMinor }
            ]
          : [
              { accountId: offsetAccountId, debitMinor: amountMinor, creditMinor: "0" },
              { accountId: bankLedgerId, debitMinor: "0", creditMinor: amountMinor }
            ]
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ journal: { id: string } }>().journal;
}

async function addMember(organizationId: string, email: string, role: string) {
  const invitation = await app.inject({
    method: "POST",
    url: "/v1/organizations/current/invitations",
    headers: headers(organizationId),
    payload: { email, role }
  });
  expect(invitation.statusCode).toBe(201);
  const token = invitation.json<{ token: string }>().token;
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/invitations/accept",
        headers: headers(undefined, email),
        payload: { token }
      })
    ).statusCode
  ).toBe(200);
}

beforeAll(async () => {
  await prisma.$connect();
  await app.ready();
});
beforeEach(async () => resetDatabase(prisma));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Phase 8 bank imports and reconciliation", () => {
  it("creates tenant-isolated masked bank and card accounts with compatible ledgers", async () => {
    const first = await createOrganization();
    const second = await createOrganization("phase8-other@example.test");
    await configure(first);
    await configure(second, "phase8-other@example.test");
    const asset = await ledgerAccount(first, "BANK-1", "ASSET");
    const liability = await ledgerAccount(first, "CARD-1", "LIABILITY");
    const bank = await bankAccount(first, asset);
    const card = await bankAccount(first, liability, "CREDIT_CARD", "Corporate card");
    expect(card.id).not.toBe(bank.id);
    const unmasked = await app.inject({
      method: "POST",
      url: "/v1/bank-accounts",
      headers: headers(first),
      payload: {
        displayName: "Unsafe",
        accountKind: "BANK",
        maskedAccountReference: "123456789",
        currency: "CAD",
        linkedLedgerAccountId: asset,
        openingDate: "2026-01-01"
      }
    });
    expect(unmasked.statusCode).toBe(422);
    const wrongType = await app.inject({
      method: "POST",
      url: "/v1/bank-accounts",
      headers: headers(first),
      payload: {
        displayName: "Wrong",
        accountKind: "CREDIT_CARD",
        maskedAccountReference: "****0001",
        currency: "CAD",
        linkedLedgerAccountId: asset,
        openingDate: "2026-01-01"
      }
    });
    expect(wrongType.statusCode).toBe(422);
    const crossTenant = await preview(second, bank.id, csv(["2026-04-01,Hidden,1.00,CAD,X"]));
    expect(crossTenant.statusCode).toBe(404);
    const firstActor = await prisma.user.findUniqueOrThrow({ where: { email: owner } });
    const secondActor = await prisma.user.findUniqueOrThrow({
      where: { email: "phase8-other@example.test" }
    });
    expect(
      await withRuntimeTransaction(prisma, firstActor.id, (tx) => tx.bankAccount.count())
    ).toBe(0);
    expect(
      await withTenantTransaction(
        prisma,
        { organizationId: second, actorUserId: secondActor.id },
        (tx) => tx.bankAccount.count()
      )
    ).toBe(0);
    expect(
      await withTenantTransaction(
        prisma,
        { organizationId: first, actorUserId: firstActor.id },
        (tx) => tx.bankAccount.count()
      )
    ).toBe(2);
    const archived = await app.inject({
      method: "POST",
      url: `/v1/bank-accounts/${bank.id}/archive`,
      headers: headers(first),
      payload: { version: bank.version }
    });
    expect(archived.statusCode).toBe(200);
    expect(await prisma.bankAccount.count({ where: { id: bank.id } })).toBe(1);
  });

  it("previews and commits CSV and OFX safely, replays files, and rejects malformed input", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const ledger = await ledgerAccount(organizationId, "BANK-CSV", "ASSET");
    const bank = await bankAccount(organizationId, ledger);
    const file = csv(["2026-04-01,Deposit,10.01,CAD,D-1", "2026-04-02,Fee,-1.25,CAD,F-1"]);
    const first = await preview(organizationId, bank.id, file, "statement.csv");
    expect(first.statusCode).toBe(201);
    const batch = first.json<{ batch: { id: string; version: number }; rows: unknown[] }>();
    expect(batch.rows).toHaveLength(2);
    const committed = await app.inject({
      method: "POST",
      url: `/v1/bank-imports/${batch.batch.id}/commit`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: batch.batch.version }
    });
    expect(committed.statusCode, committed.body).toBe(201);
    const replay = await preview(organizationId, bank.id, file, "statement.csv");
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ replayed: boolean }>().replayed).toBe(true);
    expect(await prisma.bankImportedTransaction.count({ where: { organizationId } })).toBe(2);

    const ofx =
      "OFXHEADER:100\n<OFX><CURDEF>CAD<BANKTRANLIST><STMTTRN><DTPOSTED>20260403<TRNAMT>-2.50<FITID>OFX-1<NAME>Service fee</STMTTRN></BANKTRANLIST></OFX>";
    const ofxPreview = await app.inject({
      method: "POST",
      url: "/v1/bank-imports/preview",
      headers: headers(organizationId),
      payload: {
        bankAccountId: bank.id,
        fileName: "statement.ofx",
        format: "OFX",
        contentBase64: Buffer.from(ofx).toString("base64")
      }
    });
    expect(ofxPreview.statusCode).toBe(201);
    const badMapping = await app.inject({
      method: "POST",
      url: "/v1/bank-imports/preview",
      headers: headers(organizationId),
      payload: {
        bankAccountId: bank.id,
        fileName: "bad.csv",
        format: "CSV",
        contentBase64: Buffer.from("posted,text,value\n2026-01-01,X,1.00\n").toString("base64"),
        mapping: { postingDate: "missing", description: "text", amount: "value" }
      }
    });
    expect(badMapping.statusCode).toBe(422);
    expect(
      badMapping.json<{ error: { details: { row: number; field: string } } }>().error.details
    ).toMatchObject({
      row: 1,
      field: "missing"
    });
    const duplicateRow = await preview(
      organizationId,
      bank.id,
      csv(["2026-04-04,Same,3.00,CAD,S", "2026-04-04,Same,3.00,CAD,S"])
    );
    expect(duplicateRow.statusCode).toBe(422);
    expect(await prisma.bankImportBatch.count({ where: { originalFileName: "bad.csv" } })).toBe(0);

    const probable = await importCsv(
      organizationId,
      bank.id,
      csv(["2026-04-01,Deposit,10.01,CAD,DIFFERENT-REFERENCE"]),
      "probable.csv"
    );
    const probableTransaction = probable.transactions[0]!;
    expect(probableTransaction.duplicateStatus).toBe("PROBABLE");
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${probableTransaction.id}/categorize`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: {
        version: probableTransaction.version,
        lines: [
          {
            accountId: await ledgerAccount(organizationId, "PROBABLE-EXPENSE", "EXPENSE"),
            amountMinor: probableTransaction.amountMinor
          }
        ]
      }
    });
    expect(blocked.statusCode).toBe(409);
    const overridden = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${probableTransaction.id}/duplicate-override`,
      headers: headers(organizationId),
      payload: { version: probableTransaction.version, reason: "Separate customer remittance" }
    });
    expect(overridden.statusCode).toBe(200);
    expect(
      overridden.json<{ transaction: { duplicateStatus: string } }>().transaction.duplicateStatus
    ).toBe("OVERRIDDEN");
  });

  it("serializes competing imports and rolls back the losing batch without partial rows", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const ledger = await ledgerAccount(organizationId, "BANK-RACE", "ASSET");
    const bank = await bankAccount(organizationId, ledger);
    const first = await preview(
      organizationId,
      bank.id,
      "date,description,amount,currency,reference,unused\n2026-04-01,Race,5.00,CAD,R,one\n",
      "race-one.csv"
    );
    const second = await preview(
      organizationId,
      bank.id,
      "date,description,amount,currency,reference,unused\n2026-04-01,Race,5.00,CAD,R,two\n",
      "race-two.csv"
    );
    const batches = [first, second].map(
      (response) => response.json<{ batch: { id: string; version: number } }>().batch
    );
    const results = await Promise.all(
      batches.map((batch) =>
        app.inject({
          method: "POST",
          url: `/v1/bank-imports/${batch.id}/commit`,
          headers: headers(organizationId, owner, randomUUID()),
          payload: { version: batch.version }
        })
      )
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409]);
    expect(await prisma.bankImportedTransaction.count({ where: { organizationId } })).toBe(1);
    expect(
      await prisma.bankImportBatch.count({ where: { organizationId, status: "COMMITTED" } })
    ).toBe(1);
  });

  it("supports exact split matching, explainable suggestions, reversal, and database totals", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const bankLedger = await ledgerAccount(organizationId, "BANK-MATCH", "ASSET");
    const offset = await ledgerAccount(organizationId, "MATCH-OFFSET", "REVENUE");
    const bank = await bankAccount(organizationId, bankLedger);
    const imported = (
      await importCsv(organizationId, bank.id, csv(["2026-04-01,Combined deposit,10.00,CAD,M-1"]))
    ).transactions[0]!;
    const first = await journal(organizationId, bankLedger, offset, "400", "CREDIT");
    const second = await journal(organizationId, bankLedger, offset, "600", "CREDIT");
    const suggestions = await app.inject({
      method: "GET",
      url: `/v1/bank-transactions/${imported.id}/match-suggestions`,
      headers: headers(organizationId)
    });
    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.json<{ suggestions: unknown[] }>().suggestions).toHaveLength(2);
    const directTarget = await journal(organizationId, bankLedger, offset, "1000", "CREDIT");
    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${imported.id}/matches`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: {
        version: imported.version,
        matches: [
          {
            targetJournalId: first.id,
            targetType: "MANUAL_JOURNAL",
            targetId: first.id,
            amountMinor: "999"
          }
        ]
      }
    });
    expect(mismatch.statusCode).toBe(422);
    const matched = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${imported.id}/matches`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: {
        version: imported.version,
        matches: [
          {
            targetJournalId: first.id,
            targetType: "MANUAL_JOURNAL",
            targetId: first.id,
            amountMinor: "400",
            reasons: ["same-date", "exact-split"]
          },
          {
            targetJournalId: second.id,
            targetType: "MANUAL_JOURNAL",
            targetId: second.id,
            amountMinor: "600",
            reasons: ["same-date", "exact-split"]
          }
        ]
      }
    });
    expect(matched.statusCode).toBe(201);
    const matchedTransaction = matched.json<{ transaction: { version: number } }>().transaction;
    await expect(
      prisma.$transaction(async (tx) => {
        const direct = await tx.bankImportedTransaction.create({
          data: {
            organizationId,
            bankAccountId: bank.id,
            importBatchId: (
              await tx.bankImportBatch.findFirstOrThrow({ where: { organizationId } })
            ).id,
            sourceRowNumber: 99,
            postingDate: new Date("2026-04-01"),
            description: "Direct",
            normalizedDescription: "direct",
            amountMinor: 1000n,
            direction: "CREDIT",
            rawFingerprint: "f".repeat(64)
          }
        });
        await tx.bankTransactionMatch.create({
          data: {
            organizationId,
            importedTransactionId: direct.id,
            targetJournalId: directTarget.id,
            targetType: "MANUAL_JOURNAL",
            targetId: randomUUID(),
            amountMinor: 500n,
            confidenceBasisPoints: 10000,
            reasons: [],
            createdByUserId: (await tx.user.findUniqueOrThrow({ where: { email: owner } })).id
          }
        });
        await tx.bankImportedTransaction.update({
          where: { id: direct.id },
          data: { status: "MATCHED" }
        });
      })
    ).rejects.toThrow(/exactly equal/i);
    await expect(
      prisma.bankTransactionMatch.create({
        data: {
          organizationId,
          importedTransactionId: (
            await importCsv(
              organizationId,
              bank.id,
              csv(["2026-04-03,Duplicate target,4.00,CAD,NEW-TARGET"])
            )
          ).transactions[0]!.id,
          targetJournalId: first.id,
          targetType: "MANUAL_JOURNAL",
          targetId: randomUUID(),
          amountMinor: 400n,
          confidenceBasisPoints: 10000,
          reasons: [],
          createdByUserId: (await prisma.user.findUniqueOrThrow({ where: { email: owner } })).id
        }
      })
    ).rejects.toThrow(/only be actively matched once/i);
    const reversed = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${imported.id}/matches/reverse`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: matchedTransaction.version, reason: "Wrong bank entry" }
    });
    expect(reversed.statusCode).toBe(200);
    expect(
      await prisma.bankTransactionMatch.count({
        where: { importedTransactionId: imported.id, active: false }
      })
    ).toBe(2);
  });

  it("matches invoice payments, bill payments, expenses, and processor settlements without reposting", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const bankLedger = await ledgerAccount(organizationId, "BANK-SOURCES", "ASSET");
    const expense = await ledgerAccount(organizationId, "EXP-SOURCES", "EXPENSE");
    const revenue = await ledgerAccount(organizationId, "REV-SOURCES", "REVENUE");
    const bank = await bankAccount(organizationId, bankLedger);

    const customerResponse = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "C-8",
        displayName: "Customer",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    });
    const customerId = customerResponse.json<{ customer: { id: string } }>().customer.id;
    const productResponse = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: headers(organizationId),
      payload: {
        sku: "P-8",
        name: "Service",
        itemType: "SERVICE",
        salesPriceMinor: "1000",
        incomeAccountId: revenue
      }
    });
    const productId = productResponse.json<{ product: { id: string } }>().product.id;
    const invoiceResponse = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId),
      payload: {
        customerId,
        issueDate: "2026-04-01",
        lines: [{ productItemId: productId, quantity: "1", unitPriceMinor: "1000" }]
      }
    });
    const invoice = invoiceResponse.json<{ invoice: { id: string; version: number } }>().invoice;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/invoices/${invoice.id}/post`,
          headers: headers(organizationId, owner, randomUUID()),
          payload: { version: invoice.version }
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/payments/manual",
          headers: headers(organizationId, owner, randomUUID()),
          payload: {
            customerId,
            receivingAccountId: bankLedger,
            paymentDate: "2026-04-01",
            amountMinor: "1000",
            methodCategory: "CHEQUE",
            allocations: [{ invoiceId: invoice.id, amountMinor: "1000" }]
          }
        })
      ).statusCode
    ).toBe(201);
    const payment = await prisma.payment.findFirstOrThrow({ where: { organizationId } });

    const vendorResponse = await app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: headers(organizationId),
      payload: {
        vendorNumber: "V-8",
        legalName: "Vendor",
        displayName: "Vendor",
        defaultPaymentTermsDays: 30
      }
    });
    const vendorId = vendorResponse.json<{ vendor: { id: string } }>().vendor.id;
    const billResponse = await app.inject({
      method: "POST",
      url: "/v1/bills",
      headers: headers(organizationId),
      payload: {
        vendorId,
        vendorInvoiceNumber: "B-8",
        issueDate: "2026-04-01",
        lines: [
          {
            description: "Expense",
            quantity: "1",
            unitCostMinor: "1000",
            accountId: expense
          }
        ]
      }
    });
    const bill = billResponse.json<{ bill: { id: string; version: number } }>().bill;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/bills/${bill.id}/post`,
          headers: headers(organizationId, owner, randomUUID()),
          payload: { version: bill.version }
        })
      ).statusCode
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/bill-payments",
          headers: headers(organizationId, owner, randomUUID()),
          payload: {
            vendorId,
            paymentDate: "2026-04-01",
            amountMinor: "1000",
            method: "CHEQUE",
            payingAccountId: bankLedger,
            allocations: [{ billId: bill.id, amountMinor: "1000" }]
          }
        })
      ).statusCode
    ).toBe(201);
    const billPayment = await prisma.billPayment.findFirstOrThrow({ where: { organizationId } });

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/immediate-expenses",
          headers: headers(organizationId, owner, randomUUID()),
          payload: {
            expenseDate: "2026-04-01",
            method: "CHEQUE",
            payingAccountId: bankLedger,
            lines: [
              {
                description: "Immediate",
                quantity: "1",
                unitCostMinor: "250",
                accountId: expense
              }
            ]
          }
        })
      ).statusCode
    ).toBe(201);
    const immediate = await prisma.immediateExpense.findFirstOrThrow({ where: { organizationId } });
    const settlement = await journal(
      organizationId,
      bankLedger,
      revenue,
      "700",
      "CREDIT",
      "PROCESSOR_SETTLEMENT",
      "settlement-1"
    );
    const imported = (
      await importCsv(
        organizationId,
        bank.id,
        csv([
          "2026-04-01,Invoice payment,10.00,CAD,P",
          "2026-04-01,Bill payment,-10.00,CAD,B",
          "2026-04-01,Immediate expense,-2.50,CAD,E",
          "2026-04-01,Processor settlement,7.00,CAD,S"
        ])
      )
    ).transactions;
    const targets = [
      {
        transaction: imported[0]!,
        journalId: payment.journalId!,
        targetType: "INVOICE_PAYMENT",
        targetId: payment.id
      },
      {
        transaction: imported[1]!,
        journalId: billPayment.journalId,
        targetType: "BILL_PAYMENT",
        targetId: billPayment.id
      },
      {
        transaction: imported[2]!,
        journalId: immediate.journalId,
        targetType: "IMMEDIATE_EXPENSE",
        targetId: immediate.id
      },
      {
        transaction: imported[3]!,
        journalId: settlement.id,
        targetType: "PROCESSOR_SETTLEMENT",
        targetId: "settlement-1"
      }
    ] as const;
    const journalCount = await prisma.journal.count({ where: { organizationId } });
    for (const target of targets) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/bank-transactions/${target.transaction.id}/matches`,
        headers: headers(organizationId, owner, randomUUID()),
        payload: {
          version: target.transaction.version,
          matches: [
            {
              targetJournalId: target.journalId,
              targetType: target.targetType,
              targetId: target.targetId,
              amountMinor: target.transaction.amountMinor
            }
          ]
        }
      });
      expect(response.statusCode).toBe(201);
    }
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(journalCount);
  });

  it("suggests and atomically confirms an e-Transfer deposit with a durable reference", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const bankLedger = await ledgerAccount(organizationId, "BANK-ETRANSFER", "ASSET");
    const revenue = await ledgerAccount(organizationId, "REV-ETRANSFER", "REVENUE");
    const bank = await bankAccount(organizationId, bankLedger);
    const customer = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: headers(organizationId),
      payload: {
        customerNumber: "C-ETRANSFER",
        displayName: "Northwind Services",
        defaultPaymentTermsDays: 30,
        defaultCurrency: "CAD"
      }
    });
    expect(customer.statusCode).toBe(201);
    const customerId = customer.json<{ customer: { id: string } }>().customer.id;
    const product = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: headers(organizationId),
      payload: {
        sku: "ETRANSFER-SERVICE",
        name: "Advisory service",
        itemType: "SERVICE",
        salesPriceMinor: "12500",
        incomeAccountId: revenue
      }
    });
    expect(product.statusCode).toBe(201);
    const productId = product.json<{ product: { id: string } }>().product.id;
    const draft = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: headers(organizationId),
      payload: {
        customerId,
        issueDate: "2026-04-01",
        lines: [{ productItemId: productId, quantity: "1", unitPriceMinor: "12500" }]
      }
    });
    expect(draft.statusCode).toBe(201);
    const invoice = draft.json<{
      invoice: { id: string; version: number; paymentReference: string };
    }>().invoice;
    const posted = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoice.id}/post`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: invoice.version }
    });
    expect(posted.statusCode, posted.body).toBe(201);
    const imported = (
      await importCsv(
        organizationId,
        bank.id,
        `date,description,amount,currency,reference,payee\n2026-04-02,INTERAC E-TRANSFER,125.00,CAD,${invoice.paymentReference},Northwind AP\n`,
        "etransfer.csv"
      )
    ).transactions[0]!;
    const suggestions = await app.inject({
      method: "GET",
      url: `/v1/bank-transactions/${imported.id}/invoice-deposit-suggestions`,
      headers: headers(organizationId)
    });
    expect(suggestions.statusCode, suggestions.body).toBe(200);
    const suggestion = suggestions.json<{
      suggestions: Array<{
        invoiceIds: string[];
        allocationAmountsMinor: string[];
        confidence: string;
      }>;
    }>().suggestions[0]!;
    expect(suggestion).toMatchObject({
      invoiceIds: [invoice.id],
      allocationAmountsMinor: ["12500"],
      confidence: "HIGH"
    });
    const key = randomUUID();
    const payload = {
      version: imported.version,
      allocations: suggestion.invoiceIds.map((invoiceId, index) => ({
        invoiceId,
        amountMinor: suggestion.allocationAmountsMinor[index]
      })),
      rememberPayerAlias: true
    };
    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${imported.id}/confirm-invoice-deposit`,
      headers: headers(organizationId, owner, key),
      payload
    });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    expect(
      confirmed.json<{ payment: { id: string }; payerAlias: { displayName: string } }>().payerAlias
    ).toMatchObject({ displayName: "Northwind AP" });
    const replay = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${imported.id}/confirm-invoice-deposit`,
      headers: headers(organizationId, owner, key),
      payload
    });
    expect(replay.statusCode).toBe(201);
    expect(await prisma.payment.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.customerPaymentAlias.count({ where: { organizationId } })).toBe(1);
    expect(
      await prisma.bankImportedTransaction.findUniqueOrThrow({ where: { id: imported.id } })
    ).toMatchObject({ status: "MATCHED" });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      amountPaidMinor: 12500n,
      status: "PAID"
    });
  });

  it("posts exact single and split tax categorizations and keeps bank rules advisory", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const accounts = await chart(organizationId);
    const recoverable = accounts.find((account) => account.systemPurpose === "tax-recoverable")!;
    const payable = accounts.find((account) => account.systemPurpose === "tax-payable")!;
    const expense = await ledgerAccount(organizationId, "EXP-CAT", "EXPENSE");
    const secondExpense = await ledgerAccount(organizationId, "EXP-CAT-2", "EXPENSE");
    const bankLedger = await ledgerAccount(organizationId, "BANK-CAT", "ASSET");
    const bank = await bankAccount(organizationId, bankLedger);
    const taxResponse = await app.inject({
      method: "POST",
      url: "/v1/setup/tax-codes/versions",
      headers: headers(organizationId),
      payload: {
        code: "GST8",
        name: "GST",
        treatment: "STANDARD",
        calculationMode: "EXCLUSIVE",
        effectiveFrom: "2026-01-01",
        sourceName: "Test",
        sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
        components: [
          {
            name: "GST",
            jurisdiction: "CA",
            rate: "0.050000",
            recoverablePercent: "1.000000",
            payableAccountId: payable.id,
            recoverableAccountId: recoverable.id
          }
        ]
      }
    });
    const taxCodeId = taxResponse.json<{ taxCodeVersion: { taxCodeId: string } }>().taxCodeVersion
      .taxCodeId;
    const imported = (
      await importCsv(
        organizationId,
        bank.id,
        csv(["2026-04-01,Tax expense,-10.50,CAD,T", "2026-04-02,Split expense,-10.00,CAD,S"])
      )
    ).transactions;
    const categorized = await categorize(organizationId, imported[0]!, expense, "1000", taxCodeId);
    const journalRow = await prisma.journal.findUniqueOrThrow({
      where: { id: categorized.categorization.journalId },
      include: { lines: true }
    });
    expect(journalRow.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(1050n);
    expect(journalRow.lines.reduce((sum, line) => sum + line.creditMinor, 0n)).toBe(1050n);
    expect(journalRow.lines.find((line) => line.accountId === recoverable.id)?.debitMinor).toBe(
      50n
    );
    const split = await app.inject({
      method: "POST",
      url: `/v1/bank-transactions/${imported[1]!.id}/categorize`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: {
        version: imported[1]!.version,
        lines: [
          { accountId: expense, amountMinor: "400" },
          { accountId: secondExpense, amountMinor: "600" }
        ]
      }
    });
    expect(split.statusCode).toBe(201);

    for (const [priority, name] of [
      [2, "Secondary"],
      [1, "Primary"]
    ] as const) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/bank-rules",
            headers: headers(organizationId),
            payload: {
              name,
              priority,
              descriptionContains: "expense",
              direction: "DEBIT",
              suggestion: { accountId: expense }
            }
          })
        ).statusCode
      ).toBe(201);
    }
    const journalCount = await prisma.journal.count({ where: { organizationId } });
    const suggestions = await app.inject({
      method: "GET",
      url: `/v1/bank-transactions/${imported[1]!.id}/rule-suggestions`,
      headers: headers(organizationId)
    });
    const body = suggestions.json<{
      rules: { suggestion: { name: string }; conflicts: unknown[]; autonomousPosting: boolean };
    }>().rules;
    expect(body.suggestion.name).toBe("Primary");
    expect(body.conflicts).toHaveLength(1);
    expect(body.autonomousPosting).toBe(false);
    expect(await prisma.journal.count({ where: { organizationId } })).toBe(journalCount);
  });

  it("creates one bank transfer, matches both sides, and handles credit-card payments as transfers", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const sourceLedger = await ledgerAccount(organizationId, "BANK-TRANSFER", "ASSET");
    const destinationLedger = await ledgerAccount(organizationId, "BANK-DEST", "ASSET");
    const cardLedger = await ledgerAccount(organizationId, "CARD-PAY", "LIABILITY");
    const source = await bankAccount(organizationId, sourceLedger);
    const destination = await bankAccount(organizationId, destinationLedger, "BANK", "Savings");
    const card = await bankAccount(organizationId, cardLedger, "CREDIT_CARD", "Card");
    const sourceImport = (
      await importCsv(organizationId, source.id, csv(["2026-04-01,Transfer out,-5.00,CAD,X"]))
    ).transactions[0]!;
    const destinationImport = (
      await importCsv(organizationId, destination.id, csv(["2026-04-01,Transfer in,5.00,CAD,X"]))
    ).transactions[0]!;
    const payload = {
      sourceBankAccountId: source.id,
      destinationBankAccountId: destination.id,
      transferDate: "2026-04-01",
      amountMinor: "500",
      reference: "X",
      importedTransactionIds: [sourceImport.id, destinationImport.id]
    };
    const key = randomUUID();
    const [created, replay] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: "/v1/bank-transfers",
          headers: headers(organizationId, owner, key),
          payload
        })
      )
    );
    expect([created.statusCode, replay.statusCode], `${created.body}\n${replay.body}`).toEqual([
      201, 201
    ]);
    expect(await prisma.bankTransfer.count({ where: { organizationId } })).toBe(1);
    expect(
      await prisma.bankTransactionMatch.count({ where: { organizationId, active: true } })
    ).toBe(2);
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/bank-transfers",
      headers: headers(organizationId, owner, randomUUID()),
      payload
    });
    expect(duplicate.statusCode).toBe(409);
    const cardPayment = await app.inject({
      method: "POST",
      url: "/v1/bank-transfers",
      headers: headers(organizationId, owner, randomUUID()),
      payload: {
        sourceBankAccountId: source.id,
        destinationBankAccountId: card.id,
        transferDate: "2026-04-02",
        amountMinor: "300",
        reference: "Card payment"
      }
    });
    expect(cardPayment.statusCode).toBe(201);
    const transfer = await prisma.bankTransfer.findFirstOrThrow({
      where: { destinationBankAccountId: card.id },
      include: { journal: { include: { lines: true } } }
    });
    expect(transfer.journal.lines.find((line) => line.accountId === cardLedger)?.debitMinor).toBe(
      300n
    );
    expect(
      transfer.journal.lines.find((line) => line.accountId === sourceLedger)?.creditMinor
    ).toBe(300n);
    const usd = await app.inject({
      method: "POST",
      url: "/v1/bank-accounts",
      headers: headers(organizationId),
      payload: {
        displayName: "USD",
        accountKind: "BANK",
        maskedAccountReference: "****5555",
        currency: "USD",
        linkedLedgerAccountId: await ledgerAccount(organizationId, "USD-BANK", "ASSET"),
        openingDate: "2026-01-01"
      }
    });
    expect(usd.statusCode).toBe(400);
  });

  it("saves, completes, locks, reports, reopens, and serializes reconciliations", async () => {
    const organizationId = await createOrganization();
    await configure(organizationId);
    const bankLedger = await ledgerAccount(organizationId, "BANK-RECON", "ASSET");
    const expense = await ledgerAccount(organizationId, "EXP-RECON", "EXPENSE");
    const revenue = await ledgerAccount(organizationId, "REV-RECON", "REVENUE");
    const bank = await bankAccount(organizationId, bankLedger);
    const imported = (
      await importCsv(
        organizationId,
        bank.id,
        csv(["2026-04-01,Income,10.00,CAD,I", "2026-04-02,Expense,-2.00,CAD,E"])
      )
    ).transactions;
    const income = await categorize(organizationId, imported[0]!, revenue, "1000");
    const outgoing = await categorize(organizationId, imported[1]!, expense, "200");
    const created = await app.inject({
      method: "POST",
      url: "/v1/bank-reconciliations",
      headers: headers(organizationId),
      payload: {
        bankAccountId: bank.id,
        statementStartDate: "2026-04-01",
        statementEndDate: "2026-04-30",
        openingStatementBalanceMinor: "10000",
        closingStatementBalanceMinor: "10801",
        importedTransactionIds: imported.map((row) => row.id)
      }
    });
    expect(created.statusCode, created.body).toBe(201);
    const reconciliation = created.json<{
      reconciliation: { id: string; version: number; differenceMinor: string };
    }>().reconciliation;
    expect(reconciliation.differenceMinor).toBe("1");
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/bank-reconciliations/${reconciliation.id}/complete`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: reconciliation.version }
    });
    expect(rejected.statusCode).toBe(409);
    const updatePayload = {
      version: reconciliation.version,
      statementStartDate: "2026-04-01",
      statementEndDate: "2026-04-30",
      openingStatementBalanceMinor: "10000",
      closingStatementBalanceMinor: "10800",
      importedTransactionIds: imported.map((row) => row.id)
    };
    const [updated, staleUpdate] = await Promise.all([
      app.inject({
        method: "PUT",
        url: `/v1/bank-reconciliations/${reconciliation.id}`,
        headers: headers(organizationId),
        payload: updatePayload
      }),
      app.inject({
        method: "PUT",
        url: `/v1/bank-reconciliations/${reconciliation.id}`,
        headers: headers(organizationId),
        payload: updatePayload
      })
    ]);
    expect([updated.statusCode, staleUpdate.statusCode].sort()).toEqual([200, 409]);
    const current = updated.statusCode === 200 ? updated : staleUpdate;
    const updatedReconciliation = current.json<{
      reconciliation: { version: number; differenceMinor: string };
    }>().reconciliation;
    expect(updatedReconciliation.differenceMinor).toBe("0");
    const completed = await app.inject({
      method: "POST",
      url: `/v1/bank-reconciliations/${reconciliation.id}/complete`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: { version: updatedReconciliation.version }
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const completedRow = completed.json<{
      reconciliation: { version: number };
      snapshot: { report: unknown };
    }>();
    const historicalReport = JSON.stringify(completedRow.snapshot.report);
    await expect(
      prisma.bankImportedTransaction.update({
        where: { id: imported[0]!.id },
        data: { description: "Mutated" }
      })
    ).rejects.toThrow(/immutable|reconciled transaction/i);
    await journal(organizationId, bankLedger, revenue, "25", "CREDIT", "LATE_CORRECTION");
    const report = await app.inject({
      method: "GET",
      url: `/v1/bank-reconciliations/${reconciliation.id}/report?revision=1`,
      headers: headers(organizationId)
    });
    expect(report.statusCode).toBe(200);
    const reportBody = report.json<{
      report: {
        historicalSnapshot: { report: unknown };
        adjustmentsAfterReconciliation: unknown[];
      };
    }>().report;
    expect(JSON.stringify(reportBody.historicalSnapshot.report)).toBe(historicalReport);
    expect(reportBody.adjustmentsAfterReconciliation.length).toBeGreaterThan(0);
    await addMember(organizationId, "phase8-reader@example.test", "READ_ONLY");
    const unauthorized = await app.inject({
      method: "POST",
      url: `/v1/bank-reconciliations/${reconciliation.id}/reopen`,
      headers: headers(organizationId, "phase8-reader@example.test", randomUUID()),
      payload: { version: completedRow.reconciliation.version, reason: "No access" }
    });
    expect(unauthorized.statusCode).toBe(403);
    const reopened = await app.inject({
      method: "POST",
      url: `/v1/bank-reconciliations/${reconciliation.id}/reopen`,
      headers: headers(organizationId, owner, randomUUID()),
      payload: {
        version: completedRow.reconciliation.version,
        reason: "Statement correction"
      }
    });
    expect(reopened.statusCode).toBe(200);
    expect(
      await prisma.bankReconciliationSnapshot.count({
        where: { reconciliationId: reconciliation.id }
      })
    ).toBe(1);
    expect(
      await prisma.bankReconciliationItem.count({
        where: { reconciliationId: reconciliation.id, active: true }
      })
    ).toBe(0);
    expect(income.transaction.status).toBe("CATEGORIZED");
    expect(outgoing.transaction.status).toBe("CATEGORIZED");
    const reopenedReport = await app.inject({
      method: "GET",
      url: `/v1/bank-reconciliations/${reconciliation.id}/report`,
      headers: headers(organizationId)
    });
    expect(reopenedReport.statusCode).toBe(200);
    expect(
      reopenedReport.json<{ report: { adjustmentsAfterReconciliation: unknown[] } }>().report
        .adjustmentsAfterReconciliation
    ).toHaveLength(1);
  });
});
