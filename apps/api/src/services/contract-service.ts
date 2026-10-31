import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { addressSnapshot } from "./customer-address.js";

export const contractStarterKeys = [
  "work-authorization",
  "estimate-acceptance",
  "change-order"
] as const;

export type ContractStarterKey = (typeof contractStarterKeys)[number];

export interface ContractVariableDefinition {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly kind: "text" | "date" | "money";
}

interface ContractStarterDefinition {
  readonly key: ContractStarterKey;
  readonly title: string;
  readonly description: string;
  readonly jurisdiction: string;
  readonly sourceLabel: string;
  readonly sourceUrl: string;
  readonly content: string;
  readonly variables: readonly ContractVariableDefinition[];
}

const albertaContractorSource = "https://www.alberta.ca/hiring-contractor";

const starterTemplates: readonly ContractStarterDefinition[] = [
  {
    key: "work-authorization",
    title: "Work authorization and service agreement",
    description: "A practical draft for confirming scope, schedule, payment, and change approvals.",
    jurisdiction: "Alberta, Canada (starter guidance)",
    sourceLabel: "Alberta contractor checklist and written-estimate guidance",
    sourceUrl: albertaContractorSource,
    variables: [
      field("agreementDate", "Agreement date", true, "date"),
      field("companyName", "Your company", true, "text"),
      field("companyEmail", "Company email", false, "text"),
      field("companyPhone", "Company phone", false, "text"),
      field("customerName", "Customer", true, "text"),
      field("customerEmail", "Customer email", false, "text"),
      field("workLocation", "Work location", true, "text"),
      field("scopeOfWork", "Scope of work", true, "text"),
      field("materials", "Materials and allowances", false, "text"),
      field("startDate", "Planned start date", false, "date"),
      field("completionDate", "Planned completion date", false, "date"),
      field("contractAmount", "Contract amount", true, "money"),
      field("depositAmount", "Deposit", false, "money"),
      field("paymentSchedule", "Payment schedule", true, "text"),
      field("warranty", "Warranty or guarantee", false, "text"),
      field("changeApproval", "Change approval process", true, "text"),
      field("insuranceWcb", "Insurance / WCB information", false, "text"),
      field("disputeProcess", "Dispute process", false, "text")
    ],
    content: `WORK AUTHORIZATION AND SERVICE AGREEMENT

Date: {{agreementDate}}

Parties
{{companyName}} (the Contractor) agrees to provide the services below for {{customerName}} (the Customer).
Company contact: {{companyEmail}} | {{companyPhone}}
Customer contact: {{customerEmail}}

Project and scope
Work location: {{workLocation}}
Scope of work: {{scopeOfWork}}
Materials and allowances: {{materials}}
Planned start: {{startDate}}
Planned completion: {{completionDate}}

Price and payment
Contract amount: {{contractAmount}}
Deposit: {{depositAmount}}
Payment schedule: {{paymentSchedule}}

Changes, permits, and site conditions
Any change to scope, materials, price, or schedule requires written approval before the changed work begins. The parties will identify permit, code, subcontractor, cleanup, access, and site-condition responsibilities before work starts.
Change approval process: {{changeApproval}}

Warranty, insurance, and dispute discussion
Warranty or guarantee: {{warranty}}
Insurance / WCB information: {{insuranceWcb}}
Dispute process: {{disputeProcess}}

Acknowledgement
The parties should review this draft, any applicable cancellation rights, licensing requirements, and local law before signing. This starter document is not legal advice and is not a substitute for a contract reviewed for the specific work and jurisdiction.

Customer: ______________________________  Date: __________
Contractor: _____________________________  Date: __________`
  },
  {
    key: "estimate-acceptance",
    title: "Estimate acceptance and deposit acknowledgement",
    description: "Turn an approved estimate into a clear customer authorization draft.",
    jurisdiction: "Alberta, Canada (starter guidance)",
    sourceLabel: "Alberta contractor checklist and written-estimate guidance",
    sourceUrl: albertaContractorSource,
    variables: [
      field("agreementDate", "Acceptance date", true, "date"),
      field("companyName", "Your company", true, "text"),
      field("customerName", "Customer", true, "text"),
      field("estimateNumber", "Estimate number", false, "text"),
      field("estimateAmount", "Estimate amount", true, "money"),
      field("workLocation", "Work location", true, "text"),
      field("scopeOfWork", "Accepted scope", true, "text"),
      field("depositAmount", "Deposit", false, "money"),
      field("paymentSchedule", "Payment schedule", true, "text"),
      field("startDate", "Planned start date", false, "date"),
      field("completionDate", "Planned completion date", false, "date")
    ],
    content: `ESTIMATE ACCEPTANCE AND DEPOSIT ACKNOWLEDGEMENT

Date: {{agreementDate}}
Contractor: {{companyName}}
Customer: {{customerName}}
Estimate reference: {{estimateNumber}}

The Customer accepts the following estimate as the starting scope for the work at {{workLocation}}.

Accepted scope: {{scopeOfWork}}
Estimate amount: {{estimateAmount}}
Deposit: {{depositAmount}}
Payment schedule: {{paymentSchedule}}
Planned start: {{startDate}}
Planned completion: {{completionDate}}

Any work outside the accepted scope, allowance, or schedule requires written approval before it is performed. This acknowledgement is a starter document, not legal advice. Review applicable local consumer, cancellation, licensing, and payment rules before use.

Customer: ______________________________  Date: __________
Contractor: _____________________________  Date: __________`
  },
  {
    key: "change-order",
    title: "Change order",
    description: "Document an approved change before cost or schedule moves.",
    jurisdiction: "Alberta, Canada (starter guidance)",
    sourceLabel: "Alberta contractor checklist and written-estimate guidance",
    sourceUrl: albertaContractorSource,
    variables: [
      field("agreementDate", "Change date", true, "date"),
      field("companyName", "Your company", true, "text"),
      field("customerName", "Customer", true, "text"),
      field("projectName", "Job or project", true, "text"),
      field("changeDescription", "Change description", true, "text"),
      field("changeAmount", "Change amount", true, "money"),
      field("scheduleImpact", "Schedule impact", true, "text"),
      field("paymentSchedule", "Payment terms for this change", true, "text")
    ],
    content: `CHANGE ORDER

Date: {{agreementDate}}
Contractor: {{companyName}}
Customer: {{customerName}}
Job or project: {{projectName}}

Requested and approved change
{{changeDescription}}

Change amount: {{changeAmount}}
Schedule impact: {{scheduleImpact}}
Payment terms for this change: {{paymentSchedule}}

This change takes effect only after both parties review and sign it. This starter document does not replace legal advice or the governing agreement.

Customer: ______________________________  Date: __________
Contractor: _____________________________  Date: __________`
  }
];

export class ContractService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listTemplates(context: OrganizationContext) {
    await this.authorization.assert(context, "contracts:read", "ContractTemplate");
    const templates = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.contractTemplate.findMany({
        where: { organizationId: context.organizationId, active: true },
        orderBy: { name: "asc" }
      })
    );
    return {
      starters: starterTemplates.map(publicStarter),
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        jurisdiction: template.jurisdiction,
        sourceLabel: template.sourceLabel,
        sourceUrl: template.sourceUrl,
        variableSchema: variableDefinitions(template.variableSchema),
        version: template.version,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString()
      }))
    };
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "contracts:read", "ContractDocument");
    const contracts = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.contractDocument.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { updatedAt: "desc" },
        take: 100
      })
    );
    return { contracts: contracts.map(contractSummary) };
  }

  public async get(context: OrganizationContext, contractId: string) {
    await this.authorization.assert(context, "contracts:read", "ContractDocument", contractId);
    const contract = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.contractDocument.findFirst({
        where: { id: contractId, organizationId: context.organizationId }
      })
    );
    if (!contract) throw new AppError("CONTRACT_NOT_FOUND", "Contract was not found.", 404);
    return contractDto(contract);
  }

  public async create(
    context: OrganizationContext,
    input: {
      readonly starterKey?: string | undefined;
      readonly templateId?: string | null | undefined;
      readonly title?: string | undefined;
      readonly jurisdiction?: string | undefined;
      readonly customerId?: string | null | undefined;
      readonly projectId?: string | null | undefined;
      readonly estimateId?: string | null | undefined;
      readonly variableValues: Readonly<Record<string, string>>;
    }
  ) {
    await this.authorization.assert(context, "contracts:manage", "ContractDocument");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const source = await resolveTemplate(tx, context, input);
      const references = await resolveReferences(tx, context, input);
      const autoValues = await autoFillValues(tx, context, references);
      const values = mergeVariableValues(source.variables, autoValues, input.variableValues);
      const contract = await tx.contractDocument.create({
        data: {
          organizationId: context.organizationId,
          templateId: source.templateId,
          templateKey: source.templateKey,
          title: input.title ?? source.title,
          jurisdiction: input.jurisdiction ?? source.jurisdiction,
          sourceLabel: source.sourceLabel,
          sourceUrl: source.sourceUrl,
          content: source.content,
          variableSchema: source.variables as unknown as Prisma.InputJsonValue,
          variableValues: values,
          customerId: references.customerId,
          projectId: references.projectId,
          estimateId: references.estimateId,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "CONTRACT_DRAFT_CREATED", contract.id, {
        starterKey: contract.templateKey,
        templateId: contract.templateId,
        customerId: contract.customerId,
        projectId: contract.projectId,
        estimateId: contract.estimateId
      });
      return contractDto(contract);
    });
  }

  public async update(
    context: OrganizationContext,
    contractId: string,
    input: {
      readonly version: number;
      readonly title?: string | undefined;
      readonly content?: string | undefined;
      readonly jurisdiction?: string | null | undefined;
      readonly variableValues?: Readonly<Record<string, string>> | undefined;
    }
  ) {
    await this.authorization.assert(context, "contracts:manage", "ContractDocument", contractId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.contractDocument.findFirst({
        where: { id: contractId, organizationId: context.organizationId }
      });
      if (!current) throw new AppError("CONTRACT_NOT_FOUND", "Contract was not found.", 404);
      if (current.status !== "DRAFT")
        throw new AppError(
          "CONTRACT_NOT_EDITABLE",
          "Only a draft contract can be edited. Create a new revision for a reviewed contract.",
          422
        );
      const definitions = variableDefinitions(current.variableSchema);
      const values = input.variableValues
        ? mergeVariableValues(
            definitions,
            variableValues(current.variableValues),
            input.variableValues
          )
        : variableValues(current.variableValues);
      const result = await tx.contractDocument.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          version: input.version,
          status: "DRAFT"
        },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.content === undefined ? {} : { content: input.content }),
          ...(input.jurisdiction === undefined ? {} : { jurisdiction: input.jurisdiction }),
          ...(input.variableValues === undefined ? {} : { variableValues: values }),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError(
          "STALE_CONTRACT",
          "This contract changed elsewhere. Refresh before saving your draft.",
          409
        );
      const updated = await tx.contractDocument.findUniqueOrThrow({ where: { id: current.id } });
      await audit(tx, context, "CONTRACT_DRAFT_UPDATED", updated.id, {
        changedFields: changedContractFields(current, updated)
      });
      return contractDto(updated);
    });
  }

  public async markReady(
    context: OrganizationContext,
    contractId: string,
    input: { readonly version: number; readonly legalReviewAcknowledged: true }
  ) {
    await this.authorization.assert(context, "contracts:ready", "ContractDocument", contractId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.contractDocument.findFirst({
        where: { id: contractId, organizationId: context.organizationId }
      });
      if (!current) throw new AppError("CONTRACT_NOT_FOUND", "Contract was not found.", 404);
      if (current.status !== "DRAFT")
        throw new AppError(
          "CONTRACT_STATUS_INVALID",
          "Only a draft contract can be marked ready for review.",
          422
        );
      const unresolved = unresolvedVariables(
        variableDefinitions(current.variableSchema),
        variableValues(current.variableValues)
      );
      if (unresolved.length > 0)
        throw new AppError(
          "CONTRACT_VARIABLES_UNRESOLVED",
          `Complete the required fields before review: ${unresolved.join(", ")}.`,
          422
        );
      const now = new Date();
      const result = await tx.contractDocument.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          version: input.version,
          status: "DRAFT"
        },
        data: {
          status: "READY_FOR_REVIEW",
          legalReviewAcknowledgedAt: now,
          legalReviewAcknowledgedById: context.user.id,
          readyAt: now,
          readyByUserId: context.user.id,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1)
        throw new AppError(
          "STALE_CONTRACT",
          "This contract changed elsewhere. Refresh before marking it ready.",
          409
        );
      const updated = await tx.contractDocument.findUniqueOrThrow({ where: { id: current.id } });
      await audit(tx, context, "CONTRACT_READY_FOR_REVIEW", updated.id, {
        acknowledged: input.legalReviewAcknowledged,
        unresolvedVariables: []
      });
      return contractDto(updated);
    });
  }
}

export function renderContractText(
  content: string,
  values: Readonly<Record<string, string>>,
  status: string
): string {
  const rendered = content.replace(/{{([a-z][A-Za-z0-9]*)}}/g, (_match, key: string) => {
    const value = values[key]?.trim();
    return value ? value : `[${key} — complete before review]`;
  });
  return status === "DRAFT" ? `DRAFT — REVIEW BEFORE SIGNING\n\n${rendered}` : rendered;
}

export function listContractStarterTemplates() {
  return starterTemplates.map(publicStarter);
}

function field(
  key: string,
  label: string,
  required: boolean,
  kind: ContractVariableDefinition["kind"]
): ContractVariableDefinition {
  return { key, label, required, kind };
}

function publicStarter(template: ContractStarterDefinition) {
  return {
    key: template.key,
    title: template.title,
    description: template.description,
    jurisdiction: template.jurisdiction,
    sourceLabel: template.sourceLabel,
    sourceUrl: template.sourceUrl,
    variableSchema: template.variables
  };
}

async function resolveTemplate(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  input: {
    readonly starterKey?: string | undefined;
    readonly templateId?: string | null | undefined;
  }
) {
  if (input.starterKey) {
    const starter = starterTemplates.find((template) => template.key === input.starterKey);
    if (!starter)
      throw new AppError(
        "CONTRACT_TEMPLATE_NOT_FOUND",
        "Contract starter template was not found.",
        404
      );
    return {
      templateId: null,
      templateKey: starter.key,
      title: starter.title,
      jurisdiction: starter.jurisdiction,
      sourceLabel: starter.sourceLabel,
      sourceUrl: starter.sourceUrl,
      content: starter.content,
      variables: starter.variables
    };
  }
  if (!input.templateId)
    throw new AppError("CONTRACT_TEMPLATE_REQUIRED", "Choose a contract template.", 422);
  const template = await tx.contractTemplate.findFirst({
    where: { id: input.templateId, organizationId: context.organizationId, active: true }
  });
  if (!template)
    throw new AppError("CONTRACT_TEMPLATE_NOT_FOUND", "Contract template was not found.", 404);
  return {
    templateId: template.id,
    templateKey: null,
    title: template.name,
    jurisdiction: template.jurisdiction,
    sourceLabel: template.sourceLabel,
    sourceUrl: template.sourceUrl,
    content: template.content,
    variables: variableDefinitions(template.variableSchema)
  };
}

async function resolveReferences(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  input: {
    readonly customerId?: string | null | undefined;
    readonly projectId?: string | null | undefined;
    readonly estimateId?: string | null | undefined;
  }
) {
  const project = input.projectId
    ? await tx.project.findFirst({
        where: { id: input.projectId, organizationId: context.organizationId },
        select: { id: true, customerId: true }
      })
    : null;
  if (input.projectId && !project)
    throw new AppError("CONTRACT_PROJECT_NOT_FOUND", "The selected project was not found.", 404);
  const estimate = input.estimateId
    ? await tx.estimate.findFirst({
        where: { id: input.estimateId, organizationId: context.organizationId },
        select: { id: true, customerId: true }
      })
    : null;
  if (input.estimateId && !estimate)
    throw new AppError("CONTRACT_ESTIMATE_NOT_FOUND", "The selected estimate was not found.", 404);
  const inferredCustomerId =
    input.customerId ?? project?.customerId ?? estimate?.customerId ?? null;
  if (
    (project && inferredCustomerId !== project.customerId) ||
    (estimate && inferredCustomerId !== estimate.customerId)
  )
    throw new AppError(
      "CONTRACT_REFERENCE_MISMATCH",
      "The selected customer, project, and estimate must belong together.",
      422
    );
  if (inferredCustomerId) {
    const customer = await tx.customer.findFirst({
      where: { id: inferredCustomerId, organizationId: context.organizationId },
      select: { id: true }
    });
    if (!customer)
      throw new AppError("CONTRACT_CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
  }
  return {
    customerId: inferredCustomerId,
    projectId: project?.id ?? null,
    estimateId: estimate?.id ?? null
  };
}

async function autoFillValues(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  references: {
    readonly customerId: string | null;
    readonly projectId: string | null;
    readonly estimateId: string | null;
  }
): Promise<Record<string, string>> {
  const [organization, settings, customer, project, estimate] = await Promise.all([
    tx.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
      select: { legalName: true, displayName: true }
    }),
    tx.organizationSettings.findUnique({
      where: { organizationId: context.organizationId },
      select: { email: true, phone: true, businessAddress: true }
    }),
    references.customerId
      ? tx.customer.findFirst({
          where: { id: references.customerId, organizationId: context.organizationId },
          select: {
            displayName: true,
            email: true,
            addresses: { orderBy: { createdAt: "asc" } }
          }
        })
      : null,
    references.projectId
      ? tx.project.findFirst({
          where: { id: references.projectId, organizationId: context.organizationId },
          select: { name: true, description: true, startDate: true, endDate: true }
        })
      : null,
    references.estimateId
      ? tx.estimate.findFirst({
          where: { id: references.estimateId, organizationId: context.organizationId },
          select: {
            estimateNumber: true,
            provisionalIdentifier: true,
            grandTotalMinor: true,
            currency: true,
            customerFacingNotes: true,
            issueDate: true,
            expiryDate: true
          }
        })
      : null
  ]);
  return compactValues({
    agreementDate: new Date().toISOString().slice(0, 10),
    companyName: organization.legalName || organization.displayName,
    companyEmail: settings?.email ?? "",
    companyPhone: settings?.phone ?? "",
    customerName: customer?.displayName ?? "",
    customerEmail: customer?.email ?? "",
    workLocation: addressText(
      addressSnapshot(customer?.addresses, "SERVICE") ??
        addressSnapshot(customer?.addresses, "BILLING")
    ),
    scopeOfWork: project?.description ?? estimate?.customerFacingNotes ?? "",
    startDate: dateText(project?.startDate ?? estimate?.issueDate),
    completionDate: dateText(project?.endDate ?? estimate?.expiryDate),
    projectName: project?.name ?? "",
    estimateNumber: estimate?.estimateNumber ?? estimate?.provisionalIdentifier ?? "",
    estimateAmount: estimate ? moneyText(estimate.grandTotalMinor, estimate.currency) : "",
    contractAmount: estimate ? moneyText(estimate.grandTotalMinor, estimate.currency) : ""
  });
}

function mergeVariableValues(
  definitions: readonly ContractVariableDefinition[],
  existing: Readonly<Record<string, string>>,
  supplied: Readonly<Record<string, string>>
): Record<string, string> {
  const allowed = new Set(definitions.map((definition) => definition.key));
  for (const key of Object.keys(supplied)) {
    if (!allowed.has(key))
      throw new AppError(
        "CONTRACT_VARIABLE_UNSUPPORTED",
        `The field ${key} is not part of this contract template.`,
        422
      );
  }
  const values: Record<string, string> = {};
  for (const definition of definitions)
    values[definition.key] = supplied[definition.key] ?? existing[definition.key] ?? "";
  return values;
}

function contractDto(contract: {
  id: string;
  templateId: string | null;
  templateKey: string | null;
  title: string;
  jurisdiction: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  content: string;
  variableSchema: Prisma.JsonValue;
  variableValues: Prisma.JsonValue;
  customerId: string | null;
  projectId: string | null;
  estimateId: string | null;
  status: string;
  legalReviewAcknowledgedAt: Date | null;
  readyAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  const schema = variableDefinitions(contract.variableSchema);
  const values = variableValues(contract.variableValues);
  return {
    id: contract.id,
    templateId: contract.templateId,
    templateKey: contract.templateKey,
    title: contract.title,
    jurisdiction: contract.jurisdiction,
    sourceLabel: contract.sourceLabel,
    sourceUrl: contract.sourceUrl,
    content: contract.content,
    variableSchema: schema,
    variableValues: values,
    unresolvedVariables: unresolvedVariables(schema, values),
    renderedText: renderContractText(contract.content, values, contract.status),
    customerId: contract.customerId,
    projectId: contract.projectId,
    estimateId: contract.estimateId,
    status: contract.status,
    legalReviewAcknowledgedAt: contract.legalReviewAcknowledgedAt?.toISOString() ?? null,
    readyAt: contract.readyAt?.toISOString() ?? null,
    version: contract.version,
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString()
  };
}

function contractSummary(contract: Parameters<typeof contractDto>[0]) {
  const full = contractDto(contract);
  return {
    id: full.id,
    title: full.title,
    templateKey: full.templateKey,
    status: full.status,
    customerId: full.customerId,
    projectId: full.projectId,
    estimateId: full.estimateId,
    unresolvedVariables: full.unresolvedVariables,
    version: full.version,
    updatedAt: full.updatedAt
  };
}

function variableDefinitions(value: Prisma.JsonValue): readonly ContractVariableDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : "";
    const label = typeof record.label === "string" ? record.label : "";
    const kind = record.kind;
    if (
      !/^[a-z][A-Za-z0-9]*$/.test(key) ||
      !label ||
      !["text", "date", "money"].includes(String(kind))
    )
      return [];
    return [
      {
        key,
        label,
        required: record.required === true,
        kind: kind as ContractVariableDefinition["kind"]
      }
    ];
  });
}

function variableValues(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) =>
      typeof candidate === "string" && /^[a-z][A-Za-z0-9]*$/.test(key) ? [[key, candidate]] : []
    )
  );
}

function unresolvedVariables(
  schema: readonly ContractVariableDefinition[],
  values: Readonly<Record<string, string>>
): string[] {
  return schema
    .filter((definition) => definition.required && !values[definition.key]?.trim())
    .map((definition) => definition.label);
}

function changedContractFields(
  current: {
    title: string;
    content: string;
    jurisdiction: string | null;
    variableValues: Prisma.JsonValue;
  },
  updated: {
    title: string;
    content: string;
    jurisdiction: string | null;
    variableValues: Prisma.JsonValue;
  }
) {
  const fields: readonly (keyof typeof current)[] = [
    "title",
    "content",
    "jurisdiction",
    "variableValues"
  ];
  return fields.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(updated[key]));
}

function compactValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values));
}

function addressText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return ["line1", "line2", "city", "province", "postalCode", "country", "countryCode"]
    .map((key) => (typeof record[key] === "string" ? record[key].trim() : ""))
    .filter(Boolean)
    .join(", ");
}

function dateText(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function moneyText(value: bigint, currency: string): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${currency} ${(absolute / 100n).toString()}.${(absolute % 100n)
    .toString()
    .padStart(2, "0")}`;
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  action: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType: "ContractDocument",
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
