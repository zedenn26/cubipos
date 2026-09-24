begin;

-- Cashiers may process customer returns and exchanges through the audited RPCs.
insert into public.role_permissions(role, permission)
values
  ('cashier'::public.app_role, 'returns.create'),
  ('cashier'::public.app_role, 'exchanges.create')
on conflict (role, permission) do nothing;

commit;
