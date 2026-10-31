import { createHash, randomUUID } from "node:crypto";
import { parseMinorUnit, sumMinorUnits } from "@clearledger/accounting-core";
import { Prisma, RuntimePrisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate } from "../utils/dates.js";
import { hashJson } from "../utils/json.js";
import {
  parseBankImport,
  type CsvBankMapping,
  type NormalizedBankRow
} from "./bank-import-parser.js";
import { runIdempotent } from "./idempotency-service.js";
import { suggestDepositInvoices } from "./etransfer-matching.js";
import { JournalService } from "./journal-service.js";
import { PaymentService } from "./payment-service.js";
import { calculatePurchaseLine, type CalculatedPurchaseLine } from "./purchase-calculation.js";

type Tx = Prisma.TransactionClient;
type BankAccountKind = "BANK" | "CREDIT_CARD";
type Direction = "DEBIT" | "CREDIT";
type MatchTargetType =
  | "INVOICE_PAYMENT"
  | "PROCESSOR_SETTLEMENT"
  | "BILL_PAYMENT"
  | "IMMEDIATE_EXPENSE"
  | "MANUAL_JOURNAL"
  | "TRANSFER"
  | "BANK_FEE"
  | "INTEREST";

interface StoredImportRow extends NormalizedBankRow {
  readonly duplicateStatus: "NONE" | "PROBABLE";
  readonly probableDuplicateOfId: string | null;
}

export interface BankAccountInput {
  readonly displayName: string;
  readonly accountKind: BankAccountKind;
  readonly maskedAccountReference: string;
  readonly financialInstitutionName?: string | null | undefined;
  readonly currency: string;
  readonly linkedLedgerAccountId: string;
  readonly openingDate: string;
}

export interface BankImportPreviewInput {
  readonly bankAccountId: string;
  readonly fileName: string;
  readonly format: "CSV" | "OFX" | "QFX";
  readonly contentBase64: string;
  readonly mapping?: CsvBankMapping | undefined;
}

export interface MatchInput {
  readonly targetJournalId: string;
  readonly targetType: MatchTargetType;
  readonly targetId: string;
  readonly amountMinor: string;
  readonly confidenceBasisPoints?: number | undefined;
  readonly reasons?: readonly string[] | undefined;
}

export interface InvoiceDepositConfirmationInput {
  readonly version: number;
  readonly allocations: readonly { readonly invoiceId: string; readonly amountMinor: string }[];
  readonly rememberPayerAlias?: boolean | undefined;
  readonly payerAlias?: string | null | undefined;
}

export interface CategorizationLineInput {
  readonly accountId: string;
  readonly amountMinor: string;
  readonly taxCodeId?: string | null | undefined;
  readonly memo?: string | null | undefined;
}

export interface CategorizationInput {
  readonly lines: readonly CategorizationLineInput[];
  readonly vendorId?: string | null | undefined;
  readonly customerId?: string | null | undefined;
  readonly memo?: string | null | undefined;
}

export interface BankRuleInput {
  readonly bankAccountId?: string | null | undefined;
  readonly name: string;
  readonly priority: number;
  readonly descriptionContains?: string | null | undefined;
  readonly payeeContains?: string | null | undefined;
  readonly minimumAmountMinor?: string | null | undefined;
  readonly maximumAmountMinor?: string | null | undefined;
  readonly direction?: Direction | null | undefined;
  readonly suggestion: Prisma.InputJsonValue;
}

export interface TransferInput {
  readonly sourceBankAccountId: string;
  readonly destinationBankAccountId: string;
  readonly transferDate: string;
  readonly amountMinor: string;
  readonly reference?: string | null | undefined;
  readonly importedTransactionIds?: readonly string[] | undefined;
}

export interface ReconciliationInput {
  readonly bankAccountId: string;
  readonly statementStartDate: string;
  readonly statementEndDate: string;
  readonly openingStatementBalanceMinor: string;
  readonly closingStatementBalanceMinor: string;
  readonly importedTransactionIds: readonly string[];
}

export class BankingService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly paymentService = new PaymentService(prisma)
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
  }

  public async listAccounts(context: OrganizationContext, active?: boolean) {
    await this.authorization.assert(context, "bank-reports:read", "BankAccount");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bankAccount.findMany({
        where: {
          organizationId: context.organizationId,
          ...(active === undefined ? {} : { isActive: active })
        },
        include: { linkedLedgerAccount: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: 200
      })
    );
    return rows.map(toJson);
  }

  public async createAccount(context: OrganizationContext, input: BankAccountInput) {
    await this.authorization.assert(context, "bank-accounts:manage", "BankAccount");
    validateMaskedReference(input.maskedAccountReference);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await assertLedgerAccount(
        tx,
        context.organizationId,
        input.linkedLedgerAccountId,
        input.accountKind
      );
      try {
        const row = await tx.bankAccount.create({
          data: {
            organizationId: context.organizationId,
            displayName: input.displayName.trim(),
            accountKind: input.accountKind,
            maskedAccountReference: input.maskedAccountReference.trim(),
            financialInstitutionName: cleanNullable(input.financialInstitutionName),
            currency: await assertCurrencyEnabled(tx, context.organizationId, input.currency),
            linkedLedgerAccountId: input.linkedLedgerAccountId,
            openingDate: parseDate(input.openingDate, "openingDate"),
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          },
          include: { linkedLedgerAccount: true }
        });
        await audit(tx, context, "BANK_ACCOUNT_CREATED", "BankAccount", row.id, {
          accountKind: row.accountKind,
          linkedLedgerAccountId: row.linkedLedgerAccountId
        });
        return toJson(row);
      } catch (error) {
        throwUnique(
          error,
          "BANK_LEDGER_ACCOUNT_ALREADY_LINKED",
          "Ledger account is already linked."
        );
      }
    });
  }

  public async updateAccount(
    context: OrganizationContext,
    id: string,
    version: number,
    input: {
      readonly displayName?: string | undefined;
      readonly maskedAccountReference?: string | undefined;
      readonly financialInstitutionName?: string | null | undefined;
    }
  ) {
    await this.authorization.assert(context, "bank-accounts:manage", "BankAccount", id);
    if (input.maskedAccountReference) validateMaskedReference(input.maskedAccountReference);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.bankAccount.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: {
          ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
          ...(input.maskedAccountReference
            ? { maskedAccountReference: input.maskedAccountReference.trim() }
            : {}),
          ...(input.financialInstitutionName !== undefined
            ? { financialInstitutionName: cleanNullable(input.financialInstitutionName) }
            : {}),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw stale("Bank account");
      const row = await tx.bankAccount.findUniqueOrThrow({ where: { id } });
      await audit(tx, context, "BANK_ACCOUNT_UPDATED", "BankAccount", id, {
        version: row.version
      });
      return toJson(row);
    });
  }

  public async archiveAccount(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "bank-accounts:manage", "BankAccount", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.bankAccount.updateMany({
        where: { id, organizationId: context.organizationId, version, isActive: true },
        data: {
          isActive: false,
          archivedAt: new Date(),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw stale("Bank account");
      await audit(tx, context, "BANK_ACCOUNT_ARCHIVED", "BankAccount", id, {});
      return toJson(await tx.bankAccount.findUniqueOrThrow({ where: { id } }));
    });
  }

  public async previewImport(context: OrganizationContext, input: BankImportPreviewInput) {
    await this.authorization.assert(context, "bank-imports:create", "BankImportBatch");
    const data = decodeBase64(input.contentBase64);
    const parsed = parseBankImport({
      format: input.format,
      fileName: input.fileName,
      data,
      mapping: input.mapping
    });
    const fileHash = createHash("sha256").update(data).digest("hex");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const account = await activeBankAccount(tx, context.organizationId, input.bankAccountId);
      const existing = await tx.bankImportBatch.findUnique({
        where: { bankAccountId_fileHash: { bankAccountId: account.id, fileHash } }
      });
      if (existing)
        return {
          batch: toJson(existing),
          rows: storedRows(existing.normalizedRows).map(toJson),
          replayed: true
        };

      const rows: StoredImportRow[] = [];
      for (const row of parsed) {
        const exact = await tx.bankImportedTransaction.findFirst({
          where: {
            bankAccountId: account.id,
            OR: [
              { rawFingerprint: row.rawFingerprint },
              ...(row.providerTransactionId
                ? [{ providerTransactionId: row.providerTransactionId }]
                : [])
            ]
          },
          select: { id: true }
        });
        if (exact)
          throw new AppError(
            "BANK_IMPORT_EXACT_DUPLICATE",
            "The statement contains a transaction already imported for this account.",
            409,
            { row: row.sourceRowNumber, existingTransactionId: exact.id }
          );
        const probable = await tx.bankImportedTransaction.findFirst({
          where: {
            bankAccountId: account.id,
            postingDate: parseDate(row.postingDate, "postingDate"),
            amountMinor: BigInt(row.amountMinor),
            direction: row.direction,
            normalizedDescription: row.normalizedDescription
          },
          orderBy: { createdAt: "asc" },
          select: { id: true }
        });
        rows.push({
          ...row,
          duplicateStatus: probable ? "PROBABLE" : "NONE",
          probableDuplicateOfId: probable?.id ?? null
        });
      }
      const batch = await tx.bankImportBatch.create({
        data: {
          organizationId: context.organizationId,
          bankAccountId: account.id,
          format: input.format,
          originalFileName: safeFileName(input.fileName),
          fileHash,
          fileSize: data.length,
          mapping: input.mapping
            ? (input.mapping as unknown as Prisma.InputJsonObject)
            : Prisma.JsonNull,
          normalizedRows: rows as unknown as Prisma.InputJsonArray,
          rowCount: rows.length,
          probableDuplicates: rows.filter((row) => row.duplicateStatus === "PROBABLE").length,
          createdByUserId: context.user.id
        }
      });
      await audit(tx, context, "BANK_IMPORT_PREVIEWED", "BankImportBatch", batch.id, {
        bankAccountId: account.id,
        format: input.format,
        fileHash,
        rowCount: rows.length,
        probableDuplicates: batch.probableDuplicates
      });
      return { batch: toJson(batch), rows: rows.map(toJson), replayed: false };
    });
  }

  public async commitImport(
    context: OrganizationContext,
    batchId: string,
    version: number,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "bank-imports:create", "BankImportBatch", batchId);
    try {
      return await runIdempotent(
        this.prisma,
        context,
        "bank-import.commit",
        idempotencyKey,
        { batchId, version },
        async (tx) => {
          await lock(tx, "BankImportBatch", batchId, context.organizationId);
          const batch = await tx.bankImportBatch.findFirst({
            where: { id: batchId, organizationId: context.organizationId }
          });
          if (!batch)
            throw new AppError("BANK_IMPORT_NOT_FOUND", "Import batch was not found.", 404);
          if (batch.status === "COMMITTED") {
            const transactions = await tx.bankImportedTransaction.findMany({
              where: { importBatchId: batch.id },
              orderBy: { sourceRowNumber: "asc" }
            });
            return {
              statusCode: 200,
              body: { batch: toJson(batch), transactions: transactions.map(toJson) },
              resourceId: batch.id
            };
          }
          if (batch.status !== "PREVIEWED" || batch.version !== version)
            throw stale("Import batch");
          const rows = storedRows(batch.normalizedRows);
          const created = [];
          for (const row of rows) {
            created.push(
              await tx.bankImportedTransaction.create({
                data: {
                  organizationId: context.organizationId,
                  bankAccountId: batch.bankAccountId,
                  importBatchId: batch.id,
                  sourceRowNumber: row.sourceRowNumber,
                  sourceRowIdentifier: row.sourceRowIdentifier,
                  providerTransactionId: row.providerTransactionId,
                  postingDate: parseDate(row.postingDate, "postingDate"),
                  transactionDate: row.transactionDate
                    ? parseDate(row.transactionDate, "transactionDate")
                    : null,
                  description: row.description,
                  normalizedDescription: row.normalizedDescription,
                  payee: row.payee,
                  memo: row.memo,
                  amountMinor: BigInt(row.amountMinor),
                  direction: row.direction,
                  currency: row.currency,
                  balanceMinor: row.balanceMinor === null ? null : BigInt(row.balanceMinor),
                  referenceNumber: row.referenceNumber,
                  rawFingerprint: row.rawFingerprint,
                  duplicateStatus: row.duplicateStatus,
                  probableDuplicateOfId: row.probableDuplicateOfId
                }
              })
            );
          }
          const committed = await tx.bankImportBatch.update({
            where: { id: batch.id },
            data: {
              status: "COMMITTED",
              committedAt: new Date(),
              committedByUserId: context.user.id,
              version: { increment: 1 }
            }
          });
          await tx.bankAccount.update({
            where: { id: batch.bankAccountId },
            data: {
              lastImportAt: new Date(),
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            }
          });
          await audit(tx, context, "BANK_IMPORT_COMMITTED", "BankImportBatch", batch.id, {
            bankAccountId: batch.bankAccountId,
            rowCount: created.length
          });
          await outbox(tx, context.organizationId, "banking.import.committed", batch.id, {
            batchId: batch.id,
            bankAccountId: batch.bankAccountId,
            rowCount: created.length
          });
          return {
            statusCode: 201,
            body: { batch: toJson(committed), transactions: created.map(toJson) },
            resourceId: batch.id
          };
        }
      );
    } catch (error) {
      throwUnique(
        error,
        "BANK_IMPORT_EXACT_DUPLICATE",
        "An exact transaction duplicate was blocked."
      );
    }
  }

  public async getImportBatch(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "bank-reports:read", "BankImportBatch", id);
    const batch = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bankImportBatch.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { transactions: { orderBy: { sourceRowNumber: "asc" } } }
      })
    );
    if (!batch) throw new AppError("BANK_IMPORT_NOT_FOUND", "Import batch was not found.", 404);
    return toJson(batch);
  }

  public async listImportBatches(
    context: OrganizationContext,
    bankAccountId?: string,
    cursor?: string,
    limit = 50
  ) {
    await this.authorization.assert(context, "bank-reports:read", "BankImportBatch");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bankImportBatch.findMany({
        where: {
          organizationId: context.organizationId,
          ...(bankAccountId ? { bankAccountId } : {})
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: Math.min(limit, 100) + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      })
    );
    return page(rows, Math.min(limit, 100));
  }

  public async listTransactions(
    context: OrganizationContext,
    input: {
      readonly bankAccountId?: string | undefined;
      readonly status?: "UNMATCHED" | "MATCHED" | "CATEGORIZED" | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ) {
    await this.authorization.assert(context, "bank-reports:read", "BankImportedTransaction");
    const limit = Math.min(input.limit ?? 50, 100);
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bankImportedTransaction.findMany({
        where: {
          organizationId: context.organizationId,
          ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
          ...(input.status ? { status: input.status } : {})
        },
        include: {
          matches: { where: { active: true } },
          categorization: { include: { lines: true } }
        },
        orderBy: [{ postingDate: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {})
      })
    );
    return page(rows, limit);
  }

  public async overrideDuplicate(
    context: OrganizationContext,
    id: string,
    version: number,
    reason: string
  ) {
    await this.authorization.assert(
      context,
      "bank-duplicates:review",
      "BankImportedTransaction",
      id
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.bankImportedTransaction.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version,
          duplicateStatus: "PROBABLE"
        },
        data: {
          duplicateStatus: "OVERRIDDEN",
          duplicateOverrideReason: reason.trim(),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw stale("Imported transaction");
      const row = await tx.bankImportedTransaction.findUniqueOrThrow({ where: { id } });
      await audit(
        tx,
        context,
        "BANK_DUPLICATE_OVERRIDDEN",
        "BankImportedTransaction",
        id,
        {
          probableDuplicateOfId: row.probableDuplicateOfId
        },
        reason
      );
      return toJson(row);
    });
  }

  public async suggestInvoiceDeposits(context: OrganizationContext, id: string) {
    await this.authorization.assert(
      context,
      "bank-transactions:match",
      "BankImportedTransaction",
      id
    );
    await this.authorization.assert(context, "payments:record", "Payment");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const imported = await importedTransaction(tx, context.organizationId, id);
      const bank = await tx.bankAccount.findFirstOrThrow({
        where: { id: imported.bankAccountId, organizationId: context.organizationId }
      });
      if (
        imported.status !== "UNMATCHED" ||
        imported.direction !== "CREDIT" ||
        imported.currency.trim() !== "CAD" ||
        bank.currency.trim() !== "CAD" ||
        bank.accountKind !== "BANK" ||
        !bank.isActive ||
        imported.duplicateStatus === "PROBABLE"
      )
        return { suggestions: [], truncated: false };
      const invoices = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          currency: "CAD",
          status: { in: ["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"] }
        },
        include: {
          creditNotes: { where: { status: "POSTED" }, select: { grandTotalMinor: true } },
          customer: { select: { paymentAliases: { select: { displayName: true } } } }
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: 1001
      });
      // A partial candidate set cannot establish that a name/amount match is unique.
      const truncated = invoices.length > 1000;
      const suggestions = suggestDepositInvoices(
        {
          amountMinor: imported.amountMinor,
          sender: imported.payee,
          message: [imported.description, imported.memo, imported.referenceNumber]
            .filter(Boolean)
            .join(" ")
        },
        invoices.slice(0, 1000).map((invoice) => ({
          id: invoice.id,
          customerId: invoice.customerId,
          customerName: invoice.customerNameSnapshot,
          payerAliases: invoice.customer.paymentAliases.map((alias) => alias.displayName),
          reference: invoice.paymentReference,
          outstandingMinor:
            invoice.grandTotalMinor -
            invoice.amountPaidMinor -
            invoice.creditNotes.reduce((sum, credit) => sum + credit.grandTotalMinor, 0n)
        }))
      );
      return {
        suggestions: suggestions.map((suggestion) =>
          truncated && suggestion.confidence === "HIGH"
            ? {
                ...suggestion,
                confidence: "MEDIUM" as const,
                reasons: [...suggestion.reasons, "candidate-list-truncated"]
              }
            : suggestion
        ),
        truncated
      };
    });
  }

  public async confirmInvoiceDeposit(
    context: OrganizationContext,
    id: string,
    input: InvoiceDepositConfirmationInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "bank-transactions:match",
      "BankImportedTransaction",
      id
    );
    await this.authorization.assert(context, "payments:record", "Payment");
    return runIdempotent(
      this.prisma,
      context,
      "bank-etransfer.confirm",
      idempotencyKey,
      { id, ...input },
      async (tx) => {
        await lock(tx, "BankImportedTransaction", id, context.organizationId);
        const imported = await importedTransaction(tx, context.organizationId, id);
        assertReviewable(imported, input.version);
        if (imported.direction !== "CREDIT" || imported.currency.trim() !== "CAD")
          throw new AppError(
            "BANK_ETRANSFER_NOT_A_DEPOSIT",
            "Only Canadian-dollar deposits can be confirmed as e-Transfer payments.",
            422
          );
        const bank = await tx.bankAccount.findFirst({
          where: {
            id: imported.bankAccountId,
            organizationId: context.organizationId,
            isActive: true
          }
        });
        if (!bank || bank.accountKind !== "BANK" || bank.currency.trim() !== "CAD")
          throw new AppError(
            "BANK_ETRANSFER_ACCOUNT_INVALID",
            "The deposit bank account is not eligible.",
            422
          );
        if (input.allocations.length === 0 || input.allocations.length > 10)
          throw new AppError("PAYMENT_ALLOCATION_REQUIRED", "Select at least one invoice.", 422);
        const allocationIds = input.allocations.map((allocation) => allocation.invoiceId);
        if (new Set(allocationIds).size !== allocationIds.length)
          throw new AppError(
            "PAYMENT_ALLOCATION_DUPLICATE",
            "An invoice may be selected once.",
            422
          );
        const allocations = input.allocations.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amountMinor: positiveMinor(allocation.amountMinor, "allocation.amountMinor")
        }));
        if (
          sumMinorUnits(allocations.map((allocation) => allocation.amountMinor)) !==
          imported.amountMinor
        )
          throw new AppError(
            "BANK_MATCH_AMOUNT_MISMATCH",
            "Invoice allocations must equal the deposit.",
            422
          );
        const invoices = [];
        for (const allocation of [...allocations].sort((a, b) =>
          a.invoiceId.localeCompare(b.invoiceId)
        )) {
          await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${allocation.invoiceId}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
          const invoice = await tx.invoice.findFirst({
            where: { id: allocation.invoiceId, organizationId: context.organizationId },
            include: {
              creditNotes: { where: { status: "POSTED" }, select: { grandTotalMinor: true } }
            }
          });
          if (
            !invoice ||
            !["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED"].includes(invoice.status)
          )
            throw new AppError(
              "PAYMENT_ALLOCATION_INVALID",
              "Invoice is not eligible for this payment.",
              422
            );
          if (invoice.currency.trim() !== "CAD")
            throw new AppError(
              "PAYMENT_CURRENCY_MISMATCH",
              "This workflow supports CAD invoices only.",
              422
            );
          const credits = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
          const outstanding = invoice.grandTotalMinor - credits - invoice.amountPaidMinor;
          if (allocation.amountMinor > outstanding)
            throw new AppError(
              "PAYMENT_ALLOCATION_INVALID",
              "An allocation exceeds the invoice balance.",
              422
            );
          invoices.push(invoice);
        }
        const customerId = invoices[0]!.customerId;
        if (invoices.some((invoice) => invoice.customerId !== customerId))
          throw new AppError(
            "PAYMENT_ALLOCATION_INVALID",
            "A deposit can only pay one customer at a time.",
            422
          );
        const allocated = sumMinorUnits(allocations.map((allocation) => allocation.amountMinor));
        const payment = await this.paymentService.recordManualInTransaction(
          tx,
          context,
          {
            customerId,
            receivingAccountId: bank.linkedLedgerAccountId,
            paymentDate: imported.postingDate.toISOString().slice(0, 10),
            amountMinor: imported.amountMinor.toString(),
            currency: "CAD",
            methodCategory: "ELECTRONIC_TRANSFER",
            reference: (imported.referenceNumber ?? imported.description).trim().slice(0, 300),
            allocations: allocations.map((allocation) => ({
              invoiceId: allocation.invoiceId,
              amountMinor: allocation.amountMinor.toString()
            }))
          },
          imported.amountMinor,
          allocations,
          allocated
        );
        const journal = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          select: { journalId: true }
        });
        if (!journal.journalId)
          throw new AppError(
            "PAYMENT_JOURNAL_REQUIRED",
            "The payment journal was not created.",
            500
          );
        const match = await tx.bankTransactionMatch.create({
          data: {
            organizationId: context.organizationId,
            importedTransactionId: imported.id,
            targetJournalId: journal.journalId,
            targetType: "INVOICE_PAYMENT",
            targetId: payment.id,
            amountMinor: imported.amountMinor,
            confidenceBasisPoints: 10_000,
            reasons: ["user-confirmed-etransfer", "payment-created"],
            createdByUserId: context.user.id
          }
        });
        const row = await tx.bankImportedTransaction.update({
          where: { id: imported.id },
          data: { status: "MATCHED", version: { increment: 1 } }
        });
        let alias: { id: string; displayName: string } | null = null;
        const aliasDisplayName = (input.payerAlias ?? imported.payee ?? "")
          .trim()
          .replace(/\s+/g, " ");
        const normalizedAlias = normalizePayerAlias(aliasDisplayName);
        if (input.rememberPayerAlias && normalizedAlias) {
          alias = await tx.customerPaymentAlias.upsert({
            where: {
              organizationId_customerId_normalizedName: {
                organizationId: context.organizationId,
                customerId,
                normalizedName: normalizedAlias
              }
            },
            create: {
              organizationId: context.organizationId,
              customerId,
              displayName: aliasDisplayName.slice(0, 250),
              normalizedName: normalizedAlias,
              createdByUserId: context.user.id
            },
            update: { displayName: aliasDisplayName.slice(0, 250) },
            select: { id: true, displayName: true }
          });
        }
        await audit(tx, context, "BANK_ETRANSFER_CONFIRMED", "BankImportedTransaction", id, {
          paymentId: payment.id,
          matchId: match.id,
          allocationCount: allocations.length,
          ...(alias ? { payerAliasId: alias.id } : {})
        });
        await outbox(tx, context.organizationId, "banking.etransfer.confirmed", id, {
          bankTransactionId: id,
          paymentId: payment.id,
          matchId: match.id
        });
        return {
          statusCode: 201,
          body: {
            transaction: toJson(row),
            payment,
            match: toJson(match),
            payerAlias: alias
          },
          resourceId: payment.id
        };
      }
    );
  }

  public async suggestMatches(context: OrganizationContext, id: string) {
    await this.authorization.assert(
      context,
      "bank-transactions:match",
      "BankImportedTransaction",
      id
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const imported = await importedTransaction(tx, context.organizationId, id);
      const bank = await tx.bankAccount.findUniqueOrThrow({
        where: { id: imported.bankAccountId }
      });
      const journals = await tx.journal.findMany({
        where: {
          organizationId: context.organizationId,
          status: "POSTED",
          effectiveDate: imported.postingDate,
          lines: { some: { accountId: bank.linkedLedgerAccountId } }
        },
        include: { lines: { where: { accountId: bank.linkedLedgerAccountId } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100
      });
      return journals
        .map((journal) => {
          const amount = journal.lines.reduce(
            (sum, line) =>
              sum +
              expectedLineAmount(
                line,
                bank.accountKind,
                imported.direction,
                line.transactionCurrency?.trim() === bank.currency.trim()
              ),
            0n
          );
          return { journal, amount };
        })
        .filter(({ amount }) => amount > 0n && amount <= imported.amountMinor)
        .map(({ journal, amount }) => ({
          targetJournalId: journal.id,
          targetId: journal.sourceId,
          targetType: inferTargetType(journal.sourceType),
          amountMinor: amount.toString(),
          confidenceBasisPoints: amount === imported.amountMinor ? 9500 : 8500,
          reasons: [
            "same-account",
            "same-date",
            amount === imported.amountMinor ? "exact-amount" : "possible-split"
          ],
          requiresConfirmation: true
        }));
    });
  }

  public async confirmMatches(
    context: OrganizationContext,
    id: string,
    version: number,
    matches: readonly MatchInput[],
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "bank-transactions:match",
      "BankImportedTransaction",
      id
    );
    return runIdempotent(
      this.prisma,
      context,
      "bank-match.confirm",
      idempotencyKey,
      { id, version, matches },
      async (tx) => {
        await lock(tx, "BankImportedTransaction", id, context.organizationId);
        const imported = await importedTransaction(tx, context.organizationId, id);
        assertReviewable(imported, version);
        if (matches.length === 0)
          throw new AppError("BANK_MATCH_REQUIRED", "At least one match is required.", 422);
        const amounts = matches.map((match) => positiveMinor(match.amountMinor, "amountMinor"));
        if (sumMinorUnits(amounts) !== imported.amountMinor)
          throw new AppError(
            "BANK_MATCH_AMOUNT_MISMATCH",
            "Match amounts must equal the imported amount.",
            422
          );
        const bank = await tx.bankAccount.findUniqueOrThrow({
          where: { id: imported.bankAccountId }
        });
        const created = [];
        for (const [index, match] of matches.entries()) {
          await validateMatchTarget(
            tx,
            context.organizationId,
            bank,
            imported.direction,
            match,
            amounts[index]!
          );
          created.push(
            await tx.bankTransactionMatch.create({
              data: {
                organizationId: context.organizationId,
                importedTransactionId: imported.id,
                targetJournalId: match.targetJournalId,
                targetType: match.targetType,
                targetId: match.targetId,
                amountMinor: amounts[index]!,
                confidenceBasisPoints: match.confidenceBasisPoints ?? 10_000,
                reasons: [...(match.reasons ?? ["user-confirmed"])],
                createdByUserId: context.user.id
              }
            })
          );
        }
        const row = await tx.bankImportedTransaction.update({
          where: { id },
          data: { status: "MATCHED", version: { increment: 1 } }
        });
        await audit(tx, context, "BANK_MATCH_CONFIRMED", "BankImportedTransaction", id, {
          targetJournalIds: matches.map((match) => match.targetJournalId),
          splitCount: matches.length
        });
        return {
          statusCode: 201,
          body: { transaction: toJson(row), matches: created.map(toJson) },
          resourceId: id
        };
      }
    );
  }

  public async reverseMatches(
    context: OrganizationContext,
    id: string,
    version: number,
    reason: string,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "bank-transactions:match",
      "BankImportedTransaction",
      id
    );
    return runIdempotent(
      this.prisma,
      context,
      "bank-match.reverse",
      idempotencyKey,
      { id, version, reason },
      async (tx) => {
        await lock(tx, "BankImportedTransaction", id, context.organizationId);
        const imported = await importedTransaction(tx, context.organizationId, id);
        if (imported.status !== "MATCHED" || imported.version !== version) throw stale("Match");
        const matches = await tx.bankTransactionMatch.findMany({
          where: { importedTransactionId: id, active: true }
        });
        if (matches.length === 0)
          throw new AppError("BANK_MATCH_NOT_FOUND", "Active match was not found.", 404);
        const reversedAt = new Date();
        for (const match of matches) {
          await tx.bankTransactionMatch.update({
            where: { id: match.id },
            data: {
              active: false,
              reversedAt,
              reversedByUserId: context.user.id,
              reversalReason: reason.trim()
            }
          });
        }
        const row = await tx.bankImportedTransaction.update({
          where: { id },
          data: { status: "UNMATCHED", version: { increment: 1 } }
        });
        await audit(
          tx,
          context,
          "BANK_MATCH_REVERSED",
          "BankImportedTransaction",
          id,
          {
            matchIds: matches.map((match) => match.id)
          },
          reason
        );
        return { statusCode: 200, body: { transaction: toJson(row) }, resourceId: id };
      }
    );
  }

  public async categorize(
    context: OrganizationContext,
    id: string,
    version: number,
    input: CategorizationInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "bank-transactions:categorize",
      "BankImportedTransaction",
      id
    );
    return runIdempotent(
      this.prisma,
      context,
      "bank-transaction.categorize",
      idempotencyKey,
      { id, version, input },
      async (tx) => {
        await lock(tx, "BankImportedTransaction", id, context.organizationId);
        const imported = await importedTransaction(tx, context.organizationId, id);
        assertReviewable(imported, version);
        const bank = await tx.bankAccount.findUniqueOrThrow({
          where: { id: imported.bankAccountId }
        });
        const baseCurrency = (
          await tx.organization.findUniqueOrThrow({
            where: { id: context.organizationId },
            select: { currency: true }
          })
        ).currency.trim();
        if (bank.currency.trim() !== baseCurrency)
          throw new AppError(
            "FOREIGN_BANK_CATEGORIZATION_REQUIRES_SOURCE_WORKFLOW",
            "Foreign bank transactions must be recorded through a foreign invoice, bill, or payment workflow and then matched. Direct foreign categorization is not available.",
            409
          );
        if (input.lines.length === 0)
          throw new AppError(
            "BANK_CATEGORY_REQUIRED",
            "At least one category line is required.",
            422
          );
        await validateAssociations(tx, context.organizationId, input.vendorId, input.customerId);
        const calculated = await calculateCategorizationLines(
          tx,
          context.organizationId,
          imported.postingDate,
          imported.direction,
          input.lines
        );
        if (sumMinorUnits(calculated.map((line) => line.totalMinor)) !== imported.amountMinor)
          throw new AppError(
            "BANK_CATEGORY_AMOUNT_MISMATCH",
            "Category totals, including tax, must equal the imported amount.",
            422
          );
        const categorizationId = randomUUID();
        const journal = await this.journals.postJournalInTransaction(
          tx,
          context,
          categorizationJournal(imported, bank, calculated, input.memo, categorizationId),
          true
        );
        const categorization = await tx.bankCategorization.create({
          data: {
            id: categorizationId,
            organizationId: context.organizationId,
            importedTransactionId: imported.id,
            journalId: journal.id,
            vendorId: input.vendorId ?? null,
            customerId: input.customerId ?? null,
            memo: cleanNullable(input.memo),
            createdByUserId: context.user.id,
            lines: {
              create: calculated.map((line, index) => ({
                organizationId: context.organizationId,
                lineNumber: index + 1,
                accountId: line.accountId,
                amountMinor: line.amountMinor,
                taxCodeId: line.taxCodeId,
                taxCodeVersionId: line.taxCodeVersionId,
                recoverableTaxMinor: line.recoverableTaxMinor,
                nonRecoverableTaxMinor: line.nonRecoverableTaxMinor,
                taxTotalMinor: line.taxTotalMinor,
                totalMinor: line.totalMinor,
                taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull,
                memo: line.memo
              }))
            }
          },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        const row = await tx.bankImportedTransaction.update({
          where: { id },
          data: { status: "CATEGORIZED", version: { increment: 1 } }
        });
        await audit(tx, context, "BANK_TRANSACTION_CATEGORIZED", "BankImportedTransaction", id, {
          categorizationId,
          journalId: journal.id,
          splitCount: calculated.length
        });
        await outbox(tx, context.organizationId, "banking.transaction.categorized", id, {
          importedTransactionId: id,
          journalId: journal.id
        });
        return {
          statusCode: 201,
          body: { transaction: toJson(row), categorization: toJson(categorization) },
          resourceId: categorization.id
        };
      }
    );
  }

  /**
   * Applies only unambiguous, explicitly scoped organization rules to new feed
   * activity when the owner has disabled the review-everything preference.
   * Every non-qualifying or failed transaction remains UNMATCHED for review.
   */
  public async applyAutomaticFeedRules(context: OrganizationContext, bankFeedSyncId: string) {
    await this.authorization.assert(
      context,
      "bank-transactions:categorize",
      "BankFeedSync",
      bankFeedSyncId
    );
    const candidates = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const sync = await tx.bankFeedSync.findFirst({
        where: { id: bankFeedSyncId, organizationId: context.organizationId, status: "SUCCEEDED" },
        select: { id: true }
      });
      if (!sync) throw new AppError("BANK_FEED_SYNC_NOT_FOUND", "Bank refresh was not found.", 404);
      const preferences = await tx.workflowPreferences.findUnique({
        where: { organizationId: context.organizationId },
        select: { bankFeedReviewRequired: true }
      });
      const transactions = await tx.bankImportedTransaction.findMany({
        where: {
          organizationId: context.organizationId,
          importBatch: { bankFeedSyncId },
          status: "UNMATCHED",
          duplicateStatus: "NONE",
          feedTransactionState: "ACTIVE"
        },
        orderBy: [{ postingDate: "asc" }, { id: "asc" }]
      });
      const rules = await tx.bankRule.findMany({
        where: { organizationId: context.organizationId, isActive: true },
        orderBy: [{ priority: "asc" }, { id: "asc" }]
      });
      return {
        enabled: preferences?.bankFeedReviewRequired === false,
        transactions,
        rules
      };
    });

    if (!candidates.enabled)
      return {
        enabled: false,
        automaticCategorizedCount: 0,
        reviewRequiredCount: candidates.transactions.length
      };

    let automaticCategorizedCount = 0;
    for (const transaction of candidates.transactions) {
      const matchingRules = candidates.rules.filter((rule) =>
        automaticRuleMatches(rule, transaction)
      );
      if (matchingRules.length !== 1) continue;
      const input = automaticCategorizationInput(
        matchingRules[0]!.suggestion,
        transaction.amountMinor
      );
      if (!input) continue;
      try {
        await this.categorize(
          context,
          transaction.id,
          transaction.version,
          input,
          `bank-feed-rule:${bankFeedSyncId}:${transaction.id}`
        );
        automaticCategorizedCount += 1;
      } catch (error) {
        // A stale record, invalid account/tax setup, or any posting guard leaves
        // the activity in review. The summary audit below records the outcome.
        if (!(error instanceof AppError)) throw error;
      }
    }

    const reviewRequiredCount = candidates.transactions.length - automaticCategorizedCount;
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await audit(
        tx,
        context,
        "BANK_FEED_RULE_PROCESSING_COMPLETED",
        "BankFeedSync",
        bankFeedSyncId,
        {
          automaticCategorizedCount,
          reviewRequiredCount,
          candidateCount: candidates.transactions.length
        }
      );
    });
    return { enabled: true, automaticCategorizedCount, reviewRequiredCount };
  }

  public async listRules(context: OrganizationContext) {
    await this.authorization.assert(context, "bank-reports:read", "BankRule");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.bankRule.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ priority: "asc" }, { id: "asc" }],
        take: 500
      })
    );
    return rows.map(toJson);
  }

  public async createRule(context: OrganizationContext, input: BankRuleInput) {
    await this.authorization.assert(context, "bank-rules:manage", "BankRule");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (input.bankAccountId)
        await activeBankAccount(tx, context.organizationId, input.bankAccountId);
      try {
        const row = await tx.bankRule.create({
          data: {
            organizationId: context.organizationId,
            bankAccountId: input.bankAccountId ?? null,
            name: input.name.trim(),
            priority: input.priority,
            descriptionContains: cleanNullable(input.descriptionContains),
            payeeContains: cleanNullable(input.payeeContains),
            minimumAmountMinor: optionalNonnegativeMinor(
              input.minimumAmountMinor,
              "minimumAmountMinor"
            ),
            maximumAmountMinor: optionalNonnegativeMinor(
              input.maximumAmountMinor,
              "maximumAmountMinor"
            ),
            direction: input.direction ?? null,
            suggestion: input.suggestion,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "BANK_RULE_CREATED", "BankRule", row.id, {
          priority: row.priority
        });
        return toJson(row);
      } catch (error) {
        throwUnique(error, "BANK_RULE_CONFLICT", "Bank rule name or priority already exists.");
      }
    });
  }

  public async updateRule(
    context: OrganizationContext,
    id: string,
    version: number,
    input: BankRuleInput
  ) {
    await this.authorization.assert(context, "bank-rules:manage", "BankRule", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (input.bankAccountId)
        await activeBankAccount(tx, context.organizationId, input.bankAccountId);
      try {
        const updated = await tx.bankRule.updateMany({
          where: { id, organizationId: context.organizationId, version },
          data: {
            bankAccountId: input.bankAccountId ?? null,
            name: input.name.trim(),
            priority: input.priority,
            descriptionContains: cleanNullable(input.descriptionContains),
            payeeContains: cleanNullable(input.payeeContains),
            minimumAmountMinor: optionalNonnegativeMinor(
              input.minimumAmountMinor,
              "minimumAmountMinor"
            ),
            maximumAmountMinor: optionalNonnegativeMinor(
              input.maximumAmountMinor,
              "maximumAmountMinor"
            ),
            direction: input.direction ?? null,
            suggestion: input.suggestion,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        if (updated.count !== 1) throw stale("Bank rule");
        const row = await tx.bankRule.findUniqueOrThrow({ where: { id } });
        await audit(tx, context, "BANK_RULE_UPDATED", "BankRule", id, { version: row.version });
        return toJson(row);
      } catch (error) {
        throwUnique(error, "BANK_RULE_CONFLICT", "Bank rule name or priority already exists.");
      }
    });
  }

  public async archiveRule(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "bank-rules:manage", "BankRule", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.bankRule.updateMany({
        where: { id, organizationId: context.organizationId, version, isActive: true },
        data: { isActive: false, updatedByUserId: context.user.id, version: { increment: 1 } }
      });
      if (updated.count !== 1) throw stale("Bank rule");
      await audit(tx, context, "BANK_RULE_ARCHIVED", "BankRule", id, {});
      return toJson(await tx.bankRule.findUniqueOrThrow({ where: { id } }));
    });
  }

  public async ruleSuggestions(context: OrganizationContext, transactionId: string) {
    await this.authorization.assert(
      context,
      "bank-reports:read",
      "BankImportedTransaction",
      transactionId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const imported = await importedTransaction(tx, context.organizationId, transactionId);
      const rules = await tx.bankRule.findMany({
        where: {
          organizationId: context.organizationId,
          isActive: true,
          OR: [{ bankAccountId: null }, { bankAccountId: imported.bankAccountId }]
        },
        orderBy: [{ priority: "asc" }, { id: "asc" }]
      });
      const matches = rules.filter((rule) => ruleMatches(rule, imported));
      return {
        suggestion: matches[0] ? toJson(matches[0]) : null,
        conflicts: matches.slice(1).map(toJson),
        autonomousPosting: false
      };
    });
  }

  public async createTransfer(
    context: OrganizationContext,
    input: TransferInput,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(context, "bank-transfers:create", "BankTransfer");
    return runIdempotent(
      this.prisma,
      context,
      "bank-transfer.create",
      idempotencyKey,
      input,
      async (tx) => {
        const amount = positiveMinor(input.amountMinor, "amountMinor");
        const date = parseDate(input.transferDate, "transferDate");
        const [source, destination] = await Promise.all([
          activeBankAccount(tx, context.organizationId, input.sourceBankAccountId),
          activeBankAccount(tx, context.organizationId, input.destinationBankAccountId)
        ]);
        if (source.id === destination.id)
          throw new AppError(
            "BANK_TRANSFER_ACCOUNT_INVALID",
            "Transfer accounts must differ.",
            422
          );
        if (source.currency !== destination.currency)
          throw new AppError(
            "BANK_TRANSFER_CURRENCY_MISMATCH",
            "Transfer currencies must match.",
            422
          );
        const baseCurrency = (
          await tx.organization.findUniqueOrThrow({
            where: { id: context.organizationId },
            select: { currency: true }
          })
        ).currency.trim();
        if (source.currency.trim() !== baseCurrency)
          throw new AppError(
            "FOREIGN_BANK_TRANSFER_REQUIRES_POSITION_TRANSFER",
            "Transfers between foreign bank accounts require a carrying-value position transfer and are not available yet.",
            409
          );
        const transferId = randomUUID();
        const dedupeKey = hashJson({
          source: source.id,
          destination: destination.id,
          date: input.transferDate,
          amount: input.amountMinor,
          reference: cleanNullable(input.reference)
        });
        const existing = await tx.bankTransfer.findUnique({
          where: {
            organizationId_dedupeKey: { organizationId: context.organizationId, dedupeKey }
          }
        });
        if (existing)
          throw new AppError("BANK_TRANSFER_DUPLICATE", "This transfer already exists.", 409, {
            transferId: existing.id
          });
        const journal = await this.journals.postJournalInTransaction(
          tx,
          context,
          {
            effectiveDate: input.transferDate,
            description: `Transfer ${source.displayName} to ${destination.displayName}`,
            sourceType: "BANK_TRANSFER",
            sourceId: transferId,
            postingKey: `bank-transfer:${transferId}`,
            allowControlAccountPosting: false,
            lines: [
              {
                accountId: destination.linkedLedgerAccountId,
                debitMinor: amount.toString(),
                creditMinor: "0",
                description: input.reference ?? undefined
              },
              {
                accountId: source.linkedLedgerAccountId,
                debitMinor: "0",
                creditMinor: amount.toString(),
                description: input.reference ?? undefined
              }
            ]
          },
          true
        );
        const transfer = await tx.bankTransfer.create({
          data: {
            id: transferId,
            organizationId: context.organizationId,
            sourceBankAccountId: source.id,
            destinationBankAccountId: destination.id,
            sourceLedgerAccountId: source.linkedLedgerAccountId,
            destinationLedgerAccountId: destination.linkedLedgerAccountId,
            transferDate: date,
            amountMinor: amount,
            currency: source.currency,
            reference: cleanNullable(input.reference),
            dedupeKey,
            journalId: journal.id,
            createdByUserId: context.user.id
          }
        });
        const matchedTransactions = [];
        for (const importedId of [...new Set(input.importedTransactionIds ?? [])]) {
          await lock(tx, "BankImportedTransaction", importedId, context.organizationId);
          const imported = await importedTransaction(tx, context.organizationId, importedId);
          assertReviewable(imported, imported.version);
          if (![source.id, destination.id].includes(imported.bankAccountId))
            throw new AppError(
              "BANK_TRANSFER_MATCH_ACCOUNT_INVALID",
              "Imported transfer side belongs to neither transfer account.",
              422
            );
          const account = imported.bankAccountId === source.id ? source : destination;
          const line = {
            debitMinor: imported.bankAccountId === destination.id ? amount : 0n,
            creditMinor: imported.bankAccountId === source.id ? amount : 0n
          };
          if (
            expectedLineAmount(line, account.accountKind, imported.direction) !==
            imported.amountMinor
          )
            throw new AppError(
              "BANK_TRANSFER_MATCH_DIRECTION_INVALID",
              "Imported transfer side has the wrong direction or amount.",
              422
            );
          await tx.bankTransactionMatch.create({
            data: {
              organizationId: context.organizationId,
              importedTransactionId: imported.id,
              targetJournalId: journal.id,
              targetType: "TRANSFER",
              targetId: transfer.id,
              amountMinor: amount,
              confidenceBasisPoints: 10_000,
              reasons: ["transfer-account", "exact-amount", "user-confirmed"],
              createdByUserId: context.user.id
            }
          });
          matchedTransactions.push(
            await tx.bankImportedTransaction.update({
              where: { id: imported.id },
              data: { status: "MATCHED", version: { increment: 1 } }
            })
          );
        }
        await audit(tx, context, "BANK_TRANSFER_CREATED", "BankTransfer", transfer.id, {
          journalId: journal.id,
          amountMinor: amount.toString(),
          matchedImportedTransactionIds: matchedTransactions.map((row) => row.id)
        });
        return {
          statusCode: 201,
          body: { transfer: toJson(transfer), transactions: matchedTransactions.map(toJson) },
          resourceId: transfer.id
        };
      }
    );
  }

  public async createReconciliation(context: OrganizationContext, input: ReconciliationInput) {
    await this.authorization.assert(context, "bank-reconciliations:manage", "BankReconciliation");
    return withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        const account = await activeBankAccount(tx, context.organizationId, input.bankAccountId);
        const start = parseDate(input.statementStartDate, "statementStartDate");
        const end = parseDate(input.statementEndDate, "statementEndDate");
        const opening = parseMinorUnit(
          input.openingStatementBalanceMinor,
          "openingStatementBalanceMinor"
        );
        const closing = parseMinorUnit(
          input.closingStatementBalanceMinor,
          "closingStatementBalanceMinor"
        );
        const id = randomUUID();
        const selected = await reconciliationItems(
          tx,
          context.organizationId,
          account,
          start,
          end,
          input.importedTransactionIds
        );
        const calculated = opening + sumMinorUnits(selected.map((item) => item.impact));
        try {
          const row = await tx.bankReconciliation.create({
            data: {
              id,
              organizationId: context.organizationId,
              bankAccountId: account.id,
              statementStartDate: start,
              statementEndDate: end,
              openingStatementBalanceMinor: opening,
              closingStatementBalanceMinor: closing,
              calculatedClosingBalanceMinor: calculated,
              differenceMinor: closing - calculated,
              createdByUserId: context.user.id,
              updatedByUserId: context.user.id,
              items: {
                create: selected.map((item) => ({
                  organizationId: context.organizationId,
                  importedTransactionId: item.transaction.id,
                  statementImpactMinor: item.impact,
                  snapshot: reconciliationItemSnapshot(item.transaction)
                }))
              }
            },
            include: { items: { where: { active: true } } }
          });
          await audit(tx, context, "BANK_RECONCILIATION_CREATED", "BankReconciliation", id, {
            bankAccountId: account.id,
            differenceMinor: (closing - calculated).toString()
          });
          return toJson(row);
        } catch (error) {
          throwUnique(
            error,
            "BANK_RECONCILIATION_CONFLICT",
            "Statement period or selected transaction conflicts with another reconciliation."
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async updateReconciliation(
    context: OrganizationContext,
    id: string,
    version: number,
    input: Omit<ReconciliationInput, "bankAccountId">
  ) {
    await this.authorization.assert(
      context,
      "bank-reconciliations:manage",
      "BankReconciliation",
      id
    );
    try {
      return await withTenantTransaction(
        this.prisma,
        dbContext(context),
        async (tx) => {
          await lock(tx, "BankReconciliation", id, context.organizationId);
          const existing = await tx.bankReconciliation.findFirst({
            where: { id, organizationId: context.organizationId }
          });
          if (!existing || existing.status !== "IN_PROGRESS" || existing.version !== version)
            throw stale("Reconciliation");
          const account = await tx.bankAccount.findUniqueOrThrow({
            where: { id: existing.bankAccountId }
          });
          const start = parseDate(input.statementStartDate, "statementStartDate");
          const end = parseDate(input.statementEndDate, "statementEndDate");
          const opening = parseMinorUnit(
            input.openingStatementBalanceMinor,
            "openingStatementBalanceMinor"
          );
          const closing = parseMinorUnit(
            input.closingStatementBalanceMinor,
            "closingStatementBalanceMinor"
          );
          const selected = await reconciliationItems(
            tx,
            context.organizationId,
            account,
            start,
            end,
            input.importedTransactionIds
          );
          await tx.bankReconciliationItem.updateMany({
            where: { reconciliationId: id, active: true },
            data: { active: false, removedAt: new Date() }
          });
          for (const item of selected) {
            await tx.bankReconciliationItem.create({
              data: {
                organizationId: context.organizationId,
                reconciliationId: id,
                importedTransactionId: item.transaction.id,
                statementImpactMinor: item.impact,
                snapshot: reconciliationItemSnapshot(item.transaction)
              }
            });
          }
          const calculated = opening + sumMinorUnits(selected.map((item) => item.impact));
          const row = await tx.bankReconciliation.update({
            where: { id },
            data: {
              statementStartDate: start,
              statementEndDate: end,
              openingStatementBalanceMinor: opening,
              closingStatementBalanceMinor: closing,
              calculatedClosingBalanceMinor: calculated,
              differenceMinor: closing - calculated,
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            },
            include: { items: { where: { active: true } } }
          });
          await audit(tx, context, "BANK_RECONCILIATION_UPDATED", "BankReconciliation", id, {
            differenceMinor: row.differenceMinor.toString(),
            itemCount: selected.length
          });
          return toJson(row);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (isConcurrencyConflict(error)) throw stale("Reconciliation");
      throw error;
    }
  }

  public async completeReconciliation(
    context: OrganizationContext,
    id: string,
    version: number,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "bank-reconciliations:manage",
      "BankReconciliation",
      id
    );
    return runIdempotent(
      this.prisma,
      context,
      "bank-reconciliation.complete",
      idempotencyKey,
      { id, version },
      async (tx) => {
        await lock(tx, "BankReconciliation", id, context.organizationId);
        const existing = await tx.bankReconciliation.findFirst({
          where: { id, organizationId: context.organizationId },
          include: {
            bankAccount: true,
            items: {
              where: { active: true },
              include: {
                importedTransaction: {
                  include: {
                    matches: { where: { active: true } },
                    categorization: true
                  }
                }
              },
              orderBy: { createdAt: "asc" }
            },
            snapshots: { orderBy: { revision: "desc" }, take: 1 }
          }
        });
        if (!existing || existing.status !== "IN_PROGRESS" || existing.version !== version)
          throw stale("Reconciliation");
        if (existing.differenceMinor !== 0n)
          throw new AppError(
            "BANK_RECONCILIATION_NOT_BALANCED",
            "Reconciliation cannot complete with a non-zero difference.",
            409,
            { differenceMinor: existing.differenceMinor.toString() }
          );
        const completedAt = new Date();
        const row = await tx.bankReconciliation.update({
          where: { id },
          data: {
            status: "COMPLETED",
            completedByUserId: context.user.id,
            completedAt,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        const revision = (existing.snapshots[0]?.revision ?? 0) + 1;
        const report = reconciliationSnapshot(existing, revision, completedAt);
        const snapshot = await tx.bankReconciliationSnapshot.create({
          data: {
            organizationId: context.organizationId,
            reconciliationId: id,
            revision,
            report,
            completedByUserId: context.user.id,
            completedAt
          }
        });
        await tx.bankAccount.update({
          where: { id: existing.bankAccountId },
          data: {
            lastReconciledAt: completedAt,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await audit(tx, context, "BANK_RECONCILIATION_COMPLETED", "BankReconciliation", id, {
          revision,
          snapshotId: snapshot.id,
          itemCount: existing.items.length
        });
        await outbox(tx, context.organizationId, "banking.reconciliation.completed", id, {
          reconciliationId: id,
          revision
        });
        return {
          statusCode: 200,
          body: { reconciliation: toJson(row), snapshot: toJson(snapshot) },
          resourceId: id
        };
      }
    );
  }

  public async reopenReconciliation(
    context: OrganizationContext,
    id: string,
    version: number,
    reason: string,
    idempotencyKey: string | undefined
  ) {
    await this.authorization.assert(
      context,
      "bank-reconciliations:reopen",
      "BankReconciliation",
      id
    );
    return runIdempotent(
      this.prisma,
      context,
      "bank-reconciliation.reopen",
      idempotencyKey,
      { id, version, reason },
      async (tx) => {
        await lock(tx, "BankReconciliation", id, context.organizationId);
        const existing = await tx.bankReconciliation.findFirst({
          where: { id, organizationId: context.organizationId }
        });
        if (!existing || existing.status !== "COMPLETED" || existing.version !== version)
          throw stale("Reconciliation");
        const reopenedAt = new Date();
        const row = await tx.bankReconciliation.update({
          where: { id },
          data: {
            status: "IN_PROGRESS",
            completedByUserId: null,
            completedAt: null,
            reopenCount: { increment: 1 },
            lastReopenedByUserId: context.user.id,
            lastReopenedAt: reopenedAt,
            lastReopenReason: reason.trim(),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await tx.bankReconciliationItem.updateMany({
          where: { reconciliationId: id, active: true },
          data: { active: false, removedAt: reopenedAt }
        });
        await audit(
          tx,
          context,
          "BANK_RECONCILIATION_REOPENED",
          "BankReconciliation",
          id,
          { priorCompletionAt: existing.completedAt?.toISOString() ?? null },
          reason
        );
        return { statusCode: 200, body: { reconciliation: toJson(row) }, resourceId: id };
      }
    );
  }

  public async reconciliationReport(context: OrganizationContext, id: string, revision?: number) {
    await this.authorization.assert(context, "bank-reports:read", "BankReconciliation", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const reconciliation = await tx.bankReconciliation.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          bankAccount: true,
          items: {
            where: { active: true },
            include: { importedTransaction: true },
            orderBy: { createdAt: "asc" }
          },
          snapshots: {
            ...(revision ? { where: { revision } } : {}),
            orderBy: { revision: "desc" },
            take: 1
          }
        }
      });
      if (!reconciliation)
        throw new AppError("BANK_RECONCILIATION_NOT_FOUND", "Reconciliation was not found.", 404);
      const snapshot = reconciliation.snapshots[0] ?? null;
      const adjustments = snapshot
        ? await tx.journalLine.findMany({
            where: {
              organizationId: context.organizationId,
              accountId: reconciliation.bankAccount.linkedLedgerAccountId,
              journal: {
                status: "POSTED",
                effectiveDate: { lte: reconciliation.statementEndDate },
                createdAt: { gt: snapshot.completedAt }
              }
            },
            include: { journal: true },
            orderBy: { createdAt: "asc" }
          })
        : [];
      const outstanding = await tx.bankImportedTransaction.findMany({
        where: {
          organizationId: context.organizationId,
          bankAccountId: reconciliation.bankAccountId,
          postingDate: {
            gte: reconciliation.statementStartDate,
            lte: reconciliation.statementEndDate
          },
          reconciliationItems: {
            none: { reconciliationId: id, active: true }
          }
        },
        orderBy: [{ postingDate: "asc" }, { id: "asc" }]
      });
      return {
        reconciliation: toJson(reconciliation),
        historicalSnapshot: snapshot ? toJson(snapshot) : null,
        clearedItems: reconciliation.items.map(toJson),
        outstandingItems: outstanding.map(toJson),
        adjustmentsAfterReconciliation: adjustments.map(toJson)
      };
    });
  }
}

interface CategorizationLine {
  readonly accountId: string;
  readonly amountMinor: bigint;
  readonly taxCodeId: string | null;
  readonly taxCodeVersionId: string | null;
  readonly recoverableTaxMinor: bigint;
  readonly nonRecoverableTaxMinor: bigint;
  readonly taxTotalMinor: bigint;
  readonly totalMinor: bigint;
  readonly taxSnapshot: Prisma.InputJsonObject | null;
  readonly taxComponents: CalculatedPurchaseLine["taxComponents"];
  readonly memo: string | null;
}

async function calculateCategorizationLines(
  tx: Tx,
  organizationId: string,
  date: Date,
  direction: Direction,
  inputs: readonly CategorizationLineInput[]
): Promise<readonly CategorizationLine[]> {
  if (direction === "DEBIT") {
    return Promise.all(
      inputs.map(async (input) => {
        const calculated = await calculatePurchaseLine(tx, organizationId, date, {
          description: input.memo ?? "Bank transaction",
          quantity: "1",
          unitCostMinor: positiveMinor(input.amountMinor, "amountMinor").toString(),
          accountId: input.accountId,
          taxCodeId: input.taxCodeId
        });
        return {
          accountId: calculated.accountId,
          amountMinor: calculated.netAmountMinor,
          taxCodeId: calculated.taxCodeId,
          taxCodeVersionId: calculated.taxCodeVersionId,
          recoverableTaxMinor: calculated.recoverableTaxMinor,
          nonRecoverableTaxMinor: calculated.nonRecoverableTaxMinor,
          taxTotalMinor: calculated.taxTotalMinor,
          totalMinor: calculated.totalMinor,
          taxSnapshot: calculated.taxSnapshot,
          taxComponents: calculated.taxComponents,
          memo: cleanNullable(input.memo)
        };
      })
    );
  }
  const accounts = await tx.account.findMany({
    where: {
      organizationId,
      id: { in: [...new Set(inputs.map((input) => input.accountId))] },
      isArchived: false
    }
  });
  if (accounts.length !== new Set(inputs.map((input) => input.accountId)).size)
    throw new AppError("BANK_CATEGORY_ACCOUNT_INVALID", "Category account was not found.", 422);
  for (const input of inputs) {
    if (input.taxCodeId)
      throw new AppError(
        "BANK_CATEGORY_TAX_DIRECTION_INVALID",
        "Tax codes are supported for expense and card-charge categorization only.",
        422
      );
    const account = accounts.find((candidate) => candidate.id === input.accountId)!;
    if (account.isControl || !["REVENUE", "LIABILITY", "EQUITY", "ASSET"].includes(account.type))
      throw new AppError(
        "BANK_CATEGORY_ACCOUNT_INVALID",
        "Inflow categories require a non-control revenue, liability, equity, or asset account.",
        422
      );
  }
  return inputs.map((input) => {
    const amount = positiveMinor(input.amountMinor, "amountMinor");
    return {
      accountId: input.accountId,
      amountMinor: amount,
      taxCodeId: null,
      taxCodeVersionId: null,
      recoverableTaxMinor: 0n,
      nonRecoverableTaxMinor: 0n,
      taxTotalMinor: 0n,
      totalMinor: amount,
      taxSnapshot: null,
      taxComponents: [],
      memo: cleanNullable(input.memo)
    };
  });
}

function categorizationJournal(
  imported: {
    readonly id: string;
    readonly postingDate: Date;
    readonly description: string;
    readonly direction: Direction;
    readonly amountMinor: bigint;
  },
  bank: {
    readonly linkedLedgerAccountId: string;
    readonly accountKind: BankAccountKind;
  },
  lines: readonly CategorizationLine[],
  memo: string | null | undefined,
  categorizationId: string
) {
  const journalLines: Array<{
    accountId: string;
    debitMinor: string;
    creditMinor: string;
    description?: string;
  }> = [];
  const isOutflow = imported.direction === "DEBIT";
  for (const line of lines) {
    const categoryAmount = line.amountMinor + line.nonRecoverableTaxMinor;
    journalLines.push({
      accountId: line.accountId,
      debitMinor: isOutflow ? categoryAmount.toString() : "0",
      creditMinor: isOutflow ? "0" : categoryAmount.toString(),
      ...(line.memo ? { description: line.memo } : {})
    });
    for (const component of line.taxComponents) {
      if (component.recoverableMinor > 0n && component.recoverableAccountId) {
        journalLines.push({
          accountId: component.recoverableAccountId,
          debitMinor: component.recoverableMinor.toString(),
          creditMinor: "0",
          description: `${component.name} recoverable`
        });
      }
    }
  }
  const bankDebit =
    (bank.accountKind === "BANK" && imported.direction === "CREDIT") ||
    (bank.accountKind === "CREDIT_CARD" && imported.direction === "CREDIT");
  journalLines.push({
    accountId: bank.linkedLedgerAccountId,
    debitMinor: bankDebit ? imported.amountMinor.toString() : "0",
    creditMinor: bankDebit ? "0" : imported.amountMinor.toString(),
    ...(memo ? { description: memo } : {})
  });
  return {
    effectiveDate: imported.postingDate.toISOString().slice(0, 10),
    description: `Bank categorization: ${imported.description}`,
    sourceType: "BANK_CATEGORIZATION",
    sourceId: imported.id,
    postingKey: `bank-categorization:${categorizationId}`,
    allowControlAccountPosting: false,
    lines: journalLines
  };
}

async function validateMatchTarget(
  tx: Tx,
  organizationId: string,
  bank: {
    readonly id: string;
    readonly linkedLedgerAccountId: string;
    readonly accountKind: BankAccountKind;
    readonly currency: string;
  },
  direction: Direction,
  match: MatchInput,
  amount: bigint
): Promise<void> {
  const journal = await tx.journal.findFirst({
    where: {
      id: match.targetJournalId,
      organizationId,
      status: "POSTED"
    },
    include: { lines: { where: { accountId: bank.linkedLedgerAccountId } } }
  });
  if (
    !journal ||
    !journal.lines.some(
      (line) =>
        expectedLineAmount(
          line,
          bank.accountKind,
          direction,
          line.transactionCurrency?.trim() === bank.currency.trim()
        ) >= amount
    )
  )
    throw new AppError(
      "BANK_MATCH_TARGET_INVALID",
      "Target journal does not contain the expected account-side amount.",
      422
    );
  await assertTargetIdentity(tx, organizationId, match, journal.sourceId);
  const existing = await tx.bankTransactionMatch.findFirst({
    where: {
      organizationId,
      targetJournalId: match.targetJournalId,
      active: true,
      importedTransaction: { bankAccountId: bank.id }
    }
  });
  if (existing)
    throw new AppError(
      "BANK_MATCH_TARGET_ALREADY_USED",
      "The target journal is already matched for this bank account.",
      409
    );
}

async function assertTargetIdentity(
  tx: Tx,
  organizationId: string,
  match: MatchInput,
  sourceId: string
): Promise<void> {
  const valid =
    match.targetType === "INVOICE_PAYMENT"
      ? (await tx.payment.count({
          where: { id: match.targetId, organizationId, journalId: match.targetJournalId }
        })) === 1
      : match.targetType === "BILL_PAYMENT"
        ? (await tx.billPayment.count({
            where: { id: match.targetId, organizationId, journalId: match.targetJournalId }
          })) === 1
        : match.targetType === "IMMEDIATE_EXPENSE"
          ? (await tx.immediateExpense.count({
              where: { id: match.targetId, organizationId, journalId: match.targetJournalId }
            })) === 1
          : match.targetType === "TRANSFER"
            ? (await tx.bankTransfer.count({
                where: { id: match.targetId, organizationId, journalId: match.targetJournalId }
              })) === 1
            : match.targetId === sourceId || match.targetId === match.targetJournalId;
  if (!valid)
    throw new AppError(
      "BANK_MATCH_TARGET_ID_INVALID",
      "The target identifier does not belong to the selected journal.",
      422
    );
}

function expectedLineAmount(
  line: {
    readonly debitMinor: bigint;
    readonly creditMinor: bigint;
    readonly transactionMinor?: bigint | null;
  },
  kind: BankAccountKind,
  direction: Direction,
  useTransactionCurrency = false
): bigint {
  const debit =
    useTransactionCurrency && line.transactionMinor != null
      ? line.transactionMinor > 0n
        ? line.transactionMinor
        : 0n
      : line.debitMinor;
  const credit =
    useTransactionCurrency && line.transactionMinor != null
      ? line.transactionMinor < 0n
        ? -line.transactionMinor
        : 0n
      : line.creditMinor;
  if (kind === "BANK") return direction === "CREDIT" ? debit : credit;
  return direction === "DEBIT" ? credit : debit;
}

async function reconciliationItems(
  tx: Tx,
  organizationId: string,
  account: { readonly id: string; readonly accountKind: BankAccountKind },
  start: Date,
  end: Date,
  ids: readonly string[]
) {
  const uniqueIds = [...new Set(ids)];
  const transactions = await tx.bankImportedTransaction.findMany({
    where: {
      organizationId,
      bankAccountId: account.id,
      id: { in: uniqueIds },
      postingDate: { gte: start, lte: end }
    },
    include: {
      matches: { where: { active: true } },
      categorization: true
    },
    orderBy: [{ postingDate: "asc" }, { id: "asc" }]
  });
  if (transactions.length !== uniqueIds.length)
    throw new AppError(
      "BANK_RECONCILIATION_ITEM_INVALID",
      "A selected transaction is missing, outside the statement period, or belongs to another account.",
      422
    );
  if (transactions.some((transaction) => transaction.status === "UNMATCHED"))
    throw new AppError(
      "BANK_RECONCILIATION_UNMATCHED",
      "Only matched or categorized transactions may be cleared.",
      422
    );
  return transactions.map((transaction) => ({
    transaction,
    impact:
      account.accountKind === "BANK"
        ? transaction.direction === "CREDIT"
          ? transaction.amountMinor
          : -transaction.amountMinor
        : transaction.direction === "DEBIT"
          ? transaction.amountMinor
          : -transaction.amountMinor
  }));
}

function reconciliationItemSnapshot(transaction: {
  readonly id: string;
  readonly postingDate: Date;
  readonly description: string;
  readonly amountMinor: bigint;
  readonly direction: Direction;
  readonly referenceNumber: string | null;
  readonly matches: readonly { readonly targetJournalId: string }[];
  readonly categorization: { readonly journalId: string } | null;
}): Prisma.InputJsonObject {
  return {
    importedTransactionId: transaction.id,
    postingDate: transaction.postingDate.toISOString().slice(0, 10),
    description: transaction.description,
    amountMinor: transaction.amountMinor.toString(),
    direction: transaction.direction,
    referenceNumber: transaction.referenceNumber,
    journalIds: [
      ...transaction.matches.map((match) => match.targetJournalId),
      ...(transaction.categorization ? [transaction.categorization.journalId] : [])
    ]
  };
}

function reconciliationSnapshot(
  reconciliation: {
    readonly id: string;
    readonly bankAccountId: string;
    readonly statementStartDate: Date;
    readonly statementEndDate: Date;
    readonly openingStatementBalanceMinor: bigint;
    readonly closingStatementBalanceMinor: bigint;
    readonly calculatedClosingBalanceMinor: bigint;
    readonly differenceMinor: bigint;
    readonly bankAccount: { readonly displayName: string; readonly maskedAccountReference: string };
    readonly items: readonly {
      readonly statementImpactMinor: bigint;
      readonly snapshot: Prisma.JsonValue;
    }[];
  },
  revision: number,
  completedAt: Date
): Prisma.InputJsonObject {
  return {
    reconciliationId: reconciliation.id,
    revision,
    bankAccountId: reconciliation.bankAccountId,
    bankAccountName: reconciliation.bankAccount.displayName,
    maskedAccountReference: reconciliation.bankAccount.maskedAccountReference,
    statementStartDate: reconciliation.statementStartDate.toISOString().slice(0, 10),
    statementEndDate: reconciliation.statementEndDate.toISOString().slice(0, 10),
    openingStatementBalanceMinor: reconciliation.openingStatementBalanceMinor.toString(),
    closingStatementBalanceMinor: reconciliation.closingStatementBalanceMinor.toString(),
    calculatedClosingBalanceMinor: reconciliation.calculatedClosingBalanceMinor.toString(),
    differenceMinor: reconciliation.differenceMinor.toString(),
    completedAt: completedAt.toISOString(),
    clearedItems: reconciliation.items.map((item) => ({
      statementImpactMinor: item.statementImpactMinor.toString(),
      transaction: item.snapshot
    }))
  };
}

async function importedTransaction(tx: Tx, organizationId: string, id: string) {
  const row = await tx.bankImportedTransaction.findFirst({
    where: { id, organizationId }
  });
  if (!row)
    throw new AppError("BANK_TRANSACTION_NOT_FOUND", "Imported transaction was not found.", 404);
  return row;
}

function assertReviewable(
  imported: {
    readonly status: string;
    readonly duplicateStatus: string;
    readonly version: number;
  },
  version: number
): void {
  if (imported.status !== "UNMATCHED" || imported.version !== version)
    throw stale("Imported transaction");
  if (imported.duplicateStatus === "PROBABLE")
    throw new AppError(
      "BANK_DUPLICATE_REVIEW_REQUIRED",
      "Probable duplicate must be reviewed before matching or categorization.",
      409
    );
}

async function activeBankAccount(tx: Tx, organizationId: string, id: string) {
  const row = await tx.bankAccount.findFirst({
    where: { id, organizationId, isActive: true }
  });
  if (!row) throw new AppError("BANK_ACCOUNT_NOT_FOUND", "Active bank account was not found.", 404);
  return row;
}

async function assertLedgerAccount(
  tx: Tx,
  organizationId: string,
  id: string,
  kind: BankAccountKind
): Promise<void> {
  const account = await tx.account.findFirst({
    where: { id, organizationId, isArchived: false }
  });
  const expected = kind === "BANK" ? "ASSET" : "LIABILITY";
  if (!account || account.type !== expected)
    throw new AppError(
      "BANK_LEDGER_ACCOUNT_INVALID",
      `${kind === "BANK" ? "Bank" : "Credit-card"} records require an active ${expected.toLowerCase()} ledger account.`,
      422
    );
}

async function validateAssociations(
  tx: Tx,
  organizationId: string,
  vendorId: string | null | undefined,
  customerId: string | null | undefined
): Promise<void> {
  if (
    vendorId &&
    !(await tx.vendor.findFirst({ where: { id: vendorId, organizationId, isActive: true } }))
  )
    throw new AppError("BANK_CATEGORY_VENDOR_INVALID", "Vendor was not found.", 422);
  if (
    customerId &&
    !(await tx.customer.findFirst({ where: { id: customerId, organizationId, active: true } }))
  )
    throw new AppError("BANK_CATEGORY_CUSTOMER_INVALID", "Customer was not found.", 422);
}

function storedRows(value: Prisma.JsonValue): readonly StoredImportRow[] {
  if (!Array.isArray(value))
    throw new AppError("BANK_IMPORT_DATA_INVALID", "Import preview is invalid.", 500);
  const rows = value as unknown as readonly StoredImportRow[];
  if (
    rows.some(
      (row) =>
        typeof row.sourceRowNumber !== "number" ||
        typeof row.amountMinor !== "string" ||
        typeof row.rawFingerprint !== "string"
    )
  )
    throw new AppError("BANK_IMPORT_DATA_INVALID", "Import preview is invalid.", 500);
  return rows;
}

function ruleMatches(
  rule: {
    readonly bankAccountId: string | null;
    readonly descriptionContains: string | null;
    readonly payeeContains: string | null;
    readonly minimumAmountMinor: bigint | null;
    readonly maximumAmountMinor: bigint | null;
    readonly direction: Direction | null;
  },
  transaction: {
    readonly bankAccountId: string;
    readonly normalizedDescription: string;
    readonly payee: string | null;
    readonly amountMinor: bigint;
    readonly direction: Direction;
  }
): boolean {
  return (
    (!rule.bankAccountId || rule.bankAccountId === transaction.bankAccountId) &&
    (!rule.descriptionContains ||
      transaction.normalizedDescription.includes(rule.descriptionContains.toLowerCase())) &&
    (!rule.payeeContains ||
      (transaction.payee ?? "").toLowerCase().includes(rule.payeeContains.toLowerCase())) &&
    (rule.minimumAmountMinor === null || transaction.amountMinor >= rule.minimumAmountMinor) &&
    (rule.maximumAmountMinor === null || transaction.amountMinor <= rule.maximumAmountMinor) &&
    (!rule.direction || rule.direction === transaction.direction)
  );
}

function automaticRuleMatches(
  rule: {
    readonly bankAccountId: string | null;
    readonly descriptionContains: string | null;
    readonly payeeContains: string | null;
    readonly minimumAmountMinor: bigint | null;
    readonly maximumAmountMinor: bigint | null;
    readonly direction: Direction | null;
  },
  transaction: {
    readonly bankAccountId: string;
    readonly normalizedDescription: string;
    readonly payee: string | null;
    readonly amountMinor: bigint;
    readonly direction: Direction;
  }
): boolean {
  if (rule.bankAccountId !== transaction.bankAccountId || rule.direction !== transaction.direction)
    return false;
  if (!ruleMatches(rule, transaction)) return false;
  const descriptionExact = Boolean(
    rule.descriptionContains &&
      transaction.normalizedDescription === rule.descriptionContains.trim().toLowerCase()
  );
  const payeeExact = Boolean(
    rule.payeeContains &&
      (transaction.payee ?? "").trim().toLowerCase() === rule.payeeContains.trim().toLowerCase()
  );
  return descriptionExact || payeeExact;
}

function automaticCategorizationInput(
  value: Prisma.JsonValue,
  amountMinor: bigint
): CategorizationInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const suggestion = value as Record<string, unknown>;
  const allowedKeys = new Set(["accountId", "memo"]);
  if (Object.keys(suggestion).some((key) => !allowedKeys.has(key))) return null;
  const accountId = typeof suggestion.accountId === "string" ? suggestion.accountId.trim() : "";
  const memo = typeof suggestion.memo === "string" ? suggestion.memo.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId))
    return null;
  return {
    lines: [{ accountId, amountMinor: amountMinor.toString(), ...(memo ? { memo } : {}) }],
    memo: memo || "Categorized automatically by an approved bank rule."
  };
}

function inferTargetType(sourceType: string): MatchTargetType {
  if (sourceType.includes("bill_payment")) return "BILL_PAYMENT";
  if (sourceType.includes("immediate_expense")) return "IMMEDIATE_EXPENSE";
  if (sourceType.includes("payment")) return "INVOICE_PAYMENT";
  if (sourceType === "BANK_TRANSFER") return "TRANSFER";
  return "MANUAL_JOURNAL";
}

async function lock(
  tx: Tx,
  table: "BankImportBatch" | "BankImportedTransaction" | "BankReconciliation",
  id: string,
  organizationId: string
) {
  const safeTable = RuntimePrisma.raw(`"${table}"`);
  await tx.$queryRaw`SELECT "id" FROM ${safeTable}
    WHERE "id" = ${id}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
}

async function audit(
  tx: Tx,
  context: OrganizationContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonObject,
  reason?: string
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType,
      targetId,
      requestId: context.requestId,
      reason: reason ?? null,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}

async function outbox(
  tx: Tx,
  organizationId: string,
  eventType: string,
  aggregateId: string,
  payload: Prisma.InputJsonObject
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      organizationId,
      eventType,
      aggregateType: "Banking",
      aggregateId,
      payload
    }
  });
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new AppError(
      "BANK_IMPORT_ENCODING_INVALID",
      "Statement content must be valid base64.",
      422
    );
  return Buffer.from(value, "base64");
}

function validateMaskedReference(value: string): void {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.length < 4 || trimmed.length > 64 || digits.length > 4 || /^\d+$/.test(trimmed))
    throw new AppError(
      "BANK_ACCOUNT_REFERENCE_UNMASKED",
      "Account reference must be masked and expose no more than four digits.",
      422
    );
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 255);
}

function positiveMinor(value: string, field: string): bigint {
  const amount = parseMinorUnit(value, field);
  if (amount <= 0n) throw new AppError("BANK_AMOUNT_INVALID", `${field} must be positive.`, 422);
  return amount;
}

function normalizePayerAlias(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-CA")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 250);
}

function optionalNonnegativeMinor(value: string | null | undefined, field: string): bigint | null {
  if (value === undefined || value === null) return null;
  const amount = parseMinorUnit(value, field);
  if (amount < 0n) throw new AppError("BANK_AMOUNT_INVALID", `${field} cannot be negative.`, 422);
  return amount;
}

async function assertCurrencyEnabled(
  tx: Tx,
  organizationId: string,
  value: string
): Promise<string> {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new AppError("BANK_CURRENCY_UNSUPPORTED", "Currency code is invalid.", 422);
  const enabled = await tx.$queryRaw<{ enabled: boolean }[]>`
    SELECT "enabled" FROM "OrganizationCurrency"
    WHERE "organizationId" = ${organizationId}::uuid AND "currencyCode" = ${currency}
  `;
  if (!enabled[0]?.enabled)
    throw new AppError(
      "BANK_CURRENCY_NOT_ENABLED",
      `Currency ${currency} is not enabled for this organization.`,
      400
    );
  return currency;
}

function cleanNullable(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function stale(target: string): AppError {
  return new AppError("STALE_BANKING_RECORD", `${target} was not found or was changed.`, 409);
}

function throwUnique(error: unknown, code: string, message: string): never {
  if (error instanceof AppError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new AppError(code, message, 409);
  throw error;
}

function isConcurrencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002" || error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const metadata = error.meta as { readonly code?: unknown };
  return metadata.code === "40001";
}

function page<T extends { readonly id: string }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items: items.map(toJson),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function toJson<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map(toJson) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJson(entry)])
    ) as T;
  }
  return value;
}
