begin;

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

commit;
