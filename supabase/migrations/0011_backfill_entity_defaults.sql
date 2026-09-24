begin;

insert into public.entity_settings(entity_id, trading_name, tax_framework)
select e.id, e.name, coalesce(c.tax_framework, 'Other')
from public.entities e
left join public.countries c on c.code=e.country_code
on conflict(entity_id) do nothing;

insert into public.receipt_settings(entity_id)
select e.id from public.entities e
on conflict(entity_id) do nothing;

insert into public.categories(entity_id, name, default_tax_rate, sort_order)
select e.id, defaults.name, defaults.tax_rate, defaults.sort_order
from public.entities e
cross join (values
  ('Fresh Items', 5::numeric, 10),
  ('Grocery & Kitchen', 5::numeric, 20),
  ('Snacks & Drinks', 12::numeric, 30),
  ('Beauty & Wellness', 18::numeric, 40),
  ('Household & Lifestyle', 18::numeric, 50)
) as defaults(name, tax_rate, sort_order)
on conflict(entity_id, name) do nothing;

commit;
