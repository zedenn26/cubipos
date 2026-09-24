# Supabase database delivery

**One-file setup:** paste all of `schema.sql` into Supabase SQL Editor and run it. The script detects earlier CubiPOS/MYPOS migrations, preserves existing users/data, records applied versions, and commits all missing upgrades together. It can also initialize a fresh project. `npm run db:schema` regenerates this file.

Alternatively, apply migrations **once, in numeric order**, using a database owner in Supabase SQL Editor or a tracked Supabase CLI workflow. Do not reapply 0001/0002 after the newer security migrations.

| Migration | Purpose |
| --- | --- |
| 0001 | Original core tables |
| 0002 | Repair original recursive/permissive policies and baseline transaction functions |
| 0003 | Separate system administration, tenant/store RBAC, sessions, quotas and audit triggers |
| 0004 | Catalog identifiers, tax snapshots, checkout, returns/exchanges, procurement, registers, transfers |
| 0005 | Sensitive-operation rate limits and private Storage policies |
| 0006 | Authorized reports, child-record store isolation, category/store-reference guards, voids, cost-field protection |
| 0007 | Customer credit accounts, credit journals, supplier returns |
| 0008 | Historical receipt headers, store/company metadata, tax-component validation, Storage quotas |
| 0009 | Entity administrator email in the protected platform overview |
| 0010 | Correct atomic operation rate-limit conflict handling |
| 0011 | Backfill settings, receipts and default categories for existing entities |
| 0012 | Restrict tenant roles and initialize country-appropriate tax component presets |
| 0013 | Transactional XLSX product import with category paths and opening stock |
| 0014 | Allow cashier returns and exchanges |
| 0015 | Restore the shared active-store authorization guard |
| 0016 | Permission-checked bulk product deletion with history-safe archiving |
| 0017 | Role-safe recent receipts, cashier-filtered sales reports and refund-aware totals |
| 0018 | Entity-timezone automatic daily registers and transaction-safe rollover |

For a database already at 0002, `npm run db:bundle -- 0003` creates `supabase/upgrade.sql`. Paste that generated file into SQL Editor and run it once. If only 0001 is applied, generate from 0002 instead. For a new project, generate from 0001. Each new migration has its own transaction: stop on any error, identify which migrations committed, and resume from the first unapplied migration. The generated file is a convenience copy, not an additional migration to apply after the numbered files.

The checked-in `upgrade.sql` currently contains 0016–0018. It is suitable for the application state that has already applied through 0015; 0016 is safe to reapply if its function was installed manually. Apply this upgrade before deploying the matching Products, Recent sales & receipts, reporting, multi-item return/exchange and automatic-register UI.

For CLI-managed deployments, use the canonical numbered migrations and reconcile any previously applied manual migrations before `supabase db push`. Do not blindly run initial migrations against a populated database.

## RLS and session model

`auth.uid()` identifies the authenticated user. `session_id()` reads Supabase's signed JWT session ID. `register_session` serializes admission by locking the entity, enforces its concurrent-device limit, and rejects suspended/expired entities. Operational policies require an unrevoked session with activity within 15 minutes. Visible tabs send a heartbeat every minute. Browser tabs sharing one Supabase session count once; separate devices/browser profiles count separately. Revoking a session blocks its still-valid JWT through RLS.

`system_admins` is a separate allow-list. Its members can manage `entities`, see platform totals, and request primary-admin recovery. They cannot read products, sell, adjust inventory, or access customer data. Existing active `super_admin` profiles are migrated into the allow-list by 0003; bootstrap writes both records for compatibility with Auth profile display.

`has_permission` resolves Entity Admin access, per-user allow/deny overrides, then role defaults. Supported tenant roles are Entity Admin, Store Manager and Cashier. `can_access_store` checks tenant and store assignment. Non-admin staff need `user_stores` assignments. `configure_user` rejects foreign-tenant assignments. Financial tables accept writes only through transactional functions; the app's client cannot directly insert sales/payments/returns or change inventory. Cost fields are excluded from direct authenticated table selects; authorized reports/catalog RPCs expose them when permitted.

Customer records are shared within the tenant. Sales, returns, purchases and their child records are scoped to authorized stores. Inventory movements preserve the source and actor. Child-table policies follow parent store permissions.

## Storage

Private buckets: `entity-logos`, `product-images`, `report-files`. Paths start with `entities/{entity_id}/`. Logo/image writes require their corresponding permission. Client report-file writes are disabled; downloads are generated on demand. File MIME/size limits are set per bucket. A database trigger checks stored-object byte metadata against the entity's storage allowance under an entity lock. Validate the upload lifecycle with your deployed Storage version before production.

## Bootstrap and development seed

Run `npm run bootstrap:admin -- owner@your-domain.com` from an interactive terminal after migrations. Password input is hidden. No production password is embedded in SQL/source. The deprecated fixed-password seed command deliberately refuses to run. Rotate previously shared development passwords in account Settings.

For a disposable development project, run `seed.sql`, set a unique `DEMO_SEED_PASSWORD` in `.env.local`, then run `npm run seed:demo`. This creates one demo entity with two stores, products/barcodes/QRs, stock ledger entries, a customer, a supplier, one entity admin and two store-assigned cashiers. The System Admin is created separately with bootstrap. Sign in as the demo admin to confirm the tax setup, then make sample sales through the real register/checkout workflow. The seed does not fabricate completed sales or financial records.

## Upgrade and recovery

1. Verify a recent backup and separately back up Storage objects.
2. Restore into staging and apply the migration chain there.
3. Run local tests and a live test with System Admin, Entity Admin, two store-assigned cashiers, and a second tenant.
4. Schedule a checkout pause for the schema upgrade; deploy matching app code immediately afterward.
5. If a migration fails, investigate before retrying. A transaction rollback does not revert earlier committed migrations.
6. Prefer a corrective forward migration. A full restore also restores financial state: reconcile any external payments processed after the recovery point.

Supabase database backups exclude Storage object bytes; plan and test both recovery paths: https://supabase.com/docs/guides/platform/backups
