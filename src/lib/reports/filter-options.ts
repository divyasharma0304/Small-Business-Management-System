import "server-only";
import type { FilterControl } from "@/components/reports/report-filters";
import type { RequiredContext } from "@/lib/context";
import type { FilterKey } from "./types";

const cap = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Builds the dropdown options for the filters a report supports. */
export async function filterControls(ctx: RequiredContext, keys: FilterKey[]): Promise<FilterControl[]> {
  const out: FilterControl[] = [];
  const b = ctx.businessId;
  for (const k of keys) {
    switch (k) {
      case "category": {
        const { data } = await ctx.supabase.from("product_categories").select("id, name").eq("business_id", b).order("name");
        out.push({ key: "category", label: "Categories", options: [{ value: "none", label: "Uncategorised" }, ...(data ?? []).map((c) => ({ value: c.id, label: c.name }))] });
        break;
      }
      case "product": {
        const { data } = await ctx.supabase.from("products").select("id, name").eq("business_id", b).neq("item_type", "material").order("name").limit(1000);
        out.push({ key: "product", label: "Products", options: (data ?? []).map((p) => ({ value: p.id, label: p.name })) });
        break;
      }
      case "customer": {
        if (!ctx.settings.module_customers) break;
        const { data } = await ctx.supabase.from("customers").select("id, name").eq("business_id", b).order("name").limit(1000);
        out.push({ key: "customer", label: "Customers", options: (data ?? []).map((c) => ({ value: c.id, label: c.name })) });
        break;
      }
      case "supplier": {
        if (!ctx.settings.module_suppliers) break;
        const { data } = await ctx.supabase.from("suppliers").select("id, name").eq("business_id", b).order("name").limit(1000);
        out.push({ key: "supplier", label: "Suppliers", options: (data ?? []).map((s) => ({ value: s.id, label: s.name })) });
        break;
      }
      case "expenseCategory": {
        const { data } = await ctx.supabase.from("expense_categories").select("id, name").eq("business_id", b).order("name");
        out.push({ key: "expense_category", label: "Categories", options: [{ value: "none", label: "Uncategorised" }, ...(data ?? []).map((c) => ({ value: c.id, label: c.name }))] });
        break;
      }
      case "orderStatus":
        out.push({ key: "status", label: "Statuses", options: ["draft", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled", "returned"].map((s) => ({ value: s, label: cap(s) })) });
        break;
      case "purchaseStatus":
        out.push({ key: "status", label: "Statuses", options: ["draft", "ordered", "partially_received", "received", "cancelled"].map((s) => ({ value: s, label: cap(s) })) });
        break;
      case "batchStatus":
        out.push({ key: "status", label: "Statuses", options: ["planned", "in_progress", "completed", "cancelled"].map((s) => ({ value: s, label: cap(s) })) });
        break;
      case "paymentStatus":
        out.push({ key: "payment", label: "Payment statuses", options: ["unpaid", "partial", "paid"].map((s) => ({ value: s, label: cap(s) })) });
        break;
      case "direction":
        out.push({ key: "direction", label: "Directions", options: [{ value: "in", label: "Received" }, { value: "out", label: "Paid out" }] });
        break;
    }
  }
  return out;
}
