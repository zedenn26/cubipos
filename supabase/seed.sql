-- Development data only. Run explicitly AFTER all migrations in a disposable project.
-- Auth users are created by scripts/seed-demo.mjs; passwords never appear in SQL.
begin;
update entities set max_stores=2,max_users=10,max_concurrent_sessions=5 where id='00000000-0000-0000-0000-000000000001';
insert into stores(id,entity_id,name,code) values
('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','Demo Central','CENTRAL'),
('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','Demo West','WEST') on conflict do nothing;
insert into products(id,entity_id,name,sku,internal_code,barcode,qr_identifier,selling_price,purchase_price,tax_rate) values
('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','Demo Coffee','DEMO-COFFEE','DEMO-COFFEE','8901234567890','POS:P:DEMO-COFFEE',100,60,5),
('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000001','Demo Mug','DEMO-MUG','DEMO-MUG','8901234567883','POS:P:DEMO-MUG',200,110,18) on conflict do nothing;
with inserted as (
insert into inventory(store_id,product_id,quantity) select s.id,p.id,50 from stores s cross join products p where s.code in ('CENTRAL','WEST') and s.entity_id='00000000-0000-0000-0000-000000000001' and p.sku in ('DEMO-COFFEE','DEMO-MUG') and p.entity_id=s.entity_id on conflict do nothing returning *
) insert into inventory_movements(entity_id,store_id,product_id,movement_type,quantity,notes) select '00000000-0000-0000-0000-000000000001',store_id,product_id,'opening',quantity,'Development seed' from inserted;
insert into customers(entity_id,name,mobile_normalized) values('00000000-0000-0000-0000-000000000001','Demo Customer','+919000000001') on conflict do nothing;
insert into suppliers(id,entity_id,name) values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000001','Demo Supplier') on conflict do nothing;
commit;
