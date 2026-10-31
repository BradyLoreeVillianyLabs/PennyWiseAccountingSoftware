# Help, interface hierarchy, and demo company

## Interface roles

ClearLedger uses a consistent visual language so a user can identify a control before
hovering over it:

- a framed banner with a primary-colour left edge identifies the current page;
- muted heading bands and smaller left edges identify sections inside that page;
- the main workspace menu is one grouped control with one selected destination;
- contextual section navigation and setup steps use separate pill or tab shapes;
- filled buttons perform primary actions, outlined buttons are secondary actions, and
  compact underlined controls are still visibly bounded when they navigate or reveal detail;
- exact financial values that open supporting detail are visibly interactive instead of
  appearing as plain numbers.

Themes reuse the same semantic borders and active states. High-contrast and forced-colour
styles preserve selected and interactive boundaries without relying on colour alone.

## Help and getting started

`More > Help & learning` contains:

1. a six-step guide covering company setup, customers and products, invoice preview,
   payments, banking, and team review;
2. direct actions that open and focus the relevant workspace control;
3. a searchable task index for setup, sales, payments, purchases, banking, reports,
   team access, migration, and commerce connections;
4. a global Search menu for screens and currently loaded company records, with `Ctrl+K` or
   `/` as keyboard shortcuts; major tables also expose a contextual Find-in-list field;
5. privacy-safe support diagnostics and an explicit product-analytics opt-in.

Tutorial position, completion, and the desktop Help-panel preference are browser-local
display state. They do not post accounting entries or change company settings.

At widths above 1180 pixels, Home can show the guide in a sticky companion column. Hiding
the companion returns its width to the dashboard. At smaller widths the Help button opens
the full Help workspace.

## Desktop floating workspaces

Desktop users can choose `More > Appearance > Desktop workbench > Floating, movable
windows`. Invoice Designer, Estimate Designer, customer/product work areas, and the major
accounting workspaces then open
as Windows-style surfaces with a title bar, drag handle, resize handle, minimize,
maximize, close, Fit-to-space, and per-window zoom controls. New surfaces fit the available viewport
below the wrapped header and remain clamped in view after resize, browser resize, or
restore. Close does not discard accounting data: it only hides the surface, which can be
restored from the workbench dock. Positions, sizes, zoom, and minimized state are stored
in the current browser only. Zoom changes visual layout only; invoice/PDF rendering and
accounting amounts remain deterministic. The standard panel layout remains the default,
and screens below the desktop breakpoint intentionally use the standard layout so controls
remain usable on tablets and phones.

The same desktop surface treatment is available across the major Sales, POS, Payments,
Purchases, Banking, Inventory, Accountant, Switching, Planning, Fixed Assets, CRM,
Calendar, Projects, Integrations, and Reports work areas. Sales and project panels tile
to keep related work visible; a single work area fills the available viewport.

The desktop navigation rail is kept above floating surfaces and shows the current area so it
remains usable while windows are moved. Every structured form also exposes `Paste from Excel`:
it opens a reviewable column grid, detects common field headers, and applies only the first
reviewed row to the normal form submit path. Bulk entry and import mapping remain the correct
multi-row workflows; the helper never bypasses validation or posts data by itself.

## Fictional demo company

The demo-company workflow creates a separate, clearly fictional Canadian service company.

The seeded company is intentionally rich enough for an end-to-end walkthrough. It includes
multiple Canadian and US customer profiles, contacts and timeline activity, six vendors,
twenty products/services, posted and draft invoices, posted bills, customer receipts, bill
payments, three client projects with time, CAD/USD settings, payroll workers and a posted
Canadian payroll run. All posted financial records are created through the normal invoice,
purchase, payment, payroll, tax, journal, audit, and idempotency services. The records are
marked as fictional demo data and can be safely reused by repeating the create action.

For a running local or controlled-share API, the same workflow can be invoked from the
repository with `CLEARLEDGER_DEMO_EMAIL=demo-owner@example.test pnpm demo:seed-full`. The
command uses a stable idempotency key by default and prints the resulting company summary.
It never seeds the currently active organization. The fixture is deterministic and
one-per-user so retries and double-clicks resume or reuse the same organization rather
than creating company litter.

The web client first reads `GET /v1/demo-company/capabilities`. When available,
`POST /v1/demo-company` uses the `canadian-service` template and a stable idempotency key.
Only after the API reports fictional data, completed setup, CAD and USD enabled, at least
one posted journal, and balanced journals does the client explicitly switch to the returned
organization. The previously open organization's data is never seeded or changed.

The sample includes completed company setup, a reviewed chart of accounts, CAD/USD
settings, fictional customers and vendors, products or services, a financial account,
posted and draft sales activity, posted purchasing activity, and the balanced journals
needed to make dashboard and report exploration meaningful. All names and records are
fictional and must remain unsuitable for live filing or business use.

The capability and write route are unavailable in production. Before a future production
demo can be enabled, ClearLedger requires a durable demo-mode marker, visible demo labeling,
strict rate limits, and safeguards that block live outbound payments, email, commerce
connections, and filing from fictional books.
