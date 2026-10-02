"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PickerItem } from "@/components/forms/item-picker";
import { audit } from "@/lib/audit";
import { requireContext } from "@/lib/context";
import { fail, friendlyDbError, ok, zodFieldErrors } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { productSchema } from "@/lib/validation/catalog";
import { money, optionalUuid, requiredText } from "@/lib/validation/common";

export async function saveProductAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { variants, components, ...product } = parsed.data;

  // Business rules that depend on settings
  const track = product.item_type !== "service" && product.track_inventory && ctx.settings.module_inventory;
  const hasVariants = product.has_variants && ctx.settings.module_variants;
  if (product.has_variants && !ctx.settings.module_variants && variants.length > 1) {
    return fail("Variants are turned off in Settings → Features.");
  }
  for (const path of [product.image_path, ...variants.map((v) => v.image_path)]) {
    if (path && !path.startsWith(`${ctx.businessId}/`)) return fail("Invalid image.");
  }

  const { data, error } = await ctx.supabase.rpc("save_product", {
    p_business: ctx.businessId,
    p_product: { ...product, track_inventory: track, has_variants: hasVariants },
    p_variants: variants,
    p_components: product.cost_method === "components" ? components : [],
  });
  if (error) return fail(friendlyDbError(error, "save_product"));
  revalidatePath("/catalog", "layout");
  revalidatePath("/inventory", "layout");
  return ok({ id: data as string }, product.id ? "Item updated" : "Item created");
}

export async function setProductActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const { error } = await ctx.supabase.from("products").update({ is_active: active }).eq("id", id).eq("business_id", ctx.businessId);
  if (error) return fail(friendlyDbError(error, "toggle product"));
  await audit(ctx, active ? "product.activate" : "product.deactivate", "product", id, active ? "Item activated" : "Item deactivated");
  revalidatePath("/catalog", "layout");
  return ok(undefined, active ? "Item activated" : "Item deactivated");
}

export interface DeleteImpact {
  name: string;
  can_delete: boolean;
  orders: string[];
  batches: string[];
  blocking_purchases: string[];
  purchases: string[];
  recipes_output: string[];
  recipes_component: string[];
  stock_movements: number;
}

/** What deleting this item would remove — or why it can't be deleted. */
export async function getDeleteImpactAction(id: string): Promise<ActionResult<DeleteImpact>> {
  const ctx = await requireContext();
  const { data, error } = await ctx.supabase.rpc("product_delete_impact", { p_product: id });
  if (error) return fail(friendlyDbError(error, "delete impact"));
  return ok(data as DeleteImpact);
}

/** Deletes the item with its stock history, single-item purchases and recipes (all in one transaction). */
export async function deleteProductAction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const [{ data: product }, { data: variants }] = await Promise.all([
    ctx.supabase.from("products").select("image_path").eq("id", id).eq("business_id", ctx.businessId).maybeSingle(),
    ctx.supabase.from("product_variants").select("image_path").eq("product_id", id),
  ]);
  const { error } = await ctx.supabase.rpc("delete_product_completely", { p_product: id });
  if (error) return fail(friendlyDbError(error, "delete product"));
  const images = [product?.image_path, ...(variants ?? []).map((v) => v.image_path)].filter((x): x is string => Boolean(x));
  if (images.length) await ctx.supabase.storage.from("business-files").remove(images);
  for (const p of ["/catalog", "/inventory", "/purchases", "/production", "/dashboard", "/reports"]) revalidatePath(p, "layout");
  return ok(undefined, "Item deleted");
}

const quickItemSchema = z.object({
  name: requiredText("Name"),
  item_type: z.enum(["product", "material"]),
  category_id: optionalUuid,
  unit: z.string().trim().min(1, "Unit is required").max(20),
  selling_price: money("Selling price").default(0),
});

/**
 * Creates a stock-tracked item with NO stock, for use straight away on a purchase.
 * The purchase is what adds the stock, so nothing is ever counted twice.
 */
export async function quickCreateItemAction(input: unknown): Promise<ActionResult<PickerItem>> {
  const ctx = await requireContext();
  if (!ctx.settings.module_inventory) return fail("Inventory is turned off in Settings → Features.");
  const parsed = quickItemSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const d = parsed.data;
  const { data: productId, error } = await ctx.supabase.rpc("save_product", {
    p_business: ctx.businessId,
    p_product: { name: d.name, item_type: d.item_type, category_id: d.category_id, unit: d.unit, track_inventory: true, has_variants: false, cost_method: "manual" },
    p_variants: [{ selling_price: d.item_type === "product" ? d.selling_price : 0, cost_price: 0 }],
    p_components: [],
  });
  if (error) return fail(friendlyDbError(error, "quick create item"));
  const { data: item, error: e2 } = await ctx.supabase.from("item_picker").select("*").eq("product_id", productId as string).single();
  if (e2 || !item) return fail("Item created, but it couldn't be loaded. Refresh the page.");
  revalidatePath("/catalog", "layout");
  revalidatePath("/inventory", "layout");
  return ok(
    { ...item, selling_price: Number(item.selling_price), cost_price: Number(item.cost_price), tax_rate: Number(item.tax_rate), stock_quantity: 0, avg_cost: 0 } as PickerItem,
    `"${d.name}" added`,
  );
}

/** Adds a variant (e.g. a new colour) to an existing item, with zero stock, ready for a purchase line. */
export async function quickCreateVariantAction(input: unknown): Promise<ActionResult<PickerItem>> {
  const ctx = await requireContext();
  const parsed = z.object({ product_id: z.uuid({ error: "Choose an item" }), name: requiredText("Variant name", 100) }).safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const { data: variantId, error } = await ctx.supabase.rpc("add_product_variant", {
    p_product: parsed.data.product_id,
    p_name: parsed.data.name,
    p_sku: null,
    p_selling_price: 0,
    p_cost_price: 0,
  });
  if (error) return fail(friendlyDbError(error, "add variant"));
  const { data: item, error: e2 } = await ctx.supabase.from("item_picker").select("*").eq("variant_id", variantId as string).single();
  if (e2 || !item) return fail("Variant added, but it couldn't be loaded. Refresh the page.");
  revalidatePath("/catalog", "layout");
  revalidatePath("/inventory", "layout");
  return ok(
    { ...item, selling_price: Number(item.selling_price), cost_price: Number(item.cost_price), tax_rate: Number(item.tax_rate), stock_quantity: 0, avg_cost: 0 } as PickerItem,
    `"${item.item_name}" added`,
  );
}
