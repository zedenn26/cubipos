import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
const db = new PGlite({ extensions: { citext, pgcrypto } });
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function user(n: number, session = n + 1000) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id(n)}',false); select set_config('request.jwt.claims','{"session_id":"${id(session)}"}',false);`,
  );
}
beforeAll(async () => {
  await db.exec(
    `create schema auth; create role authenticated; create role service_role; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
  );
  for (const name of ["0001_mypos_core", "0002_roles_and_checkout"])
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
  await db.exec(
    `insert into auth.users values('${id(10)}'),('${id(11)}'),('${id(12)}'); insert into profiles(id,entity_id,display_name,role) values('${id(10)}',null,'Platform','super_admin'),('${id(11)}','${id(1)}','Admin','entity_admin'),('${id(12)}','${id(1)}','Cashier','cashier');`,
  );
  await db.exec(
    `grant usage on schema auth,public to authenticated; grant all on all tables in schema public to authenticated; alter default privileges in schema public grant all on tables to authenticated;`,
  );
  await db.exec(
    `create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb); alter table storage.objects enable row level security; create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;`,
  );
  for (const name of [
    "0003_platform_security",
    "0004_retail_operations",
    "0005_storage_and_limits",
    "0006_reporting_and_guards",
    "0007_credit_and_purchase_returns",
    "0008_configuration_and_history",
    "0009_platform_admin_email",
    "0010_fix_operation_rate_limit",
    "0011_backfill_entity_defaults",
    "0012_simplify_roles_and_tax_defaults",
    "0013_bulk_product_import",
    "0014_cashier_returns_exchanges",
    "0015_restore_store_operation_guard",
    "0016_bulk_product_delete",
    "0017_sales_receipts_and_cashier_reports",
    "0018_automatic_daily_registers",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
  await db.exec(`
 update entities set max_stores=2,max_concurrent_sessions=2 where id='${id(1)}';
 insert into stores(id,entity_id,name,code) values('${id(20)}','${id(1)}','Main','MAIN'),('${id(21)}','${id(1)}','Other','OTHER');
 insert into user_stores values('${id(12)}','${id(20)}');
 update entity_settings set tax_confirmed=true where entity_id='${id(1)}';
 insert into products(id,entity_id,name,sku,internal_code,selling_price,tax_rate) values('${id(30)}','${id(1)}','Milk','MILK','MILK',100,5);
 insert into inventory values('${id(20)}','${id(30)}',20,now());`);
}, 30000);
afterAll(() => db.close());
it("gives cashiers the requested audited return and exchange workflows", async () => {
  await user(12);
  await db.query(`select register_session('cashier permissions')`);
  expect((await db.query(`select has_permission('returns.create') allowed`)).rows[0]).toEqual({
    allowed: true,
  });
  expect((await db.query(`select has_permission('exchanges.create') allowed`)).rows[0]).toEqual({
    allowed: true,
  });
});
it("isolates system admins from all tenant operations", async () => {
  await user(10);
  expect((await db.query("select id from products")).rows).toHaveLength(0);
  await expect(
    db.query(`select adjust_stock('${id(20)}','${id(30)}',50)`),
  ).rejects.toThrow("Access denied");
  expect((await db.query("select platform_overview()")).rows).toHaveLength(1);
});
it("enforces concurrent sessions and store access", async () => {
  await user(11);
  await db.query(`select register_session('admin')`);
  await user(12);
  await db.query(`select register_session('cashier')`);
  expect((await db.query("select id from stores")).rows).toEqual([
    { id: id(20) },
  ]);
  await user(12, 2000);
  await expect(
    db.query(`select register_session('third device')`),
  ).rejects.toThrow("Concurrent session limit");
  await user(12);
  await expect(
    db.query(`select search_products('${id(21)}','','0')`),
  ).rejects.toThrow("Access denied");
});
it("bulk deletes unused products and archives products with stock", async () => {
  await user(11);
  await db.query(`select register_session('admin')`);
  await db.exec(`
    insert into products(id,entity_id,name,sku,internal_code,selling_price)
    values
      ('${id(33)}','${id(1)}','Unused product','UNUSED-33','UNUSED-33',10),
      ('${id(34)}','${id(1)}','Stocked product','STOCKED-34','STOCKED-34',10);
  `);
  await db.query(`select adjust_stock('${id(20)}','${id(34)}',2)`);
  const result = await db.query<{ bulk_delete_products: { deleted: number; archived: number } }>(
    `select bulk_delete_products(array['${id(33)}','${id(34)}']::uuid[])`,
  );
  expect(result.rows[0].bulk_delete_products).toMatchObject({
    deleted: 1,
    archived: 1,
  });
  expect(
    (await db.query(`select id,is_active from products where id in ('${id(33)}','${id(34)}')`)).rows,
  ).toEqual([{ id: id(34), is_active: false }]);
  await db.exec(`
    reset role;
    delete from inventory_movements where product_id='${id(34)}';
    delete from inventory where product_id='${id(34)}';
  `);
});
it("automatically opens one daily register and enforces immutable totals and idempotency", async () => {
  await user(12);
  const call = `select checkout_v2('${id(20)}','[{"product_id":"${id(30)}","quantity":2}]','[{"method":"cash","amount":210}]','${id(40)}')`;
  await db.query(call);
  await db.query(call);
  const dailyRegisters = await db.query<{
    id: string;
    automatic: boolean;
    opened_at: Date;
    scheduled_close_at: Date;
  }>(`select id,automatic,opened_at,scheduled_close_at from register_shifts where cashier_id='${id(12)}' and store_id='${id(20)}'`);
  expect(dailyRegisters.rows).toHaveLength(1);
  expect(dailyRegisters.rows[0].automatic).toBe(true);
  expect(
    new Date(dailyRegisters.rows[0].scheduled_close_at).getTime(),
  ).toBeGreaterThan(new Date(dailyRegisters.rows[0].opened_at).getTime());
  await db.exec(`
    reset role;
    update register_shifts
    set business_date=business_date-1,
        opened_at=opened_at-interval '1 day',
        scheduled_close_at=now()-interval '1 minute'
    where id='${dailyRegisters.rows[0].id}';
  `);
  await user(12);
  await db.query(`select ensure_daily_register('${id(20)}')`);
  const rolled = await db.query<{ closed_at: Date | null; close_reason: string | null }>(
    `select closed_at,close_reason from register_shifts where id='${dailyRegisters.rows[0].id}'`,
  );
  expect(rolled.rows[0].closed_at).not.toBeNull();
  expect(rolled.rows[0].close_reason).toBe("Automatic end-of-day close");
  expect(
    (await db.query(`select id from register_shifts where cashier_id='${id(12)}' and store_id='${id(20)}'`)).rows,
  ).toHaveLength(2);
  expect(
    (await db.query<{ quantity: string }>("select quantity from inventory"))
      .rows[0].quantity,
  ).toBe("18.000");
  expect(
    (
      await db.query<{ product_name: string }>(
        "select product_name from sale_items",
      )
    ).rows[0].product_name,
  ).toBe("Milk");
  await expect(
    db.query(
      `select checkout_v2('${id(20)}','[{"product_id":"${id(30)}","quantity":1}]','[{"method":"cash","amount":1}]','${id(41)}')`,
    ),
  ).rejects.toThrow("Payment total");
  expect((await db.query("select * from sales")).rows).toHaveLength(1);
});
it("returns only original quantities and restores stock atomically", async () => {
  await user(11);
  await db.query(`select register_action('${id(20)}','open',100,'')`);
  const item = (await db.query<{ id: string }>("select id from sale_items"))
    .rows[0].id;
  await db.query(
    `select process_return('${id(40)}','[{"sale_item_id":"${item}","quantity":1,"disposition":"restocked"}]','Wrong item','cash','${id(50)}')`,
  );
  await expect(
    db.query(
      `select process_return('${id(40)}','[{"sale_item_id":"${item}","quantity":2,"disposition":"restocked"}]','Wrong item','cash','${id(51)}')`,
    ),
  ).rejects.toThrow("Invalid return quantity");
  expect(
    (await db.query<{ quantity: string }>("select quantity from inventory"))
      .rows[0].quantity,
  ).toBe("19.000");
});
it("exchanges atomically apply return credit and prevent repeat consumption", async () => {
  await user(11);
  const item = (
    await db.query<{ id: string }>(
      `select id from sale_items where sale_id='${id(40)}'`,
    )
  ).rows[0].id;
  const call = `select process_exchange('${id(40)}','[{"sale_item_id":"${item}","quantity":1,"disposition":"restocked"}]','[{"product_id":"${id(30)}","quantity":1}]','[]','Replacement','${id(60)}')`;
  await db.query(call);
  await db.query(call);
  expect((await db.query("select * from exchanges")).rows).toHaveLength(1);
  expect(
    (await db.query("select * from payments where method='exchange_credit'"))
      .rows,
  ).toHaveLength(1);
});
it("receives purchase stock once and enforces transfer transitions", async () => {
  await user(11);
  await db.query(
    `insert into suppliers(id,entity_id,name) values('${id(70)}','${id(1)}','Supplier')`,
  );
  const purchase = (
    await db.query<{ create_purchase: string }>(
      `select create_purchase('${id(20)}','${id(70)}','[{"product_id":"${id(30)}","quantity":5,"unit_cost":50}]','SUP-1')`,
    )
  ).rows[0].create_purchase;
  await db.query(`select receive_purchase('${purchase}')`);
  await db.query(`select receive_purchase('${purchase}')`);
  expect((await db.query("select * from goods_receipts")).rows).toHaveLength(1);
  const transfer = (
    await db.query<{ request_transfer: string }>(
      `select request_transfer('${id(20)}','${id(21)}','${id(30)}',2)`,
    )
  ).rows[0].request_transfer;
  await expect(
    db.query(`select advance_transfer('${transfer}','received')`),
  ).rejects.toThrow("Invalid transfer transition");
  for (const status of ["approved", "dispatched", "received"])
    await db.query(`select advance_transfer('${transfer}','${status}')`);
  expect(
    (
      await db.query<{ quantity: string }>(
        `select quantity from inventory where store_id='${id(21)}'`,
      )
    ).rows[0].quantity,
  ).toBe("2.000");
});
it("reports allow cashiers for assigned stores and tax snapshots allocate rounding exactly", async () => {
  await user(12);
  const cashierReport = await db.query<{ report_rows: Array<Record<string, unknown>> }>(
    `select report_rows('sales',now()-interval '1 day',now()+interval '1 day')`,
  );
  expect(cashierReport.rows[0].report_rows.length).toBeGreaterThan(0);
  expect(
    cashierReport.rows[0].report_rows.find((row) => row.id === id(40)),
  ).toMatchObject({
    cashier_id: id(12),
    refund_total: 210,
  });
  await expect(
    db.query(
      `select report_rows('sales',now()-interval '1 day',now()+interval '1 day','${id(21)}')`,
    ),
  ).rejects.toThrow("Access denied");
  await user(11);
  await db.query(
    `update entity_settings set tax_components='{"A":50,"B":50}' where entity_id='${id(1)}'`,
  );
  expect(
    (
      await db.query<{ tax_snapshot: Record<string, number> }>(
        `select tax_snapshot(0.05,'${id(1)}')`,
      )
    ).rows[0].tax_snapshot,
  ).toEqual({ A: 0.03, B: 0.02 });
  const report = await db.query<{ report_rows: unknown[] }>(
    `select report_rows('sales',now()-interval '1 day',now()+interval '1 day')`,
  );
  expect(report.rows[0].report_rows.length).toBeGreaterThan(0);
});
it("enforces customer credit limits and journals supplier returns", async () => {
  await user(11);
  await db.query(
    `insert into customers(id,entity_id,name) values('${id(80)}','${id(1)}','Credit customer')`,
  );
  await db.query(`select set_customer_credit('${id(80)}',110)`);
  await db.query(
    `select checkout_v2('${id(20)}','[{"product_id":"${id(30)}","quantity":1}]','[{"method":"customer_credit","amount":105}]','${id(81)}','${id(80)}')`,
  );
  await expect(
    db.query(
      `select checkout_v2('${id(20)}','[{"product_id":"${id(30)}","quantity":1}]','[{"method":"customer_credit","amount":105}]','${id(82)}','${id(80)}')`,
    ),
  ).rejects.toThrow("Insufficient customer credit");
  expect(
    (
      await db.query<{ credit_used: string }>(
        `select credit_used from customer_accounts where customer_id='${id(80)}'`,
      )
    ).rows[0].credit_used,
  ).toBe("105.00");
  const purchase = (
    await db.query<{ id: string }>("select id from purchase_orders")
  ).rows[0].id;
  const item = (await db.query<{ id: string }>("select id from purchase_items"))
    .rows[0].id;
  await db.query(
    `select return_purchase('${purchase}','${item}',1,'Damaged on delivery','${id(83)}')`,
  );
  await db.query(
    `select return_purchase('${purchase}','${item}',1,'Damaged on delivery','${id(83)}')`,
  );
  expect((await db.query("select * from purchase_returns")).rows).toHaveLength(
    1,
  );
});
it("protects cost data and cross-tenant storage paths", async () => {
  await user(12);
  await expect(
    db.query("select purchase_price from products"),
  ).rejects.toThrow();
  const resolved = (
    await db.query<{ resolve_product: Record<string, unknown> }>(
      `select resolve_product('${id(20)}','MILK')`,
    )
  ).rows[0].resolve_product;
  expect(resolved).not.toHaveProperty("purchase_price");
  await db.exec(
    `reset role; grant usage on schema storage to authenticated; grant all on storage.objects to authenticated;`,
  );
  await user(12);
  await expect(
    db.query(
      `insert into storage.objects(bucket_id,name,metadata) values('product-images','entities/${id(2)}/image.png','{"size":100}')`,
    ),
  ).rejects.toThrow();
});
it("imports products and category paths atomically with opening stock",async()=>{
 await user(11);
 const imported=await db.query<{bulk_import_products:{products_created:number;categories_created:number}}>(`select bulk_import_products('${id(20)}','[{"row_number":2,"name":"Bulk Tea","category":"Bulk Drinks","subcategory":"Tea","sku":"BULK-TEA","internal_code":"BULK-TEA","unit":"pack","purchase_price":40,"selling_price":60,"mrp":70,"tax_mode":"exclusive","tax_rate":5,"opening_quantity":7,"reorder_level":2,"is_active":true}]',true)`);
 expect(imported.rows[0].bulk_import_products).toEqual({products_created:1,categories_created:2});
 expect((await db.query<{quantity:string}>("select quantity from inventory i join products p on p.id=i.product_id where p.sku='BULK-TEA'")).rows[0].quantity).toBe("7.000");
 await expect(db.query(`select bulk_import_products('${id(20)}','[{"row_number":2,"name":"Bad One","category":"Bulk Drinks","sku":"DUP-BULK","unit":"pcs","purchase_price":1,"selling_price":2,"tax_mode":"exclusive","opening_quantity":0,"reorder_level":0,"is_active":true},{"row_number":3,"name":"Bad Two","category":"Bulk Drinks","sku":"DUP-BULK","unit":"pcs","purchase_price":1,"selling_price":2,"tax_mode":"exclusive","opening_quantity":0,"reorder_level":0,"is_active":true}]',false)`)).rejects.toThrow("duplicate SKU");
 expect((await db.query("select id from products where sku='DUP-BULK'")).rows).toHaveLength(0);
});
it("preserves historical reporting when a store is inactive but blocks new sales",async()=>{
 await user(11);await db.query(`update stores set is_active=false where id='${id(20)}'`);
 expect((await db.query(`select id from sales where store_id='${id(20)}'`)).rows.length).toBeGreaterThan(0);
 await expect(db.query(`select checkout_v2('${id(20)}','[{"product_id":"${id(30)}","quantity":1}]','[{"method":"cash","amount":105}]','${id(95)}')`)).rejects.toThrow('Access denied');
 await db.query(`update stores set is_active=true where id='${id(20)}'`);
});
it("enforces store quotas", async () => {
  await user(11);
  await expect(
    db.query(
      `insert into stores(entity_id,name,code) values('${id(1)}','Excess','EXCESS')`,
    ),
  ).rejects.toThrow("Store limit");
});
it("revocation blocks already issued tokens", async () => {
  await user(11);
  await db.query(`select revoke_session('${id(1012)}')`);
  await user(12);
  expect((await db.query("select id from products")).rows).toHaveLength(0);
  await expect(db.query(`select register_session('revoked')`)).rejects.toThrow(
    "Session revoked",
  );
});
