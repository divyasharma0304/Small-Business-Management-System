import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Factory, Plus } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { NewBatchDialog } from "@/components/production/batch-dialogs";
import { ProductionTabs } from "@/components/production/production-tabs";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatDate, formatQty } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import { loadRecipeOptions } from "@/lib/queries/production";
import type { ProductionBatch } from "@/lib/types";

export const metadata: Metadata = { title: "Production" };

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.settings.module_production) redirect("/settings?tab=features");
  const lp = parseListParams(sp, { sortable: ["production_date"], defaultSort: "production_date", timeZone: ctx.business.timezone });

  let q = ctx.supabase
    .from("production_batches")
    .select("*, production_batch_outputs(planned_quantity, actual_quantity, sort_order, product_variants!inner(name, is_default, products!inner(name, unit)))", { count: "exact" })
    .eq("business_id", ctx.businessId);
  const status = lp.get("status");
  if (status) q = q.eq("status", status);
  if (lp.q) q = q.ilike("batch_number", ilikeTerm(lp.q));
  if (lp.range) q = q.gte("production_date", lp.range.from).lte("production_date", lp.range.to);
  const [{ data, count }, recipes] = await Promise.all([
    q.order("production_date", { ascending: false }).order("created_at", { ascending: false }).range(lp.from, lp.to),
    loadRecipeOptions(ctx),
  ]);
  const rows = (data ?? []) as (ProductionBatch & {
    production_batch_outputs: {
      planned_quantity: number;
      actual_quantity: number | null;
      sort_order: number;
      product_variants: { name: string; is_default: boolean; products: { name: string; unit: string } };
    }[];
  })[];
  const today = todayIn(ctx.business.timezone);

  return (
    <>
      <PageHeader title="Production" description="Turn materials into finished goods using recipes." actions={<NewBatchDialog recipes={recipes} today={today} />} />
      <ProductionTabs active="batches" />
      <ListToolbar
        searchPlaceholder="Search batch number…"
        dateFilter
        filters={[{ key: "status", label: "Statuses", options: [{ value: "planned", label: "Planned" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }] }]}
      />
      {rows.length === 0 ? (
        recipes.length === 0 ? (
          <EmptyState icon={Factory} title="No recipes yet" description="Create a recipe (bill of materials) first: what goes into one of your products." action={<Button asChild><Link href="/production/recipes/new"><Plus /> Create recipe</Link></Button>} />
        ) : (
          <EmptyState icon={Factory} title="No production batches" description="Plan a batch to make products from your materials." />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Total cost</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const outs = [...b.production_batch_outputs].sort((x, y) => x.sort_order - y.sort_order);
                  return (
                    <TableRow key={b.id} className="relative">
                      <TableCell>
                        <Link href={`/production/batches/${b.id}`} className="font-medium text-primary after:absolute after:inset-0 hover:underline">{b.batch_number}</Link>
                        {b.is_demo && <DemoBadge />}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(b.production_date)}</TableCell>
                      <TableCell>
                        <ul className="grid gap-0.5">
                          {outs.map((o, i) => {
                            const name = o.product_variants.is_default ? o.product_variants.products.name : `${o.product_variants.products.name} — ${o.product_variants.name}`;
                            const unit = o.product_variants.products.unit;
                            return (
                              <li key={i} className="text-sm">
                                {name} <span className="text-muted-foreground tabular">× {formatQty(o.actual_quantity ?? o.planned_quantity, unit)}{o.actual_quantity == null ? " planned" : ""}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">{b.status === "completed" ? <Money value={b.total_cost} /> : "—"}</TableCell>
                      <TableCell><StatusBadge status={b.status} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/production" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
