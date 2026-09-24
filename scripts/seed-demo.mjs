import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
const env = parseEnv(readFileSync(".env.local", "utf8"));
if (process.argv[2] !== "--development-only")
  throw new Error(
    "Explicitly pass --development-only for a disposable development project.",
  );
const password = env.DEMO_SEED_PASSWORD;
if (!password || password.length < 12)
  throw new Error("Set DEMO_SEED_PASSWORD (12+ characters) in .env.local.");
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/rest\/v1\/?$/, ""),
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
for (const [email, role, name, store] of [
  ["demo.admin@example.test", "entity_admin", "Demo Admin", null],
  [
    "demo.cashier1@example.test",
    "cashier",
    "Demo Cashier Central",
    "00000000-0000-0000-0000-000000000101",
  ],
  [
    "demo.cashier2@example.test",
    "cashier",
    "Demo Cashier West",
    "00000000-0000-0000-0000-000000000102",
  ],
]) {
  const result = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (result.error) {
    console.error(`Could not create ${email}: ${result.error.message}`);
    process.exitCode = 1;
    continue;
  }
  const saved = await db
    .from("profiles")
    .insert({
      id: result.data.user.id,
      entity_id: "00000000-0000-0000-0000-000000000001",
      display_name: name,
      email,
      role,
    });
  if (saved.error) {
    await db.auth.admin.deleteUser(result.data.user.id);
    throw new Error(saved.error.message);
  }
  if (store) {
    const assigned = await db
      .from("user_stores")
      .insert({ user_id: result.data.user.id, store_id: store });
    if (assigned.error) throw new Error(assigned.error.message);
  }
  console.log(
    `Created ${email}; uses DEMO_SEED_PASSWORD. Complete onboarding and tax setup before selling.`,
  );
}
