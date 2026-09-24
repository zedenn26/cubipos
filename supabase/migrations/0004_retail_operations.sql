begin;
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
commit;
