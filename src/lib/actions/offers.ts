"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { bool, optionalDate, optionalText, optionalUuid, requiredText } from "@/lib/validation/common";

const offerSchema = z
  .object({
    id: optionalUuid,
    name: requiredText("Offer name", 120),
    is_active: bool.default(true),
    starts_on: optionalDate,
    ends_on: optionalDate,
    tiers: z
      .array(z.object({ min_qty: z.coerce.number().int().min(1, "Pack size must be at least 1"), discount_pct: z.coerce.number().gt(0, "Discount must be above 0").max(100) }))
      .min(1, "Add at least one pack size"),
    category_ids: z.array(z.uuid()).default([]),
    product_ids: z.array(z.uuid()).default([]),
    exclude_product_ids: z.array(z.uuid()).default([]),
    notes: optionalText(1000),
  })
  .refine((o) => o.category_ids.length + o.product_ids.length > 0, { message: "Choose at least one category or product", path: ["category_ids"] })
  .refine((o) => !o.starts_on || !o.ends_on || o.ends_on >= o.starts_on, { message: "End date is before the start date", path: ["ends_on"] })
  .refine((o) => new Set(o.tiers.map((t) => t.min_qty)).size === o.tiers.length, { message: "Each pack size can appear only once", path: ["tiers"] });

export async function saveOfferAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please fix the form.", zodFieldErrors(parsed.error.issues));
  const { id, ...data } = parsed.data;
  const row = { ...data, tiers: [...data.tiers].sort((a, b) => a.min_qty - b.min_qty) };
  const res = id
    ? await ctx.supabase.from("offers").update(row).eq("id", id).eq("business_id", ctx.businessId).select("id").single()
    : await ctx.supabase.from("offers").insert({ ...row, business_id: ctx.businessId }).select("id").single();
  if (res.error) return fail(friendlyDbError(res.error, "save offer"));
  await audit(ctx, id ? "offer.update" : "offer.create", "offer", res.data.id, `Offer "${row.name}" ${id ? "updated" : "created"}`, null, row);
  revalidatePath("/offers");
  revalidatePath("/orders", "layout");
  return ok({ id: res.data.id as string }, id ? "Offer saved" : "Offer created");
}

export async function deleteOfferAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.from("offers").delete().eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "delete offer"));
  await audit(ctx, "offer.delete", "offer", id, "Offer deleted");
  revalidatePath("/offers");
  return ok(undefined, "Offer deleted — past orders keep their prices");
}
