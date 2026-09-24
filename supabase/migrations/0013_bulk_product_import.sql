begin;

create or replace function public.bulk_import_products(
  target_store uuid,
  product_rows jsonb,
  create_missing_categories boolean default false
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  tenant uuid:=current_entity_id();
  line jsonb;
  row_number integer;
  product_name text;
  category_name text;
  subcategory_name text;
  product_sku text;
  product_internal_code text;
  product_barcode text;
  product_qr_identifier text;
  product_tax_code text;
  product_unit text;
  product_tax_mode text;
  category_id uuid;
  parent_category_id uuid;
  tax_code_id uuid;
  product_id uuid;
  purchase_price numeric;
  selling_price numeric;
  mrp numeric;
  tax_rate numeric;
  opening_quantity numeric;
  reorder_level numeric;
  manufactured_on date;
  expires_on date;
  products_created integer:=0;
  categories_created integer:=0;
  seen_skus text[]:='{}';
  seen_internal_codes text[]:='{}';
  seen_barcodes text[]:='{}';
  seen_identifiers text[]:='{}';
begin
  if tenant is null or not can_operate_store(target_store) or not has_permission('products.manage') then
    raise exception 'Access denied';
  end if;
  if product_rows is null or jsonb_typeof(product_rows)<>'array' or jsonb_array_length(product_rows) not between 1 and 2000 then
    raise exception 'Bulk import requires between 1 and 2000 product rows';
  end if;

  for line in select value from jsonb_array_elements(product_rows) loop
    row_number:=coalesce((line->>'row_number')::integer, products_created+2);
    product_name:=nullif(trim(line->>'name'),'');
    category_name:=nullif(trim(line->>'category'),'');
    subcategory_name:=nullif(trim(line->>'subcategory'),'');
    product_sku:=nullif(trim(line->>'sku'),'');
    product_internal_code:=coalesce(nullif(trim(line->>'internal_code'),''), product_sku);
    product_barcode:=nullif(trim(line->>'barcode'),'');
    product_qr_identifier:=nullif(trim(line->>'qr_identifier'),'');
    product_tax_code:=nullif(trim(line->>'tax_code'),'');
    product_unit:=lower(coalesce(nullif(trim(line->>'unit'),''),'pcs'));
    product_tax_mode:=lower(coalesce(nullif(trim(line->>'tax_mode'),''),'exclusive'));
    purchase_price:=coalesce((line->>'purchase_price')::numeric,0);
    selling_price:=coalesce((line->>'selling_price')::numeric,0);
    mrp:=nullif(line->>'mrp','')::numeric;
    tax_rate:=nullif(line->>'tax_rate','')::numeric;
    opening_quantity:=coalesce((line->>'opening_quantity')::numeric,0);
    reorder_level:=coalesce((line->>'reorder_level')::numeric,0);
    manufactured_on:=nullif(line->>'manufactured_on','')::date;
    expires_on:=nullif(line->>'expires_on','')::date;

    if product_name is null or category_name is null or product_sku is null then
      raise exception 'Row %: product name, category and SKU are required',row_number;
    end if;
    if product_unit not in ('pcs','kg','g','l','ml','box','pack','dozen','bottle') then
      raise exception 'Row %: unsupported unit %',row_number,product_unit;
    end if;
    if product_tax_mode not in ('inclusive','exclusive','exempt','zero_rated') then
      raise exception 'Row %: invalid tax mode %',row_number,product_tax_mode;
    end if;
    if purchase_price<0 or selling_price<0 or mrp<0 or opening_quantity<0 or reorder_level<0 or tax_rate<0 or tax_rate>100 then
      raise exception 'Row %: prices, stock and tax values are invalid',row_number;
    end if;
    if manufactured_on is not null and expires_on is not null and expires_on<manufactured_on then
      raise exception 'Row %: expiry date is before manufacturing date',row_number;
    end if;
    if lower(product_sku)=any(seen_skus) or lower(product_internal_code)=any(seen_internal_codes) or (product_barcode is not null and product_barcode=any(seen_barcodes))
      or lower(product_sku)=any(seen_identifiers) or lower(product_internal_code)=any(seen_identifiers)
      or (product_barcode is not null and lower(product_barcode)=any(seen_identifiers))
      or (product_qr_identifier is not null and lower(product_qr_identifier)=any(seen_identifiers)) then
      raise exception 'Row %: duplicate SKU, internal code, barcode or QR identifier in this file',row_number;
    end if;
    if exists(select 1 from product_identifiers where entity_id=tenant and lower(identifier_value) in (lower(product_sku),lower(product_internal_code),lower(product_barcode),lower(product_qr_identifier))) then
      raise exception 'Row %: SKU, internal code, barcode or QR identifier already exists',row_number;
    end if;
    seen_skus:=array_append(seen_skus,lower(product_sku));
    seen_internal_codes:=array_append(seen_internal_codes,lower(product_internal_code));
    if product_barcode is not null then seen_barcodes:=array_append(seen_barcodes,product_barcode); end if;
    seen_identifiers:=array_append(seen_identifiers,lower(product_sku));
    if lower(product_internal_code)<>lower(product_sku) then seen_identifiers:=array_append(seen_identifiers,lower(product_internal_code)); end if;
    if product_barcode is not null then seen_identifiers:=array_append(seen_identifiers,lower(product_barcode)); end if;
    if product_qr_identifier is not null then seen_identifiers:=array_append(seen_identifiers,lower(product_qr_identifier)); end if;

    select id into parent_category_id from categories
    where entity_id=tenant and lower(name)=lower(category_name) and parent_id is null
    limit 1;
    if parent_category_id is null then
      if exists(select 1 from categories where entity_id=tenant and lower(name)=lower(category_name)) then
        raise exception 'Row %: category "%" is currently a subcategory',row_number,category_name;
      end if;
      if not create_missing_categories then
        raise exception 'Row %: category "%" does not exist',row_number,category_name;
      end if;
      insert into categories(entity_id,name,default_tax_rate,sort_order)
      values(tenant,category_name,0,1000+categories_created)
      returning id into parent_category_id;
      categories_created:=categories_created+1;
    end if;
    category_id:=parent_category_id;
    if subcategory_name is not null then
      select id into category_id from categories
      where entity_id=tenant and lower(name)=lower(subcategory_name) and parent_id=parent_category_id
      limit 1;
      if category_id is null then
        if exists(select 1 from categories where entity_id=tenant and lower(name)=lower(subcategory_name)) then
          raise exception 'Row %: subcategory "%" already belongs elsewhere',row_number,subcategory_name;
        end if;
        if not create_missing_categories then
          raise exception 'Row %: subcategory "%" does not exist',row_number,subcategory_name;
        end if;
        insert into categories(entity_id,parent_id,name,default_tax_rate,sort_order)
        values(tenant,parent_category_id,subcategory_name,0,1000+categories_created)
        returning id into category_id;
        categories_created:=categories_created+1;
      end if;
    end if;

    tax_code_id:=null;
    if product_tax_code is not null then
      select id into tax_code_id from tax_codes
      where entity_id=tenant and lower(code)=lower(product_tax_code) and is_active
      limit 1;
      if tax_code_id is null then raise exception 'Row %: tax code "%" does not exist',row_number,product_tax_code; end if;
    end if;

    insert into products(
      entity_id,category_id,name,description,brand,unit,sku,internal_code,
      barcode,qr_identifier,purchase_price,selling_price,mrp,tax_mode,tax_rate,
      tax_code_id,hsn_sac,reorder_level,batch_number,manufactured_on,expires_on,is_active
    ) values (
      tenant,category_id,product_name,nullif(trim(line->>'description'),''),
      nullif(trim(line->>'brand'),''),product_unit,product_sku,product_internal_code,
      product_barcode,coalesce(product_qr_identifier,'POS:P:'||upper(substr(gen_random_uuid()::text,1,8))),
      purchase_price,selling_price,mrp,product_tax_mode::tax_mode,tax_rate,
      tax_code_id,nullif(trim(line->>'hsn_sac'),''),reorder_level,
      nullif(trim(line->>'batch_number'),''),manufactured_on,expires_on,
      coalesce((line->>'is_active')::boolean,true)
    ) returning id into product_id;
    insert into inventory(store_id,product_id,quantity)
    values(target_store,product_id,opening_quantity);
    if opening_quantity>0 then
      insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,unit_cost,notes,created_by)
      values(tenant,target_store,product_id,'opening',opening_quantity,purchase_price,'Bulk product import',auth.uid());
    end if;
    products_created:=products_created+1;
  end loop;
  return jsonb_build_object('products_created',products_created,'categories_created',categories_created);
end $$;

revoke execute on function public.bulk_import_products(uuid,jsonb,boolean) from public;
grant execute on function public.bulk_import_products(uuid,jsonb,boolean) to authenticated;

commit;
