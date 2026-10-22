import type { Metadata } from "next";
import Link from "next/link";
import { PackageX, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { deleteWastageAction } from "@/lib/actions/inventory";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/empty-state";
import { WASTAGE_REASONS, WastageDialog } from "@/components/inventory/stock-dialogs";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatDate, formatQty, titleCase } from "@/lib/format";
import { parseListParams } from "@/lib/list-params";

export const metadata: Metadata = { title: "Wastage" };

export default async function WastagePage({ searchParams }: PageProps<"/inventory/wastage">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const lp = parseListParams(sp, { sortable: ["wastage_date"], defaultSort: "wastage_date", timeZone: ctx.business.timezone });

  let q = ctx.supabase
    .from("wastage")
    .select("*, product_variants!inner(name, is_default, products!inner(name, unit)), production_batches(batch_number)", { count: "exact" })
    .eq("business_id", ctx.businessId);
  const reason = lp.get("reason");
  if (reason) q = q.eq("reason", reason);
  if (lp.range) q = q.gte("wastage_date", lp.range.from).lte("wastage_date", lp.range.to);
  const [{ data, count }, { data: items }] = await Promise.all([
    q.order("wastage_date", { ascending: false }).order("created_at", { ascending: false }).range(lp.from, lp.to),
    ctx.supabase.from("inventory_overview").select("variant_id, item_name, unit, quantity, avg_cost").eq("business_id", ctx.businessId).eq("is_active", true).order("item_name"),
  ]);

  const rows = (data ?? []) as {
    id: string; quantity: number; wastage_date: string; reason: string; total_cost: number; notes: string | null; batch_id: string | null;
    product_variants: { name: string; is_default: boolean; products: { name: string; unit: string } };
    production_batches: { batch_number: string } | null;
  }[];
  const total = rows.reduce((a, r) => a + Number(r.total_cost), 0);

  return (
    <>
      <PageHeader
        title="Wastage"
        description="Damaged, spilled, expired or otherwise lost stock. Production wastage is included in the batch cost."
        back={{ href: "/inventory", label: "Inventory" }}
        actions={
          <WastageDialog
            items={(items ?? []).map((i) => ({ ...i, quantity: Number(i.quantity), avg_cost: Number(i.avg_cost) }))}
            today={todayIn(ctx.business.timezone)}
            trigger={<Button><PackageX /> Record wastage</Button>}
          />
        }
      />
      <ListToolbar
        searchPlaceholder="Search…"
        dateFilter
        filters={[{ key: "reason", label: "Reasons", options: [...WASTAGE_REASONS, { value: "production", label: "Production" }] }]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={PackageX} title="No wastage recorded" description="Record damaged or lost stock so your stock count and profit stay accurate." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="hidden md:table-cell">Notes</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.wastage_date)}</TableCell>
                    <TableCell>{r.product_variants.is_default ? r.product_variants.products.name : `${r.product_variants.products.name} — ${r.product_variants.name}`}</TableCell>
                    <TableCell>
                      <Badge tone={r.reason === "production" ? "primary" : "danger"}>{titleCase(r.reason)}</Badge>
                      {r.batch_id && r.production_batches && (
                        <Link href={`/production/batches/${r.batch_id}`} className="ml-2 text-xs text-primary hover:underline">{r.production_batches.batch_number}</Link>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">{formatQty(r.quantity, r.product_variants.products.unit)}</TableCell>
                    <TableCell className="text-right"><Money value={r.total_cost} /></TableCell>
                    <TableCell className="hidden max-w-60 truncate text-muted-foreground md:table-cell">{r.notes ?? "—"}</TableCell>
                    <TableCell>
                      {!r.batch_id && (
                        <ConfirmAction
                          trigger={<Button size="icon-sm" variant="ghost" aria-label="Delete wastage entry"><Trash2 /></Button>}
                          title="Delete this wastage entry?"
                          description="The quantity is put back into stock and the loss is removed from your profit."
                          confirmLabel="Delete"
                          destructive
                          action={deleteWastageAction.bind(null, r.id)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <Pagination pathname="/inventory/wastage" searchParams={sp} page={lp.page} total={count ?? 0} />
            <span className="pt-3 text-sm text-muted-foreground">Value on this page: <Money value={total} className="font-medium text-foreground" /></span>
          </div>
        </>
      )}
    </>
  );
}
