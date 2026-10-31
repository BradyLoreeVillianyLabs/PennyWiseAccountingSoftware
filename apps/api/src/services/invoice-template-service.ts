import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";

export const invoiceTemplateKeys = [
  "clean-professional",
  "contractor",
  "ranch-agriculture",
  "retail",
  "creative",
  "modern",
  "minimal",
  "service-professional"
] as const;

export type InvoiceTemplateKey = (typeof invoiceTemplateKeys)[number];

export interface InvoiceTemplateConfiguration {
  readonly logoAssetId: string | null;
  readonly headerImageAssetId: string | null;
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly fontPairing: "system" | "classic" | "modern" | "editorial" | "technical";
  readonly headingFontSize: number;
  readonly bodyFontSize: number;
  readonly tableFontSize: number;
  readonly notesFontSize: number;
  readonly backgroundTreatment: "none" | "brand-wash" | "image-watermark";
  readonly spacing: "compact" | "comfortable" | "airy";
  readonly detailStyle: "rules" | "tinted" | "minimal";
  readonly headerAlignment: "left" | "center" | "right";
  readonly pageSize: "LETTER" | "A4";
  readonly visibleColumns: readonly ("description" | "quantity" | "unitPrice" | "tax" | "total")[];
  readonly showTaxDetails: boolean;
  readonly showItemImages: boolean;
  readonly customerNotes: string | null;
  readonly terms: string | null;
  readonly paymentInstructions: string | null;
  readonly footer: string | null;
  readonly signatureBlock: string | null;
  readonly qrCodePlaceholder: boolean;
  readonly paymentButtonPlaceholder: boolean;
  readonly customFields: readonly { readonly label: string; readonly value: string }[];
}

export interface InvoiceTemplateDefinition {
  readonly key: InvoiceTemplateKey;
  readonly name: string;
  readonly description: string;
  readonly defaultConfiguration: InvoiceTemplateConfiguration;
}

const baseColumns = ["description", "quantity", "unitPrice", "tax", "total"] as const;

const definitions: readonly InvoiceTemplateDefinition[] = (
  [
    [
      "clean-professional",
      "Signature",
      "Confident, polished business layout",
      "#1f4e79",
      "#d9eaf7",
      "system",
      "comfortable",
      "rules"
    ],
    [
      "contractor",
      "Ledger",
      "Bold, structured layout for operational work",
      "#7a3e00",
      "#f2d6bd",
      "technical",
      "compact",
      "tinted"
    ],
    [
      "ranch-agriculture",
      "Ranch and agriculture",
      "Practical field-service layout",
      "#31572c",
      "#dce8d8",
      "classic",
      "comfortable",
      "rules"
    ],
    [
      "retail",
      "Retail",
      "Compact product-focused layout",
      "#5b2c6f",
      "#eadcf0",
      "modern",
      "compact",
      "tinted"
    ],
    [
      "creative",
      "Studio",
      "Warm editorial layout for service and creative work",
      "#8a2d3f",
      "#f1d9de",
      "editorial",
      "airy",
      "tinted"
    ],
    [
      "modern",
      "Modern",
      "Strong hierarchy with relaxed whitespace",
      "#164e63",
      "#d5edf3",
      "modern",
      "airy",
      "rules"
    ],
    [
      "minimal",
      "Minimal",
      "Quiet low-ink layout",
      "#374151",
      "#e5e7eb",
      "system",
      "airy",
      "minimal"
    ],
    [
      "service-professional",
      "Service professional",
      "Readable recurring-service layout",
      "#075985",
      "#dbeafe",
      "classic",
      "comfortable",
      "rules"
    ]
  ] as const
).map(([key, name, description, primaryColor, accentColor, fontPairing, spacing, detailStyle]) => ({
  key,
  name,
  description,
  defaultConfiguration: {
    logoAssetId: null,
    headerImageAssetId: null,
    primaryColor,
    accentColor,
    fontPairing,
    headingFontSize: fontPairing === "technical" ? 28 : fontPairing === "editorial" ? 34 : 30,
    bodyFontSize: 11,
    tableFontSize: 9,
    notesFontSize: 10,
    backgroundTreatment: detailStyle === "tinted" ? "brand-wash" : "none",
    spacing,
    detailStyle,
    headerAlignment: "left" as const,
    pageSize: "LETTER" as const,
    visibleColumns: baseColumns,
    showTaxDetails: true,
    showItemImages: false,
    customerNotes: null,
    terms: null,
    paymentInstructions: null,
    footer: null,
    signatureBlock: null,
    qrCodePlaceholder: false,
    paymentButtonPlaceholder: false,
    customFields: []
  }
}));

export function listInvoiceTemplates(): readonly InvoiceTemplateDefinition[] {
  return definitions;
}

export function defaultInvoiceTemplate(): InvoiceTemplateDefinition {
  return definitions[0]!;
}

export function getInvoiceTemplate(key: string): InvoiceTemplateDefinition {
  const definition = definitions.find((item) => item.key === key);
  if (!definition)
    throw new AppError("INVOICE_TEMPLATE_NOT_FOUND", "Invoice template was not found.", 404);
  return definition;
}

export function validateTemplateConfiguration(
  definition: InvoiceTemplateDefinition,
  input: Partial<InvoiceTemplateConfiguration>
): InvoiceTemplateConfiguration {
  const configuration: InvoiceTemplateConfiguration = {
    ...definition.defaultConfiguration,
    ...input,
    logoAssetId: input.logoAssetId ?? definition.defaultConfiguration.logoAssetId,
    headerImageAssetId:
      input.headerImageAssetId ?? definition.defaultConfiguration.headerImageAssetId,
    visibleColumns: input.visibleColumns ?? definition.defaultConfiguration.visibleColumns,
    customerNotes: input.customerNotes ?? definition.defaultConfiguration.customerNotes,
    terms: input.terms ?? definition.defaultConfiguration.terms,
    paymentInstructions:
      input.paymentInstructions ?? definition.defaultConfiguration.paymentInstructions,
    footer: input.footer ?? definition.defaultConfiguration.footer,
    signatureBlock: input.signatureBlock ?? definition.defaultConfiguration.signatureBlock,
    customFields: input.customFields ?? definition.defaultConfiguration.customFields
  };
  if (!isHexColor(configuration.primaryColor) || !isHexColor(configuration.accentColor))
    throw new AppError(
      "INVOICE_TEMPLATE_COLOR_INVALID",
      "Template colours must be six-digit hex values.",
      422
    );
  if (contrastRatio(configuration.primaryColor, "#ffffff") < 4.5)
    throw new AppError(
      "INVOICE_TEMPLATE_CONTRAST_INVALID",
      "Primary colour does not meet accessible contrast.",
      422
    );
  const headerAlignment = configuration.headerAlignment as string;
  if (!new Set(["left", "center", "right"]).has(headerAlignment))
    throw new AppError(
      "INVOICE_TEMPLATE_ALIGNMENT_INVALID",
      "Header alignment is not supported.",
      422
    );
  if (
    !new Set(["system", "classic", "modern", "editorial", "technical"]).has(
      configuration.fontPairing
    )
  )
    throw new AppError(
      "INVOICE_TEMPLATE_FONT_INVALID",
      "The requested font pairing is not approved.",
      422
    );
  const fontSizes: readonly [keyof InvoiceTemplateConfiguration, number, number][] = [
    ["headingFontSize", 24, 42],
    ["bodyFontSize", 9, 14],
    ["tableFontSize", 8, 13],
    ["notesFontSize", 8, 13]
  ];
  for (const [key, minimum, maximum] of fontSizes) {
    const value = configuration[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum)
      throw new AppError(
        "INVOICE_TEMPLATE_TYPOGRAPHY_INVALID",
        "Invoice font sizes must remain within the supported print-safe range.",
        422
      );
  }
  if (!new Set(["none", "brand-wash", "image-watermark"]).has(configuration.backgroundTreatment))
    throw new AppError(
      "INVOICE_TEMPLATE_BACKGROUND_INVALID",
      "The requested invoice background treatment is not supported.",
      422
    );
  if (configuration.backgroundTreatment === "image-watermark" && !configuration.headerImageAssetId)
    throw new AppError(
      "INVOICE_TEMPLATE_BACKGROUND_IMAGE_REQUIRED",
      "Upload and select an invoice background image before choosing image watermark.",
      422
    );
  if (!new Set(["compact", "comfortable", "airy"]).has(configuration.spacing))
    throw new AppError(
      "INVOICE_TEMPLATE_SPACING_INVALID",
      "The requested spacing is not approved.",
      422
    );
  if (!new Set(["rules", "tinted", "minimal"]).has(configuration.detailStyle))
    throw new AppError(
      "INVOICE_TEMPLATE_DETAIL_STYLE_INVALID",
      "The requested detail style is not approved.",
      422
    );
  if (!new Set(["LETTER", "A4"]).has(configuration.pageSize))
    throw new AppError("INVOICE_TEMPLATE_PAGE_SIZE_INVALID", "Page size is not supported.", 422);
  const allowedColumns = new Set(["description", "quantity", "unitPrice", "tax", "total"]);
  if (
    configuration.visibleColumns.length === 0 ||
    configuration.visibleColumns.some((column) => !allowedColumns.has(column))
  )
    throw new AppError(
      "INVOICE_TEMPLATE_COLUMNS_INVALID",
      "Template columns are not supported.",
      422
    );
  if (
    configuration.customFields.length > 20 ||
    configuration.customFields.some(
      (field) =>
        field.label.trim().length === 0 || field.label.length > 80 || field.value.length > 500
    )
  )
    throw new AppError(
      "INVOICE_TEMPLATE_CUSTOM_FIELDS_INVALID",
      "Custom fields are invalid or exceed the supported limits.",
      422
    );
  return configuration;
}

export class InvoiceTemplateService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext) {
    await this.authorization.assert(context, "invoice-templates:read", "InvoiceTemplateConfig");
    const selected = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoiceTemplateConfig.findUnique({ where: { organizationId: context.organizationId } })
    );
    return {
      templates: listInvoiceTemplates(),
      selected: selected
        ? {
            key: selected.templateKey,
            version: selected.templateVersion,
            configuration: selected.configuration,
            recordVersion: selected.version
          }
        : null
    };
  }

  public async update(
    context: OrganizationContext,
    input: {
      readonly templateKey: string;
      readonly configuration: unknown;
      readonly version?: number | undefined;
    }
  ) {
    await this.authorization.assert(context, "invoice-templates:manage", "InvoiceTemplateConfig");
    const definition = getInvoiceTemplate(input.templateKey);
    const configuration = validateTemplateConfiguration(
      definition,
      input.configuration as Partial<InvoiceTemplateConfiguration>
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${context.organizationId}::uuid FOR UPDATE`;
      const existing = await tx.invoiceTemplateConfig.findUnique({
        where: { organizationId: context.organizationId }
      });
      if (existing && input.version !== existing.version)
        throw new AppError(
          "STALE_INVOICE_TEMPLATE",
          "Template settings changed by another request.",
          409
        );
      for (const assetId of [configuration.logoAssetId, configuration.headerImageAssetId]) {
        if (!assetId) continue;
        const asset = await tx.logoAsset.findFirst({
          where: { id: assetId, organizationId: context.organizationId, active: true }
        });
        if (!asset)
          throw new AppError(
            "INVOICE_TEMPLATE_ASSET_NOT_FOUND",
            "A selected invoice image is not available to this organization.",
            422
          );
      }
      const record = existing
        ? await tx.invoiceTemplateConfig.update({
            where: { id: existing.id },
            data: {
              templateKey: definition.key,
              templateVersion: 1,
              configuration: configuration as unknown as Prisma.InputJsonObject,
              updatedByUserId: context.user.id,
              version: { increment: 1 }
            }
          })
        : await tx.invoiceTemplateConfig.create({
            data: {
              organizationId: context.organizationId,
              templateKey: definition.key,
              templateVersion: 1,
              configuration: configuration as unknown as Prisma.InputJsonObject,
              updatedByUserId: context.user.id
            }
          });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "INVOICE_TEMPLATE_UPDATED",
          targetType: "InvoiceTemplateConfig",
          targetId: record.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            templateKey: record.templateKey,
            templateVersion: record.templateVersion
          })
        }
      });
      return {
        key: record.templateKey,
        version: record.templateVersion,
        configuration: record.configuration,
        recordVersion: record.version
      };
    });
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}
