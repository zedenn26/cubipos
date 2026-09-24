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
