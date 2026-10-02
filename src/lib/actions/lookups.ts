"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { optionalText } from "@/lib/validation/common";

/**
 * Simple named lists the owner configures: payment methods, expense categories,
 * product categories. The table name is whitelisted — never taken from input as-is.
 */
const TABLES = {
  payment_methods: { label: "Payment method", paths: ["/settings", "/payments", "/orders", "/expenses"] },
  expense_categories: { label: "Expense category", paths: ["/settings", "/expenses"] },
  product_categories: { label: "Category", paths: ["/catalog", "/settings"] },
} as const;
export type LookupTable = keyof typeof TABLES;

const nameSchema = z.string().trim().min(1, "Name is required").max(100, "Name is too long");

function revalidate(table: LookupTable) {
  for (const p of TABLES[table].paths) revalidatePath(p, "layout");
}

function tableOf(t: string): LookupTable | null {
  return t in TABLES ? (t as LookupTable) : null;
}

export async function createLookupAction(t: string, name: string, description?: string): Promise<ActionResult<{ id: string }>> {
  const table = tableOf(t);
  if (!table) return fail("Unknown list.");
  const ctx = await requireContext();
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const row: Record<string, unknown> = { business_id: ctx.businessId, name: parsed.data };
  if (table === "product_categories") row.description = optionalText(500).parse(description ?? null);
  const { data, error } = await ctx.supabase.from(table).insert(row).select("id").single();
  if (error) return fail(error.code === "23505" ? `"${parsed.data}" already exists.` : friendlyDbError(error, `create ${table}`));
  await audit(ctx, `${table}.create`, table, data.id, `${TABLES[table].label} "${parsed.data}" added`);
  revalidate(table);
  return ok({ id: data.id as string }, `${TABLES[table].label} added`);
}

export async function updateLookupAction(
  t: string,
  id: string,
  patch: { name?: string; is_active?: boolean; description?: string | null },
): Promise<ActionResult> {
  const table = tableOf(t);
  if (!table) return fail("Unknown list.");
  const ctx = await requireContext();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const parsed = nameSchema.safeParse(patch.name);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    update.name = parsed.data;
  }
  if (patch.is_active !== undefined) update.is_active = Boolean(patch.is_active);
  if (patch.description !== undefined && table === "product_categories") update.description = optionalText(500).parse(patch.description);
  const { error } = await ctx.supabase.from(table).update(update).eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(error.code === "23505" ? "That name already exists." : friendlyDbError(error, `update ${table}`));
  await audit(ctx, `${table}.update`, table, id, `${TABLES[table].label} updated`, null, update);
  revalidate(table);
  return ok(undefined, "Saved");
}

export async function deleteLookupAction(t: string, id: string): Promise<ActionResult> {
  const table = tableOf(t);
  if (!table) return fail("Unknown list.");
  const ctx = await requireContext();
  const { error } = await ctx.supabase.from(table).delete().eq("id", id).eq("business_id", ctx.businessId);
  if (error) {
    return fail(error.code === "23503" ? "This is used by existing records. Deactivate it instead." : friendlyDbError(error, `delete ${table}`));
  }
  await audit(ctx, `${table}.delete`, table, id, `${TABLES[table].label} deleted`);
  revalidate(table);
  return ok(undefined, "Deleted");
}

// ---------------------------------------------------------------------------
// Attribute definitions (e.g. Colour: Red, Blue)
// ---------------------------------------------------------------------------
const attributeSchema = z.object({
  name: nameSchema,
  options: z.array(z.string().trim().min(1).max(60)).max(100),
});

export async function saveAttributeAction(id: string | null, input: unknown): Promise<ActionResult> {
  const ctx = await requireContext();
  const parsed = attributeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const data = { name: parsed.data.name, options: Array.from(new Set(parsed.data.options)) };
  const q = id
    ? ctx.supabase.from("attribute_definitions").update(data).eq("id", id).eq("business_id", ctx.businessId)
    : ctx.supabase.from("attribute_definitions").insert({ ...data, business_id: ctx.businessId });
  const { error } = await q;
  if (error) return fail(error.code === "23505" ? "An attribute with that name exists." : friendlyDbError(error, "save attribute"));
  await audit(ctx, "attribute.save", "attribute_definition", id, `Attribute "${data.name}" saved`, null, data);
  revalidatePath("/settings");
  revalidatePath("/catalog", "layout");
  return ok(undefined, "Attribute saved");
}

export async function deleteAttributeAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.from("attribute_definitions").delete().eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "delete attribute"));
  await audit(ctx, "attribute.delete", "attribute_definition", id, "Attribute deleted");
  revalidatePath("/settings");
  return ok(undefined, "Attribute deleted");
}
