import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, SlidersHorizontal } from "lucide-react";
import { Pagination } from "@/components/data/pagination";
import { AdjustStockDialog } from "@/components/inventory/stock-dialogs";
import { Ledger, type LedgerRow } from "@/components/inventory/ledger";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StockBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/context";
import { formatQty } from "@/lib/format";
import { parseListParams } from "@/lib/list-params";
import { loadUndoneIds } from "@/lib/queries/catalog";

export const metadata: Metadata = { title: "Stock history" };

export default async function VariantStockPage({ params, searchParams }: PageProps<"/inventory/[variantId]">) {
  const { variantId } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  const lp = parseListParams(sp, { sortable: ["occurred_at"], defaultSort: "occurred_at" });

  const { data: item } = await ctx.supabase.from("inventory_overview").select("*").eq("variant_id", variantId).eq("business_id", ctx.businessId).maybeSingle();
  if (!item) notFound();
  const { data: txns, count } = await ctx.supabase
    .from("inventory_transactions")
    .select("*", { count: "exact" })
    .eq("variant_id", variantId)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(lp.from, lp.to);

  return (
    <>
      <PageHeader
        title={item.item_name}
        description={[item.sku, item.location].filter(Boolean).join(" · ") || "Stock history"}
        back={{ href: "/inventory", label: "Inventory" }}
        badge={<StockBadge quantity={Number(item.quantity)} min={Number(item.min_stock)} max={item.max_stock} />}
        actions={
          <>
            <Button variant="outline" asChild><Link href={`/catalog/${item.product_id}`}>View item</Link></Button>
            <AdjustStockDialog
              item={{ variant_id: item.variant_id, item_name: item.item_name, unit: item.unit, quantity: Number(item.quantity), avg_cost: Number(item.avg_cost), highest_cost: Number(item.highest_cost) }}
              trigger={<Button><SlidersHorizontal /> Adjust stock</Button>}
            />
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="On hand" value={formatQty(item.quantity, item.unit)} />
        <StatCard label="Average cost" value={<Money value={item.avg_cost} />} />
        <StatCard label="Stock value" value={<Money value={item.stock_value} />} />
        <StatCard label="Minimum" value={formatQty(item.min_stock, item.unit)} hint={item.max_stock != null ? `Max ${formatQty(item.max_stock, item.unit)}` : undefined} />
      </div>
      {(txns ?? []).length === 0 ? (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground"><History className="size-4" /> No stock movements yet.</p>
      ) : (
        <>
          <Ledger rows={(txns ?? []).map((t) => ({ ...t, unit: item.unit })) as LedgerRow[]} timeZone={ctx.business.timezone} undone={await loadUndoneIds(ctx, [variantId])} />
          <Pagination pathname={`/inventory/${variantId}`} searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
