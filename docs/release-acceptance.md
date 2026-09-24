# Release acceptance and scope

This is a working application implementation, not a claim that all 65 master-specification sections have passed production acceptance. Automated local checks cover database behavior and builds. Live Supabase Auth/Storage, browser behavior, scanners, printers, recovery email and Vercel deployment require environment-specific verification.

## Before production

- Apply `supabase/schema.sql` to a staging copy; verify existing profiles, stock and financial records remain present.
- Sign in separately as System Admin, Entity Admin and two cashiers assigned to different stores. Test direct unauthorized requests as well as navigation.
- Verify a second tenant cannot read or mutate the first tenant's data.
- Set session limit to one, sign in from two independent browser profiles, revoke the first session and verify its token immediately loses operational access.
- Verify store and user creation at quota boundaries; test two simultaneous requests.
- Upload private logos/product images, verify foreign-tenant paths are denied, and test the Storage size/quota trigger on the deployed Storage version.
- Configure actual business taxes; verify inclusive/exclusive, inherited rates, overrides, exemptions and component rounding. Change current rates after a sale and verify the old receipt remains unchanged.
- Run concurrent cashiers against the last unit of stock. Exactly one sale should succeed. Retry the same request ID and verify only one sale/payment/ledger write.
- Disconnect the browser during checkout, reconnect and retry. Do not process a second external payment while resolving the original request.
- Test returns, damaged/non-restocked dispositions, over-return rejection, exchange differences, credit balances, purchase receiving/returns and transfer state transitions.
- Verify a daily register is created once per cashier/store at the entity-timezone midnight boundary, stale registers receive the scheduled 11:59 PM close time, and cash sales/refunds/movements reconcile to expected cash.
- Inspect PDF/XLSX/CSV with real data and the store's language/fonts; check formula escaping. Report export size is capped; narrow large periods.
- Test hardware HID suffix/timing, camera permissions on target devices, and physical thermal/A4 label output.
- Configure Supabase SMTP/recovery redirect URLs. Verify primary-admin recovery arrives and completes successfully.
- Replace previously shared passwords, review dashboard/service-key access, configure provider rate limits, and test backups plus separate Storage-object restoration.
- Deploy a Vercel preview with a staging database and verify security headers, HTTPS cookies, camera permission and manifest installation.

## Scope choices that differ from the full master specification

- The schema uses adjacency-list categories for unlimited subcategories, `user_stores` for store access, and `register_shifts` for cashier register sessions. It does not duplicate these as parallel tables with different names. Roles are a database enum plus role/user permission mappings.
- Country defaults currently cover six countries. Currency calculations use two decimal places. Other currencies/regions require reviewed configuration and precision support.
- Tax components use validated country-aware presets. Automatic jurisdiction/place-of-supply rules, per-store tax profiles and comprehensive international tax compliance are not provided.
- Register sessions are automatic per cashier/store/business date; named physical register allocation is not modeled. Daily rollover is enforced by transaction RPCs and refreshed by active POS clients.
- Returns and exchanges support multiple selected original lines per transaction. Purchases currently expose one selected line per form submission; purchasing does not implement partial goods receiving, supplier settlement accounting or a full purchase-order approval workflow.
- Credit balances support checkout and refunds. Standalone debt repayment, credit statements and finance accounting are not yet exposed.
- Reports cover the implemented operational datasets with date/store filters and cashier filtering for sales and receipts. Additional product/supplier filter controls, complete category/store/customer analytics and net-profit accounting remain extensions. Margin is explicitly labeled before returns. Report requests cap at 10,000 rows and one year.
- Report exports include business name, period, generation metadata and PDF page numbers. Custom branded templates, embedded logos, full multilingual PDF font coverage and scheduled email delivery are not complete.
- Receipt output uses browser thermal/A4 printing and save-as-PDF. Sending digital receipts through SMS/email is not implemented.
- Product batch and expiry fields represent one product record. Multiple stock lots, quarantine inventory balances, valuation methods and stock-count approval workflows are not implemented.
- PWA installation and safe public-static caching are present. A fully offline shell or offline completed sales/synchronization is intentionally not enabled.
- No external card/UPI payment processing is integrated. All such payments/refunds must be completed externally and recorded accurately.
- Development seed provides operational setup and users; sample completed financial transactions are created through real checkout, not fabricated SQL.

These differences need product decisions and implementation/acceptance work before describing the entire master specification as complete or production-certified.
