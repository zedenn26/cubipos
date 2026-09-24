import { createClient } from "@supabase/supabase-js";
// Run with Node's --env-file=.env.local. Password is read from a private terminal prompt.
import { createInterface } from "node:readline/promises";
const email = process.argv[2];
if (!email || !email.includes("@"))
  throw new Error("Usage: npm run bootstrap:admin -- admin@example.com");
if (!process.stdin.isTTY) throw new Error("Run from an interactive terminal.");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const name = await rl.question("Display name: ");
rl.close();
process.stdout.write("Password (at least 12 characters, hidden): ");
process.stdin.setRawMode(true);
let password = "";
await new Promise((resolve) => {
  const read = (chunk) => {
    for (const c of chunk.toString()) {
      if (c === "\u0003") process.exit(1);
      if (c === "\r" || c === "\n") {
        process.stdin.off("data", read);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve();
        return;
      }
      if (c === "\u007f") password = password.slice(0, -1);
      else password += c;
    }
  };
  process.stdin.on("data", read);
  process.stdin.resume();
});
process.stdout.write("\n");
if (!name.trim() || password.length < 12)
  throw new Error(
    "A display name and password of at least 12 characters are required.",
  );
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/rest\/v1\/?$/, ""),
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) throw new Error(error.message);
const result = await db.from("profiles").insert({
  id: data.user.id,
  display_name: name.trim(),
  email,
  role: "super_admin",
});
if (result.error) {
  await db.auth.admin.deleteUser(data.user.id);
  throw new Error(result.error.message);
}
const system = await db.from("system_admins").insert({ id: data.user.id });
if (system.error) {
  await db.auth.admin.deleteUser(data.user.id);
  throw new Error(
    "System admin creation failed. Apply all migrations before bootstrapping.",
  );
}
console.log(
  "Super admin created. Sign in with the email and password you supplied.",
);
