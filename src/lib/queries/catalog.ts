import "server-only";
import type { RequiredContext } from "@/lib/context";
import type { AttributeDefinition, InventoryLevel, Product, Variant } from "@/lib/types";

export async function loadCatalogFormData(ctx: RequiredContext) {
  const [{ data: categories }, { data: attrs }] = await Promise.all([
    ctx.supabase.from("product_categories").select("id, name").eq("business_id", ctx.businessId).eq("is_active", true).order("name"),
    ctx.supabase.from("attribute_definitions").select("*").eq("business_id", ctx.businessId).order("sort_order").order("name"),
  ]);
  return { categories: categories ?? [], attributeDefs: (attrs ?? []) as AttributeDefinition[] };
}

export async function loadProduct(ctx: RequiredContext, id: string) {
  const { data: product } = await ctx.supabase.from("products").select("*").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!product) return null;
  const [{ data: variants }, { data: components }] = await Promise.all([
    ctx.supabase.from("product_variants").select("*").eq("product_id", id).order("sort_order"),
    ctx.supabase.from("product_cost_components").select("label, amount").eq("product_id", id).order("sort_order"),
  ]);
  const ids = (variants ?? []).map((v) => v.id);
  const [{ data: levels }, { data: history }] = await Promise.all([
    ctx.supabase.from("inventory_levels").select("*").in("variant_id", ids),
    ctx.supabase.from("inventory_transactions").select("variant_id").in("variant_id", ids).limit(1000),
  ]);
  return {
    product: product as Product,
    variants: (variants ?? []) as Variant[],
    components: (components ?? []) as { label: string; amount: number }[],
    levels: new Map(((levels ?? []) as InventoryLevel[]).map((l) => [l.variant_id, l])),
    withHistory: new Set((history ?? []).map((h) => h.variant_id as string)),
  };
}

/** Stock-tracked items that use variants — where a new variant (e.g. colour) can be added from a purchase. */
export async function loadVariantParents(ctx: RequiredContext) {
  const { data } = await ctx.supabase
    .from("products")
    .select("id, name, unit")
    .eq("business_id", ctx.businessId)
    .eq("has_variants", true)
    .eq("track_inventory", true)
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as { id: string; name: string; unit: string }[];
}
