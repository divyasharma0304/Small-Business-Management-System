"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireContext, requireUser } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { businessProfileSchema, modulesSchema, setupSchema } from "@/lib/validation/business";
import { bool, nonNegativeQty, percent } from "@/lib/validation/common";

export async function createBusinessAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUser();
  if (ctx.business) return fail("Your business is already set up.");
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));

  const m = parsed.data.modules;
  const modules = { ...m, purchases: m.inventory && m.purchases, production: m.inventory && m.production };
  const { data, error } = await ctx.supabase.rpc("create_business", { p: { ...parsed.data, modules } });
  if (error) return fail(friendlyDbError(error, "create_business"));
  // No revalidation here: the wizard still has to show its logo step, and /setup
  // redirects away once a business exists. The wizard refreshes when it finishes.
  return ok({ id: data as string });
}

export async function updateBusinessProfileAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = businessProfileSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));

  const { error } = await ctx.supabase.from("businesses").update(parsed.data).eq("id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "update business"));
  await audit(ctx, "settings.business", "business", ctx.businessId, "Business profile updated", ctx.business, parsed.data);
  revalidatePath("/", "layout");
  return ok(undefined, "Business details saved");
}

export async function setBusinessLogoAction(path: string | null): Promise<ActionResult> {
  const ctx = await requireContext();
  if (path !== null && !path.startsWith(`${ctx.businessId}/`)) return fail("Invalid file.");
  const previous = ctx.business.logo_path;
  const { error } = await ctx.supabase.from("businesses").update({ logo_path: path }).eq("id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "set logo"));
  if (previous && previous !== path) await ctx.supabase.storage.from("business-files").remove([previous]);
  await audit(ctx, "settings.logo", "business", ctx.businessId, path ? "Logo updated" : "Logo removed");
  revalidatePath("/", "layout");
  return ok(undefined, path ? "Logo updated" : "Logo removed");
}

export async function updateModulesAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = modulesSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid module settings.");
  const m = parsed.data;
  // Purchases and production only make sense with stock tracking.
  const patch = {
    module_inventory: m.inventory,
    module_purchases: m.inventory && m.purchases,
    module_suppliers: m.suppliers,
    module_customers: m.customers,
    module_production: m.inventory && m.production,
    module_expenses: m.expenses,
    module_variants: m.variants,
  };
  const { error } = await ctx.supabase.from("business_settings").update(patch).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "update modules"));
  await audit(ctx, "settings.modules", "business_settings", ctx.businessId, "Modules updated", ctx.settings, patch);
  revalidatePath("/", "layout");
  return ok(undefined, "Modules updated");
}

const operationsSchema = z.object({
  allow_negative_stock: bool,
  default_min_stock: nonNegativeQty("Default minimum stock"),
  inventory_deduction_status: z.enum(["confirmed", "processing", "ready", "shipped", "delivered"]),
  default_order_status: z.enum(["draft", "confirmed"]),
  payment_due_days: z.coerce.number().int().min(0).max(365),
  default_wastage_pct: percent("Default wastage"),
  order_prefix: z.string().trim().max(10),
  purchase_prefix: z.string().trim().max(10),
  batch_prefix: z.string().trim().max(10),
  units: z.array(z.string().trim().min(1).max(20)).min(1, "Keep at least one unit").max(50),
});

export async function updateOperationsAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = operationsSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const data = { ...parsed.data, units: Array.from(new Set(parsed.data.units)) };
  const { error } = await ctx.supabase.from("business_settings").update(data).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "update settings"));
  await audit(ctx, "settings.operations", "business_settings", ctx.businessId, "Inventory & sales settings updated", ctx.settings, data);
  revalidatePath("/", "layout");
  return ok(undefined, "Settings saved");
}

export async function seedDemoDataAction(): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("seed_demo_data", { p_business: ctx.businessId });
  if (error) return fail(friendlyDbError(error, "seed demo"));
  revalidatePath("/", "layout");
  return ok(undefined, "Demo data loaded");
}

export async function deleteDemoDataAction(): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("delete_demo_data", { p_business: ctx.businessId });
  if (error) return fail(friendlyDbError(error, "delete demo"));
  revalidatePath("/", "layout");
  return ok(undefined, "Demo data deleted");
}
