#!/usr/bin/env node
/**
 * Applies supabase/migrations to the hosted database using the Supabase CLI.
 * Reads SUPABASE_DB_URL from .env.local so the password never appears in shell
 * history. Extra args are forwarded (e.g. `npm run db:push -- --dry-run`).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set in .env.local (Supabase dashboard → Connect → Session pooler).");
  process.exit(1);
}

// Run the locally installed CLI with node directly (no shell → special characters in the password are safe).
const cli = fileURLToPath(new URL("../node_modules/supabase/dist/supabase.js", import.meta.url));
const args = [cli, "db", "push", "--db-url", url, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, { stdio: ["inherit", "pipe", "pipe"] });
const redact = (s) => s.toString().split(url).join("<SUPABASE_DB_URL>").replace(/postgres(ql)?:\/\/[^\s@]+@/g, "postgresql://***@");
process.stdout.write(redact(result.stdout ?? ""));
process.stderr.write(redact(result.stderr ?? ""));
process.exit(result.status ?? 1);
