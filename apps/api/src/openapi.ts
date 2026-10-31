export const publicApiVersion = "2026-08-03";

const capturePurchaseLineOpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["description", "quantity", "unitCostMinor", "accountId"],
  properties: {
    description: { type: "string", minLength: 1, maxLength: 500 },
    quantity: { type: "string", pattern: "^\\d+(?:\\.\\d{1,6})?$" },
    unitCostMinor: { type: "string", pattern: "^\\d+$" },
    discountMinor: { type: "string", pattern: "^\\d+$" },
    accountId: { type: "string", format: "uuid" },
    productItemId: { type: ["string", "null"], format: "uuid" },
    taxCodeId: { type: ["string", "null"], format: "uuid" }
  }
} as const;

const captureReviewConversionOpenApiSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["target", "version", "bill"],
      properties: {
        target: { const: "BILL" },
        version: { type: "integer", minimum: 1 },
        bill: {
          type: "object",
          additionalProperties: false,
          required: ["vendorId", "vendorInvoiceNumber", "issueDate", "lines"],
          properties: {
            vendorId: { type: "string", format: "uuid" },
            vendorInvoiceNumber: { type: "string", minLength: 1, maxLength: 128 },
            issueDate: { type: "string", format: "date" },
            dueDate: { type: "string", format: "date" },
            paymentTermsDays: { type: "integer", minimum: 0, maximum: 3650 },
            currency: { type: "string", pattern: "^[A-Z]{3}$", default: "CAD" },
            fxRateSnapshotId: { type: "string", format: "uuid" },
            internalNotes: { type: ["string", "null"], maxLength: 10_000 },
            lines: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: capturePurchaseLineOpenApiSchema
            }
          }
        }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["target", "version", "expense"],
      properties: {
        target: { const: "IMMEDIATE_EXPENSE" },
        version: { type: "integer", minimum: 1 },
        expense: {
          type: "object",
          additionalProperties: false,
          required: ["expenseDate", "method", "payingAccountId", "lines"],
          properties: {
            vendorId: { type: ["string", "null"], format: "uuid" },
            reference: { type: ["string", "null"], maxLength: 128 },
            expenseDate: { type: "string", format: "date" },
            method: {
              type: "string",
              enum: ["CASH", "CHEQUE", "ELECTRONIC_TRANSFER", "CREDIT_CARD", "OWNER_PAID", "OTHER"]
            },
            payingAccountId: { type: "string", format: "uuid" },
            internalNotes: { type: ["string", "null"], maxLength: 10_000 },
            lines: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: capturePurchaseLineOpenApiSchema
            }
          }
        }
      }
    }
  ]
} as const;

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "PennyWise Accounting Public API",
      version: publicApiVersion,
      description:
        "Versioned v1 contract for supported third-party integrations. See docs/DEVELOPER_API_V1.md for compatibility, scope, pagination, and idempotency rules."
    },
    servers: [{ url: "http://localhost:3001" }],
    paths: {
      "/health": {
        get: { summary: "Return process liveness", tags: ["Operations"] }
      },
      "/v1/auth/sign-in": {
        get: { summary: "Start OIDC sign-in", tags: ["Identity"] }
      },
      "/v1/auth/callback": {
        get: { summary: "Complete OIDC sign-in", tags: ["Identity"] }
      },
      "/v1/auth/reauthenticate": {
        get: { summary: "Start sensitive-action reauthentication", tags: ["Identity"] }
      },
      "/v1/auth/recover": {
        get: { summary: "Start provider-backed account recovery", tags: ["Identity"] }
      },
      "/v1/auth/session": {
        get: { summary: "Return the current session identity", tags: ["Identity"] }
      },
      "/v1/auth/session/renew": {
        post: { summary: "Rotate and renew the current session", tags: ["Identity"] }
      },
      "/v1/auth/sessions": {
        get: { summary: "List the current user's sessions", tags: ["Identity"] }
      },
      "/v1/auth/sessions/{sessionId}/revoke": {
        post: { summary: "Revoke one of the current user's sessions", tags: ["Identity"] }
      },
      "/v1/auth/sign-out": {
        post: { summary: "Revoke the current session", tags: ["Identity"] }
      },
      "/v1/organizations": {
        post: {
          summary: "Create an organization and owner membership",
          tags: ["Organizations"]
        },
        get: { summary: "List active organization memberships", tags: ["Organizations"] }
      },
      "/v1/demo-company/capabilities": {
        get: {
          summary: "Return gated fictional demo-company availability",
          tags: ["Organizations"]
        }
      },
      "/v1/demo-company": {
        post: {
          summary: "Create or resume one fully seeded fictional demo company",
          tags: ["Organizations"],
          "x-non-production-only": true
        }
      },
      "/v1/organizations/switch": {
        post: {
          summary: "Select an organization through active membership",
          tags: ["Organizations"]
        }
      },
      "/v1/organizations/current": {
        get: {
          summary: "Return the organization selected by authenticated membership",
          tags: ["Organizations"]
        }
      },
      "/v1/organizations/current/api-credentials": {
        get: {
          summary: "List organization API credentials without secrets",
          tags: ["Integrations"]
        },
        post: { summary: "Create a scoped organization API credential", tags: ["Integrations"] }
      },
      "/v1/organizations/current/api-credentials/{apiCredentialId}/revoke": {
        post: { summary: "Revoke an organization API credential", tags: ["Integrations"] }
      },
      "/v1/organizations/current/api-credentials/{apiCredentialId}/rotate": {
        post: { summary: "Rotate an organization API credential", tags: ["Integrations"] }
      },
      "/v1/organizations/current/oauth-clients": {
        get: { summary: "List OAuth client installations without secrets", tags: ["Integrations"] },
        post: { summary: "Create an OAuth client installation", tags: ["Integrations"] }
      },
      "/v1/organizations/current/oauth-clients/{oauthClientId}/revoke": {
        post: { summary: "Revoke an OAuth client and its issued tokens", tags: ["Integrations"] }
      },
      "/v1/organizations/current/oauth-clients/{oauthClientId}/rotate": {
        post: { summary: "Rotate an OAuth client secret", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors": {
        get: { summary: "List approved connector installations", tags: ["Integrations"] },
        post: { summary: "Create a connector installation draft", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/providers": {
        get: {
          summary: "List native connector capabilities and external gates",
          tags: ["Integrations"]
        }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/mapping": {
        patch: { summary: "Update versioned commerce mappings", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/sync": {
        post: {
          summary: "Run a bounded non-posting commerce synchronization",
          tags: ["Integrations"]
        }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/catalog/poll": {
        post: {
          summary: "Poll a bounded resumable provider catalog without posting accounting",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/catalog/ingest": {
        post: {
          summary: "Ingest one validated external catalog product and its variants",
          description:
            "Normalizes every provider into the source-neutral catalog boundary. Variant identifiers and name plus the parent product description become reviewer evidence; ingestion never ranks in adapter code, confirms a mapping, or posts accounting.",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog": {
        get: {
          summary: "List organization-scoped external products, variants, images, and mappings",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/variants/{catalogVariantId}/candidates": {
        get: {
          summary: "List versioned ranked mapping candidates",
          description:
            "Returns persisted reason objects unchanged. Consumers must support historical version 1 explanations and version 2 field-level basis-point evidence.",
          tags: ["Catalog automation"]
        },
        post: {
          summary: "Generate ranked candidates; fuzzy evidence never confirms a mapping",
          description:
            "Uses one source-neutral, tenant-bounded matcher for WooCommerce, Etsy, demo, spreadsheet, and future adapters. Only unresolved suggestions may receive a new version 2 reason; confirmed or rejected history is not rewritten, and every result remains reviewer-only.",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/candidates/{candidateId}/confirm": {
        post: {
          summary: "Explicitly confirm a versioned catalog mapping",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/candidates/{candidateId}/reject": {
        post: {
          summary: "Explicitly reject a versioned catalog mapping",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/variants/{catalogVariantId}/create-local-product": {
        post: {
          summary: "Explicitly create a local product through the product domain service",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/bulk-create-local-products": {
        post: {
          summary:
            "Create selected channel products as local inventory items without posting stock or accounting entries",
          description:
            "Creates only user-selected item definitions. It may attach an already-ingested source image and can confirm only the exact source-to-new-item mappings explicitly requested by the user; it never fuzzy-confirms a mapping or creates quantity movements.",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/images/{imageId}/approve": {
        post: {
          summary: "Approve an image reference after connector-host and public-network validation",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/images/{imageId}/reject": {
        post: {
          summary: "Reject a versioned catalog image reference",
          tags: ["Catalog automation"]
        }
      },
      "/v1/organizations/current/catalog/images/{imageId}/ingest": {
        post: {
          summary: "Inspect approved image bytes under type, size, redirect, and pixel limits",
          tags: ["Catalog automation"]
        }
      },
      "/v1/products/{productId}/image": {
        get: {
          summary: "Read the tenant-owned product thumbnail",
          tags: ["Inventory"]
        },
        post: {
          summary: "Upload a bounded product image and store only its print thumbnail",
          tags: ["Inventory"]
        }
      },
      "/v1/organizations/current/inventory-sync": {
        get: {
          summary: "List exact inventory policies, observations, pending operations, and conflicts",
          tags: ["Inventory automation"]
        }
      },
      "/v1/organizations/current/inventory-sync/policies": {
        put: {
          summary: "Create or version-update an explicit inventory source-of-truth policy",
          tags: ["Inventory automation"]
        }
      },
      "/v1/organizations/current/inventory-sync/policies/{policyId}/observations": {
        post: {
          summary: "Record an idempotent exact provider inventory observation",
          tags: ["Inventory automation"]
        }
      },
      "/v1/organizations/current/inventory-sync/conflicts/{conflictId}/resolve": {
        post: {
          summary: "Ignore, push local stock, or adopt channel stock through InventoryService",
          tags: ["Inventory automation"]
        }
      },
      "/v1/organizations/current/inventory-sync/operations/{operationId}/retry": {
        post: {
          summary: "Retry a failed durable provider stock operation",
          tags: ["Inventory automation"]
        }
      },
      "/v1/organizations/current/inventory-sync/operations/process": {
        post: {
          summary: "Process bounded durable provider stock operations with idempotent writes",
          tags: ["Inventory automation"]
        }
      },
      "/v1/inventory/capabilities": {
        get: {
          summary: "Describe inventory barcode, label, costing, and assembly capability boundaries",
          tags: ["Inventory"]
        }
      },
      "/v1/inventory/barcodes": {
        get: { summary: "List active tenant-scoped product barcode aliases", tags: ["Inventory"] },
        post: { summary: "Register a collision-safe product barcode alias", tags: ["Inventory"] }
      },
      "/v1/inventory/barcodes/{barcodeId}/deactivate": {
        post: { summary: "Deactivate a product barcode alias", tags: ["Inventory"] }
      },
      "/v1/inventory/scans/resolve": {
        post: { summary: "Resolve a manual, hardware, or camera scan payload", tags: ["Inventory"] }
      },
      "/v1/inventory/label-templates": {
        get: { summary: "List active inventory label templates", tags: ["Inventory"] },
        post: {
          summary: "Create a versioned preview-only inventory label template",
          tags: ["Inventory"]
        }
      },
      "/v1/inventory/label-templates/{templateId}/preview": {
        post: {
          summary: "Render deterministic label elements without printer side effects",
          tags: ["Inventory"]
        }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/pause": {
        post: { summary: "Pause connector synchronization", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/resume": {
        post: { summary: "Resume connector synchronization", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/disconnect": {
        post: {
          summary: "Remove connector credentials while retaining evidence",
          tags: ["Integrations"]
        }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/webhooks/register": {
        post: { summary: "Register supported provider webhooks", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/webhook-secret": {
        put: {
          summary: "Store or rotate an encrypted provider webhook signing secret",
          tags: ["Integrations"]
        }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/etsy/oauth/start": {
        post: { summary: "Start Etsy OAuth with S256 PKCE", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/etsy/oauth/complete": {
        post: { summary: "Complete Etsy OAuth and validate the shop", tags: ["Integrations"] }
      },
      "/v1/webhooks/commerce/{providerKey}/{connectorInstallationId}": {
        post: { summary: "Receive and verify a native commerce webhook", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/connect": {
        post: { summary: "Store consented connector credentials", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/health": {
        post: { summary: "Run a redacted connector health check", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/conflicts": {
        get: { summary: "List connector conflicts requiring review", tags: ["Integrations"] }
      },
      "/v1/organizations/current/connectors/{connectorInstallationId}/conflicts/{connectorConflictId}/resolve":
        {
          post: { summary: "Resolve a connector conflict", tags: ["Integrations"] }
        },
      "/v1/organizations/current/connectors/{connectorInstallationId}/logs": {
        get: { summary: "List redacted connector operational logs", tags: ["Integrations"] }
      },
      "/v1/oauth/authorize": {
        post: {
          summary: "Grant organization consent and issue a PKCE authorization code",
          tags: ["OAuth"]
        }
      },
      "/v1/oauth/token": {
        post: {
          summary: "Exchange an OAuth authorization code or rotate a refresh token",
          tags: ["OAuth"]
        }
      },
      "/v1/organizations/current/webhooks": {
        get: { summary: "List signed outbound webhook endpoints", tags: ["Integrations"] },
        post: { summary: "Create a signed outbound webhook endpoint", tags: ["Integrations"] }
      },
      "/v1/organizations/current/webhooks/dispatch": {
        post: { summary: "Fan out and deliver pending outbound webhooks", tags: ["Integrations"] }
      },
      "/v1/organizations/current/automations": {
        get: { summary: "List background automation status and recent runs", tags: ["Automations"] }
      },
      "/v1/organizations/current/automations/{jobName}/run": {
        post: { summary: "Run one available automation now", tags: ["Automations"] }
      },
      "/v1/organizations/current/automations/{jobName}": {
        patch: { summary: "Pause or resume one organization automation", tags: ["Automations"] }
      },
      "/v1/organizations/current/webhooks/{webhookEndpointId}/rotate": {
        post: { summary: "Rotate a webhook endpoint secret", tags: ["Integrations"] }
      },
      "/v1/organizations/current/webhooks/{webhookEndpointId}/disable": {
        post: { summary: "Disable a webhook endpoint", tags: ["Integrations"] }
      },
      "/v1/organizations/current/webhooks/{webhookEndpointId}/enable": {
        post: { summary: "Re-enable a webhook endpoint", tags: ["Integrations"] }
      },
      "/v1/organizations/current/webhooks/{webhookEndpointId}/deliveries": {
        get: { summary: "Inspect webhook delivery attempts", tags: ["Integrations"] }
      },
      "/v1/organizations/current/webhooks/{webhookEndpointId}/deliveries/{webhookDeliveryId}/replay":
        {
          post: { summary: "Replay a failed webhook delivery", tags: ["Integrations"] }
        },
      "/v1/organizations/current/members": {
        get: { summary: "List organization memberships", tags: ["Memberships"] }
      },
      "/v1/organizations/current/invitations": {
        post: { summary: "Create a single-use email-bound invitation", tags: ["Memberships"] }
      },
      "/v1/invitations/accept": {
        post: {
          summary: "Accept an invitation as the verified intended user",
          tags: ["Memberships"]
        }
      },
      "/v1/organizations/current/members/{membershipId}/role": {
        patch: { summary: "Change an authorized membership role", tags: ["Memberships"] }
      },
      "/v1/organizations/current/members/{membershipId}/revoke": {
        post: { summary: "Revoke an organization membership", tags: ["Memberships"] }
      },
      "/v1/accounts": {
        get: { summary: "List organization-scoped accounts", tags: ["Accounts"] },
        post: { summary: "Create an account", tags: ["Accounts"] }
      },
      "/v1/accounts/{accountId}": {
        patch: { summary: "Update non-financial account metadata", tags: ["Accounts"] }
      },
      "/v1/accounts/{accountId}/archive": {
        post: { summary: "Archive an account for future posting", tags: ["Accounts"] }
      },
      "/v1/fiscal-periods": {
        get: { summary: "List fiscal periods", tags: ["Fiscal periods"] },
        post: { summary: "Create a fiscal period", tags: ["Fiscal periods"] }
      },
      "/v1/fiscal-periods/{periodId}/close": {
        post: { summary: "Close a fiscal period", tags: ["Fiscal periods"] }
      },
      "/v1/fiscal-periods/{periodId}/reopen": {
        post: { summary: "Reopen a fiscal period with a reason", tags: ["Fiscal periods"] }
      },
      "/v1/journals": {
        get: { summary: "List posted journals", tags: ["Journals"] },
        post: { summary: "Post a balanced journal", tags: ["Journals"] }
      },
      "/v1/journals/{journalId}": {
        get: { summary: "Get one organization-scoped journal", tags: ["Journals"] }
      },
      "/v1/journals/{journalId}/reverse": {
        post: { summary: "Create an inverse reversal journal", tags: ["Journals"] }
      },
      "/v1/accountant/manual-journals": {
        get: {
          summary: "List editable non-posting journal workpapers",
          tags: ["Accountant workpapers"]
        },
        post: {
          summary: "Create a balanced non-posting journal workpaper",
          tags: ["Accountant workpapers"]
        }
      },
      "/v1/accountant/manual-journals/{draftId}": {
        patch: {
          summary: "Replace an unchanged non-posting journal workpaper",
          description:
            "Requires the current workpaper version and replaces the complete balanced draft atomically. No journal or journal line is created.",
          tags: ["Accountant workpapers"]
        },
        put: {
          summary: "Replace an unchanged non-posting journal workpaper",
          description:
            "Requires the current workpaper version and replaces the complete balanced draft atomically. No journal or journal line is created.",
          tags: ["Accountant workpapers"]
        }
      },
      "/v1/accountant/manual-journals/{draftId}/cancel": {
        post: {
          summary: "Cancel and retain a non-posting journal workpaper",
          description:
            "Cancellation preserves the workpaper and its audit evidence without creating an accounting entry.",
          tags: ["Accountant workpapers"]
        }
      },
      "/v1/accountant/manual-journals/{draftId}/post": {
        post: {
          summary: "Post a reviewed workpaper as one authoritative journal",
          description:
            "Posting is the explicit boundary that creates immutable journal and journal-line records.",
          tags: ["Accountant workpapers"]
        }
      },
      "/v1/reports/trial-balance": {
        get: { summary: "Return the trial balance from posted ledger lines", tags: ["Reports"] }
      },
      "/v1/reports/general-ledger": {
        get: { summary: "Return posted general-ledger detail", tags: ["Reports"] }
      },
      "/v1/setup": {
        get: { summary: "Return resumable organization setup state", tags: ["Company setup"] }
      },
      "/v1/settings/workflow-preferences": {
        get: {
          summary: "Return versioned workflow preferences and immutable safety controls",
          tags: ["Company setup"]
        },
        put: {
          summary: "Update workflow visibility preferences with optimistic concurrency",
          tags: ["Company setup"]
        }
      },
      "/v1/settings/multi-currency": {
        get: {
          summary: "Return tenant multi-currency settings and rate snapshots",
          tags: ["Company setup"]
        },
        put: {
          summary: "Prepare currency settings while foreign posting remains disabled",
          tags: ["Company setup"]
        }
      },
      "/v1/settings/multi-currency/rates": {
        post: { summary: "Create an immutable exact FX rate snapshot", tags: ["Company setup"] }
      },
      "/v1/settings/multi-currency/rate-suggestion": {
        get: {
          summary: "Preview an indicative Bank of Canada USD/CAD observation without saving it",
          description:
            "For a CAD-base organization, returns the latest published FXUSDCAD observation on or before the requested date from a fixed seven-day Bank of Canada Valet lookup. The response is a non-posting suggestion and never creates a rate snapshot or accounting entry.",
          tags: ["Company setup"],
          parameters: [
            {
              name: "date",
              in: "query",
              required: true,
              schema: { type: "string", format: "date" }
            },
            {
              name: "transactionCurrency",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["USD"] }
            }
          ]
        }
      },
      "/v1/organizations/current/commerce/inbox": {
        get: { summary: "List non-posting commerce inbox events", tags: ["Integrations"] },
        post: {
          summary: "Stage a provider-neutral commerce event for review",
          tags: ["Integrations"]
        }
      },
      "/v1/organizations/current/commerce/inbox/{eventId}/review": {
        post: { summary: "Review or normalize a staged commerce event", tags: ["Integrations"] }
      },
      "/v1/accounting/fx-revaluation/preview": {
        post: { summary: "Return the reviewed revaluation release gate", tags: ["Accounting"] }
      },
      "/v1/accounting/fx-revaluation/post": {
        post: {
          summary: "Return the reviewed revaluation release gate",
          tags: ["Accounting"]
        }
      },
      "/v1/setup/profile": {
        patch: {
          summary: "Update versioned organization profile and fiscal settings",
          tags: ["Company setup"]
        }
      },
      "/v1/setup/fiscal-year/initialize": {
        post: { summary: "Initialize the first fiscal year", tags: ["Company setup"] }
      },
      "/v1/setup/presets/{presetKey}": {
        get: { summary: "Preview a versioned account preset", tags: ["Company setup"] }
      },
      "/v1/setup/presets/{presetKey}/apply": {
        post: { summary: "Idempotently apply an account preset", tags: ["Company setup"] }
      },
      "/v1/setup/tax-registrations": {
        put: { summary: "Save a versioned tax registration", tags: ["Company setup"] }
      },
      "/v1/setup/tax-codes/versions": {
        post: {
          summary: "Create an immutable effective-dated tax-code version",
          tags: ["Company setup"]
        }
      },
      "/v1/setup/opening-balances": {
        get: { summary: "Return the latest opening-balance workflow", tags: ["Company setup"] },
        put: { summary: "Validate and save an opening-balance draft", tags: ["Company setup"] }
      },
      "/v1/setup/opening-balances/{draftId}/post": {
        post: { summary: "Post opening balances through the ledger", tags: ["Company setup"] }
      },
      "/v1/setup/defaults": {
        put: { summary: "Update versioned document defaults", tags: ["Company setup"] }
      },
      "/v1/setup/logo": {
        post: { summary: "Validate and replace an organization logo", tags: ["Company setup"] }
      },
      "/v1/setup/logo/{logoId}/content": {
        get: { summary: "Read an authorized organization logo", tags: ["Company setup"] }
      },
      "/v1/setup/steps/{step}": {
        patch: { summary: "Advance or explicitly skip a setup step", tags: ["Company setup"] }
      },
      "/v1/setup/complete": {
        post: { summary: "Complete validated company setup", tags: ["Company setup"] }
      },
      "/v1/customers": {
        get: { summary: "List organization customers", tags: ["Sales"] },
        post: { summary: "Create a customer", tags: ["Sales"] }
      },
      "/v1/customers/reports/address-review": {
        get: {
          summary: "List customer addresses requiring legacy-value review",
          tags: ["Sales"]
        }
      },
      "/v1/customers/{customerId}": {
        get: { summary: "Get a customer", tags: ["Sales"] },
        patch: { summary: "Update a customer with a version check", tags: ["Sales"] }
      },
      "/v1/customers/{customerId}/archive": {
        post: { summary: "Archive a customer without deleting history", tags: ["Sales"] }
      },
      "/v1/products": {
        get: { summary: "List products and services", tags: ["Sales"] },
        post: { summary: "Create a product or service", tags: ["Sales"] }
      },
      "/v1/inventory/reports/customs-readiness": {
        get: {
          summary: "List active products missing operator-supplied customs references",
          tags: ["Inventory"]
        }
      },
      "/v1/products/{productId}": {
        get: { summary: "Get a product or service", tags: ["Sales"] },
        patch: { summary: "Update a product or service with a version check", tags: ["Sales"] }
      },
      "/v1/products/{productId}/archive": {
        post: { summary: "Archive a product or service", tags: ["Sales"] }
      },
      "/v1/estimates": {
        get: { summary: "List organization estimates", tags: ["Sales automation"] },
        post: { summary: "Create a non-posting estimate draft", tags: ["Sales automation"] }
      },
      "/v1/estimates/{estimateId}": {
        get: {
          summary: "Get an estimate with immutable commercial snapshots",
          tags: ["Sales automation"]
        },
        patch: {
          summary: "Update an editable estimate with a version check",
          tags: ["Sales automation"]
        }
      },
      "/v1/estimates/{estimateId}/send": {
        post: { summary: "Mark an estimate sent", tags: ["Sales automation"] }
      },
      "/v1/estimates/{estimateId}/accept": {
        post: { summary: "Accept an estimate with a version check", tags: ["Sales automation"] }
      },
      "/v1/estimates/{estimateId}/decline": {
        post: { summary: "Decline an estimate with a reason", tags: ["Sales automation"] }
      },
      "/v1/estimates/{estimateId}/cancel": {
        post: { summary: "Cancel an estimate", tags: ["Sales automation"] }
      },
      "/v1/estimates/{estimateId}/convert": {
        post: {
          summary: "Idempotently convert an accepted estimate into a draft invoice",
          tags: ["Sales automation"]
        }
      },
      "/v1/recurring-schedules": {
        get: { summary: "List recurring schedules", tags: ["Sales automation"] },
        post: { summary: "Create a draft-first recurring schedule", tags: ["Sales automation"] }
      },
      "/v1/recurring-schedules/{scheduleId}": {
        patch: {
          summary: "Update a recurring schedule with a version check",
          tags: ["Sales automation"]
        }
      },
      "/v1/recurring-schedules/{scheduleId}/pause": {
        post: { summary: "Pause a recurring schedule", tags: ["Sales automation"] }
      },
      "/v1/recurring-schedules/{scheduleId}/resume": {
        post: { summary: "Resume a recurring schedule", tags: ["Sales automation"] }
      },
      "/v1/recurring-schedules/{scheduleId}/end": {
        post: { summary: "End a recurring schedule", tags: ["Sales automation"] }
      },
      "/v1/projects": {
        get: { summary: "List customer projects", tags: ["Projects"] },
        post: { summary: "Create a customer project", tags: ["Projects"] }
      },
      "/v1/projects/{projectId}": {
        get: { summary: "Get a project and its field activity", tags: ["Projects"] },
        patch: { summary: "Update a project with a version check", tags: ["Projects"] }
      },
      "/v1/projects/{projectId}/hold": {
        post: { summary: "Place a project on hold", tags: ["Projects"] }
      },
      "/v1/projects/{projectId}/resume": {
        post: { summary: "Resume a project", tags: ["Projects"] }
      },
      "/v1/projects/{projectId}/complete": {
        post: { summary: "Complete a project", tags: ["Projects"] }
      },
      "/v1/projects/{projectId}/archive": {
        post: { summary: "Archive a project", tags: ["Projects"] }
      },
      "/v1/customers/{customerId}/contacts": {
        get: {
          summary: "List active and archived customer contacts",
          tags: ["Customers", "CRM"]
        },
        post: {
          summary: "Create a tenant-scoped customer contact",
          tags: ["Customers", "CRM"]
        }
      },
      "/v1/customer-contacts/{contactId}": {
        patch: {
          summary: "Update an unchanged customer contact",
          tags: ["Customers", "CRM"]
        }
      },
      "/v1/customer-contacts/{contactId}/archive": {
        post: {
          summary: "Archive a customer contact without deleting history",
          tags: ["Customers", "CRM"]
        }
      },
      "/v1/customers/{customerId}/activities": {
        post: {
          summary: "Record append-only customer activity",
          description:
            "Records a tenant-scoped note, call, email, meeting, or follow-up. CRM activity is auditable and does not create accounting entries.",
          tags: ["Customers", "CRM"]
        }
      },
      "/v1/customers/{customerId}/timeline": {
        get: {
          summary: "Read the customer activity and planning timeline",
          tags: ["Customers", "CRM", "Planning"]
        }
      },
      "/v1/project-work-items": {
        get: {
          summary: "List bounded, non-posting project tasks, milestones, and reminders",
          tags: ["Projects", "Planning"]
        },
        post: {
          summary: "Create a non-posting project work item",
          tags: ["Projects", "Planning"]
        }
      },
      "/v1/project-work-items/{workItemId}": {
        get: {
          summary: "Get a project work item with dependency evidence",
          tags: ["Projects", "Planning"]
        },
        patch: {
          summary: "Update an unchanged project work item",
          description:
            "Requires the current version. This changes a planning source record only and never creates a journal, invoice, bill, or inventory movement.",
          tags: ["Projects", "Planning"]
        }
      },
      "/v1/project-work-items/{workItemId}/status": {
        post: {
          summary: "Change a project work-item status with a version check",
          tags: ["Projects", "Planning"]
        }
      },
      "/v1/project-work-items/{workItemId}/archive": {
        post: {
          summary: "Archive an unchanged project work item",
          tags: ["Projects", "Planning"]
        }
      },
      "/v1/project-work-items/{workItemId}/dependencies": {
        post: {
          summary: "Add an acyclic in-organization work-item dependency",
          tags: ["Projects", "Planning"]
        }
      },
      "/v1/project-work-items/{workItemId}/dependencies/{dependsOnItemId}": {
        delete: {
          summary: "Remove an unchanged work-item dependency",
          tags: ["Projects", "Planning"]
        }
      },
      "/v1/time-entries": {
        get: { summary: "List organization time entries", tags: ["Projects"] }
      },
      "/v1/projects/{projectId}/time-entries": {
        post: { summary: "Create a billable or non-billable time entry", tags: ["Projects"] }
      },
      "/v1/calendar/events": {
        get: {
          summary: "List read-only project, work-item, invoice, and bill calendar events",
          tags: ["Planning"]
        }
      },
      "/v1/time-entries/{timeEntryId}/approve": {
        post: { summary: "Approve a time entry", tags: ["Projects"] }
      },
      "/v1/mileage": {
        post: { summary: "Record mileage as a non-posting draft", tags: ["Projects"] }
      },
      "/v1/capture-reviews": {
        get: {
          summary: "List organization capture reviews",
          description:
            "Lists tenant-owned evidence with optional review-state, type, and draft-link filters. Filtering never changes source evidence or creates accounting entries.",
          tags: ["Projects"],
          parameters: [
            {
              name: "projectId",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" }
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["RECEIVED", "REVIEW_REQUIRED", "APPROVED", "REJECTED"]
              }
            },
            {
              name: "kind",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["RECEIPT", "BILL"] }
            },
            {
              name: "conversion",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["LINKED", "UNLINKED"] }
            }
          ]
        },
        post: { summary: "Create a human-review capture record", tags: ["Projects"] }
      },
      "/v1/capture-reviews/upload": {
        post: { summary: "Upload a scanned receipt or bill for review", tags: ["Projects"] }
      },
      "/v1/capture-reviews/{captureReviewId}/content": {
        get: { summary: "Download a tenant-scoped capture file", tags: ["Projects"] }
      },
      "/v1/capture-reviews/{captureReviewId}/review": {
        post: { summary: "Review an OCR/capture suggestion", tags: ["Projects"] }
      },
      "/v1/capture-reviews/{captureReviewId}/process": {
        post: {
          summary: "Reprocess retained capture evidence locally",
          description:
            "Re-runs the pinned local text and quality extraction against the immutable tenant-scoped source. Optimistic versioning and audit evidence protect retries; this operation never posts accounting entries.",
          tags: ["Projects"]
        }
      },
      "/v1/capture-reviews/{captureReviewId}/convert": {
        post: {
          summary: "Convert approved evidence to exactly one purchase draft",
          description:
            "Provider-independent conversion of APPROVED, CLEAN evidence. BILL evidence creates one DRAFT Bill; RECEIPT evidence creates one typed immediate-expense draft. The original capture remains linked, optimistic versioning and Idempotency-Key prevent duplicates, and this operation never posts accounting entries.",
          tags: ["Projects", "Purchasing"],
          parameters: [
            {
              name: "captureReviewId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" }
            },
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: captureReviewConversionOpenApiSchema }
            }
          },
          responses: {
            "201": { description: "A single linked non-posting purchase draft was created" },
            "400": { description: "Idempotency-Key is missing" },
            "404": { description: "Capture review was not found in the active organization" },
            "409": {
              description: "Capture state/version conflict or capture was already converted"
            },
            "422": { description: "Target does not match the capture kind or input is invalid" }
          }
        }
      },
      "/v1/immediate-expense-drafts/{immediateExpenseDraftId}": {
        get: {
          summary: "Read a tenant-scoped non-posting immediate-expense draft",
          description:
            "Returns the immutable capture conversion link and evidence reference. The draft has no journal and has not posted accounting entries.",
          tags: ["Purchasing"],
          parameters: [
            {
              name: "immediateExpenseDraftId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" }
            }
          ],
          responses: {
            "200": { description: "Immediate-expense draft with capture evidence link" },
            "404": { description: "Draft was not found in the active organization" }
          }
        }
      },
      "/v1/budgets": {
        get: { summary: "List versioned budget plans", tags: ["Planning"] },
        post: { summary: "Create a non-posting budget draft", tags: ["Planning"] }
      },
      "/v1/budgets/{budgetPlanId}": {
        get: { summary: "Read budget-versus-actual detail", tags: ["Planning"] },
        put: { summary: "Replace a versioned budget draft", tags: ["Planning"] }
      },
      "/v1/budgets/{budgetPlanId}/activate": {
        post: { summary: "Activate a budget draft", tags: ["Planning"] }
      },
      "/v1/budgets/{budgetPlanId}/archive": {
        post: { summary: "Archive a budget", tags: ["Planning"] }
      },
      "/v1/cash-forecast": {
        get: { summary: "Build a source-labelled 13-week cash forecast", tags: ["Planning"] }
      },
      "/v1/cash-forecast/assumptions": {
        get: { summary: "List manual forecast assumptions", tags: ["Planning"] },
        post: { summary: "Create a versioned manual forecast assumption", tags: ["Planning"] }
      },
      "/v1/cash-forecast/assumptions/{assumptionId}": {
        delete: { summary: "Delete an unchanged forecast assumption", tags: ["Planning"] }
      },
      "/v1/purchase-requests": {
        get: { summary: "List non-posting purchase requests", tags: ["Purchasing"] },
        post: { summary: "Create a purchase request draft", tags: ["Purchasing"] }
      },
      "/v1/purchase-requests/{purchaseRequestId}": {
        get: { summary: "Read purchase request detail", tags: ["Purchasing"] },
        put: { summary: "Replace a purchase request draft", tags: ["Purchasing"] }
      },
      "/v1/purchase-requests/{purchaseRequestId}/submit": {
        post: { summary: "Submit a purchase request for approval", tags: ["Purchasing"] }
      },
      "/v1/purchase-requests/{purchaseRequestId}/approve": {
        post: { summary: "Approve a submitted purchase request", tags: ["Purchasing"] }
      },
      "/v1/purchase-requests/{purchaseRequestId}/reject": {
        post: { summary: "Reject a submitted purchase request", tags: ["Purchasing"] }
      },
      "/v1/purchase-requests/{purchaseRequestId}/cancel": {
        post: { summary: "Cancel a purchase request", tags: ["Purchasing"] }
      },
      "/v1/customer-deposit-requests": {
        get: {
          summary: "List explicitly classified, non-posting customer deposit requests",
          tags: ["Sales automation"]
        },
        post: {
          summary: "Create a non-posting refundable-deposit or advance-payment request",
          tags: ["Sales automation"]
        }
      },
      "/v1/customer-deposit-requests/{depositRequestId}": {
        get: { summary: "Read a customer deposit request", tags: ["Sales automation"] },
        put: {
          summary: "Replace an unchanged customer deposit request draft",
          tags: ["Sales automation"]
        }
      },
      "/v1/customer-deposit-requests/{depositRequestId}/submit": {
        post: { summary: "Submit a deposit request for review", tags: ["Sales automation"] }
      },
      "/v1/customer-deposit-requests/{depositRequestId}/approve": {
        post: {
          summary: "Approve request details without recording money or tax",
          tags: ["Sales automation"]
        }
      },
      "/v1/customer-deposit-requests/{depositRequestId}/reject": {
        post: { summary: "Reject a deposit request with a reason", tags: ["Sales automation"] }
      },
      "/v1/customer-deposit-requests/{depositRequestId}/revise": {
        post: { summary: "Return a reviewed deposit request to draft", tags: ["Sales automation"] }
      },
      "/v1/customer-deposit-requests/{depositRequestId}/cancel": {
        post: { summary: "Cancel a deposit request with a reason", tags: ["Sales automation"] }
      },
      "/v1/estimates/{estimateId}/progress-billing-plans": {
        post: {
          summary: "Create a non-posting progress plan from an accepted estimate",
          tags: ["Sales automation"]
        }
      },
      "/v1/progress-billing-plans": {
        get: { summary: "List non-posting progress-billing plans", tags: ["Sales automation"] }
      },
      "/v1/progress-billing-plans/{progressBillingPlanId}": {
        get: {
          summary: "Read deterministic milestone and line allocations",
          tags: ["Sales automation"]
        },
        put: {
          summary: "Replace an unchanged progress-billing plan draft",
          tags: ["Sales automation"]
        }
      },
      "/v1/progress-billing-plans/{progressBillingPlanId}/submit": {
        post: {
          summary: "Submit a plan after rechecking its accepted estimate snapshot",
          tags: ["Sales automation"]
        }
      },
      "/v1/progress-billing-plans/{progressBillingPlanId}/approve": {
        post: {
          summary: "Approve plan details without generating or posting invoices",
          tags: ["Sales automation"]
        }
      },
      "/v1/progress-billing-plans/{progressBillingPlanId}/reject": {
        post: {
          summary: "Reject a progress-billing plan with a reason",
          tags: ["Sales automation"]
        }
      },
      "/v1/progress-billing-plans/{progressBillingPlanId}/revise": {
        post: {
          summary: "Return a reviewed progress-billing plan to draft",
          tags: ["Sales automation"]
        }
      },
      "/v1/progress-billing-plans/{progressBillingPlanId}/cancel": {
        post: {
          summary: "Cancel a progress-billing plan with a reason",
          tags: ["Sales automation"]
        }
      },
      "/v1/fixed-asset-classes": {
        get: { summary: "List fixed-asset classes and copied defaults", tags: ["Fixed assets"] },
        post: { summary: "Create a non-posting fixed-asset class", tags: ["Fixed assets"] }
      },
      "/v1/fixed-asset-classes/{fixedAssetClassId}": {
        get: { summary: "Read fixed-asset class defaults", tags: ["Fixed assets"] },
        put: {
          summary: "Replace an active fixed-asset class with a version check",
          tags: ["Fixed assets"]
        }
      },
      "/v1/fixed-asset-classes/{fixedAssetClassId}/archive": {
        post: { summary: "Archive a fixed-asset class for future use", tags: ["Fixed assets"] }
      },
      "/v1/fixed-assets": {
        get: { summary: "List non-posting fixed-asset register entries", tags: ["Fixed assets"] },
        post: {
          summary: "Create a draft fixed asset by copying class defaults",
          tags: ["Fixed assets"]
        }
      },
      "/v1/fixed-assets/{fixedAssetId}": {
        get: { summary: "Read a fixed-asset register entry", tags: ["Fixed assets"] },
        patch: {
          summary: "Update an unchanged fixed-asset draft",
          tags: ["Fixed assets"]
        }
      },
      "/v1/fixed-assets/{fixedAssetId}/depreciation-preview": {
        get: {
          summary: "Preview a deterministic non-posting book-depreciation schedule",
          tags: ["Fixed assets"]
        }
      },
      "/v1/fixed-assets/{fixedAssetId}/submit": {
        post: { summary: "Submit a fixed-asset draft for review", tags: ["Fixed assets"] }
      },
      "/v1/fixed-assets/{fixedAssetId}/register": {
        post: {
          summary: "Register the asset without creating a journal or CCA workpaper",
          tags: ["Fixed assets"]
        }
      },
      "/v1/fixed-assets/{fixedAssetId}/reject": {
        post: { summary: "Reject a submitted fixed asset with a reason", tags: ["Fixed assets"] }
      },
      "/v1/fixed-assets/{fixedAssetId}/revise": {
        post: { summary: "Return a reviewed fixed asset to draft", tags: ["Fixed assets"] }
      },
      "/v1/fixed-assets/{fixedAssetId}/cancel": {
        post: { summary: "Cancel a fixed-asset draft with a reason", tags: ["Fixed assets"] }
      },
      "/v1/invoices": {
        get: { summary: "List organization invoices", tags: ["Sales"] },
        post: { summary: "Create a server-calculated invoice draft", tags: ["Sales"] }
      },
      "/v1/invoices/{invoiceId}": {
        get: { summary: "Get an invoice with immutable snapshots", tags: ["Sales"] },
        patch: { summary: "Update an unposted invoice draft", tags: ["Sales"] }
      },
      "/v1/invoices/{invoiceId}/validate": {
        get: { summary: "Validate invoice calculations and tax", tags: ["Sales"] }
      },
      "/v1/invoices/{invoiceId}/approve": {
        post: { summary: "Approve an invoice without posting it", tags: ["Sales"] }
      },
      "/v1/invoices/{invoiceId}/post": {
        post: {
          summary: "Atomically post an invoice and accounts-receivable journal",
          tags: ["Sales"]
        }
      },
      "/v1/invoices/{invoiceId}/void": {
        post: { summary: "Reverse and void a posted invoice", tags: ["Sales"] }
      },
      "/v1/invoices/{invoiceId}/credit-notes": {
        post: { summary: "Create a full or partial credit-note draft", tags: ["Sales"] }
      },
      "/v1/invoice-templates": {
        get: {
          summary: "List approved invoice templates and the organization selection",
          tags: ["Invoice documents"]
        }
      },
      "/v1/organizations/current/invoice-template": {
        put: {
          summary: "Update the organization invoice template configuration",
          tags: ["Invoice documents"]
        }
      },
      "/v1/invoices/{invoiceId}/preview": {
        get: { summary: "Render an authorized invoice preview", tags: ["Invoice documents"] }
      },
      "/v1/invoices/{invoiceId}/pdf": {
        get: { summary: "Download an authorized invoice PDF", tags: ["Invoice documents"] },
        post: { summary: "Idempotently generate an invoice PDF", tags: ["Invoice documents"] }
      },
      "/v1/invoices/{invoiceId}/picking-slip": {
        get: { summary: "Read the invoice's operational picking slip", tags: ["Inventory"] },
        post: {
          summary: "Create or return the invoice's bin-ordered picking slip",
          tags: ["Inventory"]
        }
      },
      "/v1/pos/sales/{saleId}/picking-slip": {
        post: { summary: "Create or return a completed POS sale picking slip", tags: ["Inventory"] }
      },
      "/v1/shipping/carrier-accounts": {
        get: {
          summary: "List operator-owned carrier accounts without credentials",
          tags: ["Shipping"]
        },
        post: {
          summary: "Connect and validate an operator-owned carrier account",
          tags: ["Shipping"]
        }
      },
      "/v1/shipping/carrier-accounts/{id}/deactivate": {
        post: { summary: "Deactivate an operator-owned carrier account", tags: ["Shipping"] }
      },
      "/v1/invoices/{invoiceId}/shipment": {
        post: { summary: "Create a shipment draft from a posted invoice", tags: ["Shipping"] }
      },
      "/v1/pos/sales/{saleId}/shipment": {
        post: { summary: "Create a shipment draft from a completed POS sale", tags: ["Shipping"] }
      },
      "/v1/shipments/{shipmentId}": {
        get: { summary: "Read a shipment and its labels/tracking history", tags: ["Shipping"] }
      },
      "/v1/shipments/{shipmentId}/quote": {
        post: { summary: "Quote one shipment for operator review", tags: ["Shipping"] }
      },
      "/v1/shipments/{shipmentId}/purchase": {
        post: { summary: "Explicitly confirm and purchase one carrier label", tags: ["Shipping"] }
      },
      "/v1/shipments/{shipmentId}/void": {
        post: { summary: "Request a carrier-governed label void", tags: ["Shipping"] }
      },
      "/v1/shipments/{shipmentId}/track": {
        post: { summary: "Refresh shipment tracking from its carrier", tags: ["Shipping"] }
      },
      "/v1/shipment-labels/{labelId}": {
        get: {
          summary: "Download a carrier-returned PDF or ZPL label for browser printing",
          tags: ["Shipping"]
        }
      },
      "/v1/picking-slips/{pickingSlipId}": {
        get: {
          summary: "Read a picking slip and its generation/short-pick history",
          tags: ["Inventory"]
        }
      },
      "/v1/picking-slips/{pickingSlipId}/pdf": {
        get: {
          summary: "Read the latest local picking-slip PDF for browser printing",
          tags: ["Inventory"]
        }
      },
      "/v1/picking-slips/{pickingSlipId}/reprint": {
        post: { summary: "Generate a traceable picking-slip reprint", tags: ["Inventory"] }
      },
      "/v1/picking-slips/{pickingSlipId}/short-pick": {
        post: {
          summary: "Record picked quantities and create count-review items for shortages",
          tags: ["Inventory"]
        }
      },
      "/v1/invoices/{invoiceId}/send": {
        post: { summary: "Queue an invoice email", tags: ["Invoice documents"] }
      },
      "/v1/invoices/{invoiceId}/manual-delivery": {
        post: {
          summary: "Record an invoice sent through the user's own email app",
          tags: ["Invoice documents"]
        }
      },
      "/v1/invoices/{invoiceId}/reminder": {
        post: { summary: "Queue a payment reminder for an unpaid invoice", tags: ["Receivables"] }
      },
      "/v1/invoices/{invoiceId}/manual-reminder": {
        post: {
          summary: "Record a payment reminder prepared through the user's own email app",
          tags: ["Receivables"]
        }
      },
      "/v1/email-connections": {
        get: { summary: "List organization email connection options", tags: ["Email"] }
      },
      "/v1/email-connections/smtp": {
        post: {
          summary: "Test and save an encrypted organization SMTP relay",
          tags: ["Email"]
        }
      },
      "/v1/invoices/{invoiceId}/resend": {
        post: { summary: "Queue an authorized invoice resend", tags: ["Invoice documents"] }
      },
      "/v1/invoices/{invoiceId}/delivery-history": {
        get: { summary: "List invoice delivery events", tags: ["Invoice documents"] }
      },
      "/v1/reminder-settings": {
        get: { summary: "Read organization reminder settings", tags: ["Receivables"] },
        put: { summary: "Update organization reminder settings", tags: ["Receivables"] }
      },
      "/v1/receivables/follow-up": {
        get: {
          summary: "List overdue invoices grouped for follow-up review",
          tags: ["Receivables"]
        }
      },
      "/v1/reports/receivables/customers/{customerId}/statement": {
        get: { summary: "Read an activity or open-item customer statement", tags: ["Receivables"] }
      },
      "/v1/reports/receivables/customers/{customerId}/statement.pdf": {
        get: { summary: "Download a customer statement PDF", tags: ["Receivables"] }
      },
      "/v1/reports/receivables/customers/{customerId}/statement/send": {
        post: {
          summary: "Send a customer statement through the configured mailbox",
          tags: ["Receivables"]
        }
      },
      "/v1/reports/receivables/customers/{customerId}/statement/manual-delivery": {
        post: {
          summary: "Record a customer statement sent through the user's own email app",
          tags: ["Receivables"]
        }
      },
      "/v1/invoices/{invoiceId}/public-link": {
        post: { summary: "Issue a revocable public invoice link", tags: ["Invoice documents"] }
      },
      "/v1/invoices/{invoiceId}/public-links/{linkId}/revoke": {
        post: { summary: "Revoke a public invoice link", tags: ["Invoice documents"] }
      },
      "/v1/estimates/{estimateId}/public-link": {
        post: { summary: "Issue a revocable public estimate link", tags: ["Estimates"] }
      },
      "/v1/estimates/{estimateId}/preview": {
        get: { summary: "Render an exact estimate preview", tags: ["Estimates"] }
      },
      "/v1/estimates/{estimateId}/email": {
        post: { summary: "Queue an estimate email with a secure public link", tags: ["Estimates"] }
      },
      "/v1/estimates/{estimateId}/delivery-history": {
        get: { summary: "List estimate delivery attempts", tags: ["Estimates"] }
      },
      "/v1/estimates/{estimateId}/public-links/{linkId}/revoke": {
        post: { summary: "Revoke a public estimate link", tags: ["Estimates"] }
      },
      "/v1/invoices/{invoiceId}/attachments": {
        get: { summary: "List authorized invoice attachments", tags: ["Invoice documents"] },
        post: {
          summary: "Add a scanned customer-facing invoice attachment",
          tags: ["Invoice documents"]
        }
      },
      "/v1/invoices/{invoiceId}/attachments/{attachmentId}": {
        get: { summary: "Download an authorized invoice attachment", tags: ["Invoice documents"] }
      },
      "/public/invoices/{token}": {
        get: {
          summary: "View an invoice through an opaque public token",
          tags: ["Public invoices"]
        }
      },
      "/public/estimates/{token}": {
        get: {
          summary: "View an estimate through an opaque public token",
          tags: ["Public estimates"]
        }
      },
      "/public/estimates/{token}/accept": {
        post: { summary: "Accept an estimate through its public token", tags: ["Public estimates"] }
      },
      "/public/estimates/{token}/decline": {
        post: {
          summary: "Decline an estimate through its public token",
          tags: ["Public estimates"]
        }
      },
      "/v1/migration-runs": {
        get: { summary: "List migration control-plane runs", tags: ["Migration"] },
        post: { summary: "Create a validated migration manifest run", tags: ["Migration"] }
      },
      "/v1/migration-runs/{migrationRunId}": {
        get: { summary: "Read a migration control-plane run", tags: ["Migration"] }
      },
      "/v1/migration-runs/{migrationRunId}/transition": {
        post: {
          summary: "Advance a migration run with optimistic concurrency",
          tags: ["Migration"]
        }
      },
      "/v1/commercial/subscription": {
        get: { summary: "Read the organization commercial subscription", tags: ["Commercial"] },
        post: { summary: "Provision or update a commercial subscription", tags: ["Commercial"] }
      },
      "/v1/commercial/subscription/transition": {
        post: { summary: "Advance commercial lifecycle status", tags: ["Commercial"] }
      },
      "/v1/commercial/events": {
        post: { summary: "Record an idempotent provider billing event", tags: ["Commercial"] }
      },
      "/public/invoices/{token}/pdf": {
        get: { summary: "Download a public invoice PDF", tags: ["Public invoices"] }
      },
      "/public/invoices/{token}/attachments/{attachmentId}": {
        get: {
          summary: "Download a customer-visible invoice attachment",
          tags: ["Public invoices"]
        }
      },
      "/v1/credit-notes/{creditNoteId}/post": {
        post: { summary: "Atomically post a credit note", tags: ["Sales"] }
      },
      "/v1/customers/{customerId}/balance": {
        get: {
          summary: "Return customer accounts-receivable detail",
          tags: ["Accounts receivable"]
        }
      },
      "/v1/receivables/aging": {
        get: { summary: "Return accounts-receivable aging", tags: ["Accounts receivable"] }
      },
      "/v1/receivables/reconciliation": {
        get: {
          summary: "Reconcile receivables to the general ledger",
          tags: ["Accounts receivable"]
        }
      },
      "/public/invoices/{token}/checkout-sessions": {
        post: { summary: "Create an idempotent hosted payment checkout", tags: ["Public payments"] }
      },
      "/public/invoices/{token}/checkout-sessions/{checkoutSessionId}/capture": {
        post: {
          summary: "Request capture for an approved hosted checkout",
          tags: ["Public payments"]
        }
      },
      "/public/invoices/{token}/payment-status": {
        get: { summary: "Read verified public payment status", tags: ["Public payments"] }
      },
      "/v1/webhooks/payments/stripe": {
        post: { summary: "Receive a signed Stripe payment event", tags: ["Payment webhooks"] }
      },
      "/v1/webhooks/payments/paypal": {
        post: { summary: "Receive a verified PayPal payment event", tags: ["Payment webhooks"] }
      },
      "/v1/payments": {
        get: { summary: "List organization-scoped payments", tags: ["Payments"] }
      },
      "/v1/payments/{paymentId}": {
        get: {
          summary: "Read a payment and its immutable refund history",
          responses: { "200": { description: "Payment" } }
        }
      },
      "/v1/payments/manual": {
        post: { summary: "Record an idempotent manual customer payment", tags: ["Payments"] }
      },
      "/v1/payment-disputes": {
        get: { summary: "List organization payment disputes for review", tags: ["Payments"] }
      },
      "/v1/payment-disputes/{disputeId}": {
        patch: {
          summary: "Advance a dispute review state",
          responses: { "200": { description: "Dispute" } }
        }
      },
      "/v1/payments/{paymentId}/receipt": {
        get: { summary: "Read an immutable payment receipt", tags: ["Payments"] }
      },
      "/v1/payments/{paymentId}/receipt/resend": {
        post: { summary: "Idempotently queue a payment receipt email", tags: ["Payments"] }
      },
      "/v1/payments/{paymentId}/refunds": {
        post: { summary: "Create an authorized, idempotent payment refund", tags: ["Payments"] }
      },
      "/v1/payment-account": {
        get: { summary: "Read connected payment-account status", tags: ["Payments"] }
      },
      "/v1/payment-account/connect": {
        post: { summary: "Start authorized payment-account onboarding", tags: ["Payments"] }
      },
      "/v1/payment-account/disconnect": {
        post: { summary: "Disconnect the organization payment account", tags: ["Payments"] }
      },
      "/v1/payment-accounts": {
        get: {
          summary: "List organization payment accounts without credentials",
          tags: ["Payments"]
        }
      },
      "/v1/payment-accounts/own": {
        post: { summary: "Test and save an owner's provider credential", tags: ["Payments"] }
      },
      "/v1/payment-links/poll": {
        post: { summary: "Poll durable own-account payment links", tags: ["Payments"] }
      },
      "/v1/invoices/{invoiceId}/payment-links": {
        get: { summary: "List durable payment links for an invoice", tags: ["Payments"] },
        post: {
          summary: "Create or reissue a durable provider-hosted payment link",
          tags: ["Payments"]
        }
      },
      "/v1/payment-settings": {
        get: { summary: "Read organization payment settings", tags: ["Payments"] },
        put: { summary: "Update versioned payment settings", tags: ["Payments"] }
      },
      "/ready": {
        get: {
          summary: "Verify API and database readiness",
          tags: ["Operations"]
        }
      },
      "/v1/product-events": {
        post: {
          summary: "Record a consented privacy-safe product event",
          tags: ["Product analytics"]
        }
      },
      "/v1/product-analytics/consent": {
        get: {
          summary: "Read the organization's product-analytics consent state",
          tags: ["Product analytics"]
        },
        put: {
          summary: "Grant or withdraw organization product-analytics consent (owner or admin)",
          tags: ["Product analytics"]
        }
      },
      "/v1/product-events/summary": {
        get: {
          summary: "Read a thresholded organization activation summary",
          tags: ["Product analytics"]
        }
      },
      "/public/invoices/{token}/receipts/{receiptNumber}": {
        get: {
          summary: "Read an immutable public payment receipt",
          responses: { "200": { description: "Receipt snapshot" } }
        }
      }
    },
    components: {
      securitySchemes: {
        OidcSession: {
          type: "apiKey",
          in: "cookie",
          name: "clearledger_session"
        },
        BearerSession: {
          type: "http",
          scheme: "bearer"
        },
        DevelopmentIdentity: {
          type: "apiKey",
          in: "header",
          name: "x-clearledger-user-email"
        }
      }
    }
  };
}
