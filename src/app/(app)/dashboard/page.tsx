import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  Clock,
  CreditCard,
  HandCoins,
  Package,
  PiggyBank,
  Plus,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { OrdersChart, RankedBars, TrendChart } from "@/components/charts/charts";
import { RangePicker } from "@/components/data/range-picker";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge, StockBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/context";
import { resolveRange, todayIn } from "@/lib/dates";
import { formatDate, formatMoney, formatPct, formatQty, localeFor } from "@/lib/format";
import { businessSnapshot, expenseBreakdown, itemPerformance, profitSummary, salesByCategory, timeseries } from "@/lib/queries/reports";
import type { Order } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const tz = ctx.business.timezone;
  const range = resolveRange({ range: sp.range as string, from: sp.from as string, to: sp.to as string }, tz);
  const today = todayIn(tz);
  const s = ctx.settings;

  const [period, todaySummary, snap, series, byCategory, items, expenses, recent, lowStock] = await Promise.all([
    profitSummary(ctx, range.from, range.to),
    profitSummary(ctx, today, today),
    businessSnapshot(ctx),
    timeseries(ctx, range.from, range.to, range.bucket),
    salesByCategory(ctx, range.from, range.to),
    itemPerformance(ctx, range.from, range.to),
    s.module_expenses ? expenseBreakdown(ctx, range.from, range.to) : Promise.resolve([]),
    ctx.supabase.from("orders").select("*, customers(name)").eq("business_id", ctx.businessId).order("created_at", { ascending: false }).limit(6),
    s.module_inventory
      ? ctx.supabase.from("inventory_overview").select("variant_id, item_name, unit, quantity, min_stock, max_stock").eq("business_id", ctx.businessId).eq("is_active", true).eq("is_low", true).order("quantity").limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  const money = (n: number) => formatMoney(n, ctx.business.currency, localeFor(ctx.business.country));
  const isEmpty = snap.products === 0 && snap.materials === 0 && period.orders === 0 && snap.pending_orders === 0;
  const recentOrders = (recent.data ?? []) as (Order & { customers: { name: string } | null })[];
  const periodLabel = range.label.toLowerCase();

  return (
    <>
      <PageHeader
        title={`Welcome${ctx.business.owner_name ? `, ${ctx.business.owner_name.split(" ")[0]}` : ""}`}
        description={`${ctx.business.name} · ${range.preset === "custom" ? `${formatDate(range.from)} – ${formatDate(range.to)}` : range.label}`}
        actions={
          <>
            <RangePicker value={range.preset} from={range.from} to={range.to} />
            <Button asChild><Link href="/orders/new"><Plus /> New order</Link></Button>
          </>
        }
      />

      {isEmpty && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Add what you sell, then record your first order. Everything on this page is calculated from your records.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild><Link href="/catalog/new"><Package /> Add a product or service</Link></Button>
            {s.module_customers && <Button variant="outline" asChild><Link href="/customers">Add customers</Link></Button>}
            <Button variant="outline" asChild><Link href="/settings?tab=data">Explore with demo data</Link></Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's sales" value={money(todaySummary.revenue)} icon={CalendarDays} hint={`${todaySummary.orders} order${todaySummary.orders === 1 ? "" : "s"}`} />
        <StatCard label={`Sales · ${periodLabel}`} value={money(period.revenue)} icon={TrendingUp} hint={`${period.orders} orders · avg ${money(period.avg_order_value)}`} href="/reports/sales" />
        <StatCard label={`Gross profit · ${periodLabel}`} value={money(period.gross_profit)} icon={PiggyBank} hint={`Margin ${formatPct(period.gross_margin_pct)} · Sales − cost of goods`} href="/reports/profit" />
        <StatCard
          label={`Est. net profit · ${periodLabel}`}
          value={money(period.net_profit)}
          icon={Wallet}
          tone={period.net_profit < 0 ? "danger" : "success"}
          hint="Gross profit − expenses − stock losses"
          href="/reports/profit"
        />
        {s.module_expenses && <StatCard label={`Expenses · ${periodLabel}`} value={money(period.operating_expenses)} icon={CreditCard} href="/reports/expenses" />}
        <StatCard
          label="Pending payments"
          value={money(snap.pending_payments)}
          icon={HandCoins}
          tone={snap.overdue_payments > 0 ? "danger" : snap.pending_payments > 0 ? "warning" : "default"}
          hint={snap.overdue_payments > 0 ? `${money(snap.overdue_payments)} overdue` : `${snap.pending_payment_orders} orders`}
          href="/orders?payment=unpaid"
        />
        <StatCard label="Pending orders" value={snap.pending_orders} icon={Clock} hint={snap.draft_orders ? `+ ${snap.draft_orders} drafts` : "Confirmed → shipped"} href="/orders?status=open" />
        {s.module_inventory ? (
          <StatCard label="Low-stock items" value={snap.low_stock_items} icon={AlertTriangle} tone={snap.low_stock_items ? "warning" : "default"} hint={snap.out_of_stock_items ? `${snap.out_of_stock_items} out of stock` : "At or below minimum"} href="/inventory?status=low" />
        ) : (
          <StatCard label="Products & services" value={snap.products} icon={Package} href="/catalog" />
        )}
        {s.module_inventory && <StatCard label="Inventory value" value={money(snap.inventory_value)} icon={Boxes} hint="At average cost" href="/inventory" />}
        {s.module_inventory && <StatCard label="Products & services" value={snap.products} icon={Package} hint={snap.materials ? `+ ${snap.materials} materials` : undefined} href="/catalog" />}
        {s.module_customers && <StatCard label="Customers" value={snap.customers} icon={Users} href="/customers" />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sales, expenses & profit</CardTitle>
            <CardDescription>Per {range.bucket}. Net profit here = sales − cost of goods − expenses.</CardDescription>
          </CardHeader>
          <CardContent>
            {period.revenue === 0 && period.operating_expenses === 0 ? (
              <ChartEmpty text="No sales or expenses in this period." />
            ) : (
              <TrendChart data={series} bucket={range.bucket} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Orders recorded as sales, per {range.bucket}</CardDescription>
          </CardHeader>
          <CardContent>{period.orders === 0 ? <ChartEmpty text="No orders in this period." /> : <OrdersChart data={series} bucket={range.bucket} />}</CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Top sellers</CardTitle><CardDescription>By revenue</CardDescription></CardHeader>
          <CardContent>
            {items.length === 0 ? <ChartEmpty text="No sales yet." /> : <RankedBars label="Revenue" data={items.slice(0, 6).map((i) => ({ name: i.item_name, value: i.revenue }))} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sales by category</CardTitle></CardHeader>
          <CardContent>
            {byCategory.length === 0 ? <ChartEmpty text="No sales yet." /> : <RankedBars label="Revenue" data={byCategory.slice(0, 8).map((c) => ({ name: c.category_name, value: c.revenue }))} />}
          </CardContent>
        </Card>
        {s.module_expenses && (
          <Card>
            <CardHeader><CardTitle>Expense breakdown</CardTitle></CardHeader>
            <CardContent>
              {expenses.length === 0 ? <ChartEmpty text="No expenses in this period." /> : <RankedBars label="Expenses" slot={2} data={expenses.slice(0, 8).map((e) => ({ name: e.category_name, value: e.amount }))} />}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent orders</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link href="/orders">View all</Link></Button>
          </CardHeader>
          <CardContent className="grid gap-1">
            {recentOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              recentOrders.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                  <Receipt className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.order_number} · {o.customers?.name ?? "Walk-in"}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(o.order_date)}</div>
                  </div>
                  <StatusBadge status={o.status} />
                  <Money value={o.total} className="w-24 text-right text-sm" />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
        {s.module_inventory && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Low stock</CardTitle>
              <Button variant="ghost" size="sm" asChild><Link href="/inventory?status=low">View all</Link></Button>
            </CardHeader>
            <CardContent className="grid gap-1">
              {(lowStock.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">All items are above their minimum stock.</p>
              ) : (
                (lowStock.data ?? []).map((i) => (
                  <Link key={i.variant_id} href={`/inventory/${i.variant_id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                    <AlertTriangle className="size-4 shrink-0 text-warning" />
                    <span className="flex-1 truncate text-sm font-medium">{i.item_name}</span>
                    <span className="text-sm tabular text-muted-foreground">{formatQty(i.quantity, i.unit)} / min {formatQty(i.min_stock)}</span>
                    <StockBadge quantity={Number(i.quantity)} min={Number(i.min_stock)} max={i.max_stock} />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{text}</div>;
}
