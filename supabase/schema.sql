-- CubiPOS combined schema: paste this entire file into Supabase SQL Editor and Run.
-- Supports a fresh Supabase project or the earlier MYPOS/CubiPOS numbered migrations.
-- Existing Auth users, entities, sales and inventory are preserved.
-- Take a backup first. All changes below commit together or roll back together.
-- API keys are not needed in this SQL file. Never paste secrets into it.

begin;
create table if not exists public.mypos_schema_migrations(version text primary key,filename text not null,applied_at timestamptz not null default now(),detected_existing boolean not null default false);
alter table public.mypos_schema_migrations enable row level security;

-- 0001_mypos_core.sql
do $apply_0001$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0001') then
  if to_regclass('public.entities') is not null and to_regclass('public.audit_logs') is not null and to_regclass('public.products') is not null and to_regclass('public.profiles') is not null then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0001','0001_mypos_core.sql',true);
  else
   execute $sql_0001$
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

$sql_0001$;
   insert into public.mypos_schema_migrations(version,filename) values('0001','0001_mypos_core.sql');
  end if;
 end if;
end
$apply_0001$;

-- 0002_roles_and_checkout.sql
do $apply_0002$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0002') then
  if to_regprocedure('public.set_team_active(uuid,boolean)') is not null then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0002','0002_roles_and_checkout.sql',true);
  else
   execute $sql_0002$

-- Replace permissive prototype policies, including policies on previously unprotected tables.
create or replace function public.current_entity_id() returns uuid language sql stable security definer set search_path = public as $$ select p.entity_id from profiles p join entities e on e.id=p.entity_id where p.id=auth.uid() and p.is_active and e.status in ('active','trial') $$;
create or replace function public.app_role_name() returns text language sql stable security definer set search_path = public as $$ select role::text from profiles where id=auth.uid() and is_active $$;
create or replace function public.can_read_entity(target uuid) returns boolean language sql stable security definer set search_path = public as $$ select coalesce(public.app_role_name()='super_admin' or target=public.current_entity_id(),false) $$;
create or replace function public.can_manage_entity(target uuid) returns boolean language sql stable security definer set search_path = public as $$ select coalesce(public.app_role_name()='super_admin' or (public.app_role_name()='entity_admin' and target=public.current_entity_id()),false) $$;
do $$ declare r record; begin
 for r in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('entities','entity_settings','profiles','stores','user_stores','categories','products','inventory','inventory_movements','customers','financial_years','document_sequences','sales','sale_items','payments','register_shifts','receipt_settings','smtp_settings','report_schedules','email_delivery_logs','audit_logs') loop execute format('drop policy %I on public.%I',r.policyname,r.tablename); end loop;
 for r in select tablename from pg_tables where schemaname='public' and tablename in ('entities','entity_settings','profiles','stores','user_stores','categories','products','inventory','inventory_movements','customers','financial_years','document_sequences','sales','sale_items','payments','register_shifts','receipt_settings','smtp_settings','report_schedules','email_delivery_logs','audit_logs') loop execute format('alter table public.%I enable row level security',r.tablename); end loop;
end $$;
create policy entities_read on entities for select to authenticated using (can_read_entity(id));
create policy entities_create on entities for insert to authenticated with check (app_role_name()='super_admin');
create policy entities_edit on entities for update to authenticated using (app_role_name()='super_admin') with check (app_role_name()='super_admin');
create policy profiles_read on profiles for select to authenticated using (id=auth.uid() or can_manage_entity(entity_id));
do $$ declare t text; begin
 foreach t in array array['stores','categories','products','entity_settings','receipt_settings','customers'] loop
 execute format('create policy tenant_read on %I for select to authenticated using (can_read_entity(entity_id))',t);
 execute format('create policy admin_insert on %I for insert to authenticated with check (can_manage_entity(entity_id))',t);
 execute format('create policy admin_update on %I for update to authenticated using (can_manage_entity(entity_id)) with check (can_manage_entity(entity_id))',t);
 end loop;
 foreach t in array array['sales','inventory_movements','register_shifts','financial_years'] loop
 execute format('create policy tenant_read on %I for select to authenticated using (can_read_entity(entity_id))',t);
 end loop;
 foreach t in array array['audit_logs','report_schedules','email_delivery_logs'] loop
 execute format('create policy admin_read on %I for select to authenticated using (can_manage_entity(entity_id))',t);
 end loop;
end $$;
create policy customers_create on customers for insert to authenticated with check (can_read_entity(entity_id));
create policy inventory_read on inventory for select to authenticated using (exists(select 1 from stores s where s.id=store_id and can_read_entity(s.entity_id)));
create policy items_read on sale_items for select to authenticated using (exists(select 1 from sales s where s.id=sale_id and can_read_entity(s.entity_id)));
create policy payments_read on payments for select to authenticated using (exists(select 1 from sales s where s.id=sale_id and can_read_entity(s.entity_id)));

create or replace function public.adjust_stock(target_store uuid,target_product uuid,new_quantity numeric) returns void language plpgsql security definer set search_path=public as $$
declare tenant uuid; old_quantity numeric; begin
 select entity_id into tenant from stores where id=target_store;
 if not can_manage_entity(tenant) or not exists(select 1 from products where id=target_product and entity_id=tenant) then raise exception 'Access denied'; end if;
 if new_quantity is null or new_quantity<0 or new_quantity>100000000 then raise exception 'Invalid stock quantity'; end if;
 insert into inventory(store_id,product_id,quantity) values(target_store,target_product,0) on conflict do nothing;
 select quantity into old_quantity from inventory where store_id=target_store and product_id=target_product for update;
 update inventory set quantity=new_quantity,updated_at=now() where store_id=target_store and product_id=target_product;
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,created_by) values(tenant,target_store,target_product,'adjustment',new_quantity-old_quantity,auth.uid());
end $$;

create or replace function public.checkout(target_store uuid,lines jsonb,payment_method text,request_id uuid,target_customer uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare tenant uuid; line record; product products%rowtype; available numeric; net numeric; tax numeric; gross numeric; total_net numeric:=0; total_tax numeric:=0; existing uuid; begin
 select entity_id into tenant from stores where id=target_store and is_active;
 if tenant is null or not can_read_entity(tenant) or app_role_name() not in ('super_admin','entity_admin','cashier') then raise exception 'Access denied'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,0));
 select id into existing from sales where id=request_id and entity_id=tenant and cashier_id=auth.uid();
 if existing is not null then return existing; end if;
 if request_id is null then raise exception 'Request ID required'; end if;
 if payment_method not in ('cash','card','upi') or payment_method is null then raise exception 'Invalid payment'; end if;
 if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)=0 or jsonb_array_length(lines)>200 then raise exception 'Invalid cart'; end if;
 if exists(select 1 from jsonb_array_elements(lines) where (value->>'quantity')::numeric is null or (value->>'quantity')::numeric<=0 or (value->>'quantity')::numeric<>trunc((value->>'quantity')::numeric)) then raise exception 'Invalid quantity'; end if;
 if target_customer is not null and not exists(select 1 from customers where id=target_customer and entity_id=tenant) then raise exception 'Invalid customer'; end if;
 insert into sales(id,entity_id,store_id,customer_id,invoice_number,subtotal,grand_total,cashier_id) values(request_id,tenant,target_store,target_customer,'INV-'||request_id::text,0,0,auth.uid());
 for line in select (value->>'product_id')::uuid as id,sum((value->>'quantity')::numeric) as qty from jsonb_array_elements(lines) group by 1 order by 1 loop
 if line.qty is null or line.qty<=0 or line.qty>100000 or line.qty<>trunc(line.qty) then raise exception 'Invalid quantity'; end if;
 select * into product from products where id=line.id and entity_id=tenant and is_active for share;
 if not found then raise exception 'Product unavailable'; end if;
 select quantity into available from inventory where store_id=target_store and product_id=line.id for update;
 if available is null or available<line.qty then raise exception 'Insufficient stock for %',product.name; end if;
 gross:=round(product.selling_price*line.qty,2); net:=gross; tax:=0;
 if product.tax_mode='inclusive' then net:=round(gross/(1+coalesce(product.tax_rate,0)/100),2); tax:=gross-net;
 elsif product.tax_mode='exclusive' then tax:=round(net*coalesce(product.tax_rate,0)/100,2); end if;
 total_net:=total_net+net; total_tax:=total_tax+tax;
 insert into sale_items(sale_id,product_id,quantity,unit_price,taxable_value,tax_rate,tax_amount) values(request_id,line.id,line.qty,product.selling_price,net,coalesce(product.tax_rate,0),tax);
 update inventory set quantity=quantity-line.qty,updated_at=now() where store_id=target_store and product_id=line.id;
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,created_by) values(tenant,target_store,line.id,'sale',-line.qty,request_id,auth.uid());
 end loop;
 if total_net+total_tax<=0 then raise exception 'Sale total must be positive'; end if;
 update sales set subtotal=total_net,tax_total=total_tax,grand_total=total_net+total_tax where id=request_id;
 insert into payments(sale_id,method,amount) values(request_id,payment_method,total_net+total_tax);
 return request_id;
end $$;
revoke all on function public.checkout(uuid,jsonb,text,uuid,uuid) from public;
grant execute on function public.checkout(uuid,jsonb,text,uuid,uuid) to authenticated;
revoke all on function public.adjust_stock(uuid,uuid,numeric) from public;
grant execute on function public.adjust_stock(uuid,uuid,numeric) to authenticated;

create or replace function public.set_team_active(target_user uuid,active boolean) returns void language plpgsql security definer set search_path=public as $$
declare member profiles%rowtype; begin
 select * into member from profiles where id=target_user for update;
 if not found or active is null or target_user=auth.uid() or member.role='super_admin' or not can_manage_entity(member.entity_id) or (app_role_name()<>'super_admin' and member.role<>'cashier') then raise exception 'Access denied'; end if;
 update profiles set is_active=active where id=target_user;
 insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id,metadata) values(member.entity_id,auth.uid(),'user.active_changed','profiles',target_user,jsonb_build_object('is_active',active));
end $$;
revoke all on function public.set_team_active(uuid,boolean) from public;
grant execute on function public.set_team_active(uuid,boolean) to authenticated;

$sql_0002$;
   insert into public.mypos_schema_migrations(version,filename) values('0002','0002_roles_and_checkout.sql');
  end if;
 end if;
end
$apply_0002$;

-- 0003_platform_security.sql
do $apply_0003$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0003') then
  if to_regclass('public.system_admins') is not null then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0003','0003_platform_security.sql',true);
  else
   execute $sql_0003$

create table public.system_admins(id uuid primary key references auth.users(id), is_active boolean not null default true, created_at timestamptz not null default now());
insert into system_admins(id,is_active) select id,is_active from profiles where role='super_admin';
alter table entities add column subscription_start date default current_date, add column subscription_expiry date, add column storage_limit_mb bigint not null default 1024 check(storage_limit_mb>0);
create table countries(code char(2) primary key, name text not null, currency char(3) not null, symbol text not null, timezone text not null, calling_code text not null, tax_framework text not null);
insert into countries values ('IN','India','INR','₹','Asia/Kolkata','+91','GST'),('AE','United Arab Emirates','AED','د.إ','Asia/Dubai','+971','VAT'),('GB','United Kingdom','GBP','£','Europe/London','+44','VAT'),('US','United States','USD','$','America/New_York','+1','Sales Tax'),('SG','Singapore','SGD','$','Asia/Singapore','+65','GST'),('AU','Australia','AUD','$','Australia/Sydney','+61','GST');
alter table entity_settings add column onboarding_completed boolean not null default false, add column date_format text not null default 'DD/MM/YYYY', add column registration_number text, add column tax_confirmed boolean not null default false;
create table entity_sessions(id uuid primary key, entity_id uuid not null references entities, user_id uuid not null references profiles, device text not null default '', ip inet, logged_in_at timestamptz not null default now(), last_activity timestamptz not null default now(), revoked_at timestamptz);
create index entity_sessions_active_idx on entity_sessions(entity_id,last_activity) where revoked_at is null;
create table permissions(code text primary key, label text not null);
insert into permissions select v,initcap(replace(v,'.',' ')) from unnest(array['sales.create','sales.discount','sales.void','sales.hold','returns.create','exchanges.create','customers.read','customers.manage','inventory.read','inventory.manage','products.manage','reports.read','reports.profit','purchases.manage','transfers.manage','users.manage','stores.manage','settings.manage','register.manage']) v;
create table user_permissions(user_id uuid references profiles, permission text references permissions, allowed boolean not null, max_discount_percent numeric not null default 0 check(max_discount_percent between 0 and 100), primary key(user_id,permission));
create table role_permissions(role app_role, permission text references permissions, primary key(role,permission));
insert into role_permissions select 'cashier'::app_role,v from unnest(array['sales.create','sales.hold','customers.read','customers.manage','inventory.read','register.manage']) v;
insert into role_permissions select 'store_manager'::app_role,code from permissions where code not in ('users.manage','stores.manage','settings.manage');
insert into role_permissions select 'inventory_manager'::app_role,v from unnest(array['inventory.read','inventory.manage','products.manage','purchases.manage','transfers.manage']) v;
create or replace function is_system_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from system_admins a join profiles p on p.id=a.id where a.id=auth.uid() and a.is_active and p.is_active) $$;
create or replace function session_id() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid $$;
create or replace function current_entity_id() returns uuid language sql stable security definer set search_path=public as $$
select p.entity_id from profiles p join entities e on e.id=p.entity_id join entity_sessions s on s.user_id=p.id and s.id=public.session_id() and s.entity_id=p.entity_id where p.id=auth.uid() and p.is_active and p.role<>'super_admin' and not is_system_admin() and e.status in ('trial','active') and (e.subscription_expiry is null or e.subscription_expiry>=current_date) and s.revoked_at is null and s.last_activity>now()-interval '15 minutes' $$;
create or replace function can_read_entity(target uuid) returns boolean language sql stable security definer set search_path=public as $$ select coalesce(target=current_entity_id(),false) $$;
create or replace function has_permission(code text) returns boolean language sql stable security definer set search_path=public as $$ select current_entity_id() is not null and (app_role_name()='entity_admin' or coalesce((select allowed from user_permissions where user_id=auth.uid() and permission=code),exists(select 1 from role_permissions where role::text=app_role_name() and permission=code))) $$;
create or replace function can_manage_entity(target uuid) returns boolean language sql stable security definer set search_path=public as $$ select can_read_entity(target) and app_role_name()='entity_admin' $$;
create or replace function can_access_store(target uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from stores where id=target and entity_id=current_entity_id() and (app_role_name()='entity_admin' or exists(select 1 from user_stores where user_id=auth.uid() and store_id=target))) $$;
create or replace function can_operate_store(target uuid) returns boolean language sql stable security definer set search_path=public as $$ select can_access_store(target) and exists(select 1 from stores where id=target and is_active) $$;
create or replace function register_session(device_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare p profiles%rowtype; e entities%rowtype; sid uuid:=public.session_id(); begin
 if is_system_admin() then return sid; end if;
 select * into p from profiles where id=auth.uid() and is_active and role<>'super_admin';
 if p.id is null or sid is null then raise exception 'Account unavailable'; end if;
 select * into e from entities where id=p.entity_id for update;
 if e.status not in ('active','trial') or e.subscription_expiry<current_date then raise exception 'Business suspended or subscription expired'; end if;
 if exists(select 1 from entity_sessions where id=sid and revoked_at is not null) then raise exception 'Session revoked. Sign in again'; end if;
 if not exists(select 1 from entity_sessions where id=sid and last_activity>now()-interval '15 minutes') and (select count(*) from entity_sessions where entity_id=e.id and revoked_at is null and last_activity>now()-interval '15 minutes')>=e.max_concurrent_sessions then raise exception 'Concurrent session limit reached'; end if;
 insert into entity_sessions(id,entity_id,user_id,device) values(sid,e.id,p.id,left(device_name,300)) on conflict(id) do update set last_activity=now() where entity_sessions.user_id=auth.uid() and entity_sessions.revoked_at is null;
 return sid;
end $$;
create or replace function revoke_session(target uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 update entity_sessions set revoked_at=now() where id=target and (user_id=auth.uid() or can_manage_entity(entity_id) or is_system_admin());
 if not found then raise exception 'Access denied'; end if;
end $$;
-- Replace policies on the previously shipped operational tables.
do $$ declare r record; begin
 for r in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('entities','profiles','stores','products','categories','customers','entity_settings','receipt_settings','sales','sale_items','payments','inventory','inventory_movements','register_shifts','audit_logs','financial_years') loop execute format('drop policy %I on %I',r.policyname,r.tablename); end loop;
end $$;
create policy platform_entities_read on entities for select to authenticated using(is_system_admin() or can_read_entity(id));
create policy platform_entities_insert on entities for insert to authenticated with check(is_system_admin());
create policy platform_entities_update on entities for update to authenticated using(is_system_admin()) with check(is_system_admin());
create policy own_profile on profiles for select to authenticated using(id=auth.uid() or (can_read_entity(entity_id) and has_permission('users.manage')));
create policy store_read on stores for select to authenticated using(can_access_store(id) or can_manage_entity(entity_id));
create policy store_insert on stores for insert to authenticated with check(can_read_entity(entity_id) and has_permission('stores.manage'));
create policy store_update on stores for update to authenticated using(can_read_entity(entity_id) and has_permission('stores.manage')) with check(can_read_entity(entity_id));
do $$ declare t text; perm text; begin
 foreach t in array array['products','categories','customers','entity_settings','receipt_settings'] loop
 perm:=case when t in ('products','categories') then 'products.manage' when t='customers' then 'customers.manage' else 'settings.manage' end;
 execute format('create policy tenant_read on %I for select to authenticated using(can_read_entity(entity_id))',t);
 execute format('create policy permitted_insert on %I for insert to authenticated with check(can_read_entity(entity_id) and has_permission(%L))',t,perm);
 execute format('create policy permitted_update on %I for update to authenticated using(can_read_entity(entity_id) and has_permission(%L)) with check(can_read_entity(entity_id))',t,perm);
 end loop;
 foreach t in array array['inventory_movements','register_shifts'] loop execute format('create policy store_read on %I for select to authenticated using(can_access_store(store_id))',t); end loop;
end $$;
create policy sale_read on sales for select to authenticated using(can_access_store(store_id) and (cashier_id=auth.uid() or has_permission('reports.read') or has_permission('returns.create') or has_permission('exchanges.create')));
create policy inventory_read on inventory for select to authenticated using(can_access_store(store_id) and has_permission('inventory.read'));
create policy items_read on sale_items for select to authenticated using(exists(select 1 from sales where id=sale_id and can_access_store(store_id)));
create policy payment_read on payments for select to authenticated using(exists(select 1 from sales where id=sale_id and can_access_store(store_id)));
create policy audit_read on audit_logs for select to authenticated using(can_manage_entity(entity_id));
create policy financial_years_read on financial_years for select to authenticated using(can_read_entity(entity_id));
create policy user_stores_read on user_stores for select to authenticated using(user_id=auth.uid() or exists(select 1 from stores where id=store_id and can_manage_entity(entity_id)));
-- Enforce limits even through service-role account provisioning.
create function resource_limit_guard() returns trigger language plpgsql security definer set search_path=public as $$ declare e entities%rowtype; n bigint; begin
 if new.entity_id is null then return new; end if;
 select * into e from entities where id=new.entity_id for update;
 if tg_table_name='stores' then select count(*) into n from stores where entity_id=e.id; if n>=e.max_stores then raise exception 'Store limit reached'; end if;
 else select count(*) into n from profiles where entity_id=e.id; if n>=e.max_users then raise exception 'User limit reached'; end if; end if;
 return new;
end $$;
create trigger stores_limit before insert on stores for each row execute function resource_limit_guard();
create trigger users_limit before insert on profiles for each row execute function resource_limit_guard();
create function tenant_reference_guard() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if tg_table_name='products' and new.category_id is not null and not exists(select 1 from categories where id=new.category_id and entity_id=new.entity_id) then raise exception 'Invalid category'; end if;
 return new;
end $$;
create trigger products_reference before insert or update on products for each row execute function tenant_reference_guard();
create function audit_change() returns trigger language plpgsql security definer set search_path=public as $$ declare record_data jsonb; tenant uuid; begin
 record_data:=to_jsonb(new); tenant:=case when tg_table_name='entities' then (record_data->>'id')::uuid else (record_data->>'entity_id')::uuid end;
 insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id,metadata) values(tenant,auth.uid(),lower(tg_op),tg_table_name,coalesce((record_data->>'id')::uuid,tenant),jsonb_build_object('old',case when tg_op='UPDATE' then to_jsonb(old) else null end,'new',record_data,'session_id',public.session_id())); return new;
end $$;
do $$ declare t text; begin foreach t in array array['entities','products','categories','stores','profiles','entity_settings'] loop execute format('create trigger audit_changes after insert or update on %I for each row execute function audit_change()',t); end loop; end $$;
create function initialize_entity() returns trigger language plpgsql security definer set search_path=public as $$ declare c countries%rowtype; begin
 select * into c from countries where code=new.country_code;
 if not found then raise exception 'Unsupported country'; end if;
 update entities set currency_code=c.currency,timezone=c.timezone where id=new.id;
 insert into entity_settings(entity_id,trading_name,tax_framework) values(new.id,new.name,c.tax_framework);
 insert into receipt_settings(entity_id) values(new.id);
 insert into categories(entity_id,name) select new.id,v from unnest(array['Fresh Items','Grocery & Kitchen','Snacks & Drinks','Beauty & Wellness','Household & Lifestyle']) v;
 return new;
end $$;
create trigger entity_defaults after insert on entities for each row execute function initialize_entity();
create function platform_overview() returns jsonb language plpgsql stable security definer set search_path=public as $$ begin
 if not is_system_admin() then raise exception 'Access denied'; end if;
 return (select coalesce(jsonb_agg(x),'[]') from (select e.*, (select count(*) from stores s where s.entity_id=e.id) as stores,(select count(*) from profiles p where p.entity_id=e.id) as users,(select count(*) from entity_sessions s where s.entity_id=e.id and s.revoked_at is null and s.last_activity>now()-interval '15 minutes') as sessions from entities e order by created_at desc) x);
end $$;
create function configure_user(target uuid, store_ids uuid[], grants jsonb) returns void language plpgsql security definer set search_path=public as $$ declare p profiles%rowtype; g record; begin
 select * into p from profiles where id=target for update;
 if not can_manage_entity(p.entity_id) or target=auth.uid() or p.role in ('super_admin','entity_admin') then raise exception 'Access denied'; end if;
 if exists(select 1 from unnest(store_ids) s where not exists(select 1 from stores where id=s and entity_id=p.entity_id)) then raise exception 'Invalid store'; end if;
 delete from user_stores where user_id=target; insert into user_stores select target,unnest(store_ids);
 delete from user_permissions where user_id=target;
 for g in select key,value from jsonb_each(grants) loop insert into user_permissions(user_id,permission,allowed,max_discount_percent) values(target,g.key,(g.value->>'allowed')::boolean,coalesce((g.value->>'max_discount_percent')::numeric,0)); end loop;
 insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id,metadata) values(p.entity_id,auth.uid(),'permissions.changed','profiles',target,jsonb_build_object('stores',store_ids,'permissions',grants));
end $$;
do $$ declare t text; begin foreach t in array array['system_admins','countries','entity_sessions','permissions','user_permissions','role_permissions'] loop execute format('alter table %I enable row level security',t); end loop; end $$;
create policy system_self on system_admins for select to authenticated using(id=auth.uid());
create policy country_read on countries for select to authenticated using(true);
create policy permission_read on permissions for select to authenticated using(true);
create policy role_permission_read on role_permissions for select to authenticated using(true);
create policy user_permission_read on user_permissions for select to authenticated using(user_id=auth.uid() or exists(select 1 from profiles where id=user_id and can_manage_entity(entity_id)));
create policy session_read on entity_sessions for select to authenticated using(user_id=auth.uid() or can_manage_entity(entity_id) or is_system_admin());
-- Only authenticated users may invoke public application functions.
do $$ declare r record; begin for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.prosecdef loop execute format('revoke execute on function %s from public',r.signature); execute format('grant execute on function %s to authenticated,service_role',r.signature); end loop; end $$;

$sql_0003$;
   insert into public.mypos_schema_migrations(version,filename) values('0003','0003_platform_security.sql');
  end if;
 end if;
end
$apply_0003$;

-- 0004_retail_operations.sql
do $apply_0004$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0004') then
  if to_regprocedure('public.advance_transfer(uuid,text)') is not null then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0004','0004_retail_operations.sql',true);
  else
   execute $sql_0004$

alter table categories add column sort_order integer not null default 0;
alter table categories add constraint category_tax_range check(default_tax_rate between 0 and 100);
alter table products add constraint product_tax_range check(tax_rate is null or tax_rate between 0 and 100);
alter table entity_settings add column tax_components jsonb not null default '{"Tax":100}';
create function tax_snapshot(tax numeric,tenant uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$ declare components jsonb; total_weight numeric; c record; result jsonb:='{}'; remaining numeric:=tax; count integer; i integer:=0; part numeric; begin
 if not can_read_entity(tenant) then raise exception 'Access denied'; end if;
 select tax_components into components from entity_settings where entity_id=tenant;
 select sum(value::numeric),count(*) into total_weight,count from jsonb_each_text(components);
 if total_weight<>100 or count=0 then raise exception 'Tax component weights must total 100'; end if;
 for c in select key,value::numeric weight from jsonb_each_text(components) order by key loop
 i:=i+1; if c.weight<0 then raise exception 'Invalid tax component'; end if;
 part:=case when i=count then remaining else round(tax*c.weight/100,2) end;remaining:=remaining-part;result:=result||jsonb_build_object(c.key,part);
 end loop;return result;
end $$;
create table tax_codes(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,name text not null,code text not null,rate numeric(7,4) not null check(rate between 0 and 100),components jsonb not null default '{}',is_active boolean not null default true,unique(entity_id,code));
alter table products add column tax_code_id uuid references tax_codes, add column batch_number text, add column manufactured_on date, add column expires_on date;
create function product_tax_rate(target uuid) returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(p.tax_rate,tc.rate,c.default_tax_rate,0) from products p left join categories c on c.id=p.category_id left join tax_codes tc on tc.id=p.tax_code_id and tc.entity_id=p.entity_id and tc.is_active where p.id=target and p.entity_id=current_entity_id()
$$;
create function product_tax_code_guard() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if new.tax_code_id is not null and not exists(select 1 from tax_codes where id=new.tax_code_id and entity_id=new.entity_id and is_active) then raise exception 'Invalid tax code';end if;return new;
end $$;
create trigger product_tax_code before insert or update on products for each row execute function product_tax_code_guard();
create table product_identifiers(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,product_id uuid not null references products,type text not null check(type in ('BARCODE','QR','SKU','INTERNAL_CODE')),identifier_value text not null check(length(identifier_value)>0),is_primary boolean not null default false,created_at timestamptz not null default now(),unique(entity_id,identifier_value));
create index product_identifiers_product_idx on product_identifiers(product_id);
create function sync_identifiers() returns trigger language plpgsql security definer set search_path=public as $$ begin
 delete from product_identifiers where product_id=new.id and is_primary;
 insert into product_identifiers(entity_id,product_id,type,identifier_value,is_primary) select new.entity_id,new.id,kind,value,true from (select distinct on(value) kind,value from (values ('SKU',new.sku),('INTERNAL_CODE',new.internal_code),('BARCODE',new.barcode),('QR',new.qr_identifier)) v(kind,value) where nullif(value,'') is not null order by value,kind) x;
 return new;
end $$;
create trigger product_identifiers_sync after insert or update of sku,internal_code,barcode,qr_identifier on products for each row execute function sync_identifiers();
insert into product_identifiers(entity_id,product_id,type,identifier_value,is_primary) select entity_id,id,'SKU',sku,true from products on conflict do nothing;
insert into product_identifiers(entity_id,product_id,type,identifier_value,is_primary) select entity_id,id,'BARCODE',barcode,true from products where barcode is not null on conflict do nothing;
alter table sale_items add column product_name text, add column sku text, add column tax_code text, add column line_total numeric(14,2), add column unit_cost numeric(14,2) not null default 0;
update sale_items si set product_name=p.name,sku=p.sku,tax_code=p.hsn_sac,line_total=si.taxable_value+si.tax_amount from products p where p.id=si.product_id;
create table held_sales(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,store_id uuid not null references stores,user_id uuid not null references profiles,cart jsonb not null,created_at timestamptz not null default now());
create table invoice_counters(entity_id uuid references entities,year integer,number bigint not null,primary key(entity_id,year));
create table suppliers(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,name text not null,email text,phone text,address text,tax_number text,is_active boolean not null default true,created_at timestamptz not null default now());
create table purchase_orders(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,store_id uuid not null references stores,supplier_id uuid not null references suppliers,status text not null default 'draft' check(status in ('draft','ordered','received','cancelled')),supplier_invoice text,created_by uuid not null references profiles,created_at timestamptz not null default now(),received_at timestamptz);
create table purchase_items(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,purchase_id uuid not null references purchase_orders,product_id uuid not null references products,quantity numeric(14,3) not null check(quantity>0),unit_cost numeric(14,2) not null check(unit_cost>=0));
create table goods_receipts(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,purchase_id uuid not null unique references purchase_orders,received_by uuid not null references profiles,received_at timestamptz not null default now());
create table stock_transfers(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,from_store uuid not null references stores,to_store uuid not null references stores,status text not null default 'requested' check(status in ('requested','approved','dispatched','received','cancelled')),created_by uuid not null references profiles,created_at timestamptz not null default now(),check(from_store<>to_store));
create table stock_transfer_items(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,transfer_id uuid not null references stock_transfers,product_id uuid not null references products,quantity numeric(14,3) not null check(quantity>0));
create table returns(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,store_id uuid not null references stores,sale_id uuid not null references sales,reason text not null,created_by uuid not null references profiles,total numeric(14,2) not null default 0,created_at timestamptz not null default now());
create table return_items(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,return_id uuid not null references returns,sale_item_id uuid not null references sale_items,quantity numeric(14,3) not null check(quantity>0),disposition text not null check(disposition in ('restocked','damaged','quarantined','disposed')),amount numeric(14,2) not null check(amount>=0));
create table refunds(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,return_id uuid not null references returns,method text not null,amount numeric(14,2) not null check(amount>=0),created_at timestamptz not null default now());
create table exchanges(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,return_id uuid not null unique references returns,replacement_sale_id uuid not null unique references sales,difference numeric(14,2) not null,created_at timestamptz not null default now());
create table cash_movements(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,shift_id uuid not null references register_shifts,amount numeric(14,2) not null,reason text not null,created_by uuid not null references profiles,created_at timestamptz not null default now());
alter table register_shifts add column close_reason text;
create unique index open_shift_per_cashier on register_shifts(cashier_id) where closed_at is null;
alter table sales add column shift_id uuid references register_shifts;
create table notifications(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,user_id uuid references profiles,message text not null,read_at timestamptz,created_at timestamptz not null default now());
-- Catalog RPC uses indexed exact identifiers and bounded, server-side pagination.
create function search_products(target_store uuid,search_text text default '',page_number integer default 0,include_archived boolean default false) returns jsonb language plpgsql stable security definer set search_path=public as $$ begin
 if not can_operate_store(target_store) or not has_permission('inventory.read') then raise exception 'Access denied'; end if;
 return (select coalesce(jsonb_agg(case when has_permission('reports.profit') or has_permission('products.manage') then to_jsonb(x) else to_jsonb(x)-'purchase_price' end),'[]') from (select p.*,coalesce(i.quantity,0) as stock,product_tax_rate(p.id) as resolved_tax_rate from products p left join categories c on c.id=p.category_id left join inventory i on i.product_id=p.id and i.store_id=target_store where p.entity_id=current_entity_id() and (p.is_active or (include_archived and has_permission('products.manage'))) and (search_text='' or p.name ilike '%'||search_text||'%' or exists(select 1 from product_identifiers pi where pi.product_id=p.id and pi.entity_id=current_entity_id() and pi.identifier_value=search_text)) order by p.name,p.id limit 48 offset greatest(page_number,0)*48) x);
end $$;
create function resolve_product(target_store uuid,identifier text) returns jsonb language plpgsql stable security definer set search_path=public as $$ declare result jsonb; begin
 if not can_operate_store(target_store) then raise exception 'Access denied'; end if;
 select case when has_permission('reports.profit') or has_permission('products.manage') then to_jsonb(x) else to_jsonb(x)-'purchase_price' end into result from (select p.*,coalesce(i.quantity,0) stock,product_tax_rate(p.id) resolved_tax_rate from product_identifiers pi join products p on p.id=pi.product_id left join categories c on c.id=p.category_id left join inventory i on i.product_id=p.id and i.store_id=target_store where pi.entity_id=current_entity_id() and pi.identifier_value=identifier and p.is_active) x;
 if result is null then raise exception 'Product not found'; end if; return result;
end $$;
create or replace function adjust_stock(target_store uuid,target_product uuid,new_quantity numeric) returns void language plpgsql security definer set search_path=public as $$ declare old_quantity numeric; begin
 if not can_operate_store(target_store) or not has_permission('inventory.manage') or not exists(select 1 from products where id=target_product and entity_id=current_entity_id()) then raise exception 'Access denied'; end if;
 if new_quantity is null or new_quantity<0 or new_quantity>100000000 then raise exception 'Invalid stock quantity'; end if;
 insert into inventory(store_id,product_id,quantity) values(target_store,target_product,0) on conflict do nothing;
 select quantity into old_quantity from inventory where store_id=target_store and product_id=target_product for update;
 update inventory set quantity=new_quantity,updated_at=now() where store_id=target_store and product_id=target_product;
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,created_by) values(current_entity_id(),target_store,target_product,'adjustment',new_quantity-old_quantity,auth.uid());
end $$;
create function checkout_v2(target_store uuid,lines jsonb,payment_lines jsonb,request_id uuid,target_customer uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare tenant uuid:=current_entity_id(); l jsonb; p products%rowtype; q numeric; available numeric; rate numeric; net numeric; tax numeric; gross numeric; discount numeric; max_discount numeric; total_net numeric:=0; total_tax numeric:=0; total_discount numeric:=0; seq bigint; fy integer; pay jsonb; paid numeric:=0; shift uuid; begin
 if not can_operate_store(target_store) or not has_permission('sales.create') then raise exception 'Access denied'; end if;
 if request_id is null then raise exception 'Request ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request_id::text,0));
 if exists(select 1 from sales where id=request_id and entity_id=tenant and cashier_id=auth.uid()) then return request_id; end if;
 if not exists(select 1 from entity_settings where entity_id=tenant and tax_confirmed) then raise exception 'Tax configuration missing. Ask your admin to complete setup'; end if;
 select id into shift from register_shifts where cashier_id=auth.uid() and store_id=target_store and closed_at is null for update;
 if shift is null then raise exception 'Open your register before completing a sale'; end if;
 if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 200 then raise exception 'Invalid cart'; end if;
 if payment_lines is null or jsonb_typeof(payment_lines)<>'array' or jsonb_array_length(payment_lines) not between 1 and 10 then raise exception 'Invalid payment'; end if;
 if target_customer is not null and not exists(select 1 from customers where id=target_customer and entity_id=tenant) then raise exception 'Invalid customer'; end if;
 fy:=extract(year from now());
 insert into invoice_counters values(tenant,fy,1) on conflict(entity_id,year) do update set number=invoice_counters.number+1 returning number into seq;
 insert into sales(id,entity_id,store_id,customer_id,invoice_number,subtotal,grand_total,cashier_id,currency_code,shift_id) select request_id,tenant,target_store,target_customer,'INV-'||fy||'-'||lpad(seq::text,6,'0'),0,0,auth.uid(),currency_code,shift from entities where id=tenant;
 for l in select value from jsonb_array_elements(lines) order by value->>'product_id' loop
 q:=(l->>'quantity')::numeric; discount:=coalesce((l->>'discount_percent')::numeric,0);
 if q is null or q<=0 or q>100000 or q<>round(q,3) or discount<0 or discount>100 then raise exception 'Invalid quantity or discount'; end if;
 max_discount:=case when app_role_name()='entity_admin' then 100 else coalesce((select max_discount_percent from user_permissions where user_id=auth.uid() and permission='sales.discount' and allowed),0) end;
 if discount>0 and (not has_permission('sales.discount') or discount>max_discount) then raise exception 'Discount exceeds your permission'; end if;
 select * into p from products where id=(l->>'product_id')::uuid and entity_id=tenant and is_active for share;
 if not found then raise exception 'Product unavailable'; end if;
 select quantity into available from inventory where store_id=target_store and product_id=p.id for update;
 if available is null or available<q then raise exception 'Insufficient stock'; end if;
 rate:=product_tax_rate(p.id);
 gross:=round(p.selling_price*q*(1-discount/100),2); net:=gross; tax:=0;
 if p.tax_mode='inclusive' then net:=round(gross/(1+rate/100),2); tax:=gross-net; elsif p.tax_mode='exclusive' then tax:=round(net*rate/100,2); end if;
 total_net:=total_net+net; total_tax:=total_tax+tax; total_discount:=total_discount+round(p.selling_price*q*discount/100,2);
 insert into sale_items(sale_id,product_id,product_name,sku,tax_code,quantity,unit_price,unit_cost,discount_amount,taxable_value,tax_rate,tax_amount,tax_components,line_total) values(request_id,p.id,p.name,p.sku,p.hsn_sac,q,p.selling_price,p.purchase_price,round(p.selling_price*q*discount/100,2),net,rate,tax,tax_snapshot(tax,tenant),net+tax);
 update inventory set quantity=quantity-q,updated_at=now() where store_id=target_store and product_id=p.id;
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,created_by) values(tenant,target_store,p.id,'sale',-q,request_id,auth.uid());
 end loop;
 for pay in select value from jsonb_array_elements(payment_lines) loop
 if pay->>'method' not in ('cash','upi','credit_card','debit_card','card','exchange_credit','customer_credit','store_credit') or (pay->>'amount')::numeric is null or (pay->>'amount')::numeric<=0 then raise exception 'Invalid payment'; end if;
 if pay->>'method'='exchange_credit' then
 perform 1 from returns r join refunds rf on rf.return_id=r.id where r.id=(pay->>'reference')::uuid and r.entity_id=tenant and rf.method='exchange' and rf.amount>=(pay->>'amount')::numeric and not exists(select 1 from payments pm where pm.method='exchange_credit' and pm.reference=pay->>'reference') for update of r;
 if not found then raise exception 'Invalid exchange credit'; end if; end if;
 paid:=paid+round((pay->>'amount')::numeric,2);
 insert into payments(sale_id,method,amount,reference) values(request_id,pay->>'method',round((pay->>'amount')::numeric,2),pay->>'reference');
 end loop;
 if paid<>total_net+total_tax then raise exception 'Payment total must equal the sale total'; end if;
 update sales set subtotal=total_net,tax_total=total_tax,discount_total=total_discount,grand_total=total_net+total_tax where id=request_id;
 return request_id;
end $$;
-- Retire the original checkout entry point; callers cannot bypass shifts or permissions.
create or replace function checkout(target_store uuid,lines jsonb,payment_method text,request_id uuid,target_customer uuid default null) returns uuid language plpgsql security definer set search_path=public as $$ begin raise exception 'Please update the app and use checkout_v2'; end $$;
create function process_return(original_sale uuid,items jsonb,reason text,refund_method text,request_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s sales%rowtype; l jsonb; si sale_items%rowtype; returned numeric; q numeric; amount numeric; return_total numeric:=0; disposition text; begin
 select * into s from sales where id=original_sale for update;
 if not found or not can_operate_store(s.store_id) or not has_permission('returns.create') then raise exception 'Access denied'; end if;
 if request_id is null then raise exception 'Request ID required'; end if;
 if exists(select 1 from returns where id=request_id and sale_id=original_sale) then return request_id; end if;
 if s.status='voided' then raise exception 'Sale is voided'; end if;
 if refund_method='cash' and not exists(select 1 from register_shifts where cashier_id=auth.uid() and store_id=s.store_id and closed_at is null) then raise exception 'Open your register before a cash refund'; end if;
 if length(trim(reason))<3 or reason is null or refund_method not in ('cash','upi','card','exchange','customer_credit','store_credit') then raise exception 'Reason and refund method required'; end if;
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 200 then raise exception 'Select return items'; end if;
 insert into returns(id,entity_id,store_id,sale_id,reason,created_by) values(request_id,s.entity_id,s.store_id,s.id,reason,auth.uid());
 for l in select value from jsonb_array_elements(items) order by value->>'sale_item_id' loop
 select * into si from sale_items where id=(l->>'sale_item_id')::uuid and sale_id=s.id for update;
 if not found then raise exception 'Invalid original item'; end if;
 q:=(l->>'quantity')::numeric; disposition:=l->>'disposition';
 select coalesce(sum(quantity),0) into returned from return_items where sale_item_id=si.id;
 if q is null or q<=0 or q>si.quantity-returned or q<>round(q,3) then raise exception 'Invalid return quantity'; end if;
 amount:=case when q=si.quantity-returned then si.line_total-coalesce((select sum(ri.amount) from return_items ri where ri.sale_item_id=si.id),0) else round(si.line_total*q/si.quantity,2) end;
 insert into return_items(entity_id,return_id,sale_item_id,quantity,disposition,amount) values(s.entity_id,request_id,si.id,q,disposition,amount);
 if disposition='restocked' then
 update inventory set quantity=quantity+q,updated_at=now() where store_id=s.store_id and product_id=si.product_id;
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,created_by) values(s.entity_id,s.store_id,si.product_id,'customer_return',q,request_id,auth.uid());
 end if;
 return_total:=return_total+amount;
 end loop;
 update returns set total=return_total where id=request_id;
 insert into refunds(entity_id,return_id,method,amount) values(s.entity_id,request_id,refund_method,return_total);
 update sales set status=case when not exists(select 1 from sale_items original_item where original_item.sale_id=s.id and original_item.quantity>(select coalesce(sum(ri.quantity),0) from return_items ri where ri.sale_item_id=original_item.id)) then 'refunded'::sale_status else 'partially_refunded'::sale_status end where id=s.id;
 insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id) values(s.entity_id,auth.uid(),'return.processed','returns',request_id);
 return request_id;
end $$;
create unique index exchange_credit_once on payments(reference) where method='exchange_credit';
create function process_exchange(original_sale uuid,return_lines jsonb,replacement_lines jsonb,payment_lines jsonb,reason text,request_id uuid) returns uuid language plpgsql security definer set search_path=public as $$ declare s sales%rowtype; rid uuid; sid uuid; difference numeric; replacement_total numeric:=0; credit numeric; returned_total numeric; l jsonb; p products%rowtype; value numeric; rate numeric; begin
 select * into s from sales where id=original_sale for update;
 if not has_permission('exchanges.create') or not can_operate_store(s.store_id) then raise exception 'Access denied'; end if;
 if request_id is null then raise exception 'Request ID required'; end if;
 if exists(select 1 from exchanges where id=request_id and entity_id=current_entity_id()) then return request_id; end if;
 rid:=process_return(original_sale,return_lines,reason,'exchange',gen_random_uuid());
 for l in select e.value from jsonb_array_elements(replacement_lines) e order by e.value->>'product_id' loop
 select * into p from products where id=(l->>'product_id')::uuid and entity_id=current_entity_id() for share;
 if not found then raise exception 'Product unavailable'; end if;
 rate:=product_tax_rate(p.id);
 value:=round(p.selling_price*(l->>'quantity')::numeric*(1-coalesce((l->>'discount_percent')::numeric,0)/100),2);
 if p.tax_mode='exclusive' then value:=value+round(value*rate/100,2); end if;
 replacement_total:=replacement_total+value;
 end loop;
 select total into returned_total from returns where id=rid;
 credit:=least(returned_total,replacement_total);
 sid:=checkout_v2(s.store_id,replacement_lines,coalesce(payment_lines,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('method','exchange_credit','amount',credit,'reference',rid::text)),gen_random_uuid(),s.customer_id);
 difference:=replacement_total-returned_total;
 if difference<0 then update refunds set amount=credit where return_id=rid and method='exchange'; insert into refunds(entity_id,return_id,method,amount) values(s.entity_id,rid,'cash',-difference); end if;
 insert into exchanges(id,entity_id,return_id,replacement_sale_id,difference) values(request_id,s.entity_id,rid,sid,difference);
 return request_id;
end $$;
create function register_action(target_store uuid,action text,amount numeric,reason text default '') returns uuid language plpgsql security definer set search_path=public as $$ declare shift register_shifts%rowtype; expected numeric; begin
 if not can_operate_store(target_store) or not has_permission('register.manage') then raise exception 'Access denied'; end if;
 if amount is null or amount<0 then raise exception 'Invalid cash amount'; end if;
 if action='open' then insert into register_shifts(entity_id,store_id,cashier_id,opening_cash) values(current_entity_id(),target_store,auth.uid(),amount) returning * into shift; return shift.id; end if;
 select * into shift from register_shifts where cashier_id=auth.uid() and store_id=target_store and closed_at is null for update;
 if not found then raise exception 'No open register'; end if;
 if action in ('add','withdraw') then
 if length(trim(reason))<3 then raise exception 'Reason required'; end if;
 insert into cash_movements(entity_id,shift_id,amount,reason,created_by) values(current_entity_id(),shift.id,case when action='add' then amount else -amount end,reason,auth.uid());
 elsif action='close' then
 select shift.opening_cash+coalesce((select sum(p.amount) from payments p join sales s on s.id=p.sale_id where s.shift_id=shift.id and p.method='cash'),0)+coalesce((select sum(cm.amount) from cash_movements cm where cm.shift_id=shift.id),0)-coalesce((select sum(rf.amount) from refunds rf join returns r on r.id=rf.return_id where r.created_by=auth.uid() and r.store_id=target_store and r.created_at>=shift.opened_at and rf.method='cash'),0) into expected;
 if amount<>expected and length(trim(reason))<3 then raise exception 'Explain the cash variance'; end if;
 update register_shifts set closed_at=now(),expected_cash=expected,actual_cash=amount,difference=amount-expected,close_reason=reason where id=shift.id;
 else raise exception 'Invalid register action'; end if; return shift.id;
end $$;
create function create_purchase(target_store uuid,supplier uuid,items jsonb,invoice text default '') returns uuid language plpgsql security definer set search_path=public as $$ declare pid uuid; l jsonb; begin
 if not can_operate_store(target_store) or not has_permission('purchases.manage') or not exists(select 1 from suppliers where id=supplier and entity_id=current_entity_id()) then raise exception 'Access denied'; end if;
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 200 then raise exception 'Purchase items required'; end if;
 insert into purchase_orders(entity_id,store_id,supplier_id,created_by,supplier_invoice,status) values(current_entity_id(),target_store,supplier,auth.uid(),invoice,'ordered') returning id into pid;
 for l in select value from jsonb_array_elements(items) loop
 if not exists(select 1 from products where id=(l->>'product_id')::uuid and entity_id=current_entity_id()) then raise exception 'Invalid product'; end if;
 insert into purchase_items(entity_id,purchase_id,product_id,quantity,unit_cost) values(current_entity_id(),pid,(l->>'product_id')::uuid,(l->>'quantity')::numeric,(l->>'unit_cost')::numeric);
 end loop; return pid;
end $$;
create function receive_purchase(target uuid) returns void language plpgsql security definer set search_path=public as $$ declare p purchase_orders%rowtype; l purchase_items%rowtype; begin
 select * into p from purchase_orders where id=target for update;
 if not can_operate_store(p.store_id) or not has_permission('purchases.manage') then raise exception 'Access denied'; end if;
 if p.status='received' then return; end if;
 if p.status<>'ordered' then raise exception 'Purchase is not ordered'; end if;
 for l in select * from purchase_items where purchase_id=p.id order by product_id loop
 insert into inventory(store_id,product_id,quantity) values(p.store_id,l.product_id,l.quantity) on conflict(store_id,product_id) do update set quantity=inventory.quantity+excluded.quantity,updated_at=now();
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,unit_cost,created_by) values(p.entity_id,p.store_id,l.product_id,'purchase',l.quantity,p.id,l.unit_cost,auth.uid());
 end loop;
 insert into goods_receipts(entity_id,purchase_id,received_by) values(p.entity_id,p.id,auth.uid()); update purchase_orders set status='received',received_at=now() where id=p.id;
end $$;
create function request_transfer(source_store uuid,destination_store uuid,product uuid,quantity numeric) returns uuid language plpgsql security definer set search_path=public as $$ declare tid uuid; begin
 if not has_permission('transfers.manage') or not can_operate_store(source_store) or not can_operate_store(destination_store) or not exists(select 1 from products where id=product and entity_id=current_entity_id()) then raise exception 'Access denied'; end if;
 insert into stock_transfers(entity_id,from_store,to_store,created_by) values(current_entity_id(),source_store,destination_store,auth.uid()) returning id into tid;
 insert into stock_transfer_items(entity_id,transfer_id,product_id,quantity) values(current_entity_id(),tid,product,quantity); return tid;
end $$;
create function advance_transfer(target uuid,next_status text) returns void language plpgsql security definer set search_path=public as $$ declare t stock_transfers%rowtype; l stock_transfer_items%rowtype; begin
 select * into t from stock_transfers where id=target for update;
 if not has_permission('transfers.manage') or not can_operate_store(t.from_store) or not can_operate_store(t.to_store) then raise exception 'Access denied'; end if;
 if not ((t.status='requested' and next_status in ('approved','cancelled')) or (t.status='approved' and next_status in ('dispatched','cancelled')) or (t.status='dispatched' and next_status='received')) then raise exception 'Invalid transfer transition'; end if;
 for l in select * from stock_transfer_items where transfer_id=t.id order by product_id loop
 if next_status='dispatched' then
 update inventory set quantity=quantity-l.quantity,updated_at=now() where store_id=t.from_store and product_id=l.product_id and quantity>=l.quantity;
 if not found then raise exception 'Insufficient stock'; end if;
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,created_by) values(t.entity_id,t.from_store,l.product_id,'transfer_out',-l.quantity,t.id,auth.uid());
 elsif next_status='received' then
 insert into inventory(store_id,product_id,quantity) values(t.to_store,l.product_id,l.quantity) on conflict(store_id,product_id) do update set quantity=inventory.quantity+excluded.quantity;
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,created_by) values(t.entity_id,t.to_store,l.product_id,'transfer_in',l.quantity,t.id,auth.uid());
 end if; end loop;
 update stock_transfers set status=next_status where id=t.id;
 insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id,metadata) values(t.entity_id,auth.uid(),'transfer.'||next_status,'stock_transfers',t.id,jsonb_build_object('previous',t.status));
end $$;
do $$ declare t text; begin
 foreach t in array array['tax_codes','product_identifiers','held_sales','invoice_counters','suppliers','purchase_orders','purchase_items','goods_receipts','stock_transfers','stock_transfer_items','returns','return_items','refunds','exchanges','cash_movements','notifications'] loop
 execute format('alter table %I enable row level security',t);
 if t not in ('invoice_counters','held_sales','purchase_orders','returns','stock_transfers') then execute format('create policy tenant_read on %I for select to authenticated using(can_read_entity(entity_id))',t); end if;
 end loop;
end $$;
create policy purchase_read on purchase_orders for select to authenticated using(can_access_store(store_id) and has_permission('purchases.manage'));
create policy return_read on returns for select to authenticated using(can_access_store(store_id));
create policy transfer_read on stock_transfers for select to authenticated using(can_access_store(from_store) or can_access_store(to_store));
create policy held_read on held_sales for select to authenticated using(can_access_store(store_id) and has_permission('sales.hold'));
create policy held_insert on held_sales for insert to authenticated with check(entity_id=current_entity_id() and user_id=auth.uid() and can_access_store(store_id) and has_permission('sales.hold'));
create policy held_delete on held_sales for delete to authenticated using(user_id=auth.uid() and can_access_store(store_id));
create policy supplier_write on suppliers for all to authenticated using(can_read_entity(entity_id) and has_permission('purchases.manage')) with check(can_read_entity(entity_id) and has_permission('purchases.manage'));
create policy tax_write on tax_codes for all to authenticated using(can_manage_entity(entity_id)) with check(can_manage_entity(entity_id));
create policy identifier_write on product_identifiers for insert to authenticated with check(can_read_entity(entity_id) and has_permission('products.manage') and exists(select 1 from products where id=product_id and entity_id=current_entity_id()));
do $$ declare r record; begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.prosecdef loop execute format('revoke execute on function %s from public',r.signature); execute format('grant execute on function %s to authenticated,service_role',r.signature); end loop; end $$;

$sql_0004$;
   insert into public.mypos_schema_migrations(version,filename) values('0004','0004_retail_operations.sql');
  end if;
 end if;
end
$apply_0004$;

-- 0005_storage_and_limits.sql
do $apply_0005$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0005') then
  if to_regclass('public.operation_limits') is not null then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0005','0005_storage_and_limits.sql',true);
  else
   execute $sql_0005$

create table operation_limits(user_id uuid references auth.users,operation text,bucket timestamptz,hits integer not null,primary key(user_id,operation,bucket));
alter table operation_limits enable row level security;
create function consume_operation(operation text,maximum integer) returns void language plpgsql security definer set search_path=public as $$ declare hits integer; begin
 if auth.uid() is null then raise exception 'Access denied'; end if;
 insert into operation_limits values(auth.uid(),operation,date_trunc('hour',now()),1) on conflict(user_id,operation,bucket) do update set hits=operation_limits.hits+1 returning operation_limits.hits into hits;
 if hits>least(greatest(maximum,1),20) then raise exception 'Too many requests. Try later'; end if;
end $$;
revoke execute on function consume_operation(text,integer) from public;
grant execute on function consume_operation(text,integer) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('entity-logos','entity-logos',false,2097152,array['image/png','image/jpeg','image/webp']),('product-images','product-images',false,5242880,array['image/png','image/jpeg','image/webp']),('report-files','report-files',false,20971520,array['application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) on conflict(id) do nothing;
create policy tenant_file_read on storage.objects for select to authenticated using(bucket_id in ('entity-logos','product-images','report-files') and (storage.foldername(name))[1]='entities' and (storage.foldername(name))[2]=public.current_entity_id()::text and (bucket_id<>'report-files' or public.has_permission('reports.read')));
create policy tenant_file_insert on storage.objects for insert to authenticated with check((storage.foldername(name))[1]='entities' and (storage.foldername(name))[2]=public.current_entity_id()::text and ((bucket_id='entity-logos' and public.has_permission('settings.manage')) or (bucket_id='product-images' and public.has_permission('products.manage'))));
create policy tenant_file_delete on storage.objects for delete to authenticated using((storage.foldername(name))[1]='entities' and (storage.foldername(name))[2]=public.current_entity_id()::text and ((bucket_id='entity-logos' and public.has_permission('settings.manage')) or (bucket_id='product-images' and public.has_permission('products.manage'))));

$sql_0005$;
   insert into public.mypos_schema_migrations(version,filename) values('0005','0005_storage_and_limits.sql');
  end if;
 end if;
end
$apply_0005$;

-- 0006_reporting_and_guards.sql
do $apply_0006$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0006') then
  if to_regprocedure('public.void_sale(uuid,text,uuid)') is not null then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0006','0006_reporting_and_guards.sql',true);
  else
   execute $sql_0006$

-- Child records inherit parent store visibility, not just tenant membership.
drop policy tenant_read on purchase_items;
create policy purchase_item_read on purchase_items for select to authenticated using(exists(select 1 from purchase_orders p where p.id=purchase_id and can_access_store(p.store_id) and has_permission('purchases.manage')));
drop policy tenant_read on goods_receipts;
create policy goods_read on goods_receipts for select to authenticated using(exists(select 1 from purchase_orders p where p.id=purchase_id and can_access_store(p.store_id) and has_permission('purchases.manage')));
drop policy tenant_read on return_items;
create policy returned_item_read on return_items for select to authenticated using(exists(select 1 from returns r where r.id=return_id and can_access_store(r.store_id)));
drop policy tenant_read on refunds;
create policy refund_read on refunds for select to authenticated using(exists(select 1 from returns r where r.id=return_id and can_access_store(r.store_id)));
drop policy tenant_read on exchanges;
create policy exchange_read on exchanges for select to authenticated using(exists(select 1 from returns r where r.id=return_id and can_access_store(r.store_id)));
drop policy tenant_read on stock_transfer_items;
create policy transfer_item_read on stock_transfer_items for select to authenticated using(exists(select 1 from stock_transfers t where t.id=transfer_id and (can_access_store(t.from_store) or can_access_store(t.to_store))));
drop policy tenant_read on cash_movements;
create policy cash_read on cash_movements for select to authenticated using(exists(select 1 from register_shifts r where r.id=shift_id and can_access_store(r.store_id)));
create function report_rows(report_name text,starts_at timestamptz,ends_at timestamptz,target_store uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$ declare result jsonb; begin
 if not has_permission('reports.read') or (target_store is not null and not can_access_store(target_store)) then raise exception 'Access denied'; end if;
 if starts_at is null or ends_at is null or ends_at<=starts_at or ends_at-starts_at>interval '367 days' then raise exception 'Select a date range of at most one year'; end if;
 if report_name in ('sales','tax','discounts') then
 select coalesce(jsonb_agg(x),'[]') into result from (select s.id,s.invoice_number,s.completed_at,st.name store,p.display_name cashier,s.status,s.subtotal,s.discount_total,s.tax_total,s.grand_total,s.currency_code from sales s join stores st on st.id=s.store_id join profiles p on p.id=s.cashier_id where s.entity_id=current_entity_id() and can_access_store(s.store_id) and (target_store is null or s.store_id=target_store) and s.completed_at>=starts_at and s.completed_at<ends_at order by s.completed_at desc limit 10000) x;
 elsif report_name in ('products','categories','profit') then
 if report_name='profit' and not has_permission('reports.profit') then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(x),'[]') into result from (select si.sku,si.product_name,sum(si.quantity) quantity,sum(si.taxable_value) taxable_value,sum(si.tax_amount) tax,sum(si.line_total) gross,case when report_name='profit' then sum(si.taxable_value-si.quantity*si.unit_cost) else null end margin_before_returns from sale_items si join sales s on s.id=si.sale_id where s.entity_id=current_entity_id() and can_access_store(s.store_id) and (target_store is null or s.store_id=target_store) and s.completed_at>=starts_at and s.completed_at<ends_at group by si.sku,si.product_name order by gross desc limit 10000) x;
 elsif report_name='payments' then
 select coalesce(jsonb_agg(x),'[]') into result from (select p.method,sum(p.amount) amount,count(*) transactions from payments p join sales s on s.id=p.sale_id where s.entity_id=current_entity_id() and can_access_store(s.store_id) and (target_store is null or s.store_id=target_store) and s.completed_at>=starts_at and s.completed_at<ends_at group by p.method) x;
 elsif report_name in ('inventory','low_stock','expiry') then
 select coalesce(jsonb_agg(x),'[]') into result from (select p.name,p.sku,s.name store,i.quantity,p.reorder_level,p.expires_on from inventory i join products p on p.id=i.product_id join stores s on s.id=i.store_id where p.entity_id=current_entity_id() and can_access_store(i.store_id) and (target_store is null or i.store_id=target_store) and (report_name<>'low_stock' or i.quantity<=p.reorder_level) and (report_name<>'expiry' or p.expires_on between starts_at::date and ends_at::date) order by p.name limit 10000) x;
 elsif report_name='returns' then
 select coalesce(jsonb_agg(x),'[]') into result from (select r.id,r.created_at,s.invoice_number,r.reason,r.total from returns r join sales s on s.id=r.sale_id where r.entity_id=current_entity_id() and can_access_store(r.store_id) and (target_store is null or r.store_id=target_store) and r.created_at>=starts_at and r.created_at<ends_at order by r.created_at desc limit 10000) x;
 elsif report_name='exchanges' then
 select coalesce(jsonb_agg(x),'[]') into result from (select e.* from exchanges e join returns r on r.id=e.return_id where e.entity_id=current_entity_id() and can_access_store(r.store_id) and (target_store is null or r.store_id=target_store) and e.created_at>=starts_at and e.created_at<ends_at limit 10000) x;
 elsif report_name='movements' then
 select coalesce(jsonb_agg(x),'[]') into result from (select m.created_at,p.name,m.movement_type,m.quantity,m.reference_id from inventory_movements m join products p on p.id=m.product_id where m.entity_id=current_entity_id() and can_access_store(m.store_id) and (target_store is null or m.store_id=target_store) and m.created_at>=starts_at and m.created_at<ends_at order by m.created_at desc limit 10000) x;
 elsif report_name='purchases' then
 if not has_permission('purchases.manage') then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(x),'[]') into result from (select p.id,s.name supplier,p.supplier_invoice,p.status,p.created_at,p.received_at from purchase_orders p join suppliers s on s.id=p.supplier_id where p.entity_id=current_entity_id() and can_access_store(p.store_id) and (target_store is null or p.store_id=target_store) and p.created_at>=starts_at and p.created_at<ends_at order by p.created_at desc limit 10000) x;
 elsif report_name='registers' then
 select coalesce(jsonb_agg(x),'[]') into result from (select r.* from register_shifts r where r.entity_id=current_entity_id() and can_access_store(r.store_id) and (target_store is null or r.store_id=target_store) and r.opened_at>=starts_at and r.opened_at<ends_at limit 10000) x;
 elsif report_name='audit' then
 if not can_manage_entity(current_entity_id()) then raise exception 'Access denied'; end if;
 select coalesce(jsonb_agg(x),'[]') into result from (select created_at,actor_id,action,resource_type,resource_id from audit_logs where entity_id=current_entity_id() and created_at>=starts_at and created_at<ends_at order by created_at desc limit 10000) x;
 else raise exception 'Unknown report'; end if; return result;
end $$;
revoke execute on function report_rows(text,timestamptz,timestamptz,uuid) from public;
grant execute on function report_rows(text,timestamptz,timestamptz,uuid) to authenticated;
-- Prevent category cycles and cross-tenant parents.
create function category_parent_guard() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if new.parent_id is not null then
 if not exists(select 1 from categories where id=new.parent_id and entity_id=new.entity_id) then raise exception 'Invalid parent category'; end if;
 if exists(with recursive ancestors as (select id,parent_id from categories where id=new.parent_id union select c.id,c.parent_id from categories c join ancestors a on c.id=a.parent_id) select 1 from ancestors where id=new.id) then raise exception 'Category hierarchy cannot contain cycles'; end if;
 end if; return new;
end $$;
create trigger category_parent before insert or update on categories for each row execute function category_parent_guard();
-- User/store assignments remain tenant-safe even through privileged provisioning.
create function user_store_guard() returns trigger language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from stores s join profiles p on p.entity_id=s.entity_id where s.id=new.store_id and p.id=new.user_id) then raise exception 'Invalid store assignment'; end if; return new;
end $$;
create trigger user_store_tenant before insert or update on user_stores for each row execute function user_store_guard();
create or replace function set_team_active(target_user uuid,active boolean) returns void language plpgsql security definer set search_path=public as $$ declare member profiles%rowtype; begin
 select * into member from profiles where id=target_user for update;
 if not found or active is null or target_user=auth.uid() or member.role in ('super_admin','entity_admin') or not can_manage_entity(member.entity_id) then raise exception 'Access denied'; end if;
 update profiles set is_active=active where id=target_user;
 if not active then update entity_sessions set revoked_at=now() where user_id=target_user and revoked_at is null; end if;
end $$;
create function void_sale(target uuid,reason text,request_id uuid) returns void language plpgsql security definer set search_path=public as $$ declare original sales%rowtype; lines jsonb; begin
 select * into original from sales where id=target for update;
 if not can_access_store(original.store_id) or not has_permission('sales.void') then raise exception 'Access denied'; end if;
 if original.status='voided' then return; end if;
 if original.status<>'completed' then raise exception 'Only completed sales without returns can be voided'; end if;
 select jsonb_agg(jsonb_build_object('sale_item_id',id,'quantity',quantity,'disposition','restocked')) into lines from sale_items where sale_id=target;
 perform process_return(target,lines,reason,'cash',request_id);
 update sales set status='voided' where id=target;
 insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id,metadata) values(original.entity_id,auth.uid(),'sale.voided','sales',target,jsonb_build_object('reason',reason));
end $$;
revoke execute on function void_sale(uuid,text,uuid) from public;
grant execute on function void_sale(uuid,text,uuid) to authenticated;
-- Cost fields are readable only through permission-checked RPCs, never raw client selects.
do $$ declare cols text; t text; hidden text; begin
 foreach t in array array['products','sale_items'] loop
 hidden:=case when t='products' then 'purchase_price' else 'unit_cost' end;
 execute format('revoke select on %I from authenticated',t);
 select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=t and column_name<>hidden;
 execute format('grant select (%s) on %I to authenticated',cols,t);
 end loop;
end $$;

$sql_0006$;
   insert into public.mypos_schema_migrations(version,filename) values('0006','0006_reporting_and_guards.sql');
  end if;
 end if;
end
$apply_0006$;

-- 0007_credit_and_purchase_returns.sql
do $apply_0007$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0007') then
  if to_regclass('public.customer_accounts') is not null then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0007','0007_credit_and_purchase_returns.sql',true);
  else
   execute $sql_0007$

create table customer_accounts(customer_id uuid primary key references customers,entity_id uuid not null references entities,credit_limit numeric(14,2) not null default 0 check(credit_limit>=0),credit_used numeric(14,2) not null default 0 check(credit_used>=0),store_credit numeric(14,2) not null default 0 check(store_credit>=0));
create table customer_account_movements(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,customer_id uuid not null references customers,kind text not null,amount numeric(14,2) not null,reference_id uuid,created_by uuid references profiles,created_at timestamptz not null default now());
create table purchase_returns(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,purchase_id uuid not null references purchase_orders,store_id uuid not null references stores,reason text not null,created_by uuid not null references profiles,created_at timestamptz not null default now());
create table purchase_return_items(id uuid primary key default gen_random_uuid(),entity_id uuid not null references entities,return_id uuid not null references purchase_returns,purchase_item_id uuid not null references purchase_items,quantity numeric(14,3) not null check(quantity>0));
create function set_customer_credit(target uuid,maximum numeric) returns void language plpgsql security definer set search_path=public as $$ begin
 if not can_manage_entity(current_entity_id()) or not exists(select 1 from customers where id=target and entity_id=current_entity_id()) or maximum is null or maximum<0 then raise exception 'Access denied'; end if;
 insert into customer_accounts(customer_id,entity_id,credit_limit) values(target,current_entity_id(),maximum) on conflict(customer_id) do update set credit_limit=excluded.credit_limit;
 insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id,metadata) values(current_entity_id(),auth.uid(),'customer.credit_limit','customers',target,jsonb_build_object('limit',maximum));
end $$;
create function account_payment_guard() returns trigger language plpgsql security definer set search_path=public as $$ declare s sales%rowtype; begin
 if new.method not in ('customer_credit','store_credit') then return new; end if;
 select * into s from sales where id=new.sale_id;
 if s.customer_id is null then raise exception 'Select a customer for credit payments'; end if;
 insert into customer_accounts(customer_id,entity_id) values(s.customer_id,s.entity_id) on conflict do nothing;
 if new.method='customer_credit' then update customer_accounts set credit_used=credit_used+new.amount where customer_id=s.customer_id and credit_used+new.amount<=credit_limit;
 else update customer_accounts set store_credit=store_credit-new.amount where customer_id=s.customer_id and store_credit>=new.amount; end if;
 if not found then raise exception 'Insufficient customer credit'; end if;
 insert into customer_account_movements(entity_id,customer_id,kind,amount,reference_id,created_by) values(s.entity_id,s.customer_id,new.method,new.amount,s.id,auth.uid());return new;
end $$;
create trigger credit_payment before insert on payments for each row execute function account_payment_guard();
create function account_refund_guard() returns trigger language plpgsql security definer set search_path=public as $$ declare customer uuid; tenant uuid; begin
 if new.method not in ('customer_credit','store_credit') then return new; end if;
 select s.customer_id,s.entity_id into customer,tenant from returns r join sales s on s.id=r.sale_id where r.id=new.return_id;
 if customer is null then raise exception 'A customer is required for credit refunds'; end if;
 insert into customer_accounts(customer_id,entity_id) values(customer,tenant) on conflict do nothing;
 if new.method='customer_credit' then update customer_accounts set credit_used=credit_used-new.amount where customer_id=customer and credit_used>=new.amount;
 else update customer_accounts set store_credit=store_credit+new.amount where customer_id=customer;end if;
 if not found then raise exception 'Refund exceeds outstanding customer credit'; end if;
 insert into customer_account_movements(entity_id,customer_id,kind,amount,reference_id,created_by) values(tenant,customer,new.method||'_refund',new.amount,new.return_id,auth.uid());return new;
end $$;
create trigger credit_refund before insert on refunds for each row execute function account_refund_guard();
create function return_purchase(target uuid,item uuid,quantity numeric,reason text,request_id uuid) returns void language plpgsql security definer set search_path=public as $$ declare p purchase_orders%rowtype; l purchase_items%rowtype; returned numeric; begin
 select * into p from purchase_orders where id=target for update;
 if not can_operate_store(p.store_id) or not has_permission('purchases.manage') then raise exception 'Access denied'; end if;
 if exists(select 1 from purchase_returns where id=request_id and purchase_id=target) then return;end if;
 if p.status<>'received' or length(trim(reason))<3 then raise exception 'Received purchase and reason required'; end if;
 select * into l from purchase_items where id=item and purchase_id=target;
 select coalesce(sum(pri.quantity),0) into returned from purchase_return_items pri where purchase_item_id=item;
 if not found or quantity is null or quantity<=0 or quantity>l.quantity-returned then raise exception 'Invalid purchase return quantity'; end if;
 update inventory set quantity=inventory.quantity-return_purchase.quantity where store_id=p.store_id and product_id=l.product_id and inventory.quantity>=return_purchase.quantity;
 if not found then raise exception 'Insufficient stock'; end if;
 insert into purchase_returns(id,entity_id,purchase_id,store_id,reason,created_by) values(request_id,p.entity_id,p.id,p.store_id,reason,auth.uid());
 insert into purchase_return_items(entity_id,return_id,purchase_item_id,quantity) values(p.entity_id,request_id,item,quantity);
 insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_type,reference_id,created_by) values(p.entity_id,p.store_id,l.product_id,'adjustment',-quantity,'purchase_return',request_id,auth.uid());
end $$;
do $$ declare t text; begin foreach t in array array['customer_accounts','customer_account_movements','purchase_returns','purchase_return_items'] loop execute format('alter table %I enable row level security',t);end loop;end $$;
create policy account_read on customer_accounts for select to authenticated using(can_read_entity(entity_id) and has_permission('customers.read'));
create policy account_movement_read on customer_account_movements for select to authenticated using(can_read_entity(entity_id) and has_permission('customers.read'));
create policy purchase_return_read on purchase_returns for select to authenticated using(can_access_store(store_id) and has_permission('purchases.manage'));
create policy purchase_return_item_read on purchase_return_items for select to authenticated using(exists(select 1 from purchase_returns where id=return_id and can_access_store(store_id) and has_permission('purchases.manage')));
revoke execute on function set_customer_credit(uuid,numeric), return_purchase(uuid,uuid,numeric,text,uuid) from public;
grant execute on function set_customer_credit(uuid,numeric), return_purchase(uuid,uuid,numeric,text,uuid) to authenticated;

$sql_0007$;
   insert into public.mypos_schema_migrations(version,filename) values('0007','0007_credit_and_purchase_returns.sql');
  end if;
 end if;
end
$apply_0007$;

-- 0008_configuration_and_history.sql
do $apply_0008$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0008') then
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='receipt_snapshot') then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0008','0008_configuration_and_history.sql',true);
  else
   execute $sql_0008$

alter table entity_settings add column legal_name text;
alter table stores add column phone text,add column email citext,add column receipt_configuration jsonb not null default '{}';
alter table customers add column notes text,add column created_by uuid references profiles default auth.uid();
alter table sales add column receipt_snapshot jsonb not null default '{}';
create function capture_receipt() returns trigger language plpgsql security definer set search_path=public as $$ begin
 new.receipt_snapshot:=jsonb_build_object('business',(select to_jsonb(es) from entity_settings es where es.entity_id=new.entity_id),'store',(select jsonb_build_object('name',s.name,'code',s.code,'address',s.address,'phone',s.phone) from stores s where s.id=new.store_id),'cashier',(select display_name from profiles where id=new.cashier_id),'customer',(select jsonb_build_object('name',c.name,'mobile',c.mobile_normalized,'address',c.address) from customers c where c.id=new.customer_id));return new;
end $$;
create trigger receipt_snapshot before insert on sales for each row execute function capture_receipt();
create function storage_quota_guard() returns trigger language plpgsql security definer set search_path=public,storage as $$ declare tenant uuid; quota bigint; used numeric; incoming numeric; begin
 if new.bucket_id not in ('entity-logos','product-images','report-files') then return new; end if;
 if split_part(new.name,'/',1)<>'entities' then raise exception 'Invalid storage path'; end if;
 tenant:=split_part(new.name,'/',2)::uuid;
 select storage_limit_mb*1024*1024 into quota from public.entities where id=tenant for update;
 if quota is null then raise exception 'Invalid entity'; end if;
 incoming:=coalesce((new.metadata->>'size')::numeric,0);
 select coalesce(sum(coalesce((metadata->>'size')::numeric,0)),0) into used from storage.objects where bucket_id in ('entity-logos','product-images','report-files') and split_part(name,'/',2)=tenant::text and id<>new.id;
 if used+incoming>quota then raise exception 'Storage limit reached'; end if;return new;
end $$;
create trigger tenant_storage_quota before insert or update of metadata,name on storage.objects for each row execute function storage_quota_guard();
-- Keep tax component configuration valid before allowing checkout.
create function tax_component_guard() returns trigger language plpgsql set search_path=public as $$ declare weight numeric; begin
 if jsonb_typeof(new.tax_components)<>'object' then raise exception 'Tax components must be a JSON object'; end if;
 select sum(value::numeric) into weight from jsonb_each_text(new.tax_components);
 if weight is null or weight<>100 or exists(select 1 from jsonb_each_text(new.tax_components) where value::numeric<0) then raise exception 'Tax component weights must total 100';end if;
 return new;
end $$;
create trigger validate_tax_components before insert or update of tax_components on entity_settings for each row execute function tax_component_guard();

$sql_0008$;
   insert into public.mypos_schema_migrations(version,filename) values('0008','0008_configuration_and_history.sql');
  end if;
 end if;
end
$apply_0008$;

-- 0009_platform_admin_email.sql
do $apply_0009$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0009') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0009','0009_platform_admin_email.sql',true);
  else
   execute $sql_0009$

create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not is_system_admin() then raise exception 'Access denied'; end if;
  return (
    select coalesce(jsonb_agg(x), '[]')
    from (
      select
        e.*,
        (select p.email from profiles p where p.entity_id=e.id and p.role='entity_admin' order by p.created_at limit 1) as admin_email,
        (select count(*) from stores s where s.entity_id=e.id) as stores,
        (select count(*) from profiles p where p.entity_id=e.id) as users,
        (select count(*) from entity_sessions s where s.entity_id=e.id and s.revoked_at is null and s.last_activity>now()-interval '15 minutes') as sessions
      from entities e
      order by created_at desc
    ) x
  );
end $$;

$sql_0009$;
   insert into public.mypos_schema_migrations(version,filename) values('0009','0009_platform_admin_email.sql');
  end if;
 end if;
end
$apply_0009$;

-- 0010_fix_operation_rate_limit.sql
do $apply_0010$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0010') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0010','0010_fix_operation_rate_limit.sql',true);
  else
   execute $sql_0010$

create or replace function public.consume_operation(operation text, maximum integer)
returns void language plpgsql security definer set search_path=public as $$
declare hits integer;
begin
  if auth.uid() is null then raise exception 'Access denied'; end if;
  insert into operation_limits
  values(auth.uid(), $1, date_trunc('hour', now()), 1)
  on conflict on constraint operation_limits_pkey
  do update set hits=operation_limits.hits+1
  returning operation_limits.hits into hits;
  if hits>least(greatest($2, 1), 20) then
    raise exception 'Too many requests. Try later';
  end if;
end $$;

revoke execute on function public.consume_operation(text,integer) from public;
grant execute on function public.consume_operation(text,integer) to authenticated;

$sql_0010$;
   insert into public.mypos_schema_migrations(version,filename) values('0010','0010_fix_operation_rate_limit.sql');
  end if;
 end if;
end
$apply_0010$;

-- 0011_backfill_entity_defaults.sql
do $apply_0011$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0011') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0011','0011_backfill_entity_defaults.sql',true);
  else
   execute $sql_0011$

insert into public.entity_settings(entity_id, trading_name, tax_framework)
select e.id, e.name, coalesce(c.tax_framework, 'Other')
from public.entities e
left join public.countries c on c.code=e.country_code
on conflict(entity_id) do nothing;

insert into public.receipt_settings(entity_id)
select e.id from public.entities e
on conflict(entity_id) do nothing;

insert into public.categories(entity_id, name, default_tax_rate, sort_order)
select e.id, defaults.name, defaults.tax_rate, defaults.sort_order
from public.entities e
cross join (values
  ('Fresh Items', 5::numeric, 10),
  ('Grocery & Kitchen', 5::numeric, 20),
  ('Snacks & Drinks', 12::numeric, 30),
  ('Beauty & Wellness', 18::numeric, 40),
  ('Household & Lifestyle', 18::numeric, 50)
) as defaults(name, tax_rate, sort_order)
on conflict(entity_id, name) do nothing;

$sql_0011$;
   insert into public.mypos_schema_migrations(version,filename) values('0011','0011_backfill_entity_defaults.sql');
  end if;
 end if;
end
$apply_0011$;

-- 0012_simplify_roles_and_tax_defaults.sql
do $apply_0012$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0012') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0012','0012_simplify_roles_and_tax_defaults.sql',true);
  else
   execute $sql_0012$

update public.profiles
set role='store_manager'
where role in ('inventory_manager', 'custom');

delete from public.role_permissions
where role in ('inventory_manager', 'custom');

alter table public.profiles
drop constraint if exists profiles_supported_roles;

alter table public.profiles
add constraint profiles_supported_roles
check (role in ('super_admin', 'entity_admin', 'store_manager', 'cashier'));

update public.entity_settings es
set tax_components=case
  when e.country_code='IN' and es.tax_components='{"Tax":100}'::jsonb
    then '{"CGST":50,"SGST":50}'::jsonb
  when e.country_code<>'IN' and es.tax_components='{"Tax":100}'::jsonb
    then jsonb_build_object(coalesce(nullif(es.tax_framework, ''), 'Tax'), 100)
  else es.tax_components
end
from public.entities e
where e.id=es.entity_id;

create or replace function public.initialize_entity() returns trigger
language plpgsql security definer set search_path=public as $$
declare c countries%rowtype;
begin
  select * into c from countries where code=new.country_code;
  if not found then raise exception 'Unsupported country'; end if;
  update entities set currency_code=c.currency,timezone=c.timezone where id=new.id;
  insert into entity_settings(
    entity_id,
    trading_name,
    tax_framework,
    tax_components
  ) values (
    new.id,
    new.name,
    c.tax_framework,
    case
      when new.country_code='IN' then '{"CGST":50,"SGST":50}'::jsonb
      else jsonb_build_object(c.tax_framework, 100)
    end
  );
  insert into receipt_settings(entity_id) values(new.id);
  insert into categories(entity_id,name,default_tax_rate,sort_order)
  values
    (new.id,'Fresh Items',5,10),
    (new.id,'Grocery & Kitchen',5,20),
    (new.id,'Snacks & Drinks',12,30),
    (new.id,'Beauty & Wellness',18,40),
    (new.id,'Household & Lifestyle',18,50);
  return new;
end $$;

$sql_0012$;
   insert into public.mypos_schema_migrations(version,filename) values('0012','0012_simplify_roles_and_tax_defaults.sql');
  end if;
 end if;
end
$apply_0012$;

-- 0013_bulk_product_import.sql
do $apply_0013$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0013') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0013','0013_bulk_product_import.sql',true);
  else
   execute $sql_0013$

create or replace function public.bulk_import_products(
  target_store uuid,
  product_rows jsonb,
  create_missing_categories boolean default false
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=current_entity_id();
  line jsonb;
  row_number integer;
  product_name text;
  category_name text;
  subcategory_name text;
  product_sku text;
  product_internal_code text;
  product_barcode text;
  product_qr_identifier text;
  product_tax_code text;
  product_unit text;
  product_tax_mode text;
  category_id uuid;
  parent_category_id uuid;
  tax_code_id uuid;
  product_id uuid;
  purchase_price numeric;
  selling_price numeric;
  mrp numeric;
  tax_rate numeric;
  opening_quantity numeric;
  reorder_level numeric;
  manufactured_on date;
  expires_on date;
  products_created integer:=0;
  categories_created integer:=0;
  seen_skus text[]:='{}';
  seen_internal_codes text[]:='{}';
  seen_barcodes text[]:='{}';
  seen_identifiers text[]:='{}';
begin
  if tenant is null or not can_operate_store(target_store) or not has_permission('products.manage') then
    raise exception 'Access denied';
  end if;
  if product_rows is null or jsonb_typeof(product_rows)<>'array' or jsonb_array_length(product_rows) not between 1 and 2000 then
    raise exception 'Bulk import requires between 1 and 2000 product rows';
  end if;

  for line in select value from jsonb_array_elements(product_rows) loop
    row_number:=coalesce((line->>'row_number')::integer, products_created+2);
    product_name:=nullif(trim(line->>'name'),'');
    category_name:=nullif(trim(line->>'category'),'');
    subcategory_name:=nullif(trim(line->>'subcategory'),'');
    product_sku:=nullif(trim(line->>'sku'),'');
    product_internal_code:=coalesce(nullif(trim(line->>'internal_code'),''), product_sku);
    product_barcode:=nullif(trim(line->>'barcode'),'');
    product_qr_identifier:=nullif(trim(line->>'qr_identifier'),'');
    product_tax_code:=nullif(trim(line->>'tax_code'),'');
    product_unit:=lower(coalesce(nullif(trim(line->>'unit'),''),'pcs'));
    product_tax_mode:=lower(coalesce(nullif(trim(line->>'tax_mode'),''),'exclusive'));
    purchase_price:=coalesce((line->>'purchase_price')::numeric,0);
    selling_price:=coalesce((line->>'selling_price')::numeric,0);
    mrp:=nullif(line->>'mrp','')::numeric;
    tax_rate:=nullif(line->>'tax_rate','')::numeric;
    opening_quantity:=coalesce((line->>'opening_quantity')::numeric,0);
    reorder_level:=coalesce((line->>'reorder_level')::numeric,0);
    manufactured_on:=nullif(line->>'manufactured_on','')::date;
    expires_on:=nullif(line->>'expires_on','')::date;

    if product_name is null or category_name is null or product_sku is null then
      raise exception 'Row %: product name, category and SKU are required',row_number;
    end if;
    if product_unit not in ('pcs','kg','g','l','ml','box','pack','dozen','bottle') then
      raise exception 'Row %: unsupported unit %',row_number,product_unit;
    end if;
    if product_tax_mode not in ('inclusive','exclusive','exempt','zero_rated') then
      raise exception 'Row %: invalid tax mode %',row_number,product_tax_mode;
    end if;
    if purchase_price<0 or selling_price<0 or mrp<0 or opening_quantity<0 or reorder_level<0 or tax_rate<0 or tax_rate>100 then
      raise exception 'Row %: prices, stock and tax values are invalid',row_number;
    end if;
    if manufactured_on is not null and expires_on is not null and expires_on<manufactured_on then
      raise exception 'Row %: expiry date is before manufacturing date',row_number;
    end if;
    if lower(product_sku)=any(seen_skus) or lower(product_internal_code)=any(seen_internal_codes) or (product_barcode is not null and product_barcode=any(seen_barcodes))
      or lower(product_sku)=any(seen_identifiers) or lower(product_internal_code)=any(seen_identifiers)
      or (product_barcode is not null and lower(product_barcode)=any(seen_identifiers))
      or (product_qr_identifier is not null and lower(product_qr_identifier)=any(seen_identifiers)) then
      raise exception 'Row %: duplicate SKU, internal code, barcode or QR identifier in this file',row_number;
    end if;
    if exists(select 1 from product_identifiers where entity_id=tenant and lower(identifier_value) in (lower(product_sku),lower(product_internal_code),lower(product_barcode),lower(product_qr_identifier))) then
      raise exception 'Row %: SKU, internal code, barcode or QR identifier already exists',row_number;
    end if;
    seen_skus:=array_append(seen_skus,lower(product_sku));
    seen_internal_codes:=array_append(seen_internal_codes,lower(product_internal_code));
    if product_barcode is not null then seen_barcodes:=array_append(seen_barcodes,product_barcode); end if;
    seen_identifiers:=array_append(seen_identifiers,lower(product_sku));
    if lower(product_internal_code)<>lower(product_sku) then seen_identifiers:=array_append(seen_identifiers,lower(product_internal_code)); end if;
    if product_barcode is not null then seen_identifiers:=array_append(seen_identifiers,lower(product_barcode)); end if;
    if product_qr_identifier is not null then seen_identifiers:=array_append(seen_identifiers,lower(product_qr_identifier)); end if;

    select id into parent_category_id from categories
    where entity_id=tenant and lower(name)=lower(category_name) and parent_id is null
    limit 1;
    if parent_category_id is null then
      if exists(select 1 from categories where entity_id=tenant and lower(name)=lower(category_name)) then
        raise exception 'Row %: category "%" is currently a subcategory',row_number,category_name;
      end if;
      if not create_missing_categories then
        raise exception 'Row %: category "%" does not exist',row_number,category_name;
      end if;
      insert into categories(entity_id,name,default_tax_rate,sort_order)
      values(tenant,category_name,0,1000+categories_created)
      returning id into parent_category_id;
      categories_created:=categories_created+1;
    end if;
    category_id:=parent_category_id;
    if subcategory_name is not null then
      select id into category_id from categories
      where entity_id=tenant and lower(name)=lower(subcategory_name) and parent_id=parent_category_id
      limit 1;
      if category_id is null then
        if exists(select 1 from categories where entity_id=tenant and lower(name)=lower(subcategory_name)) then
          raise exception 'Row %: subcategory "%" already belongs elsewhere',row_number,subcategory_name;
        end if;
        if not create_missing_categories then
          raise exception 'Row %: subcategory "%" does not exist',row_number,subcategory_name;
        end if;
        insert into categories(entity_id,parent_id,name,default_tax_rate,sort_order)
        values(tenant,parent_category_id,subcategory_name,0,1000+categories_created)
        returning id into category_id;
        categories_created:=categories_created+1;
      end if;
    end if;

    tax_code_id:=null;
    if product_tax_code is not null then
      select id into tax_code_id from tax_codes
      where entity_id=tenant and lower(code)=lower(product_tax_code) and is_active
      limit 1;
      if tax_code_id is null then raise exception 'Row %: tax code "%" does not exist',row_number,product_tax_code; end if;
    end if;

    insert into products(
      entity_id,category_id,name,description,brand,unit,sku,internal_code,
      barcode,qr_identifier,purchase_price,selling_price,mrp,tax_mode,tax_rate,
      tax_code_id,hsn_sac,reorder_level,batch_number,manufactured_on,expires_on,is_active
    ) values (
      tenant,category_id,product_name,nullif(trim(line->>'description'),''),
      nullif(trim(line->>'brand'),''),product_unit,product_sku,product_internal_code,
      product_barcode,coalesce(product_qr_identifier,'POS:P:'||upper(substr(gen_random_uuid()::text,1,8))),
      purchase_price,selling_price,mrp,product_tax_mode::tax_mode,tax_rate,
      tax_code_id,nullif(trim(line->>'hsn_sac'),''),reorder_level,
      nullif(trim(line->>'batch_number'),''),manufactured_on,expires_on,
      coalesce((line->>'is_active')::boolean,true)
    ) returning id into product_id;
    insert into inventory(store_id,product_id,quantity)
    values(target_store,product_id,opening_quantity);
    if opening_quantity>0 then
      insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,unit_cost,notes,created_by)
      values(tenant,target_store,product_id,'opening',opening_quantity,purchase_price,'Bulk product import',auth.uid());
    end if;
    products_created:=products_created+1;
  end loop;
  return jsonb_build_object('products_created',products_created,'categories_created',categories_created);
end $$;

revoke execute on function public.bulk_import_products(uuid,jsonb,boolean) from public;
grant execute on function public.bulk_import_products(uuid,jsonb,boolean) to authenticated;

$sql_0013$;
   insert into public.mypos_schema_migrations(version,filename) values('0013','0013_bulk_product_import.sql');
  end if;
 end if;
end
$apply_0013$;

-- 0014_cashier_returns_exchanges.sql
do $apply_0014$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0014') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0014','0014_cashier_returns_exchanges.sql',true);
  else
   execute $sql_0014$

-- Cashiers may process customer returns and exchanges through the audited RPCs.
insert into public.role_permissions(role, permission)
values
  ('cashier'::public.app_role, 'returns.create'),
  ('cashier'::public.app_role, 'exchanges.create')
on conflict (role, permission) do nothing;

$sql_0014$;
   insert into public.mypos_schema_migrations(version,filename) values('0014','0014_cashier_returns_exchanges.sql');
  end if;
 end if;
end
$apply_0014$;

-- 0015_restore_store_operation_guard.sql
do $apply_0015$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0015') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0015','0015_restore_store_operation_guard.sql',true);
  else
   execute $sql_0015$

-- Restore the shared active-store authorization guard used by POS, inventory,
-- purchases, transfers, returns and bulk product import.
create or replace function public.can_operate_store(target uuid)
returns boolean
language sql stable security definer set search_path=public as $$
  select public.can_access_store(target)
    and exists(
      select 1
      from public.stores
      where id=target and is_active
    )
$$;

revoke execute on function public.can_operate_store(uuid) from public;
grant execute on function public.can_operate_store(uuid) to authenticated, service_role;

$sql_0015$;
   insert into public.mypos_schema_migrations(version,filename) values('0015','0015_restore_store_operation_guard.sql');
  end if;
 end if;
end
$apply_0015$;

-- 0016_bulk_product_delete.sql
do $apply_0016$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0016') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0016','0016_bulk_product_delete.sql',true);
  else
   execute $sql_0016$

create or replace function public.bulk_delete_products(product_ids uuid[])
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=public.current_entity_id();
  requested integer:=coalesce(cardinality(product_ids),0);
  matched integer;
  deleted_count integer:=0;
  archived_count integer:=0;
  deletable uuid[]:='{}'::uuid[];
  deleted_image_paths text[]:='{}'::text[];
begin
  if tenant is null or not public.has_permission('products.manage') then
    raise exception 'Access denied';
  end if;
  if requested<1 or requested>500 or array_position(product_ids,null) is not null then
    raise exception 'Select between 1 and 500 products';
  end if;
  if (select count(distinct id) from unnest(product_ids) selected(id))<>requested then
    raise exception 'Duplicate product selection';
  end if;

  perform 1
  from public.products
  where entity_id=tenant and id=any(product_ids)
  order by id
  for update;
  select count(*) into matched
  from public.products
  where entity_id=tenant and id=any(product_ids);
  if matched<>requested then raise exception 'One or more products are unavailable'; end if;

  select
    coalesce(array_agg(p.id),'{}'::uuid[]),
    coalesce(array_agg(p.image_path) filter(where p.image_path is not null),'{}'::text[])
  into deletable,deleted_image_paths
  from public.products p
  where p.entity_id=tenant
    and p.id=any(product_ids)
    and not exists(select 1 from public.sale_items x where x.product_id=p.id)
    and not exists(select 1 from public.inventory_movements x where x.product_id=p.id)
    and not exists(select 1 from public.purchase_items x where x.product_id=p.id)
    and not exists(select 1 from public.stock_transfer_items x where x.product_id=p.id)
    and not exists(
      select 1 from public.inventory x
      where x.product_id=p.id and x.quantity<>0
    )
    and not exists(
      select 1
      from public.held_sales h
      cross join lateral jsonb_array_elements(h.cart) line
      where h.entity_id=tenant
        and coalesce(line->>'product_id',line->>'id')=p.id::text
    );

  update public.products
  set is_active=false
  where entity_id=tenant
    and id=any(product_ids)
    and not (id=any(deletable));
  get diagnostics archived_count=row_count;

  delete from public.product_identifiers where product_id=any(deletable);
  delete from public.inventory where product_id=any(deletable);
  delete from public.products where entity_id=tenant and id=any(deletable);
  get diagnostics deleted_count=row_count;

  insert into public.audit_logs(
    entity_id,actor_id,action,resource_type,metadata
  ) values (
    tenant,auth.uid(),'products.bulk_deleted','products',
    jsonb_build_object(
      'product_ids',product_ids,
      'deleted',deleted_count,
      'archived',archived_count
    )
  );

  return jsonb_build_object(
    'deleted',deleted_count,
    'archived',archived_count,
    'deleted_image_paths',to_jsonb(deleted_image_paths)
  );
end $$;

revoke execute on function public.bulk_delete_products(uuid[]) from public;
grant execute on function public.bulk_delete_products(uuid[]) to authenticated, service_role;

$sql_0016$;
   insert into public.mypos_schema_migrations(version,filename) values('0016','0016_bulk_product_delete.sql');
  end if;
 end if;
end
$apply_0016$;

-- 0017_sales_receipts_and_cashier_reports.sql
do $apply_0017$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0017') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0017','0017_sales_receipts_and_cashier_reports.sql',true);
  else
   execute $sql_0017$

-- Every cashier may review completed receipts and the sales report for stores
-- assigned to their account. Store RLS continues to enforce those assignments.
insert into public.role_permissions(role, permission)
values ('cashier'::public.app_role, 'reports.read')
on conflict do nothing;

drop function if exists public.report_rows(text,timestamptz,timestamptz,uuid);

create function public.report_rows(
  report_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  target_store uuid default null,
  target_cashier uuid default null
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not has_permission('reports.read')
    or (target_store is not null and not can_access_store(target_store))
  then raise exception 'Access denied'; end if;

  if target_cashier is not null and not exists(
    select 1 from profiles
    where id=target_cashier and entity_id=current_entity_id() and is_active
  ) then raise exception 'Invalid cashier filter'; end if;

  if starts_at is null or ends_at is null or ends_at<=starts_at
    or ends_at-starts_at>interval '367 days'
  then raise exception 'Select a date range of at most one year'; end if;

  if report_name in ('sales','tax','discounts') then
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select
        s.id,
        s.invoice_number,
        s.completed_at,
        s.store_id,
        st.name store,
        s.cashier_id,
        p.display_name cashier,
        s.status,
        s.subtotal,
        s.discount_total,
        s.tax_total,
        s.grand_total,
        coalesce((select sum(r.total) from returns r where r.sale_id=s.id),0) refund_total,
        s.grand_total-coalesce((select sum(r.total) from returns r where r.sale_id=s.id),0) net_sales,
        s.currency_code
      from sales s
      join stores st on st.id=s.store_id
      join profiles p on p.id=s.cashier_id
      where s.entity_id=current_entity_id()
        and can_access_store(s.store_id)
        and (target_store is null or s.store_id=target_store)
        and (target_cashier is null or s.cashier_id=target_cashier)
        and s.completed_at>=starts_at and s.completed_at<ends_at
      order by s.completed_at desc
      limit 10000
    ) x;
  elsif report_name in ('products','categories','profit') then
    if report_name='profit' and not has_permission('reports.profit')
    then raise exception 'Access denied'; end if;
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select
        si.sku,
        si.product_name,
        sum(si.quantity) quantity,
        sum(si.taxable_value) taxable_value,
        sum(si.tax_amount) tax,
        sum(si.line_total) gross,
        case when report_name='profit'
          then sum(si.taxable_value-si.quantity*si.unit_cost)
          else null
        end margin_before_returns
      from sale_items si
      join sales s on s.id=si.sale_id
      where s.entity_id=current_entity_id()
        and can_access_store(s.store_id)
        and (target_store is null or s.store_id=target_store)
        and (target_cashier is null or s.cashier_id=target_cashier)
        and s.completed_at>=starts_at and s.completed_at<ends_at
      group by si.sku,si.product_name
      order by gross desc
      limit 10000
    ) x;
  elsif report_name='payments' then
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select p.method,sum(p.amount) amount,count(*) transactions
      from payments p
      join sales s on s.id=p.sale_id
      where s.entity_id=current_entity_id()
        and can_access_store(s.store_id)
        and (target_store is null or s.store_id=target_store)
        and (target_cashier is null or s.cashier_id=target_cashier)
        and s.completed_at>=starts_at and s.completed_at<ends_at
      group by p.method
    ) x;
  elsif report_name in ('inventory','low_stock','expiry') then
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select p.name,p.sku,s.name store,i.quantity,p.reorder_level,p.expires_on
      from inventory i
      join products p on p.id=i.product_id
      join stores s on s.id=i.store_id
      where p.entity_id=current_entity_id()
        and can_access_store(i.store_id)
        and (target_store is null or i.store_id=target_store)
        and (report_name<>'low_stock' or i.quantity<=p.reorder_level)
        and (report_name<>'expiry' or p.expires_on between starts_at::date and ends_at::date)
      order by p.name
      limit 10000
    ) x;
  elsif report_name='returns' then
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select r.id,r.created_at,s.invoice_number,p.display_name cashier,r.reason,r.total
      from returns r
      join sales s on s.id=r.sale_id
      join profiles p on p.id=s.cashier_id
      where r.entity_id=current_entity_id()
        and can_access_store(r.store_id)
        and (target_store is null or r.store_id=target_store)
        and (target_cashier is null or s.cashier_id=target_cashier)
        and r.created_at>=starts_at and r.created_at<ends_at
      order by r.created_at desc
      limit 10000
    ) x;
  elsif report_name='exchanges' then
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select e.*
      from exchanges e
      join returns r on r.id=e.return_id
      join sales s on s.id=r.sale_id
      where e.entity_id=current_entity_id()
        and can_access_store(r.store_id)
        and (target_store is null or r.store_id=target_store)
        and (target_cashier is null or s.cashier_id=target_cashier)
        and e.created_at>=starts_at and e.created_at<ends_at
      limit 10000
    ) x;
  elsif report_name='movements' then
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select m.created_at,p.name,m.movement_type,m.quantity,m.reference_id
      from inventory_movements m
      join products p on p.id=m.product_id
      where m.entity_id=current_entity_id()
        and can_access_store(m.store_id)
        and (target_store is null or m.store_id=target_store)
        and m.created_at>=starts_at and m.created_at<ends_at
      order by m.created_at desc
      limit 10000
    ) x;
  elsif report_name='purchases' then
    if not has_permission('purchases.manage') then raise exception 'Access denied'; end if;
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select p.id,s.name supplier,p.supplier_invoice,p.status,p.created_at,p.received_at
      from purchase_orders p
      join suppliers s on s.id=p.supplier_id
      where p.entity_id=current_entity_id()
        and can_access_store(p.store_id)
        and (target_store is null or p.store_id=target_store)
        and p.created_at>=starts_at and p.created_at<ends_at
      order by p.created_at desc
      limit 10000
    ) x;
  elsif report_name='registers' then
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select r.*
      from register_shifts r
      where r.entity_id=current_entity_id()
        and can_access_store(r.store_id)
        and (target_store is null or r.store_id=target_store)
        and (target_cashier is null or r.cashier_id=target_cashier)
        and r.opened_at>=starts_at and r.opened_at<ends_at
      limit 10000
    ) x;
  elsif report_name='audit' then
    if not can_manage_entity(current_entity_id()) then raise exception 'Access denied'; end if;
    select coalesce(jsonb_agg(x),'[]') into result
    from (
      select created_at,actor_id,action,resource_type,resource_id
      from audit_logs
      where entity_id=current_entity_id()
        and created_at>=starts_at and created_at<ends_at
      order by created_at desc
      limit 10000
    ) x;
  else raise exception 'Unknown report'; end if;

  return result;
end $$;

revoke execute on function public.report_rows(text,timestamptz,timestamptz,uuid,uuid) from public;
grant execute on function public.report_rows(text,timestamptz,timestamptz,uuid,uuid) to authenticated, service_role;

$sql_0017$;
   insert into public.mypos_schema_migrations(version,filename) values('0017','0017_sales_receipts_and_cashier_reports.sql');
  end if;
 end if;
end
$apply_0017$;

-- 0018_automatic_daily_registers.sql
do $apply_0018$
begin
 if not exists(select 1 from public.mypos_schema_migrations where version='0018') then
  if false then
   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('0018','0018_automatic_daily_registers.sql',true);
  else
   execute $sql_0018$

alter table public.register_shifts
  add column business_date date,
  add column scheduled_close_at timestamptz,
  add column automatic boolean not null default false;

update public.register_shifts r
set
  business_date=(r.opened_at at time zone e.timezone)::date,
  scheduled_close_at=(
    (((r.opened_at at time zone e.timezone)::date + 1)::timestamp at time zone e.timezone)
    - interval '1 microsecond'
  )
from public.entities e
where e.id=r.entity_id;

alter table public.register_shifts
  alter column business_date set not null,
  alter column scheduled_close_at set not null;

drop index if exists public.open_shift_per_cashier;
create unique index open_shift_per_cashier_store
  on public.register_shifts(cashier_id,store_id)
  where closed_at is null;
create unique index automatic_daily_register
  on public.register_shifts(cashier_id,store_id,business_date)
  where automatic;

create or replace function public.register_expected_cash(target uuid)
returns numeric
language sql stable security definer set search_path=public as $$
  select
    r.opening_cash
    + coalesce((
        select sum(p.amount)
        from payments p
        join sales s on s.id=p.sale_id
        where s.shift_id=r.id and p.method='cash'
      ),0)
    + coalesce((select sum(cm.amount) from cash_movements cm where cm.shift_id=r.id),0)
    - coalesce((
        select sum(rf.amount)
        from refunds rf
        join returns returned on returned.id=rf.return_id
        where returned.created_by=r.cashier_id
          and returned.store_id=r.store_id
          and returned.created_at>=r.opened_at
          and returned.created_at<=r.scheduled_close_at
          and rf.method='cash'
      ),0)
  from register_shifts r
  where r.id=target
$$;

create or replace function public.close_expired_registers()
returns integer
language plpgsql security definer set search_path=public as $$
declare
  shift register_shifts%rowtype;
  expected numeric;
  closed_count integer:=0;
begin
  for shift in
    select * from register_shifts
    where closed_at is null and scheduled_close_at<now()
    order by scheduled_close_at,id
    for update
  loop
    expected:=register_expected_cash(shift.id);
    update register_shifts
    set
      closed_at=shift.scheduled_close_at,
      expected_cash=expected,
      actual_cash=expected,
      difference=0,
      close_reason='Automatic end-of-day close'
    where id=shift.id;
    closed_count:=closed_count+1;
  end loop;
  return closed_count;
end $$;

create or replace function public.ensure_daily_register(target_store uuid)
returns uuid
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=current_entity_id();
  tenant_zone text;
  local_day date;
  starts_at timestamptz;
  ends_at timestamptz;
  shift_id uuid;
begin
  if tenant is null
    or not can_operate_store(target_store)
    or not has_permission('register.manage')
  then raise exception 'Access denied'; end if;

  select timezone into tenant_zone from entities where id=tenant;
  local_day:=(now() at time zone tenant_zone)::date;
  starts_at:=local_day::timestamp at time zone tenant_zone;
  ends_at:=((local_day+1)::timestamp at time zone tenant_zone)-interval '1 microsecond';

  perform pg_advisory_xact_lock(
    hashtextextended(auth.uid()::text||':'||target_store::text||':'||local_day::text,0)
  );
  perform close_expired_registers();

  select id into shift_id
  from register_shifts
  where cashier_id=auth.uid()
    and store_id=target_store
    and business_date=local_day
    and closed_at is null
  order by automatic desc,opened_at desc
  limit 1
  for update;

  if shift_id is null then
    insert into register_shifts(
      entity_id,store_id,cashier_id,opened_at,opening_cash,
      business_date,scheduled_close_at,automatic
    ) values (
      tenant,target_store,auth.uid(),starts_at,0,
      local_day,ends_at,true
    )
    on conflict (cashier_id,store_id,business_date) where automatic
    do update set scheduled_close_at=excluded.scheduled_close_at
    returning id into shift_id;
  end if;

  return shift_id;
end $$;

create or replace function public.register_action(
  target_store uuid,
  action text,
  amount numeric,
  reason text default ''
) returns uuid
language plpgsql security definer set search_path=public as $$
declare shift_id uuid;
begin
  if amount is null or amount<0 then raise exception 'Invalid cash amount'; end if;
  shift_id:=ensure_daily_register(target_store);
  if action='open' then return shift_id; end if;
  if action not in ('add','withdraw') then
    raise exception 'Daily registers close automatically';
  end if;
  if length(trim(reason))<3 then raise exception 'Reason required'; end if;
  insert into cash_movements(entity_id,shift_id,amount,reason,created_by)
  values(
    current_entity_id(),shift_id,
    case when action='add' then amount else -amount end,
    reason,auth.uid()
  );
  return shift_id;
end $$;

create or replace function public.checkout_v2(
  target_store uuid,
  lines jsonb,
  payment_lines jsonb,
  request_id uuid,
  target_customer uuid default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=current_entity_id(); l jsonb; p products%rowtype; q numeric;
  available numeric; rate numeric; net numeric; tax numeric; gross numeric;
  discount numeric; max_discount numeric; total_net numeric:=0;
  total_tax numeric:=0; total_discount numeric:=0; seq bigint; fy integer;
  pay jsonb; paid numeric:=0; shift uuid;
begin
  if not can_operate_store(target_store) or not has_permission('sales.create') then raise exception 'Access denied'; end if;
  if request_id is null then raise exception 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_id::text,0));
  if exists(select 1 from sales where id=request_id and entity_id=tenant and cashier_id=auth.uid()) then return request_id; end if;
  if not exists(select 1 from entity_settings where entity_id=tenant and tax_confirmed) then raise exception 'Tax configuration missing. Ask your admin to complete setup'; end if;
  shift:=ensure_daily_register(target_store);
  if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 200 then raise exception 'Invalid cart'; end if;
  if payment_lines is null or jsonb_typeof(payment_lines)<>'array' or jsonb_array_length(payment_lines) not between 1 and 10 then raise exception 'Invalid payment'; end if;
  if target_customer is not null and not exists(select 1 from customers where id=target_customer and entity_id=tenant) then raise exception 'Invalid customer'; end if;
  fy:=extract(year from now());
  insert into invoice_counters values(tenant,fy,1)
  on conflict(entity_id,year) do update set number=invoice_counters.number+1
  returning number into seq;
  insert into sales(id,entity_id,store_id,customer_id,invoice_number,subtotal,grand_total,cashier_id,currency_code,shift_id)
  select request_id,tenant,target_store,target_customer,'INV-'||fy||'-'||lpad(seq::text,6,'0'),0,0,auth.uid(),currency_code,shift
  from entities where id=tenant;
  for l in select value from jsonb_array_elements(lines) order by value->>'product_id' loop
    q:=(l->>'quantity')::numeric; discount:=coalesce((l->>'discount_percent')::numeric,0);
    if q is null or q<=0 or q>100000 or q<>round(q,3) or discount<0 or discount>100 then raise exception 'Invalid quantity or discount'; end if;
    max_discount:=case when app_role_name()='entity_admin' then 100 else coalesce((select max_discount_percent from user_permissions where user_id=auth.uid() and permission='sales.discount' and allowed),0) end;
    if discount>0 and (not has_permission('sales.discount') or discount>max_discount) then raise exception 'Discount exceeds your permission'; end if;
    select * into p from products where id=(l->>'product_id')::uuid and entity_id=tenant and is_active for share;
    if not found then raise exception 'Product unavailable'; end if;
    select quantity into available from inventory where store_id=target_store and product_id=p.id for update;
    if available is null or available<q then raise exception 'Insufficient stock'; end if;
    rate:=product_tax_rate(p.id);
    gross:=round(p.selling_price*q*(1-discount/100),2); net:=gross; tax:=0;
    if p.tax_mode='inclusive' then net:=round(gross/(1+rate/100),2); tax:=gross-net;
    elsif p.tax_mode='exclusive' then tax:=round(net*rate/100,2); end if;
    total_net:=total_net+net; total_tax:=total_tax+tax;
    total_discount:=total_discount+round(p.selling_price*q*discount/100,2);
    insert into sale_items(sale_id,product_id,product_name,sku,tax_code,quantity,unit_price,unit_cost,discount_amount,taxable_value,tax_rate,tax_amount,tax_components,line_total)
    values(request_id,p.id,p.name,p.sku,p.hsn_sac,q,p.selling_price,p.purchase_price,round(p.selling_price*q*discount/100,2),net,rate,tax,tax_snapshot(tax,tenant),net+tax);
    update inventory set quantity=quantity-q,updated_at=now() where store_id=target_store and product_id=p.id;
    insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,created_by)
    values(tenant,target_store,p.id,'sale',-q,request_id,auth.uid());
  end loop;
  for pay in select value from jsonb_array_elements(payment_lines) loop
    if pay->>'method' not in ('cash','upi','credit_card','debit_card','card','exchange_credit','customer_credit','store_credit')
      or (pay->>'amount')::numeric is null or (pay->>'amount')::numeric<=0
    then raise exception 'Invalid payment'; end if;
    if pay->>'method'='exchange_credit' then
      perform 1 from returns r join refunds rf on rf.return_id=r.id
      where r.id=(pay->>'reference')::uuid and r.entity_id=tenant
        and rf.method='exchange' and rf.amount>=(pay->>'amount')::numeric
        and not exists(select 1 from payments pm where pm.method='exchange_credit' and pm.reference=pay->>'reference')
      for update of r;
      if not found then raise exception 'Invalid exchange credit'; end if;
    end if;
    paid:=paid+round((pay->>'amount')::numeric,2);
    insert into payments(sale_id,method,amount,reference)
    values(request_id,pay->>'method',round((pay->>'amount')::numeric,2),pay->>'reference');
  end loop;
  if paid<>total_net+total_tax then raise exception 'Payment total must equal the sale total'; end if;
  update sales set subtotal=total_net,tax_total=total_tax,discount_total=total_discount,grand_total=total_net+total_tax where id=request_id;
  return request_id;
end $$;

create or replace function public.process_return(
  original_sale uuid,
  items jsonb,
  reason text,
  refund_method text,
  request_id uuid
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  s sales%rowtype; l jsonb; si sale_items%rowtype; returned numeric;
  q numeric; amount numeric; return_total numeric:=0; disposition text;
begin
  select * into s from sales where id=original_sale for update;
  if not found or not can_operate_store(s.store_id) or not has_permission('returns.create') then raise exception 'Access denied'; end if;
  if request_id is null then raise exception 'Request ID required'; end if;
  if exists(select 1 from returns where id=request_id and sale_id=original_sale) then return request_id; end if;
  if s.status='voided' then raise exception 'Sale is voided'; end if;
  if refund_method='cash' then perform ensure_daily_register(s.store_id); end if;
  if length(trim(reason))<3 or reason is null or refund_method not in ('cash','upi','card','exchange','customer_credit','store_credit') then raise exception 'Reason and refund method required'; end if;
  if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 200 then raise exception 'Select return items'; end if;
  insert into returns(id,entity_id,store_id,sale_id,reason,created_by)
  values(request_id,s.entity_id,s.store_id,s.id,reason,auth.uid());
  for l in select value from jsonb_array_elements(items) order by value->>'sale_item_id' loop
    select * into si from sale_items where id=(l->>'sale_item_id')::uuid and sale_id=s.id for update;
    if not found then raise exception 'Invalid original item'; end if;
    q:=(l->>'quantity')::numeric; disposition:=l->>'disposition';
    select coalesce(sum(quantity),0) into returned from return_items where sale_item_id=si.id;
    if q is null or q<=0 or q>si.quantity-returned or q<>round(q,3) then raise exception 'Invalid return quantity'; end if;
    amount:=case when q=si.quantity-returned
      then si.line_total-coalesce((select sum(ri.amount) from return_items ri where ri.sale_item_id=si.id),0)
      else round(si.line_total*q/si.quantity,2) end;
    insert into return_items(entity_id,return_id,sale_item_id,quantity,disposition,amount)
    values(s.entity_id,request_id,si.id,q,disposition,amount);
    if disposition='restocked' then
      update inventory set quantity=quantity+q,updated_at=now() where store_id=s.store_id and product_id=si.product_id;
      insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,reference_id,created_by)
      values(s.entity_id,s.store_id,si.product_id,'customer_return',q,request_id,auth.uid());
    end if;
    return_total:=return_total+amount;
  end loop;
  update returns set total=return_total where id=request_id;
  insert into refunds(entity_id,return_id,method,amount)
  values(s.entity_id,request_id,refund_method,return_total);
  update sales set status=case
    when not exists(
      select 1 from sale_items original_item
      where original_item.sale_id=s.id
        and original_item.quantity>(select coalesce(sum(ri.quantity),0) from return_items ri where ri.sale_item_id=original_item.id)
    ) then 'refunded'::sale_status else 'partially_refunded'::sale_status end
  where id=s.id;
  insert into audit_logs(entity_id,actor_id,action,resource_type,resource_id)
  values(s.entity_id,auth.uid(),'return.processed','returns',request_id);
  return request_id;
end $$;

revoke execute on function public.register_expected_cash(uuid) from public;
revoke execute on function public.close_expired_registers() from public;
revoke execute on function public.ensure_daily_register(uuid) from public;
revoke execute on function public.register_action(uuid,text,numeric,text) from public;
revoke execute on function public.checkout_v2(uuid,jsonb,jsonb,uuid,uuid) from public;
revoke execute on function public.process_return(uuid,jsonb,text,text,uuid) from public;
grant execute on function public.ensure_daily_register(uuid) to authenticated,service_role;
grant execute on function public.register_action(uuid,text,numeric,text) to authenticated,service_role;
grant execute on function public.checkout_v2(uuid,jsonb,jsonb,uuid,uuid) to authenticated,service_role;
grant execute on function public.process_return(uuid,jsonb,text,text,uuid) to authenticated,service_role;
grant execute on function public.close_expired_registers() to service_role;

$sql_0018$;
   insert into public.mypos_schema_migrations(version,filename) values('0018','0018_automatic_daily_registers.sql');
  end if;
 end if;
end
$apply_0018$;

commit;
select version,filename,detected_existing,applied_at from public.mypos_schema_migrations order by version;
