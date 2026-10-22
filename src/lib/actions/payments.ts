"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { paymentSchema } from "@/lib/validation/documents";

function revalidateMoney() {
  for (const p of ["/payments", "/orders", "/purchases", "/customers", "/suppliers", "/dashboard", "/reports"]) revalidatePath(p, "layout");
}

/**
 * Records money received (direction "in") or paid out ("out"), optionally linked
 * to an order or purchase. Totals and payment status on the linked document are
 * recalculated by a database trigger, which also rejects overpayments.
 */
export async function recordPaymentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const p = parsed.data;
  const { data, error } = await ctx.supabase
    .from("payments")
    .insert({ ...p, business_id: ctx.businessId })
    .select("id")
    .single();
  if (error) return fail(friendlyDbError(error, "record payment"));
  await audit(
    ctx,
    p.kind === "refund" ? "payment.refund" : "payment.create",
    "payment",
    data.id,
    `${p.kind === "refund" ? "Refund" : p.direction === "in" ? "Payment received" : "Payment made"}: ${p.amount} via ${p.method}`,
    null,
    p,
  );
  revalidateMoney();
  return ok({ id: data.id as string }, p.kind === "refund" ? "Refund recorded" : "Payment recorded");
}

export async function deletePaymentAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { data: old } = await ctx.supabase.from("payments").select("*").eq("id", id).eq("business_id", ctx.businessId).single();
  const { error } = await ctx.supabase.from("payments").delete().eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "delete payment"));
  await audit(ctx, "payment.delete", "payment", id, `Payment of ${old?.amount} deleted`, old);
  revalidateMoney();
  return ok(undefined, "Payment deleted");
}

/** Corrects a payment's amount, date, method, reference or notes. Order/purchase totals are recalculated. */
export async function updatePaymentAction(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { data: old } = await ctx.supabase.from("payments").select("*").eq("id", id).eq("business_id", ctx.businessId).single();
  if (!old) return fail("Payment not found.");
  const p = parsed.data;
  const patch = { payment_date: p.payment_date, amount: p.amount, method: p.method, reference: p.reference, notes: p.notes, kind: p.kind };
  const { error } = await ctx.supabase.from("payments").update(patch).eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "update payment"));
  await audit(ctx, "payment.update", "payment", id, `Payment changed from ${old.amount} to ${p.amount}`, old, patch);
  revalidateMoney();
  return ok(undefined, "Payment updated");
}
