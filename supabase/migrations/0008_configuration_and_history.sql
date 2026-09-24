begin;
alter table entity_settings add column legal_name text;
alter table stores add column phone text,add column email citext,add column receipt_configuration jsonb not null default '{}';
alter table customers add column notes text,add column created_by uuid references profiles default auth.uid();
alter table sales add column receipt_snapshot jsonb not null default '{}';
create function capture_receipt() returns trigger language plpgsql security definer set search_path=public as $$ begin
 new.receipt_snapshot:=jsonb_build_object('business',(select to_jsonb(es) from entity_settings es where es.entity_id=new.entity_id),'store',(select jsonb_build_object('name',s.name,'code',s.code,'address',s.address,'phone',s.phone) from stores s where s.id=new.store_id),'cashier',(select display_name from profiles where id=new.cashier_id),'customer',(select jsonb_build_object('name',c.name,'mobile',c.mobile_normalized,'address',c.address) from customers c where c.id=new.customer_id));return new;
end $$;
create trigger receipt_snapshot before insert on sales for each row execute function capture_receipt();
create function storage_quota_guard() returns trigger language plpgsql security definer set search_path=public,storage as $$ declare tenant uuid; quota bigint; used numeric; incoming numeric; begin
 if new.bucket_id not in ('entity-logos','product-images','report-files') then return new; end if;
 if split_part(new.name,'/',1)<>'entities' then raise exception 'Invalid storage path'; end if;
 tenant:=split_part(new.name,'/',2)::uuid;
 select storage_limit_mb*1024*1024 into quota from public.entities where id=tenant for update;
 if quota is null then raise exception 'Invalid entity'; end if;
 incoming:=coalesce((new.metadata->>'size')::numeric,0);
 select coalesce(sum(coalesce((metadata->>'size')::numeric,0)),0) into used from storage.objects where bucket_id in ('entity-logos','product-images','report-files') and split_part(name,'/',2)=tenant::text and id<>new.id;
 if used+incoming>quota then raise exception 'Storage limit reached'; end if;return new;
end $$;
create trigger tenant_storage_quota before insert or update of metadata,name on storage.objects for each row execute function storage_quota_guard();
-- Keep tax component configuration valid before allowing checkout.
create function tax_component_guard() returns trigger language plpgsql set search_path=public as $$ declare weight numeric; begin
 if jsonb_typeof(new.tax_components)<>'object' then raise exception 'Tax components must be a JSON object'; end if;
 select sum(value::numeric) into weight from jsonb_each_text(new.tax_components);
 if weight is null or weight<>100 or exists(select 1 from jsonb_each_text(new.tax_components) where value::numeric<0) then raise exception 'Tax component weights must total 100';end if;
 return new;
end $$;
create trigger validate_tax_components before insert or update of tax_components on entity_settings for each row execute function tax_component_guard();
commit;
