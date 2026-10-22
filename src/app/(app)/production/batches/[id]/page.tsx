import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Play, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { TotalsPanel } from "@/components/documents/lines-editor";
import { Ledger, type LedgerRow } from "@/components/inventory/ledger";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { CompleteBatchDialog } from "@/components/production/batch-dialogs";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteBatchAction, setBatchStatusAction } from "@/lib/actions/production";
import { requireContext } from "@/lib/context";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import type { ProductionBatch, ProductionConsumption } from "@/lib/types";

export const metadata: Metadata = { title: "Production batch" };

type VariantJoin = { name: string; is_default: boolean; products: { name: string; unit: string } };
const nameOf = (v: VariantJoin) => (v.is_default ? v.products.name : `${v.products.name} — ${v.name}`);

export default async function BatchPage({ params }: PageProps<"/production/batches/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase
    .from("production_batches")
    .select("*, product_variants!inner(name, is_default, products!inner(name, unit)), recipes(id, name)")
    .eq("id", id)
    .eq("business_id", ctx.businessId)
    .maybeSingle();
  if (!data) notFound();
  const batch = data as ProductionBatch & { product_variants: VariantJoin; recipes: { id: string; name: string } | null };

  const [{ data: consRows }, { data: txns }] = await Promise.all([
    ctx.supabase.from("production_consumption").select("*, product_variants!inner(name, is_default, products!inner(name, unit))").eq("batch_id", id).order("sort_order"),
    ctx.supabase.from("inventory_transactions").select("*, product_variants!inner(name, is_default, products!inner(name, unit))").eq("reference_id", id).eq("reference_type", "production_batch").order("created_at"),
  ]);
  const cons = (consRows ?? []) as (ProductionConsumption & { product_variants: VariantJoin })[];
  const { data: levels } = cons.length
    ? await ctx.supabase.from("inventory_levels").select("variant_id, quantity, avg_cost").in("variant_id", cons.map((c) => c.component_variant_id))
    : { data: [] };
  const levelOf = new Map((levels ?? []).map((l) => [l.variant_id, l]));
  const unit = batch.product_variants.products.unit;
  const open = batch.status === "planned" || batch.status === "in_progress";

  return (
    <>
      <PageHeader
        title={batch.batch_number}
        back={{ href: "/production", label: "Production" }}
        badge={<><StatusBadge status={batch.status} />{batch.is_demo && <DemoBadge />}</>}
        description={`${formatDate(batch.production_date)} · ${formatQty(batch.planned_quantity, unit)} × ${nameOf(batch.product_variants)}${batch.recipes ? ` · Recipe: ${batch.recipes.name}` : ""}`}
        actions={
          batch.status === "completed" ? (
            <ConfirmAction
              trigger={<Button variant="ghost"><Trash2 /> Delete</Button>}
              title="Delete this completed batch?"
              description={
                <ul className="list-disc space-y-1 pl-5">
                  <li>The materials it used (and wasted) go back into stock.</li>
                  <li>The {formatQty(batch.actual_quantity, unit)} it produced are removed from stock. If some were already sold or used, the delete stops and nothing changes.</li>
                  <li>This can&apos;t be undone.</li>
                </ul>
              }
              confirmLabel="Delete batch"
              destructive
              action={deleteBatchAction.bind(null, batch.id)}
              redirectTo="/production"
            />
          ) : open ? (
            <>
              <ConfirmAction trigger={<Button variant="ghost"><Trash2 /> Delete</Button>} title="Delete this batch?" description="Nothing has been consumed or produced yet, so it can be deleted." confirmLabel="Delete" destructive action={deleteBatchAction.bind(null, batch.id)} redirectTo="/production" />
              <ConfirmAction trigger={<Button variant="ghost"><Ban /> Cancel</Button>} title="Cancel this batch?" description="No stock changes. The batch stays on record as cancelled." confirmLabel="Cancel batch" destructive action={setBatchStatusAction.bind(null, batch.id, "cancelled")} />
              {batch.status === "planned" && (
                <ConfirmAction trigger={<Button variant="outline"><Play /> Start</Button>} title="Start production?" description="Marks the batch as in progress. Stock changes only when you complete it." confirmLabel="Start" action={setBatchStatusAction.bind(null, batch.id, "in_progress")} />
              )}
              <CompleteBatchDialog
                batchId={batch.id}
                plannedQuantity={Number(batch.planned_quantity)}
                unit={unit}
                lines={cons.map((c) => ({
                  id: c.id,
                  name: nameOf(c.product_variants),
                  unit: c.product_variants.products.unit,
                  planned_quantity: Number(c.planned_quantity),
                  used_quantity: Number(c.used_quantity),
                  wasted_quantity: Number(c.wasted_quantity),
                  available: Number(levelOf.get(c.component_variant_id)?.quantity ?? 0),
                  avg_cost: Number(levelOf.get(c.component_variant_id)?.avg_cost ?? 0),
                }))}
              />
            </>
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Materials</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Material</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">{open ? "Expected use" : "Used"}</TableHead>
                    <TableHead className="text-right">{open ? "Expected waste" : "Wasted"}</TableHead>
                    {open ? <TableHead className="pr-6 text-right">In stock</TableHead> : <TableHead className="pr-6 text-right">Cost</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cons.map((c) => {
                    const u = c.product_variants.products.unit;
                    const avail = Number(levelOf.get(c.component_variant_id)?.quantity ?? 0);
                    const short = open && Number(c.used_quantity) + Number(c.wasted_quantity) > avail;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="pl-6"><Link href={`/inventory/${c.component_variant_id}`} className="hover:underline">{nameOf(c.product_variants)}</Link></TableCell>
                        <TableCell className="text-right tabular">{formatQty(c.planned_quantity, u)}</TableCell>
                        <TableCell className="text-right tabular">{formatQty(c.used_quantity, u)}</TableCell>
                        <TableCell className="text-right tabular">{formatQty(c.wasted_quantity, u)}</TableCell>
                        {open ? (
                          <TableCell className={`pr-6 text-right tabular ${short ? "font-medium text-destructive" : ""}`}>{formatQty(avail, u)}</TableCell>
                        ) : (
                          <TableCell className="pr-6 text-right"><Money value={c.total_cost} /></TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {(txns ?? []).length > 0 && (
            <div>
              <h2 className="mb-3 text-base font-semibold">Stock movements</h2>
              <Ledger
                rows={((txns ?? []) as (LedgerRow & { product_variants: VariantJoin })[]).map((t) => ({ ...t, item_name: nameOf(t.product_variants), unit: t.product_variants.products.unit }))}
                timeZone={ctx.business.timezone}
                showItem
              />
            </div>
          )}
        </div>
        <Card className="content-start">
          <CardHeader><CardTitle>Batch cost</CardTitle></CardHeader>
          <CardContent>
            {batch.status === "completed" ? (
              <>
                <TotalsPanel
                  rows={[
                    { label: "Materials used", value: batch.material_cost },
                    { label: "Materials wasted", value: batch.wastage_cost },
                    { label: "Additional cost", value: batch.additional_cost },
                    { label: "Total cost", value: batch.total_cost, strong: true },
                  ]}
                />
                <dl className="mt-4 grid gap-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Produced</dt><dd className="tabular">{formatQty(batch.actual_quantity, unit)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Cost per unit</dt><dd><Money value={batch.unit_cost} /></dd></div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">Completed {formatDateTime(batch.completed_at, ctx.business.timezone)}. Finished goods entered stock at the cost per unit above.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{batch.status === "cancelled" ? "This batch was cancelled; stock was not changed." : "Costs are calculated when the batch is completed."}</p>
            )}
            {batch.notes && <p className="mt-4 rounded-md bg-muted p-3 text-sm whitespace-pre-line">{batch.notes}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
