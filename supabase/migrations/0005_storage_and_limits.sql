begin;
create table operation_limits(user_id uuid references auth.users,operation text,bucket timestamptz,hits integer not null,primary key(user_id,operation,bucket));
alter table operation_limits enable row level security;
create function consume_operation(operation text,maximum integer) returns void language plpgsql security definer set search_path=public as $$ declare hits integer; begin
 if auth.uid() is null then raise exception 'Access denied'; end if;
 insert into operation_limits values(auth.uid(),operation,date_trunc('hour',now()),1) on conflict(user_id,operation,bucket) do update set hits=operation_limits.hits+1 returning operation_limits.hits into hits;
 if hits>least(greatest(maximum,1),20) then raise exception 'Too many requests. Try later'; end if;
end $$;
revoke execute on function consume_operation(text,integer) from public;
grant execute on function consume_operation(text,integer) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('entity-logos','entity-logos',false,2097152,array['image/png','image/jpeg','image/webp']),('product-images','product-images',false,5242880,array['image/png','image/jpeg','image/webp']),('report-files','report-files',false,20971520,array['application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) on conflict(id) do nothing;
create policy tenant_file_read on storage.objects for select to authenticated using(bucket_id in ('entity-logos','product-images','report-files') and (storage.foldername(name))[1]='entities' and (storage.foldername(name))[2]=public.current_entity_id()::text and (bucket_id<>'report-files' or public.has_permission('reports.read')));
create policy tenant_file_insert on storage.objects for insert to authenticated with check((storage.foldername(name))[1]='entities' and (storage.foldername(name))[2]=public.current_entity_id()::text and ((bucket_id='entity-logos' and public.has_permission('settings.manage')) or (bucket_id='product-images' and public.has_permission('products.manage'))));
create policy tenant_file_delete on storage.objects for delete to authenticated using((storage.foldername(name))[1]='entities' and (storage.foldername(name))[2]=public.current_entity_id()::text and ((bucket_id='entity-logos' and public.has_permission('settings.manage')) or (bucket_id='product-images' and public.has_permission('products.manage'))));
commit;
