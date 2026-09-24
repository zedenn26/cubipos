begin;
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
commit;
