/**
 * Integration test against the hosted Supabase project in .env.local.
 *
 * Creates a disposable user + business, exercises the real API (PostgREST, RLS,
 * Storage, Auth), then deletes everything it created. Your real business data is
 * never touched: RLS isolates the test business, and cleanup only removes rows
 * belonging to the test business id.
 *
 * Run with: npm run test:integration
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const email = `velqora-it-${Date.now()}@example.com`;
const password = `It-${crypto.randomUUID()}`;

let admin: SupabaseClient;
let user: SupabaseClient;
let anon: SupabaseClient;
let userId: string;
let biz: string;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await user.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

beforeAll(async () => {
  if (!URL || !KEY || !SERVICE) throw new Error("Fill in .env.local first (see README).");
  admin = createClient(URL, SERVICE, opts);
  anon = createClient(URL, KEY, opts);
  user = createClient(URL, KEY, opts);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  const signIn = await user.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
});

afterAll(async () => {
  if (biz) {
    const { data: files } = await admin.storage.from("business-files").list(`${biz}/products`);
    if (files?.length) await admin.storage.from("business-files").remove(files.map((f) => `${biz}/products/${f.name}`));
    await admin.from("businesses").delete().eq("id", biz);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("hosted Supabase", () => {
  it("anonymous visitors cannot read business data", async () => {
    const { data, error } = await anon.from("businesses").select("*");
    expect(error?.code === "42501" || (data ?? []).length === 0).toBe(true);
    const { data: owner } = await anon.rpc("app_has_owner");
    expect(typeof owner).toBe("boolean");
  });

  it("creates a business for the signed-in user", async () => {
    biz = await rpc<string>("create_business", { p: { name: "IT Test Business", currency: "INR", country: "India", modules: { production: true } } });
    expect(biz).toMatch(/[0-9a-f-]{36}/);
    const { data } = await user.from("business_settings").select("*").eq("business_id", biz).single();
    expect(data?.module_production).toBe(true);
  });

  it("runs purchase → order → payment → report", async () => {
    const product = await rpc<string>("save_product", {
      p_business: biz,
      p_product: { name: "IT Widget", item_type: "product", track_inventory: true },
      p_variants: [{ sku: `IT-${Date.now()}`, selling_price: 250, cost_price: 100, min_stock: 3 }],
      p_components: [],
    });
    const { data: variant } = await user.from("product_variants").select("id").eq("product_id", product).single();

    const purchase = await rpc<string>("save_purchase", {
      p_business: biz,
      p_purchase: { status: "ordered" },
      p_lines: [{ variant_id: variant!.id, quantity: 10, unit_price: 90 }],
    });
    await rpc("receive_purchase", { p_purchase: purchase, p_receipts: null, p_batch_lot: null });
    let { data: level } = await user.from("inventory_levels").select("quantity, avg_cost").eq("variant_id", variant!.id).single();
    expect(Number(level!.quantity)).toBe(10);
    expect(Number(level!.avg_cost)).toBe(90);

    const order = await rpc<string>("save_order", {
      p_business: biz,
      p_order: { status: "draft", shipping_charge: 40 },
      p_lines: [{ variant_id: variant!.id, quantity: 8, unit_price: 250 }],
    });
    const pay = await user.from("payments").insert({ business_id: biz, direction: "in", amount: 1000, method: "UPI", order_id: order });
    expect(pay.error).toBeNull();
    await rpc("set_order_status", { p_order: order, p_status: "confirmed" });

    const { data: o } = await user.from("orders").select("*").eq("id", order).single();
    expect(Number(o!.total)).toBe(2040);
    expect(Number(o!.amount_paid)).toBe(1000);
    expect(o!.payment_status).toBe("partial");
    expect(Number(o!.cogs_total)).toBe(720);

    ({ data: level } = await user.from("inventory_levels").select("quantity, avg_cost").eq("variant_id", variant!.id).single());
    expect(Number(level!.quantity)).toBe(2);

    const { data: low } = await user.from("inventory_overview").select("is_low").eq("variant_id", variant!.id).single();
    expect(low!.is_low).toBe(true);

    const summary = await rpc<Record<string, number>>("report_profit_summary", { p_business: biz, p_from: "2000-01-01", p_to: "2100-01-01" });
    expect(Number(summary.revenue)).toBe(2040);
    expect(Number(summary.gross_profit)).toBe(1320);
  });

  it("blocks direct stock edits through the API", async () => {
    const { error } = await user.from("inventory_levels").update({ quantity: 999 }).eq("business_id", biz);
    expect(error).not.toBeNull();
  });

  it("stores files only inside the business folder", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ok = await user.storage.from("business-files").upload(`${biz}/products/it.png`, png, { contentType: "image/png" });
    expect(ok.error).toBeNull();
    const signed = await user.storage.from("business-files").createSignedUrl(`${biz}/products/it.png`, 60);
    expect(signed.data?.signedUrl).toBeTruthy();
    const bad = await user.storage.from("business-files").upload(`00000000-0000-0000-0000-000000000000/x.png`, png, { contentType: "image/png" });
    expect(bad.error).not.toBeNull();
  });

  it("seeds and removes demo data", async () => {
    await rpc("seed_demo_data", { p_business: biz });
    const { count } = await user.from("orders").select("id", { count: "exact", head: true }).eq("is_demo", true);
    expect(count).toBe(3);
    await rpc("delete_demo_data", { p_business: biz });
    const after = await user.from("products").select("id", { count: "exact", head: true }).eq("is_demo", true);
    expect(after.count).toBe(0);
  });
});
