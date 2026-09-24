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
