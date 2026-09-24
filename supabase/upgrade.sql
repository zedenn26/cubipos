-- Generated upgrade bundle. Apply ONCE, only after all migrations before 0016.
-- Back up your database and test in staging first.

-- Migration: 0016_bulk_product_delete.sql
begin;

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

commit;


-- Migration: 0017_sales_receipts_and_cashier_reports.sql
begin;

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

commit;


-- Migration: 0018_automatic_daily_registers.sql
begin;

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

commit;

