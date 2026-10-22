import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, History, PackageX, Plus, SlidersHorizontal, Trash2, Wallet } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { EmptyState } from "@/components/empty-state";
import { AdjustStockDialog, StockLevelsDialog, WastageDialog, type StockItem } from "@/components/inventory/stock-dialogs";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StockBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatMoney, formatQty, localeFor, titleCase } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Inventory" };

interface Row {
  variant_id: string;
  product_id: string;
  item_name: string;
  sku: string | null;
  item_type: string;
  unit: string;
  category_name: string | null;
  quantity: number;
  avg_cost: number;
  min_stock: number;
  max_stock: number | null;
  location: string | null;
  stock_value: number;
  highest_cost: number;
  is_low: boolean;
  is_out: boolean;
}

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.settings.module_inventory) redirect("/settings?tab=features");
  const lp = parseListParams(sp, { sortable: ["item_name", "quantity", "stock_value", "updated_at"], defaultSort: "item_name", defaultDir: "asc" });

  let q = ctx.supabase.from("inventory_overview").select("*", { count: "exact" }).eq("business_id", ctx.businessId).eq("is_active", true);
  if (lp.q) q = q.or(`item_name.ilike.${ilikeTerm(lp.q)},sku.ilike.${ilikeTerm(lp.q)},location.ilike.${ilikeTerm(lp.q)}`);
  const status = lp.get("status");
  if (status === "low") q = q.eq("is_low", true);
  if (status === "out") q = q.eq("is_out", true);
  if (status === "over") q = q.eq("is_over", true);
  const type = lp.get("type");
  if (type) q = q.eq("item_type", type);

  const [{ data, count }, { data: all }] = await Promise.all([
    q.order(lp.sort, { ascending: lp.dir === "asc" }).range(lp.from, lp.to),
    ctx.supabase.from("inventory_overview").select("variant_id, item_name, unit, quantity, avg_cost, stock_value, is_low, is_out").eq("business_id", ctx.businessId).eq("is_active", true).order("item_name"),
  ]);
  const rows = (data ?? []) as Row[];
  const allItems = all ?? [];
  const totalValue = allItems.reduce((a, r) => a + Number(r.stock_value), 0);
  const lowCount = allItems.filter((r) => r.is_low).length;
  const outCount = allItems.filter((r) => r.is_out).length;
  const pickerItems: StockItem[] = allItems.map((r) => ({ variant_id: r.variant_id, item_name: r.item_name, unit: r.unit, quantity: Number(r.quantity), avg_cost: Number(r.avg_cost) }));
  const locale = localeFor(ctx.business.country);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock on hand, valued at weighted-average cost."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/inventory/history"><History /> Stock history</Link></Button>
            <Button variant="outline" asChild><Link href="/inventory/wastage"><Trash2 /> Wastage</Link></Button>
            {pickerItems.length > 0 && (
              <WastageDialog items={pickerItems} today={todayIn(ctx.business.timezone)} trigger={<Button variant="outline"><PackageX /> Record wastage</Button>} />
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Inventory value" value={formatMoney(totalValue, ctx.business.currency, locale)} icon={Wallet} hint="Quantity × average cost" />
        <StatCard label="Items tracked" value={allItems.length} icon={Boxes} />
        <StatCard label="Low stock" value={lowCount} icon={AlertTriangle} tone={lowCount ? "warning" : "default"} href="/inventory?status=low" hint="At or below minimum" />
        <StatCard label="Out of stock" value={outCount} icon={PackageX} tone={outCount ? "danger" : "default"} href="/inventory?status=out" />
      </div>

      <ListToolbar
        searchPlaceholder="Search item, SKU or location…"
        filters={[
          { key: "status", label: "Stock levels", options: [{ value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }, { value: "over", label: "Above maximum" }] },
          { key: "type", label: "Types", options: [{ value: "product", label: "Products" }, { value: "material", label: "Materials" }] },
        ]}
      />

      {rows.length === 0 ? (
        allItems.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No stock-tracked items yet"
            description="Items appear here when “Track stock” is on. Add a product or material to start."
            action={<Button asChild><Link href="/catalog/new"><Plus /> Add item</Link></Button>}
          />
        ) : (
          <EmptyState icon={Boxes} title="Nothing matches" description="Try a different search or filter." />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader column="item_name" label="Item" pathname="/inventory" searchParams={sp} current={lp.sort} dir={lp.dir} />
                  <TableHead className="hidden lg:table-cell">Location</TableHead>
                  <SortHeader column="quantity" label="On hand" pathname="/inventory" searchParams={sp} current={lp.sort} dir={lp.dir} className="text-right" align="right" />
                  <TableHead className="hidden text-right md:table-cell">Min / Max</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Avg. cost</TableHead>
                  <SortHeader column="stock_value" label="Value" pathname="/inventory" searchParams={sp} current={lp.sort} dir={lp.dir} className="hidden text-right sm:table-cell" align="right" />
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const item: StockItem = { ...r, quantity: Number(r.quantity), avg_cost: Number(r.avg_cost), highest_cost: Number(r.highest_cost), min_stock: Number(r.min_stock), max_stock: r.max_stock == null ? null : Number(r.max_stock) };
                  return (
                    <TableRow key={r.variant_id}>
                      <TableCell>
                        <Link href={`/inventory/${r.variant_id}`} className="font-medium hover:underline">{r.item_name}</Link>
                        <div className="text-xs text-muted-foreground">{[r.sku, titleCase(r.item_type), r.category_name].filter(Boolean).join(" · ")}</div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{r.location ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular">{formatQty(r.quantity, r.unit)}</TableCell>
                      <TableCell className="hidden text-right text-muted-foreground tabular md:table-cell">
                        {formatQty(r.min_stock)} / {r.max_stock == null ? "—" : formatQty(r.max_stock)}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money value={r.avg_cost} /></TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money value={r.stock_value} /></TableCell>
                      <TableCell><StockBadge quantity={Number(r.quantity)} min={Number(r.min_stock)} max={r.max_stock} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <AdjustStockDialog item={item} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Adjust stock of ${r.item_name}`}><SlidersHorizontal /></Button>} />
                          <StockLevelsDialog item={item} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Stock levels for ${r.item_name}`}><AlertTriangle /></Button>} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/inventory" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
