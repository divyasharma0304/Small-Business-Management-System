#!/usr/bin/env node
/**
 * Manage a disposable end-to-end test user in the hosted Supabase project.
 *
 *   node scripts/e2e-user.mjs create   # creates the user, stores credentials in .env.local
 *   node scripts/e2e-user.mjs delete   # deletes the user AND the business it created
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY — for local testing only; the app never uses it.
 * Credentials are written to the git-ignored .env.local and never printed.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const cmd = process.argv[2];

if (cmd === "create") {
  if (process.env.E2E_TEST_EMAIL) {
    console.log("E2E test user already configured in .env.local");
    process.exit(0);
  }
  const email = `velqora-e2e-${randomBytes(3).toString("hex")}@example.com`;
  const password = `E2e-${randomBytes(12).toString("base64url")}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  appendFileSync(".env.local", `\n# Disposable E2E test user (delete with: node scripts/e2e-user.mjs delete)\nE2E_TEST_EMAIL=${email}\nE2E_TEST_PASSWORD=${password}\n`);
  console.log("Created E2E test user; credentials saved to .env.local");
} else if (cmd === "delete") {
  const email = process.env.E2E_TEST_EMAIL;
  if (!email) {
    console.log("No E2E test user configured.");
    process.exit(0);
  }
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === email);
  if (user) {
    const { data: members } = await admin.from("business_members").select("business_id").eq("user_id", user.id);
    for (const m of members ?? []) {
      const { data: files } = await admin.storage.from("business-files").list(m.business_id, { limit: 1000 });
      for (const folder of files ?? []) {
        const { data: inner } = await admin.storage.from("business-files").list(`${m.business_id}/${folder.name}`, { limit: 1000 });
        if (inner?.length) await admin.storage.from("business-files").remove(inner.map((f) => `${m.business_id}/${folder.name}/${f.name}`));
      }
      await admin.from("businesses").delete().eq("id", m.business_id);
    }
    await admin.auth.admin.deleteUser(user.id);
  }
  const env = readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("E2E_TEST_") && !l.startsWith("# Disposable E2E"))
    .join("\n");
  writeFileSync(".env.local", env.replace(/\n{3,}/g, "\n\n"));
  console.log("Deleted E2E test user and its business.");
} else {
  console.log("Usage: node scripts/e2e-user.mjs create|delete");
}
