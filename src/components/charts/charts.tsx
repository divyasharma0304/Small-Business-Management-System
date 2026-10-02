"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { useCurrency } from "@/components/money";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatMoneyCompact } from "@/lib/format";

/**
 * Charts use the validated categorical palette (--chart-1…5) in fixed order:
 * revenue = slot 1, expenses = slot 2, profit = slot 3. One y-axis per chart.
 */

function periodLabel(iso: string, bucket: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (bucket === "month") return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function useMoneyAxis() {
  const { currency, locale, format } = useCurrency();
  return {
    tick: (v: number) => formatMoneyCompact(v, currency, locale),
    tooltip: (value: unknown, name: unknown, item: { color?: string }) => (
      <div className="flex w-full items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2.5 rounded-[2px]" style={{ background: item.color }} />
          {String(name)}
        </span>
        <span className="font-medium text-foreground tabular">{format(Number(value))}</span>
      </div>
    ),
  };
}

export interface TrendRow {
  period: string;
  revenue: number;
  expenses: number;
  net_profit: number;
  gross_profit: number;
  orders: number;
}

const trendConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-2)" },
  net_profit: { label: "Net profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function TrendChart({ data, bucket }: { data: TrendRow[]; bucket: string }) {
  const money = useMoneyAxis();
  const rows = data.map((d) => ({ ...d, label: periodLabel(d.period, bucket) }));
  return (
    <ChartContainer config={trendConfig} className="aspect-auto h-72 w-full">
      <ComposedChart data={rows} margin={{ left: 4, right: 8, top: 8 }} barGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={money.tick} />
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent formatter={money.tooltip} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="revenue" name="Revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expenses" name="Expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line dataKey="net_profit" name="Net profit" type="linear" stroke="var(--color-net_profit)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ChartContainer>
  );
}

const ordersConfig = { orders: { label: "Orders", color: "var(--chart-1)" } } satisfies ChartConfig;

export function OrdersChart({ data, bucket }: { data: TrendRow[]; bucket: string }) {
  const rows = data.map((d) => ({ ...d, label: periodLabel(d.period, bucket) }));
  return (
    <ChartContainer config={ordersConfig} className="aspect-auto h-56 w-full">
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent />} />
        <Bar dataKey="orders" name="Orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  );
}

/** Horizontal ranked bars for one money measure (single series → no legend). */
export function RankedBars({ data, label, slot = 1 }: { data: { name: string; value: number }[]; label: string; slot?: 1 | 2 | 3 }) {
  const money = useMoneyAxis();
  const config = { value: { label, color: `var(--chart-${slot})` } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(120, data.length * 34 + 24) }}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={money.tick} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent hideLabel={false} formatter={money.tooltip} />} />
        <Bar dataKey="value" name={label} fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}
