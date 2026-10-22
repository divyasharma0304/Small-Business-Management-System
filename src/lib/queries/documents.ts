import "server-only";
import type { PickerItem } from "@/components/forms/item-picker";
import type { RequiredContext } from "@/lib/context";

export async function loadPickerItems(ctx: RequiredContext, purpose: "sale" | "purchase" | "component") {
  let q = ctx.supabase.from("item_picker").select("*").eq("business_id", ctx.businessId).order("item_name").limit(2000);
  if (purpose === "sale") q = q.neq("item_type", "material");
  else q = q.eq("track_inventory", true);
  const { data } = await q;
  return ((data ?? []) as PickerItem[]).map((i) => ({
    ...i,
    selling_price: Number(i.selling_price),
    cost_price: Number(i.cost_price),
    tax_rate: Number(i.tax_rate),
    stock_quantity: i.stock_quantity == null ? null : Number(i.stock_quantity),
    avg_cost: i.avg_cost == null ? null : Number(i.avg_cost),
    highest_cost: i.highest_cost == null ? null : Number(i.highest_cost),
  }));
}

export async function loadPaymentMethods(ctx: RequiredContext) {
  const { data } = await ctx.supabase.from("payment_methods").select("name").eq("business_id", ctx.businessId).eq("is_active", true).order("sort_order").order("name");
  return (data ?? []).map((m) => m.name as string);
}

export async function loadCustomers(ctx: RequiredContext) {
  const { data } = await ctx.supabase.from("customers").select("id, name").eq("business_id", ctx.businessId).order("name").limit(5000);
  return data ?? [];
}

export async function loadSuppliers(ctx: RequiredContext, includeId?: string | null) {
  const { data } = await ctx.supabase.from("suppliers").select("id, name, is_active").eq("business_id", ctx.businessId).order("name").limit(5000);
  return (data ?? []).filter((s) => s.is_active || s.id === includeId).map(({ id, name }) => ({ id, name }));
}
