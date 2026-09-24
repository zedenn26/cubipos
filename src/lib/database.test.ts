import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
const db = new PGlite({ extensions: { citext, pgcrypto } });
const tenantA = "00000000-0000-0000-0000-000000000001";
const tenantB = "00000000-0000-0000-0000-000000000002";
const admin = "10000000-0000-0000-0000-000000000001";
const cashier = "10000000-0000-0000-0000-000000000002";
const superAdmin = "10000000-0000-0000-0000-000000000003";
const store = "20000000-0000-0000-0000-000000000001";
const product = "30000000-0000-0000-0000-000000000001";
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
beforeAll(async () => {
  await db.exec(
    `create schema auth; create table auth.users(id uuid primary key); create role authenticated; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/0001_mypos_core.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/0002_roles_and_checkout.sql", "utf8"),
  );
  await db.exec(`grant usage on schema public,auth to authenticated; grant all on all tables in schema public to authenticated;
 insert into entities(id,name,status) values('${tenantB}','Other tenant','active');
 insert into auth.users(id) values('${admin}'),('${cashier}'),('${superAdmin}');
 insert into profiles(id,entity_id,display_name,role) values('${admin}','${tenantA}','Admin','entity_admin'),('${cashier}','${tenantA}','Cashier','cashier'),('${superAdmin}',null,'Super admin','super_admin');
 insert into stores(id,entity_id,name,code) values('${store}','${tenantA}','Main','MAIN');
 insert into products(id,entity_id,name,sku,internal_code,selling_price,tax_rate) values('${product}','${tenantA}','Test product','TEST','TEST',100,5);
 insert into inventory(store_id,product_id,quantity) values('${store}','${product}',10);`);
}, 30000);
afterAll(async () => {
  await db.close();
});
describe("database permissions and atomic checkout", () => {
  it("isolates an admin from other tenants and prevents self promotion", async () => {
    await asUser(admin);
    expect((await db.query("select id from entities")).rows).toEqual([
      { id: tenantA },
    ]);
    await expect(
      db.query(
        `insert into stores(entity_id,name,code) values('${tenantB}','Forbidden','BAD')`,
      ),
    ).rejects.toThrow();
    await db.query(
      `update profiles set role='super_admin' where id='${admin}'`,
    );
    expect(
      (
        await db.query<{ role: string }>(
          `select role from profiles where id='${admin}'`,
        )
      ).rows[0].role,
    ).toBe("entity_admin");
  });
  it("allows super admins to see all businesses", async () => {
    await asUser(superAdmin);
    expect((await db.query("select id from entities")).rows).toHaveLength(2);
  });
  it("blocks cashiers from stock changes and protects unimplemented sensitive tables", async () => {
    await asUser(cashier);
    await expect(
      db.query(`select adjust_stock('${store}','${product}',100)`),
    ).rejects.toThrow("Access denied");
    await expect(
      db.query(
        `insert into products(entity_id,name,sku,internal_code) values('${tenantA}','Forbidden','BAD','BAD')`,
      ),
    ).rejects.toThrow();
    expect((await db.query("select * from smtp_settings")).rows).toHaveLength(
      0,
    );
  });
  it("saves totals, payments and stock exactly once on retries", async () => {
    await asUser(cashier);
    const sql = `select checkout('${store}','[{"product_id":"${product}","quantity":2}]','cash','40000000-0000-0000-0000-000000000001')`;
    await db.query(sql);
    await db.query(sql);
    expect(
      (await db.query<{ quantity: string }>("select quantity from inventory"))
        .rows[0].quantity,
    ).toBe("8.000");
    expect(
      (await db.query<{ grand_total: string }>("select grand_total from sales"))
        .rows,
    ).toEqual([{ grand_total: "210.00" }]);
    expect((await db.query("select * from payments")).rows).toHaveLength(1);
  });
  it("rolls back the entire sale when stock is insufficient", async () => {
    await asUser(cashier);
    await expect(
      db.query(
        `select checkout('${store}','[{"product_id":"${product}","quantity":20}]','cash','40000000-0000-0000-0000-000000000002')`,
      ),
    ).rejects.toThrow("Insufficient stock");
    expect((await db.query("select * from sales")).rows).toHaveLength(1);
  });
  it("allows admins to deactivate only cashiers and prevents cashier team changes", async () => {
    await asUser(cashier);
    await expect(
      db.query(`select set_team_active('${admin}',false)`),
    ).rejects.toThrow("Access denied");
    await asUser(admin);
    await expect(
      db.query(`select set_team_active('${admin}',false)`),
    ).rejects.toThrow("Access denied");
    await db.query(`select set_team_active('${cashier}',false)`);
    await asUser(cashier);
    expect((await db.query("select * from products")).rows).toHaveLength(0);
    await asUser(admin);
    await db.query(`select set_team_active('${cashier}',true)`);
  });
  it("denies suspended businesses and inactive users", async () => {
    await db.exec(
      `reset role; update entities set status='suspended' where id='${tenantA}';`,
    );
    await asUser(cashier);
    await expect(
      db.query(
        `select checkout('${store}','[{"product_id":"${product}","quantity":1}]','cash','40000000-0000-0000-0000-000000000003')`,
      ),
    ).rejects.toThrow("Access denied");
    await db.exec(
      `reset role; update entities set status='active' where id='${tenantA}'; update profiles set is_active=false where id='${cashier}';`,
    );
    await asUser(cashier);
    expect((await db.query("select * from products")).rows).toHaveLength(0);
  });
});
