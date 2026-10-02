"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { isoDate, optionalText, optionalUuid, positiveMoney, requiredText } from "@/lib/validation/common";

const expenseSchema = z.object({
  id: optionalUuid,
  expense_date: isoDate("Date"),
  category_id: optionalUuid,
  description: requiredText("Description", 500),
  amount: positiveMoney("Amount"),
  vendor: optionalText(200),
  supplier_id: optionalUuid,
  payment_method: optionalText(60),
  reference: optionalText(100),
  receipt_path: optionalText(500),
  notes: optionalText(2000),
});

function revalidateExpenses() {
  for (const p of ["/expenses", "/dashboard", "/reports"]) revalidatePath(p, "layout");
}

export async function saveExpenseAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { id, ...data } = parsed.data;
  if (data.receipt_path && !data.receipt_path.startsWith(`${ctx.businessId}/`)) return fail("Invalid receipt.");

  let old: { receipt_path: string | null } | null = null;
  if (id) old = (await ctx.supabase.from("expenses").select("*").eq("id", id).eq("business_id", ctx.businessId).single()).data;
  const res = id
    ? await ctx.supabase.from("expenses").update(data).eq("id", id).eq("business_id", ctx.businessId).select("id").single()
    : await ctx.supabase.from("expenses").insert({ ...data, business_id: ctx.businessId }).select("id").single();
  if (res.error) return fail(friendlyDbError(res.error, "save expense"));
  if (old?.receipt_path && old.receipt_path !== data.receipt_path) await ctx.supabase.storage.from("business-files").remove([old.receipt_path]);
  await audit(ctx, id ? "expense.update" : "expense.create", "expense", res.data.id, `Expense "${data.description}" ${id ? "updated" : "recorded"}: ${data.amount}`, old, data);
  revalidateExpenses();
  return ok({ id: res.data.id as string }, id ? "Expense updated" : "Expense recorded");
}

export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { data: old } = await ctx.supabase.from("expenses").select("*").eq("id", id).eq("business_id", ctx.businessId).single();
  const { error } = await ctx.supabase.from("expenses").delete().eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "delete expense"));
  if (old?.receipt_path) await ctx.supabase.storage.from("business-files").remove([old.receipt_path]);
  await audit(ctx, "expense.delete", "expense", id, `Expense "${old?.description}" deleted`, old);
  revalidateExpenses();
  return ok(undefined, "Expense deleted");
}
