"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult, ProductionStatus } from "@/lib/types";
import { bool, isoDate, money, nonNegativeQty, optionalText, optionalUuid, percent, quantity, requiredText, uuid } from "@/lib/validation/common";

function revalidateProduction() {
  for (const p of ["/production", "/inventory", "/catalog", "/dashboard", "/reports"]) revalidatePath(p, "layout");
}

const recipeSchema = z.object({
  id: optionalUuid,
  name: requiredText("Recipe name"),
  variant_id: uuid,
  yield_quantity: quantity("Yield"),
  notes: optionalText(2000),
  is_active: bool.default(true),
  items: z
    .array(z.object({ component_variant_id: uuid, quantity: quantity("Component quantity"), wastage_pct: percent("Wastage").default(0) }))
    .min(1, "Add at least one component")
    .max(100),
});

export async function saveRecipeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { items, ...recipe } = parsed.data;
  const { data, error } = await ctx.supabase.rpc("save_recipe", { p_business: ctx.businessId, p_recipe: recipe, p_items: items });
  if (error) return fail(friendlyDbError(error, "save_recipe"));
  revalidateProduction();
  return ok({ id: data as string }, recipe.id ? "Recipe updated" : "Recipe created");
}

export async function setRecipeActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.from("recipes").update({ is_active: active }).eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "toggle recipe"));
  revalidateProduction();
  return ok(undefined, active ? "Recipe activated" : "Recipe deactivated");
}

const batchSchema = z.object({
  recipe_id: uuid,
  planned_quantity: quantity("Planned quantity"),
  production_date: isoDate(),
  notes: optionalText(2000),
});

export async function createBatchAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const d = parsed.data;
  const { data, error } = await ctx.supabase.rpc("create_production_batch", {
    p_business: ctx.businessId,
    p_recipe: d.recipe_id,
    p_planned_quantity: d.planned_quantity,
    p_date: d.production_date,
    p_notes: d.notes,
    p_is_demo: false,
  });
  if (error) return fail(friendlyDbError(error, "create batch"));
  revalidateProduction();
  return ok({ id: data as string }, "Batch planned");
}

export async function setBatchStatusAction(id: string, status: ProductionStatus): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("set_batch_status", { p_batch: id, p_status: status });
  if (error) return fail(friendlyDbError(error, "set batch status"));
  revalidateProduction();
  return ok(undefined, status === "cancelled" ? "Batch cancelled" : "Batch started");
}

const completeSchema = z.object({
  actual_quantity: quantity("Quantity produced"),
  additional_cost: money("Additional cost").default(0),
  notes: optionalText(2000),
  lines: z.array(z.object({ id: uuid, used_quantity: nonNegativeQty("Used"), wasted_quantity: nonNegativeQty("Wasted") })),
});

export async function completeBatchAction(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const d = parsed.data;
  const { error } = await ctx.supabase.rpc("complete_production_batch", {
    p_batch: id,
    p_actual_quantity: d.actual_quantity,
    p_lines: d.lines,
    p_additional_cost: d.additional_cost,
    p_notes: d.notes,
  });
  if (error) return fail(friendlyDbError(error, "complete batch"));
  revalidateProduction();
  return ok(undefined, "Batch completed — finished goods added to stock");
}

export async function deleteBatchAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("delete_production_batch", { p_batch: id });
  if (error) return fail(friendlyDbError(error, "delete batch"));
  revalidateProduction();
  return ok(undefined, "Batch deleted");
}

export async function deleteRecipeAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { data: r } = await ctx.supabase.from("recipes").select("name").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!r) return fail("Recipe not found.");
  const { error } = await ctx.supabase.from("recipes").delete().eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "delete recipe"));
  await audit(ctx, "recipe.delete", "recipe", id, `Recipe "${r.name}" deleted`);
  revalidateProduction();
  return ok(undefined, "Recipe deleted");
}
