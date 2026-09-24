import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const schemaPath = join(projectRoot, "supabase", "schema.sql");
const backupDirectory = join(projectRoot, "supabase", "backups");
const backupFilename = "cubipos-complete-schema.sql";
const backupPath = join(backupDirectory, backupFilename);

execFileSync(process.execPath, [join(projectRoot, "scripts", "combined-schema.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

const schema = readFileSync(schemaPath, "utf8");
const header = `-- CubiPOS by Cubixtop complete Supabase schema backup.
-- Generated from every numbered migration in supabase/migrations.
-- Use this file on a fresh Supabase project. It contains no passwords or API keys.
-- Existing Auth users and transactional data are not included.

`;
const backup = `${header}${schema}`;
const checksum = createHash("sha256").update(backup).digest("hex");

mkdirSync(backupDirectory, { recursive: true });
writeFileSync(backupPath, backup);
writeFileSync(
  join(backupDirectory, "SHA256SUMS"),
  `${checksum}  ${backupFilename}\n`,
);

console.log(`Created ${backupPath}`);
console.log(`SHA-256 ${checksum}`);
