begin;

update public.profiles
set role='store_manager'
where role in ('inventory_manager', 'custom');

delete from public.role_permissions
where role in ('inventory_manager', 'custom');

alter table public.profiles
drop constraint if exists profiles_supported_roles;

alter table public.profiles
add constraint profiles_supported_roles
check (role in ('super_admin', 'entity_admin', 'store_manager', 'cashier'));

update public.entity_settings es
set tax_components=case
  when e.country_code='IN' and es.tax_components='{"Tax":100}'::jsonb
    then '{"CGST":50,"SGST":50}'::jsonb
  when e.country_code<>'IN' and es.tax_components='{"Tax":100}'::jsonb
    then jsonb_build_object(coalesce(nullif(es.tax_framework, ''), 'Tax'), 100)
  else es.tax_components
end
from public.entities e
where e.id=es.entity_id;

create or replace function public.initialize_entity() returns trigger
language plpgsql security definer set search_path=public as $$
declare c countries%rowtype;
begin
  select * into c from countries where code=new.country_code;
  if not found then raise exception 'Unsupported country'; end if;
  update entities set currency_code=c.currency,timezone=c.timezone where id=new.id;
  insert into entity_settings(
    entity_id,
    trading_name,
    tax_framework,
    tax_components
  ) values (
    new.id,
    new.name,
    c.tax_framework,
    case
      when new.country_code='IN' then '{"CGST":50,"SGST":50}'::jsonb
      else jsonb_build_object(c.tax_framework, 100)
    end
  );
  insert into receipt_settings(entity_id) values(new.id);
  insert into categories(entity_id,name,default_tax_rate,sort_order)
  values
    (new.id,'Fresh Items',5,10),
    (new.id,'Grocery & Kitchen',5,20),
    (new.id,'Snacks & Drinks',12,30),
    (new.id,'Beauty & Wellness',18,40),
    (new.id,'Household & Lifestyle',18,50);
  return new;
end $$;

commit;
