import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const files = readdirSync("supabase/migrations")
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
const markers = {
  "0001":
    "to_regclass('public.entities') is not null and to_regclass('public.audit_logs') is not null and to_regclass('public.products') is not null and to_regclass('public.profiles') is not null",
  "0002": "to_regprocedure('public.set_team_active(uuid,boolean)') is not null",
  "0003": "to_regclass('public.system_admins') is not null",
  "0004": "to_regprocedure('public.advance_transfer(uuid,text)') is not null",
  "0005": "to_regclass('public.operation_limits') is not null",
  "0006": "to_regprocedure('public.void_sale(uuid,text,uuid)') is not null",
  "0007": "to_regclass('public.customer_accounts') is not null",
  "0008":
    "exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='receipt_snapshot')",
  "0009": "false",
  "0010": "false",
  "0011": "false",
  "0012": "false",
  "0013": "false",
};
let output = `-- CubiPOS combined schema: paste this entire file into Supabase SQL Editor and Run.\n-- Supports a fresh Supabase project or the earlier MYPOS/CubiPOS numbered migrations.\n-- Existing Auth users, entities, sales and inventory are preserved.\n-- Take a backup first. All changes below commit together or roll back together.\n-- API keys are not needed in this SQL file. Never paste secrets into it.\n\nbegin;\ncreate table if not exists public.mypos_schema_migrations(version text primary key,filename text not null,applied_at timestamptz not null default now(),detected_existing boolean not null default false);\nalter table public.mypos_schema_migrations enable row level security;\n`;
for (const file of files) {
  const version = file.slice(0, 4);
  const body = readFileSync(`supabase/migrations/${file}`, "utf8").replace(
    /^\s*(begin|commit);\s*$/gim,
    "",
  );
  output += `\n-- ${file}\ndo $apply_${version}$\nbegin\n if not exists(select 1 from public.mypos_schema_migrations where version='${version}') then\n  if ${markers[version] ?? "false"} then\n   insert into public.mypos_schema_migrations(version,filename,detected_existing) values('${version}','${file}',true);\n  else\n   execute $sql_${version}$\n${body}\n$sql_${version}$;\n   insert into public.mypos_schema_migrations(version,filename) values('${version}','${file}');\n  end if;\n end if;\nend\n$apply_${version}$;\n`;
}
output += `\ncommit;\nselect version,filename,detected_existing,applied_at from public.mypos_schema_migrations order by version;\n`;
writeFileSync("supabase/schema.sql", output);
console.log(
  `Created supabase/schema.sql: ${files.length} migrations with existing-schema detection and an application ledger.`,
);
