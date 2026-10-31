import { randomUUID } from "node:crypto";
import { PrismaClient, withTenantTransaction } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { AppError, type OrganizationContext } from "@clearledger/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FixedAssetService,
  type FixedAssetClassInput,
  type FixedAssetCreateInput
} from "./services/fixed-asset-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const service = new FixedAssetService(prisma);

interface Fixture {
  readonly context: OrganizationContext;
  readonly organizationId: string;
  readonly assetAccountId: string;
  readonly accumulatedAccountId: string;
  readonly expenseAccountId: string;
  readonly gainAccountId: string;
  readonly lossAccountId: string;
}

beforeAll(async () => prisma.$connect());
beforeEach(async () => resetDatabase(prisma));
afterAll(async () => prisma.$disconnect());

describe("fixed-asset register service", () => {
  it("enforces the editable workflow gate and idempotently creates validated classes", async () => {
    const fixture = await createFixture(false);
    const input = classInput(fixture);

    await expectAppError(
      () => service.createClass(fixture.context, input, "class-gate"),
      "FIXED_ASSET_REGISTER_DISABLED"
    );
    expect(await prisma.fixedAssetClass.count()).toBe(0);

    await prisma.workflowPreferences.update({
      where: { organizationId: fixture.organizationId },
      data: { fixedAssetRegisterEnabled: true }
    });
    const first = await service.createClass(fixture.context, input, "class-gate");
    const replay = await service.createClass(fixture.context, input, "class-gate");
    expect(first.statusCode).toBe(201);
    expect(replay.replayed).toBe(true);
    expect(replay.body.fixedAssetClass.id).toBe(first.body.fixedAssetClass.id);
    expect(await prisma.fixedAssetClass.count()).toBe(1);

    await expectAppError(
      () =>
        service.createClass(
          fixture.context,
          {
            ...input,
            code: "BAD-MAP",
            defaultAssetAccountId: fixture.expenseAccountId
          },
          "class-bad-map"
        ),
      "FIXED_ASSET_ACCOUNT_MAPPING_INVALID"
    );
  });

  it("copies class defaults at asset creation and keeps previews deterministic after class edits", async () => {
    const fixture = await createFixture();
    const createdClass = await service.createClass(
      fixture.context,
      classInput(fixture),
      "class-copy"
    );
    const classRow = createdClass.body.fixedAssetClass;
    const created = await service.create(fixture.context, assetInput(classRow.id), "asset-copy");
    const asset = created.body.fixedAsset;

    expect(asset).toMatchObject({
      classVersionSnapshot: 1,
      bookMethod: "STRAIGHT_LINE",
      bookConvention: "FULL_MONTH",
      usefulLifeMonths: 60,
      residualRatioMicrosSnapshot: "100000",
      residualValueMinor: "12001",
      assetAccountId: fixture.assetAccountId,
      accumulatedDepreciationAccountId: fixture.accumulatedAccountId,
      depreciationExpenseAccountId: fixture.expenseAccountId
    });

    await service.updateClass(fixture.context, classRow.id, classRow.version, {
      ...classInput(fixture),
      defaultUsefulLifeMonths: 36,
      defaultResidualRatioMicros: "0"
    });
    const unchanged = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: asset.id }
    });
    expect(unchanged.classVersionSnapshot).toBe(1);
    expect(unchanged.usefulLifeMonths).toBe(60);
    expect(unchanged.residualValueMinor).toBe(12_001n);

    const firstPreview = await service.preview(fixture.context, asset.id);
    const secondPreview = await service.preview(fixture.context, asset.id);
    expect(firstPreview.calculation).toEqual(secondPreview.calculation);
    expect(firstPreview.calculation.calculationVersion).toBe("book-straight-line-v1");
    expect(firstPreview.calculation.schedule).toHaveLength(60);
    expect(firstPreview.calculation.finalNetBookValueMinor).toBe("12001");
    expect(firstPreview.accountMappingWarnings).toEqual([]);
    expect(await prisma.journal.count()).toBe(0);

    await expect(
      withTenantTransaction(
        prisma,
        {
          organizationId: fixture.organizationId,
          actorUserId: fixture.context.user.id
        },
        (tx) =>
          tx.fixedAsset.update({
            where: { id: asset.id },
            data: { updatedByUserId: randomUUID() }
          })
      )
    ).rejects.toThrow("Workflow updater must match the authenticated actor");
  });

  it("registers only through versioned idempotent review and never creates a journal", async () => {
    const fixture = await createFixture();
    const asset = await createAsset(fixture, "lifecycle");

    const submitted = await service.transition(
      fixture.context,
      asset.id,
      asset.version,
      "submit",
      null,
      "asset-submit"
    );
    expect(submitted.body.fixedAsset.status).toBe("SUBMITTED");

    const registered = await service.transition(
      fixture.context,
      asset.id,
      submitted.body.fixedAsset.version,
      "register",
      "Reviewed register classification",
      "asset-register"
    );
    const replay = await service.transition(
      fixture.context,
      asset.id,
      submitted.body.fixedAsset.version,
      "register",
      "Reviewed register classification",
      "asset-register"
    );
    expect(registered.body.fixedAsset.status).toBe("REGISTERED");
    expect(registered.body.fixedAsset.financialState).toBe("NON_POSTING");
    expect(replay.replayed).toBe(true);
    expect(await prisma.journal.count()).toBe(0);
    expect(await prisma.journalLine.count()).toBe(0);

    await expectAppError(
      () =>
        service.update(fixture.context, asset.id, asset.version, {
          name: "Stale edit"
        }),
      "STALE_FIXED_ASSET"
    );
    await expectAppError(
      () =>
        service.transition(
          fixture.context,
          asset.id,
          registered.body.fixedAsset.version,
          "revise",
          "Correct register details",
          "asset-revise"
        ),
      "FIXED_ASSET_TRANSITION_INVALID"
    );
    await expect(
      prisma.fixedAsset.update({
        where: { id: asset.id },
        data: { name: "Direct history rewrite" }
      })
    ).rejects.toThrow("Registered fixed assets are immutable");
    const frozen = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(frozen.status).toBe("REGISTERED");
    expect(frozen.name).toBe(registered.body.fixedAsset.name);
    expect(await prisma.journal.count()).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: {
          organizationId: fixture.organizationId,
          targetId: asset.id,
          action: { in: ["FIXED_ASSET_SUBMITTED", "FIXED_ASSET_REGISTERED"] }
        }
      })
    ).toBe(2);
  });

  it("requires an explicit ledger treatment before register-only approval", async () => {
    const fixture = await createFixture();
    const createdClass = await service.createClass(
      fixture.context,
      classInput(fixture),
      "class-undecided"
    );
    const created = await service.create(
      fixture.context,
      {
        ...assetInput(createdClass.body.fixedAssetClass.id),
        assetNumber: "FA-UNDECIDED",
        ledgerTreatment: "UNDECIDED"
      },
      "asset-undecided"
    );
    const submitted = await service.transition(
      fixture.context,
      created.body.fixedAsset.id,
      created.body.fixedAsset.version,
      "submit",
      null,
      "asset-undecided-submit"
    );

    await expectAppError(
      () =>
        service.transition(
          fixture.context,
          created.body.fixedAsset.id,
          submitted.body.fixedAsset.version,
          "register",
          null,
          "asset-undecided-register"
        ),
      "FIXED_ASSET_LEDGER_TREATMENT_REQUIRED"
    );
    expect(await prisma.journal.count()).toBe(0);
  });

  it("supports a NONE class as a non-depreciating register entry", async () => {
    const fixture = await createFixture();
    const createdClass = await service.createClass(
      fixture.context,
      {
        code: "LAND",
        name: "Land",
        defaultBookMethod: "NONE",
        defaultAssetAccountId: fixture.assetAccountId
      },
      "class-none"
    );
    const created = await service.create(
      fixture.context,
      {
        fixedAssetClassId: createdClass.body.fixedAssetClass.id,
        assetNumber: "FA-LAND-1",
        name: "Shop land",
        acquiredOn: "2026-01-01",
        inServiceOn: "2026-01-01",
        acquisitionCostMinor: "50000000",
        ledgerTreatment: "ALREADY_RECORDED",
        sourceReference: "Manual land opening record"
      },
      "asset-none"
    );
    const preview = await service.preview(fixture.context, created.body.fixedAsset.id);

    expect(created.body.fixedAsset).toMatchObject({
      bookMethod: "NONE",
      residualValueMinor: "50000000",
      usefulLifeMonths: null
    });
    expect(preview.calculation.schedule).toEqual([]);
    expect(preview.calculation.finalNetBookValueMinor).toBe("50000000");
  });

  it("isolates tenants in services, RLS reads, and composite class references", async () => {
    const first = await createFixture();
    const second = await createFixture();
    const asset = await createAsset(first, "tenant");
    const firstClassId = asset.fixedAssetClassId;

    await expectAppError(() => service.get(second.context, asset.id), "FIXED_ASSET_NOT_FOUND");
    expect(
      await withTenantTransaction(
        prisma,
        {
          organizationId: second.organizationId,
          actorUserId: second.context.user.id
        },
        (tx) => tx.fixedAsset.count()
      )
    ).toBe(0);
    await expectAppError(
      () =>
        service.create(
          second.context,
          {
            ...assetInput(firstClassId),
            assetNumber: "FA-CROSS-TENANT"
          },
          "asset-cross-tenant"
        ),
      "FIXED_ASSET_CLASS_NOT_FOUND"
    );

    await expect(
      prisma.fixedAsset.create({
        data: {
          organizationId: second.organizationId,
          fixedAssetClassId: firstClassId,
          classVersionSnapshot: 1,
          assetNumber: "FA-DB-CROSS",
          name: "Cross tenant",
          acquiredOn: new Date("2026-01-01T00:00:00.000Z"),
          inServiceOn: new Date("2026-01-01T00:00:00.000Z"),
          acquisitionCostMinor: 100n,
          residualValueMinor: 100n,
          bookMethod: "NONE",
          ledgerTreatment: "ALREADY_RECORDED",
          sourceReference: "Cross-tenant attempt",
          createdByUserId: second.context.user.id,
          updatedByUserId: second.context.user.id
        }
      })
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

async function createFixture(fixedAssetRegisterEnabled = true): Promise<Fixture> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `fixed-assets-${suffix}@example.test`,
      displayName: "Fixed Asset Owner",
      emailVerifiedAt: new Date()
    }
  });
  const { organization, membership } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        legalName: `Fixed Assets ${suffix}`,
        displayName: "Fixed Assets",
        currency: "CAD"
      }
    });
    const membership = await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "OWNER"
      }
    });
    return { organization, membership };
  });
  await prisma.workflowPreferences.create({
    data: {
      organizationId: organization.id,
      fixedAssetRegisterEnabled
    }
  });
  const assetAccount = await createAccount(organization.id, `${suffix}-1500`, "Equipment", "ASSET");
  const accumulated = await createAccount(
    organization.id,
    `${suffix}-1590`,
    "Accumulated depreciation",
    "CONTRA_ASSET"
  );
  const expense = await createAccount(
    organization.id,
    `${suffix}-6000`,
    "Depreciation expense",
    "EXPENSE"
  );
  const gain = await createAccount(
    organization.id,
    `${suffix}-4800`,
    "Gain on disposal",
    "REVENUE"
  );
  const loss = await createAccount(
    organization.id,
    `${suffix}-6800`,
    "Loss on disposal",
    "EXPENSE"
  );
  return {
    organizationId: organization.id,
    assetAccountId: assetAccount.id,
    accumulatedAccountId: accumulated.id,
    expenseAccountId: expense.id,
    gainAccountId: gain.id,
    lossAccountId: loss.id,
    context: {
      requestId: randomUUID(),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        emailVerifiedAt: user.emailVerifiedAt
      },
      organizationId: organization.id,
      membershipId: membership.id,
      role: "OWNER",
      sessionId: null,
      recentAuthAt: new Date(),
      mfaAuthenticated: false,
      authenticationMethod: "DEVELOPMENT",
      auditOrigin: { ipAddress: null, userAgent: null }
    }
  };
}

async function createAccount(
  organizationId: string,
  code: string,
  name: string,
  type: "ASSET" | "CONTRA_ASSET" | "EXPENSE" | "REVENUE"
) {
  return prisma.account.create({
    data: { organizationId, code, name, type }
  });
}

function classInput(fixture: Fixture): FixedAssetClassInput {
  return {
    code: "EQUIPMENT",
    name: "Equipment",
    description: "Straight-line equipment",
    defaultBookMethod: "STRAIGHT_LINE",
    defaultBookConvention: "FULL_MONTH",
    defaultUsefulLifeMonths: 60,
    defaultResidualRatioMicros: "100000",
    defaultAssetAccountId: fixture.assetAccountId,
    defaultAccumulatedAccountId: fixture.accumulatedAccountId,
    defaultDepreciationExpenseId: fixture.expenseAccountId,
    defaultDisposalGainAccountId: fixture.gainAccountId,
    defaultDisposalLossAccountId: fixture.lossAccountId
  };
}

function assetInput(fixedAssetClassId: string): FixedAssetCreateInput {
  return {
    fixedAssetClassId,
    assetNumber: "FA-0001",
    name: "Service van",
    acquiredOn: "2026-01-15",
    inServiceOn: "2026-02-01",
    acquisitionCostMinor: "120005",
    ledgerTreatment: "ALREADY_RECORDED",
    sourceReference: "Manual reference VAN-2026-01"
  };
}

async function createAsset(fixture: Fixture, suffix: string) {
  const createdClass = await service.createClass(
    fixture.context,
    {
      ...classInput(fixture),
      code: `EQUIPMENT-${suffix}`
    },
    `class-${suffix}`
  );
  const created = await service.create(
    fixture.context,
    {
      ...assetInput(createdClass.body.fixedAssetClass.id),
      assetNumber: `FA-${suffix}`
    },
    `asset-${suffix}`
  );
  return created.body.fixedAsset;
}

async function expectAppError(work: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}
