begin;

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

commit;
