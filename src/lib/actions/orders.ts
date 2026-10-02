"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult, OrderStatus } from "@/lib/types";
import { optionalDate, optionalText } from "@/lib/validation/common";
import { orderSchema } from "@/lib/validation/documents";

function revalidateSales() {
  for (const p of ["/orders", "/customers", "/payments", "/inventory", "/catalog", "/dashboard", "/reports"]) revalidatePath(p, "layout");
}

export async function saveOrderAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { lines, ...order } = parsed.data;
  const { data, error } = await ctx.supabase.rpc("save_order", { p_business: ctx.businessId, p_order: order, p_lines: lines });
  if (error) return fail(friendlyDbError(error, "save_order"));
  revalidateSales();
  return ok({ id: data as string }, order.id ? "Order updated" : "Order created");
}

const STATUSES = ["draft", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled", "returned"] as const;

export async function setOrderStatusAction(id: string, status: OrderStatus): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!STATUSES.includes(status)) return fail("Unknown status.");
  const { error } = await ctx.supabase.rpc("set_order_status", { p_order: id, p_status: status });
  if (error) return fail(friendlyDbError(error, "set_order_status"));
  revalidateSales();
  return ok(undefined, `Order marked ${status}`);
}

export async function deleteOrderAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("delete_order", { p_order: id });
  if (error) return fail(friendlyDbError(error, "delete_order"));
  revalidateSales();
  return ok(undefined, "Order deleted");
}

const detailsSchema = z.object({ notes: optionalText(2000), due_date: optionalDate, preferred_payment_method: optionalText(60) });

export async function updateOrderDetailsAction(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid details.");
  const { error } = await ctx.supabase.rpc("update_order_details", {
    p_order: id,
    p_notes: parsed.data.notes,
    p_due_date: parsed.data.due_date,
    p_preferred_payment_method: parsed.data.preferred_payment_method,
  });
  if (error) return fail(friendlyDbError(error, "update_order_details"));
  revalidatePath(`/orders/${id}`);
  return ok(undefined, "Saved");
}
