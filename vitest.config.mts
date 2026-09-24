import { existsSync } from "node:fs";
import { configDefaults, defineConfig } from "vitest/config";

const databaseTests = [
  "src/lib/combined-schema.test.ts",
  "src/lib/database.test.ts",
  "src/lib/platform.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    exclude: existsSync("supabase/migrations")
      ? configDefaults.exclude
      : [...configDefaults.exclude, ...databaseTests],
  },
});
