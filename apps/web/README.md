# PennyWise Accounting web flow

This web surface supports the controlled-beta MVP: sign-in, organization selection, invitations, membership administration, company setup, customers, products and services, invoices and documents, payment settings and receipts, purchases and payables, banking and reconciliation, inventory, reports, accountant review, imports, exports, and closure requests. Production identity uses OIDC; the local development adapter is restricted to localhost.

The owner workspace uses a visibly grouped top navigation (`Home`, `Sales`, `Purchases`, `Banking`, `Reports`, and `More`), a persistent `+ New` menu, pill-shaped contextual section navigation, framed page-title banners, and a separate Business/Accountant view switch. Page titles, section headings, menus, primary commands, secondary commands, and text actions have intentionally different visual treatments. At mobile widths the primary destinations move to a bottom navigation while the active business selector remains in the compact header. Banking and migration labels are intentionally task-oriented; their existing preview, validation, idempotency, and posting safeguards remain unchanged.

Home also provides a QuickBooks Desktop-inspired business center: large, grouped task icons for sales, purchases, banking/accounting, and company tools, plus a compact quick-access pane and task finder. These are navigation shortcuts over the existing tenant-scoped workspaces; they do not create a second accounting workflow. The Settings menu brings together company settings, appearance, dashboard preferences, help, and safe runtime diagnostics. Environment variables and credentials remain server-only and are never rendered in the browser.

The secondary workspace-navigation rail starts closed on desktop so the full top menu and Home dashboard retain their working width. A small Navigate control reopens it when needed; it becomes a drawer below the complete wrapped header on narrow screens. Mobile starts with the drawer closed so organization controls and workspace content remain reachable.

`More > Help & learning` opens a searchable eight-topic task index and a six-step getting-started tutorial. Progress is stored only in the browser. On desktop, the same guide can remain docked beside Home, be collapsed to return the width to the dashboard, and remember that display preference. At smaller widths, the Home Help button opens the complete Help workspace instead of compressing financial information.

The `Appearance` menu provides device-aware, light, evergreen, ocean, warm, midnight, and high-contrast themes together with density, text-size, motion, and screen-width controls. People can choose a dashboard layout and independently show or hide the business summary, attention list, cash and tax card, Books Health, quick actions, and getting-started section. These personal display choices are validated, stored only in the current browser, and can be reset without changing company data or another member's view.

Non-production builds expose an isolated fictional demo-company option after the session capability check. Creating the sample is idempotent and one-per-user, switches into the new organization only after seeding and integrity checks succeed, and does not modify the data in the organization that was open when the command began. The route is unavailable in production. A future production demo requires a durable demo-mode marker and safeguards against live outbound payments, email, commerce connections, or filing before that boundary may change.

Run `pnpm.cmd --filter @clearledger/web dev` from Windows PowerShell. The local server listens on `http://localhost:3000` and proxies `/api/*` to `API_BASE_URL` (default `http://localhost:3001`). Localhost exposes the development identity form; non-local deployments use the OIDC sign-in action.

On localhost, the sign-in panel exposes four fictional sample identities: `owner@example.test`,
`bookkeeper@example.test`, `accountant@example.test`, and `readonly@example.test`. They are
email-only development identities with no passwords. The picker is hidden in controlled-share
and production-style runtimes; organization membership, not the sample label, determines actual
permissions. Use a disposable database and never use these identities for live customer data.

The release contract is checked with `pnpm.cmd test:e2e` and `pnpm.cmd test:accessibility`. Refer to `docs/RELEASE_CANDIDATE.md` and `docs/USER_ACCEPTANCE_SCRIPTS.md` before expanding the beta audience.
