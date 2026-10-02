import "server-only";
import type { RequiredContext } from "@/lib/context";

/** All numbers here come from the SQL report functions (supabase/migrations/…_reporting.sql). */

export interface ProfitSummary {
  revenue: number;
  shipping_revenue: number;
  tax_collected: number;
  discounts: number;
  gross_sales: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
  operating_expenses: number;
  wastage_losses: number;
  adjustment_losses: number;
  inventory_losses: number;
  net_profit: number;
  orders: number;
  avg_order_value: number;
}

export interface Snapshot {
  pending_payments: number;
  pending_payment_orders: number;
  overdue_payments: number;
  pending_orders: number;
  draft_orders: number;
  low_stock_items: number;
  out_of_stock_items: number;
  inventory_value: number;
  products: number;
  materials: number;
  customers: number;
  payables: number;
}

const numify = <T extends object>(o: Record<string, unknown> | null): T =>
  Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, v === null ? null : Number(v)])) as T;

async function rpc<T>(ctx: RequiredContext, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) {
    console.error(`[report] ${fn} failed`, error);
    throw new Error("Could not load report data.");
  }
  return data as T;
}

export async function profitSummary(ctx: RequiredContext, from: string, to: string) {
  return numify<ProfitSummary>(await rpc(ctx, "report_profit_summary", { p_business: ctx.businessId, p_from: from, p_to: to }));
}

export async function businessSnapshot(ctx: RequiredContext) {
  return numify<Snapshot>(await rpc(ctx, "report_business_snapshot", { p_business: ctx.businessId }));
}

export async function timeseries(ctx: RequiredContext, from: string, to: string, bucket: "day" | "week" | "month") {
  const rows = await rpc<Record<string, unknown>[]>(ctx, "report_timeseries", { p_business: ctx.businessId, p_from: from, p_to: to, p_bucket: bucket });
  return rows.map((r) => ({
    period: String(r.period),
    revenue: Number(r.revenue),
    cogs: Number(r.cogs),
    expenses: Number(r.expenses),
    gross_profit: Number(r.gross_profit),
    net_profit: Number(r.net_profit),
    orders: Number(r.orders),
  }));
}

export async function salesByCategory(ctx: RequiredContext, from: string, to: string) {
  const rows = await rpc<Record<string, unknown>[]>(ctx, "report_sales_by_category", { p_business: ctx.businessId, p_from: from, p_to: to });
  return rows.map((r) => ({ category_id: r.category_id as string | null, category_name: String(r.category_name), revenue: Number(r.revenue), cogs: Number(r.cogs), quantity: Number(r.quantity) }));
}

export async function itemPerformance(ctx: RequiredContext, from: string, to: string) {
  const rows = await rpc<Record<string, unknown>[]>(ctx, "report_item_performance", { p_business: ctx.businessId, p_from: from, p_to: to });
  return rows.map((r) => ({
    variant_id: String(r.variant_id),
    product_id: String(r.product_id),
    item_name: String(r.item_name),
    sku: (r.sku as string | null) ?? null,
    item_type: String(r.item_type),
    category_name: (r.category_name as string | null) ?? null,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
    cogs: Number(r.cogs),
    gross_profit: Number(r.gross_profit),
    margin_pct: r.margin_pct === null ? null : Number(r.margin_pct),
    orders: Number(r.orders),
  }));
}

export async function expenseBreakdown(ctx: RequiredContext, from: string, to: string) {
  const rows = await rpc<Record<string, unknown>[]>(ctx, "report_expense_breakdown", { p_business: ctx.businessId, p_from: from, p_to: to });
  return rows.map((r) => ({ category_id: r.category_id as string | null, category_name: String(r.category_name), amount: Number(r.amount), entries: Number(r.entries) }));
}

export async function customerSummary(ctx: RequiredContext, from: string, to: string) {
  const rows = await rpc<Record<string, unknown>[]>(ctx, "report_customer_summary", { p_business: ctx.businessId, p_from: from, p_to: to });
  return rows.map((r) => ({
    customer_id: String(r.customer_id),
    customer_name: String(r.customer_name),
    orders: Number(r.orders),
    revenue: Number(r.revenue),
    total_billed: Number(r.total_billed),
    amount_paid: Number(r.amount_paid),
    amount_due: Number(r.amount_due),
    last_order: (r.last_order as string | null) ?? null,
  }));
}

export async function supplierSummary(ctx: RequiredContext, from: string, to: string) {
  const rows = await rpc<Record<string, unknown>[]>(ctx, "report_supplier_summary", { p_business: ctx.businessId, p_from: from, p_to: to });
  return rows.map((r) => ({
    supplier_id: String(r.supplier_id),
    supplier_name: String(r.supplier_name),
    purchases: Number(r.purchases),
    total: Number(r.total),
    amount_paid: Number(r.amount_paid),
    amount_due: Number(r.amount_due),
    last_purchase: (r.last_purchase as string | null) ?? null,
  }));
}
