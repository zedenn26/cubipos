begin;

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

commit;
