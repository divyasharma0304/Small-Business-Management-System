"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { isoDate, nonNegativeQty, optionalNonNegative, optionalText, quantity, uuid } from "@/lib/validation/common";

function revalidateStock() {
  revalidatePath("/inventory", "layout");
  revalidatePath("/catalog", "layout");
  revalidatePath("/dashboard");
}

const adjustSchema = z.object({
  variant_id: uuid,
  mode: z.enum(["add", "remove", "set"]),
  quantity: nonNegativeQty(),
  unit_cost: optionalNonNegative("Unit cost"),
  notes: z.string().trim().min(1, "Give a reason, e.g. “Stock count” or “Found extra”").max(500),
  batch_lot: optionalText(64),
});

export async function adjustStockAction(input: unknown): Promise<ActionResult<{ quantity: number }>> {
  const ctx = await requireContext();
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const d = parsed.data;
  const { data, error } = await ctx.supabase.rpc("adjust_stock", {
    p_business: ctx.businessId,
    p_variant: d.variant_id,
    p_mode: d.mode,
    p_quantity: d.quantity,
    p_unit_cost: d.unit_cost ?? null,
    p_notes: d.notes,
    p_batch_lot: d.batch_lot,
  });
  if (error) return fail(friendlyDbError(error, "adjust_stock"));
  revalidateStock();
  return ok({ quantity: Number(data) }, "Stock updated");
}

const wastageSchema = z.object({
  variant_id: uuid,
  quantity: quantity(),
  reason: z.enum(["damage", "spillage", "production_failure", "broken", "expired", "packaging_loss", "other"]),
  date: isoDate(),
  notes: optionalText(500),
});

export async function recordWastageAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = wastageSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const d = parsed.data;
  const { error } = await ctx.supabase.rpc("record_wastage", {
    p_business: ctx.businessId,
    p_variant: d.variant_id,
    p_quantity: d.quantity,
    p_reason: d.reason,
    p_date: d.date,
    p_notes: d.notes,
  });
  if (error) return fail(friendlyDbError(error, "record_wastage"));
  revalidateStock();
  revalidatePath("/production", "layout");
  return ok(undefined, "Wastage recorded");
}

const levelsSchema = z.object({
  variant_id: uuid,
  min_stock: nonNegativeQty("Minimum stock"),
  max_stock: optionalNonNegative("Maximum stock"),
  location: optionalText(100),
});

export async function updateStockLevelsAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = levelsSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const d = parsed.data;
  if (d.max_stock != null && d.max_stock < d.min_stock) return fail("Maximum must be at least the minimum.", { max_stock: "Must be ≥ minimum" });
  const { error } = await ctx.supabase
    .from("inventory_levels")
    .update({ min_stock: d.min_stock, max_stock: d.max_stock ?? null, location: d.location })
    .eq("variant_id", d.variant_id)
    .eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "update levels"));
  revalidateStock();
  return ok(undefined, "Stock levels saved");
}

/** Undo a stock adjustment or opening stock by adding the opposite movement. */
export async function undoStockMovementAction(txnId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("undo_stock_movement", { p_txn: txnId });
  if (error) return fail(friendlyDbError(error, "undo movement"));
  revalidateStock();
  return ok(undefined, "Stock movement undone");
}

export async function deleteWastageAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("delete_wastage", { p_wastage: id });
  if (error) return fail(friendlyDbError(error, "delete wastage"));
  revalidateStock();
  revalidatePath("/reports", "layout");
  return ok(undefined, "Wastage entry deleted — stock put back");
}
