import "server-only";
import type { RequiredContext } from "@/lib/context";

export async function loadRecipeOptions(ctx: RequiredContext) {
  const { data } = await ctx.supabase
    .from("recipes")
    .select("id, name, yield_quantity, product_variants!inner(name, is_default, products!inner(name, unit))")
    .eq("business_id", ctx.businessId)
    .eq("is_active", true)
    .order("name");
  type Row = { id: string; name: string; yield_quantity: number; product_variants: { name: string; is_default: boolean; products: { name: string; unit: string } } };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    yield_quantity: Number(r.yield_quantity),
    output: r.product_variants.is_default ? r.product_variants.products.name : `${r.product_variants.products.name} — ${r.product_variants.name}`,
    unit: r.product_variants.products.unit,
  }));
}
