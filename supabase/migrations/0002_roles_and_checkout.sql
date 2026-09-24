begin;
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

commit;
