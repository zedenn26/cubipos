create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.entity_status as enum ('trial','active','suspended','cancelled');
create type public.app_role as enum ('super_admin','entity_admin','store_manager','cashier','inventory_manager','custom');
create type public.tax_mode as enum ('inclusive','exclusive','exempt','zero_rated');
create type public.sale_status as enum ('completed','voided','refunded','partially_refunded');
create type public.movement_type as enum ('opening','purchase','sale','customer_return','exchange','damage','adjustment','transfer_out','transfer_in');

create table public.entities (
  id uuid primary key default gen_random_uuid(), name text not null, legal_name text, country_code char(2) not null default 'IN',
  status entity_status not null default 'trial', max_stores int not null default 1 check (max_stores > 0), max_users int not null default 10 check (max_users > 0),
  max_concurrent_sessions int not null default 3 check (max_concurrent_sessions > 0), currency_code char(3) not null default 'INR', timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.entity_settings (entity_id uuid primary key references public.entities on delete cascade, business_type text, trading_name text, phone text, email citext, website text, address jsonb not null default '{}', tax_framework text not null default 'GST', gstin text, invoice_prefix text not null default 'INV', footer_message text, logo_path text, financial_year_start_month int not null default 4 check (financial_year_start_month between 1 and 12), updated_at timestamptz not null default now());
create table public.profiles (id uuid primary key references auth.users on delete cascade, entity_id uuid references public.entities on delete cascade, display_name text not null, email citext, phone text, role app_role not null default 'cashier', is_active boolean not null default true, must_change_password boolean not null default false, created_at timestamptz not null default now());
create table public.stores (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities on delete cascade, name text not null, code text not null, address jsonb not null default '{}', is_active boolean not null default true, created_at timestamptz not null default now(), unique(entity_id, code));
create table public.user_stores (user_id uuid references public.profiles on delete cascade, store_id uuid references public.stores on delete cascade, primary key(user_id, store_id));
create table public.categories (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities on delete cascade, parent_id uuid references public.categories, name text not null, default_tax_rate numeric(7,4) not null default 0, is_archived boolean not null default false, unique(entity_id, name));
create table public.products (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities on delete cascade, category_id uuid references public.categories, name text not null, description text, brand text, unit text not null default 'pcs', sku text not null, internal_code text not null, barcode text, qr_identifier text, purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0), selling_price numeric(14,2) not null default 0 check (selling_price >= 0), mrp numeric(14,2) check (mrp is null or mrp >= 0), tax_mode tax_mode not null default 'exclusive', tax_rate numeric(7,4) check (tax_rate is null or tax_rate >= 0), hsn_sac text, reorder_level numeric(14,3) not null default 0, image_path text, is_active boolean not null default true, created_at timestamptz not null default now(), unique(entity_id, sku), unique(entity_id, internal_code));
create unique index products_barcode_per_entity on public.products(entity_id, barcode) where barcode is not null;
create unique index products_qr_per_entity on public.products(entity_id, qr_identifier) where qr_identifier is not null;
create table public.inventory (store_id uuid references public.stores on delete cascade, product_id uuid references public.products on delete cascade, quantity numeric(14,3) not null default 0 check (quantity >= 0), updated_at timestamptz not null default now(), primary key(store_id, product_id));
create table public.inventory_movements (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities, store_id uuid not null references public.stores, product_id uuid not null references public.products, movement_type movement_type not null, quantity numeric(14,3) not null, reference_type text, reference_id uuid, unit_cost numeric(14,2), notes text, created_by uuid references public.profiles, created_at timestamptz not null default now());
create table public.customers (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities on delete cascade, name text not null, mobile_normalized text, email citext, address jsonb not null default '{}', tax_details jsonb not null default '{}', created_at timestamptz not null default now(), unique(entity_id, mobile_normalized));
create table public.financial_years (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities, label text not null, starts_on date not null, ends_on date not null, is_closed boolean not null default false, unique(entity_id, label));
create table public.document_sequences (entity_id uuid references public.entities on delete cascade, store_id uuid references public.stores on delete cascade, financial_year_id uuid references public.financial_years, document_type text not null default 'sale', prefix text not null default 'INV', next_number bigint not null default 1, sequence_length int not null default 5, primary key(entity_id, store_id, financial_year_id, document_type));
create table public.sales (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities, store_id uuid not null references public.stores, customer_id uuid references public.customers, invoice_number text not null, status sale_status not null default 'completed', subtotal numeric(14,2) not null, discount_total numeric(14,2) not null default 0, tax_total numeric(14,2) not null default 0, grand_total numeric(14,2) not null, currency_code char(3) not null default 'INR', cashier_id uuid not null references public.profiles, completed_at timestamptz not null default now(), unique(entity_id, invoice_number));
create table public.sale_items (id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales, product_id uuid not null references public.products, quantity numeric(14,3) not null check (quantity > 0), unit_price numeric(14,2) not null, discount_amount numeric(14,2) not null default 0, taxable_value numeric(14,2) not null, tax_rate numeric(7,4) not null default 0, tax_amount numeric(14,2) not null default 0, tax_components jsonb not null default '{}');
create table public.payments (id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales, method text not null, amount numeric(14,2) not null check (amount > 0), reference text, created_at timestamptz not null default now());
create table public.register_shifts (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities, store_id uuid not null references public.stores, cashier_id uuid not null references public.profiles, opened_at timestamptz not null default now(), closed_at timestamptz, opening_cash numeric(14,2) not null default 0, expected_cash numeric(14,2), actual_cash numeric(14,2), difference numeric(14,2));
create table public.receipt_settings (entity_id uuid primary key references public.entities on delete cascade, template text not null default 'compact_classic', paper_width int not null default 80 check (paper_width in (58,80)), store_overrides jsonb not null default '{}');
create table public.smtp_settings (entity_id uuid primary key references public.entities on delete cascade, host text not null, port int not null, security_mode text not null, username text not null, encrypted_password text not null, sender_name text not null, sender_email citext not null, reply_to citext, last_tested_at timestamptz, last_test_status text, updated_at timestamptz not null default now());
create table public.report_schedules (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities, name text not null, reports text[] not null, frequency text not null check (frequency in ('daily','weekly','monthly')), timezone text not null, delivery_time time not null, filters jsonb not null default '{}', formats text[] not null default '{pdf}', recipients jsonb not null default '[]', is_active boolean not null default true, next_run_at timestamptz, created_by uuid references public.profiles);
create table public.email_delivery_logs (id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.entities, schedule_id uuid references public.report_schedules, recipients jsonb not null, formats text[] not null, status text not null, error_message text, idempotency_key text unique, created_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), entity_id uuid references public.entities, actor_id uuid references public.profiles, action text not null, resource_type text not null, resource_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());

create index profiles_entity_idx on public.profiles(entity_id);
create index stores_entity_idx on public.stores(entity_id);
create index products_entity_idx on public.products(entity_id);
create index sales_entity_date_idx on public.sales(entity_id, completed_at desc);
create index movements_store_product_idx on public.inventory_movements(store_id, product_id, created_at desc);
create index audit_entity_date_idx on public.audit_logs(entity_id, created_at desc);

create or replace function public.current_entity_id() returns uuid language sql stable security definer set search_path = public as $$ select entity_id from public.profiles where id = auth.uid() $$;
create or replace function public.is_entity_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('entity_admin','super_admin') and is_active) $$;

alter table public.entities enable row level security;
alter table public.entity_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.user_stores enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

create policy entity_isolation on public.entities for select using (id = public.current_entity_id() or exists(select 1 from public.profiles where id = auth.uid() and role = 'super_admin'));
create policy tenant_entity_settings on public.entity_settings using (entity_id = public.current_entity_id() or public.is_entity_admin());
create policy tenant_profiles on public.profiles using (entity_id = public.current_entity_id() or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));
create policy tenant_stores on public.stores using (entity_id = public.current_entity_id() or public.is_entity_admin());
create policy tenant_categories on public.categories using (entity_id = public.current_entity_id() or public.is_entity_admin());
create policy tenant_products on public.products using (entity_id = public.current_entity_id() or public.is_entity_admin());
create policy tenant_customers on public.customers using (entity_id = public.current_entity_id() or public.is_entity_admin());
create policy tenant_sales on public.sales using (entity_id = public.current_entity_id() or public.is_entity_admin());
create policy tenant_movements on public.inventory_movements using (entity_id = public.current_entity_id() or public.is_entity_admin());
create policy tenant_audit on public.audit_logs using (entity_id = public.current_entity_id() or exists(select 1 from public.profiles where id = auth.uid() and role = 'super_admin'));
create policy tenant_inventory on public.inventory for all using (exists(select 1 from public.stores s where s.id = store_id and (s.entity_id = public.current_entity_id() or public.is_entity_admin())));
create policy tenant_sale_items on public.sale_items for select using (exists(select 1 from public.sales s where s.id = sale_id and s.entity_id = public.current_entity_id()));
create policy tenant_payments on public.payments for select using (exists(select 1 from public.sales s where s.id = sale_id and s.entity_id = public.current_entity_id()));

insert into public.entities (id, name, legal_name, status) values ('00000000-0000-0000-0000-000000000001', 'Cubixtop Demo Retail', 'Cubixtop Demo Retail Private Limited', 'trial') on conflict do nothing;
insert into public.entity_settings (entity_id, trading_name) values ('00000000-0000-0000-0000-000000000001', 'CubiPOS Demo Store') on conflict do nothing;
insert into public.categories (entity_id, name, default_tax_rate) values
('00000000-0000-0000-0000-000000000001','Fresh Items',5), ('00000000-0000-0000-0000-000000000001','Grocery & Kitchen',5), ('00000000-0000-0000-0000-000000000001','Snacks & Drinks',12), ('00000000-0000-0000-0000-000000000001','Beauty & Wellness',18), ('00000000-0000-0000-0000-000000000001','Household & Lifestyle',18) on conflict do nothing;
insert into public.receipt_settings (entity_id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;
