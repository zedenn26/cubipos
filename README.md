# CubiPOS by Cubixtop

A runnable multi-tenant retail application using Next.js 16 App Router, strict TypeScript, React, Tailwind, shadcn-compatible Radix UI components, Supabase Auth/PostgreSQL/Storage, Zod, React Hook Form, Recharts, ZXing, ExcelJS, jsPDF, QRCode and bwip-js.

The application uses real Supabase authentication and database transactions. It does not use mock production APIs. **The refactor requires the new database migrations before login and store operations work.** Local verification is not a production certification; follow the deployment and acceptance checks below.

## Architecture and roles

- `/system`: platform owner. Entity creation, primary admin provisioning/recovery, country, status, subscription expiry, store/user/session/storage limits, platform totals and search. No retail operations or tenant catalog access.
- `/settings`: entity onboarding, company/tax configuration, private logo upload, stores, users, manager-controlled credential resets, store assignments, permission overrides and session revocation. Every role can change its own password from the sidebar profile control.
- `/admin`: business sales overview and charts.
- `/pos`: assigned-store POS, HID/camera scanning, persistent active cart, split payments, credit, hold/resume, registers and itemized receipt.
- `/products`, `/inventory`: catalog/tax defaults/identifiers, QR/barcode labels, store stock, ledger, transfers.
- `/customers`: tenant customer directory, international mobile lookup, purchase history and credit limits.
- `/purchases`: suppliers, purchase orders, goods receiving and supplier returns.
- `/returns`: invoice lookup, returns, stock disposition and linked exchanges.
- `/reports`: permission-checked reports and CSV/XLSX/PDF downloads.

Tenant identity comes from authenticated database context. RLS checks entity, active device session, role/permission and store assignment. Tenant roles are Entity Admin, Store Manager and Cashier; System Admin is deliberately outside tenant operations. Security details and migration sequence are in [supabase/README.md](supabase/README.md).

## Requirements and local installation

Use Node.js 24.x and npm. A Supabase project is required. Camera access requires HTTPS or localhost; hardware HID scanners act like a keyboard.

```bash
npm install
cp .env.example .env.local
```

In Supabase Dashboard, create/select your project. Copy its project URL and API keys from project settings. The URL is `https://PROJECT.supabase.co`, without `/rest/v1`. New publishable/secret keys and legacy anon/service-role keys are accepted by the SDK.

| Variable | Visibility / purpose |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Browser-safe project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Browser-safe publishable/anon key |
| NEXT_PUBLIC_APP_URL | App origin; use HTTPS in production |
| SUPABASE_SERVICE_ROLE_KEY | **Server only**; user provisioning/recovery |
| SYSTEM_ADMIN_EMAIL | Optional deployment reference; does not grant access |
| REPORT_SECRET, CRON_SECRET | Reserved server-only values; no scheduled jobs are enabled |
| DEMO_SEED_PASSWORD | Optional local development seeding only |

Never put a secret/service-role key in a `NEXT_PUBLIC_` variable. `.env.local` is ignored by Git. `.env.example` contains placeholders only. A database password is not an API key.

## Apply the database schema — one file

Open [supabase/schema.sql](supabase/schema.sql), copy **the entire file**, paste it into **Supabase Dashboard → SQL Editor → New query**, and click **Run**. Do not paste `.env.local` or API keys into the SQL Editor.

The combined script supports a fresh Supabase project and earlier CubiPOS/MYPOS schema versions. It preserves existing accounts and business records, detects the numbered migrations already present, records applied versions, and applies the missing upgrades inside one transaction. It is tested for fresh install, upgrade from the original schema and repeat execution. A version table appears in the result on success. Back up your database before a schema change.

For developers, `npm run db:schema` regenerates the combined file from the canonical numbered migrations. Do not edit the generated file directly. Supabase CLI users should use tracked numbered migrations and reconcile any manually applied versions before `supabase db push`. Never rerun 0001/0002 individually after the newer security migrations.

After running the schema, restart Next.js and sign out/in to establish the new registered session. Existing Super Admin accounts are moved into the separate `/system` area. The application API keys are sufficient for normal operation; creating tables and policies requires SQL Editor/database-owner access. Full details: [database delivery](supabase/README.md).

## Initial System Admin

```bash
npm run bootstrap:admin -- owner@your-domain.com
```

Enter the display name and a unique password of at least 12 characters at the hidden prompt. The command creates an Auth user, display profile and `system_admins` membership. It does not overwrite existing accounts. Existing `super_admin` profiles are promoted into the separate allow-list by migration 0003.

No fixed production password is kept in source. `npm run seed:admin` is a deprecated entry point that explains how to use secure bootstrap. Change previously shared development credentials in Settings before any public deployment.

## Run and use the app

```bash
npm run dev
```

Open http://localhost:3000. Sign in as System Admin and create an entity with its primary admin. Then sign out and use the Entity Admin account to:

1. Complete company onboarding and explicitly confirm the applicable tax settings.
2. Create stores within the platform allowance.
3. Create staff and assign stores and permissions.
4. Configure categories/tax codes, products, identifiers and opening stock.
5. Sign in as a cashier, confirm the automatic daily register is active, scan products and complete a paid sale.
6. Print the receipt, process permitted multi-item returns/exchanges and review reports.

Country defaults are supplied for India, UAE, UK, US, Singapore and Australia. Tax rates are not legal determinations. Entity administrators set category rates, optional tax codes and product overrides. Tax components use validated presets: India supports equal CGST/SGST, IGST or single-component GST; other countries use their configured framework as one component. This is a configurable allocation, not automatic place-of-supply tax advice.

## Development seed

Use only with a disposable development project. Run `supabase/seed.sql` after migrations, set `DEMO_SEED_PASSWORD` locally, then:

```bash
npm run seed:demo
```

Accounts: `demo.admin@example.test`, `demo.cashier1@example.test`, `demo.cashier2@example.test`. All use the password you supplied, never a source-code password. The data contains two stores, sample products, codes, inventory movements, customer and supplier. Create sample sales via the real checkout flow after confirming tax settings. System Admin bootstrap is separate.

## Scanners, labels and printing

USB/Bluetooth scanners should be in HID keyboard mode with an Enter suffix. The focused POS search accepts exact codes; a fast keyboard scan listener also works outside editable fields. Repeated scans increment quantity. An unmatched identifier shows an error and never creates a product automatically.

The SCAN control uses ZXing and the browser camera for common EAN/UPC/Code 128/Code 39/QR formats. Permission failure leaves manual entry available. Test actual devices and label quality at your store; desktop emulation cannot certify scanner/printer hardware.

Product labels support QR or Code 128, 1–200 labels, configurable page dimensions, name, identifier and price. QR payloads are opaque identifiers, never mutable prices/tax. Product forms stay collapsed until **Add new product**, **Bulk add products**, **Edit** or **Labels & codes** is selected. Print downloaded PDFs at 100% scale using the correct thermal paper size.

Checkout offers **Complete sale & print** and **Complete sale & view**. The first completes the database transaction and opens the 80 mm thermal print flow; the second opens the professional receipt preview with manual thermal and A4/save-as-PDF actions. Standard browsers show their print dialog and preselect the configured/default printer. Silent direct printing requires a managed kiosk browser or approved local print bridge because ordinary web pages cannot bypass browser printer security.

Product administration includes a transactional XLSX bulk import. Download the current template from `/products`; it contains instructions plus the entity&apos;s categories, subcategories and active tax codes. Required fields are highlighted and use controlled unit, tax-mode and status values. Select the store that receives opening stock, optionally allow missing category paths to be created, then upload up to 2,000 rows or 5 MB. The server validates every row before one database transaction creates products, identifiers, inventory balances and opening-stock ledger entries. Any invalid row rolls back the entire file.

## Financial and inventory behavior

Checkout computes price, category/product tax, discounts and totals in PostgreSQL. It automatically resolves one daily register per cashier/store using the entity timezone, stock and valid payment totals. A transaction writes the sale, immutable line/header snapshots, payments and stock ledger. UUID request keys make retries idempotent; invoice counters are serialized per entity/year.

Cash, UPI and card are **recorded payment methods**, not payment-gateway integrations. Confirm the money was received before checkout. Never enter card numbers or authentication data. Split payments must sum to the calculated total.

Customer credit checks an admin-set limit; store credit checks an available balance. Credit usage/refunds create an account ledger. Returns provide checkbox selection for multiple original invoice lines, cap refundable quantities, preserve original amounts and apply an individual stock disposition. Exchanges use the same multi-item selection, consume original return credit once and create linked replacement sales; negative differences are recorded as cash refunds. Cash refunds use the automatic daily register.

Purchases change stock only when received, exactly once. Supplier returns validate received quantities and available stock. Transfers follow requested → approved → dispatched → received; cancellation is allowed only before dispatch. Ledger rows record dispatch/receipt separately.

Stock values use three decimal places; currency values use two decimal places. Countries with other currency precision require extension before use. Product batch/expiry fields represent one product record, not a full multi-lot valuation system.

## Reports and exports

Sales, tax, discounts, products, payments, inventory, low stock, expiry, returns, exchanges, movements, purchases, registers, audit and cost-permitted profit reports use a server/database authorization check. **Recent sales & receipts** is a separate menu for Entity Admins, Store Managers and Cashiers. It shows only authorized stores, supports store/cashier/date filters, opens historical receipts and reports sales before refunds, transactions, average basket and snapshotted tax. Reports cap a request at one year and 10,000 rows; narrow the range at the cap. Profit output is explicitly labeled margin before returns, not an accounting general ledger.

CSV escapes spreadsheet formulas. XLSX includes heading, metadata, frozen headers, typed amounts and print settings. PDF uses a paginated table. Receipt headers and sale-line values are stored at sale time. See [release acceptance](docs/release-acceptance.md) for remaining validation and detailed scope differences.

## Offline and PWA behavior

The active cart and uncertain checkout request ID are preserved on the same browser/device, keyed by user and store. An uncertain checkout locks edits until the same request is safely retried. This is not offline sales processing. The app warns on lost connectivity and rejects offline checkout.

A manifest and 192/512 icons support installation. The production service worker caches only the public app icon; it never caches Auth, transaction pages, API responses or Supabase data. A fully offline app shell and offline transaction synchronization are not enabled.

## Verification

```bash
npm run lint
npm test
npm run build
npm audit
```

Tests execute the SQL migrations using PGlite and cover the original migration upgrade, platform/tenant isolation, store restrictions, limits, sessions, permissions, idempotent checkout, rollback, tax rounding, returns/exchanges, receiving/transfers, customer credit, supplier returns, cost-data access and export formats. The test suite uses Node 24.

## Vercel deployment and custom domain

Import the repository into Vercel as a Next.js project. Use Node 24.x, the standard `npm run build`, and set the required environment variables separately for Preview and Production. Use a staging Supabase project for previews. Vercel supports Node version selection in project settings: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions

Apply migrations to the target Supabase project before promoting the matching app release. Set Supabase Auth's Site URL to your production origin and allow the `/settings` recovery redirect. Configure production SMTP in Supabase for admin recovery emails. Restart local Next.js after changing `.env.local`; rebuild Vercel after changing public variables.

Add your custom domain in Vercel project settings and use the DNS records Vercel supplies. Update `NEXT_PUBLIC_APP_URL` and Supabase Auth redirect settings to the final HTTPS origin. No cron is configured; reserved cron/report secrets do not imply scheduled reports are active.

## Backup and operations

Use the Supabase backup/PITR options available for your project and rehearse restoring a staging copy. Separately back up Storage object bytes: database backups contain metadata, not the uploaded files. Reference: https://supabase.com/docs/guides/platform/backups

Keep secrets out of logs, restrict project dashboard access, monitor Auth/API failures and reconcile external payments with recorded sales. Apply schema changes through a reviewed migration sequence and retain a record of the last successfully applied file. Use a forward fix for schema issues or a planned restore with payment reconciliation; do not delete completed financial transactions.

## Troubleshooting

- **Invalid API key:** verify URL and both keys belong to the same project; keep the service key server-only.
- **Infinite recursion in profiles:** 0002 has not been applied. Apply it and then the later migrations.
- **Function not found / Account unavailable after upgrade:** verify the complete migration chain, sign out, and sign back in to create a registered session.
- **No stores:** assign the user in Entity Admin Settings. System Admin intentionally has no stores.
- **Concurrent session limit:** revoke an old session or wait for its 15-minute activity timeout.
- **Tax configuration missing:** complete Entity Admin onboarding and confirm tax setup.
- **Daily register unavailable:** apply migration 0018, verify the entity timezone and the user’s store assignment, then reload the POS.
- **Payment total mismatch:** check discount permissions, current prices/tax and split amounts. Do not complete a second payment externally while retrying an uncertain checkout.
- **Camera unavailable:** use HTTPS/localhost, grant camera permission, or use HID/manual entry.
- **Report empty:** verify date range, selected store and report permissions.
