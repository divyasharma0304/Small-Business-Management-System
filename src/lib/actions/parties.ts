"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { bool, optionalEmail, optionalPhone, optionalText, optionalUuid, requiredText } from "@/lib/validation/common";

const base = {
  id: optionalUuid,
  name: requiredText("Name"),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  tax_number: optionalText(50),
  notes: optionalText(2000),
};
const supplierSchema = z.object({ ...base, contact_person: optionalText(200), is_active: bool.default(true) });
const customerSchema = z.object(base);

type Kind = "supplier" | "customer";
const TABLE: Record<Kind, "suppliers" | "customers"> = { supplier: "suppliers", customer: "customers" };

async function save(kind: Kind, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = (kind === "supplier" ? supplierSchema : customerSchema).safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { id, ...data } = parsed.data;
  const table = TABLE[kind];

  const res = id
    ? await ctx.supabase.from(table).update(data).eq("id", id).eq("business_id", ctx.businessId).select("id").single()
    : await ctx.supabase.from(table).insert({ ...data, business_id: ctx.businessId }).select("id").single();
  if (res.error) return fail(friendlyDbError(res.error, `save ${kind}`));
  await audit(ctx, `${kind}.${id ? "update" : "create"}`, kind, res.data.id, `${kind === "supplier" ? "Supplier" : "Customer"} "${data.name}" ${id ? "updated" : "added"}`, null, data);
  revalidatePath(`/${table}`, "layout");
  return ok({ id: res.data.id as string }, id ? "Saved" : `${kind === "supplier" ? "Supplier" : "Customer"} added`);
}

async function remove(kind: Kind, id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const table = TABLE[kind];
  const { error } = await ctx.supabase.from(table).delete().eq("id", id).eq("business_id", ctx.businessId);
  if (error) {
    return fail(
      error.code === "23503"
        ? kind === "supplier"
          ? "This supplier has purchases or payments, so it can't be deleted. Mark it inactive instead."
          : "This customer has orders or payments, so they can't be deleted."
        : friendlyDbError(error, `delete ${kind}`),
    );
  }
  await audit(ctx, `${kind}.delete`, kind, id, `${kind === "supplier" ? "Supplier" : "Customer"} deleted`);
  revalidatePath(`/${table}`, "layout");
  return ok(undefined, "Deleted");
}

export async function saveSupplierAction(input: unknown) {
  return save("supplier", input);
}
export async function deleteSupplierAction(id: string) {
  return remove("supplier", id);
}
export async function saveCustomerAction(input: unknown) {
  return save("customer", input);
}
export async function deleteCustomerAction(id: string) {
  return remove("customer", id);
}
