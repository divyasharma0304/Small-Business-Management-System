"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult, PurchaseStatus } from "@/lib/types";
import { nonNegativeQty, optionalText, uuid } from "@/lib/validation/common";
import { purchaseSchema } from "@/lib/validation/documents";

function revalidatePurchases() {
  for (const p of ["/purchases", "/suppliers", "/payments", "/inventory", "/catalog", "/dashboard", "/reports"]) revalidatePath(p, "layout");
}

export async function savePurchaseAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { lines, receive_now, ...purchase } = parsed.data;
  if (purchase.attachment_path && !purchase.attachment_path.startsWith(`${ctx.businessId}/`)) return fail("Invalid attachment.");

  const { data, error } = await ctx.supabase.rpc("save_purchase", {
    p_business: ctx.businessId,
    p_purchase: receive_now ? { ...purchase, status: "ordered" } : purchase,
    p_lines: lines,
  });
  if (error) return fail(friendlyDbError(error, "save_purchase"));
  const id = data as string;

  if (receive_now) {
    // Separate step: if receiving fails the purchase is kept as "ordered" and can be received later.
    const rec = await ctx.supabase.rpc("receive_purchase", { p_purchase: id, p_receipts: null, p_batch_lot: null });
    if (rec.error) {
      revalidatePurchases();
      return fail(`Purchase saved, but stock was not received: ${friendlyDbError(rec.error, "receive_purchase")}`);
    }
  }
  revalidatePurchases();
  return ok({ id }, receive_now ? "Purchase saved and stock received" : purchase.id ? "Purchase updated" : "Purchase created");
}

const receiveSchema = z.object({
  lines: z.array(z.object({ item_id: uuid, quantity: nonNegativeQty() })),
  batch_lot: optionalText(64),
});

export async function receivePurchaseAction(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const receipts = parsed.data.lines.filter((l) => l.quantity > 0);
  if (receipts.length === 0) return fail("Enter a quantity to receive.");
  const { error } = await ctx.supabase.rpc("receive_purchase", { p_purchase: id, p_receipts: receipts, p_batch_lot: parsed.data.batch_lot });
  if (error) return fail(friendlyDbError(error, "receive_purchase"));
  revalidatePurchases();
  return ok(undefined, "Stock received");
}

export async function setPurchaseStatusAction(id: string, status: PurchaseStatus): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("set_purchase_status", { p_purchase: id, p_status: status });
  if (error) return fail(friendlyDbError(error, "set_purchase_status"));
  revalidatePurchases();
  return ok(undefined, status === "cancelled" ? "Purchase cancelled" : "Status updated");
}

export async function deletePurchaseAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.rpc("delete_purchase", { p_purchase: id });
  if (error) return fail(friendlyDbError(error, "delete_purchase"));
  revalidatePurchases();
  return ok(undefined, "Purchase deleted");
}
