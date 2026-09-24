begin;
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
commit;
