import type { Metadata } from "next";
import { History } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/empty-state";
import { Ledger, TXN_LABELS, type LedgerRow } from "@/components/inventory/ledger";
import { PageHeader } from "@/components/page-header";
import { requireContext } from "@/lib/context";
import { addDays, startOfDay } from "@/lib/dates";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import type { InventoryTxnType } from "@/lib/types";

export const metadata: Metadata = { title: "Stock history" };

/** Every inventory movement across all items. */
export default async function StockHistoryPage({ searchParams }: PageProps<"/inventory/history">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const lp = parseListParams(sp, { sortable: ["occurred_at"], defaultSort: "occurred_at", timeZone: ctx.business.timezone });

  let q = ctx.supabase
    .from("inventory_transactions")
    .select("*, product_variants!inner(name, is_default, sku, products!inner(name, unit))", { count: "exact" })
    .eq("business_id", ctx.businessId);
  const type = lp.get("type");
  if (type) q = q.eq("txn_type", type);
  if (lp.q) q = q.or(`reference_label.ilike.${ilikeTerm(lp.q)},notes.ilike.${ilikeTerm(lp.q)}`);
  if (lp.range) {
    const tz = ctx.business.timezone;
    q = q.gte("occurred_at", startOfDay(lp.range.from, tz)).lt("occurred_at", startOfDay(addDays(lp.range.to, 1), tz));
  }
  const { data, count } = await q.order("occurred_at", { ascending: false }).range(lp.from, lp.to);

  type Joined = LedgerRow & { product_variants: { name: string; is_default: boolean; products: { name: string; unit: string } } };
  const rows = ((data ?? []) as Joined[]).map((t) => ({
    ...t,
    item_name: t.product_variants.is_default ? t.product_variants.products.name : `${t.product_variants.products.name} — ${t.product_variants.name}`,
    unit: t.product_variants.products.unit,
  }));

  return (
    <>
      <PageHeader title="Stock history" description="Every stock movement, with its reason and value." back={{ href: "/inventory", label: "Inventory" }} />
      <ListToolbar
        searchPlaceholder="Search reference or notes…"
        dateFilter
        filters={[{ key: "type", label: "Movement types", options: (Object.keys(TXN_LABELS) as InventoryTxnType[]).map((k) => ({ value: k, label: TXN_LABELS[k] })) }]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={History} title="No stock movements found" description="Purchases, sales, production, wastage and adjustments will appear here." />
      ) : (
        <>
          <Ledger rows={rows} timeZone={ctx.business.timezone} showItem />
          <Pagination pathname="/inventory/history" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
