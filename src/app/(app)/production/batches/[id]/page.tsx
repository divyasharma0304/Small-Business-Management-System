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
import type { ProductionBatch, ProductionBatchOutput, ProductionConsumption } from "@/lib/types";

export const metadata: Metadata = { title: "Production batch" };

type VariantJoin = { name: string; is_default: boolean; products: { name: string; unit: string } };
const nameOf = (v: VariantJoin) => (v.is_default ? v.products.name : `${v.products.name} — ${v.name}`);
const VJ = "product_variants!inner(name, is_default, products!inner(name, unit))";

export default async function BatchPage({ params }: PageProps<"/production/batches/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("production_batches").select("*").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const batch = data as ProductionBatch;

  const [{ data: outRows }, { data: consRows }, { data: txns }] = await Promise.all([
    ctx.supabase.from("production_batch_outputs").select(`*, ${VJ}, recipes(name)`).eq("batch_id", id).order("sort_order"),
    ctx.supabase.from("production_consumption").select(`*, ${VJ}`).eq("batch_id", id).order("sort_order"),
    ctx.supabase.from("inventory_transactions").select(`*, ${VJ}`).eq("reference_id", id).eq("reference_type", "production_batch").order("created_at"),
  ]);
  const outputs = (outRows ?? []) as (ProductionBatchOutput & { product_variants: VariantJoin; recipes: { name: string } | null })[];
  const cons = (consRows ?? []) as (ProductionConsumption & { product_variants: VariantJoin })[];
  const { data: levels } = cons.length
    ? await ctx.supabase.from("inventory_levels").select("variant_id, quantity, avg_cost").in("variant_id", cons.map((c) => c.component_variant_id))
    : { data: [] };
  const levelOf = new Map((levels ?? []).map((l) => [l.variant_id, l]));
  const open = batch.status === "planned" || batch.status === "in_progress";
  const completed = batch.status === "completed";

  // Combined material needs across all products (the same material can be in several recipes)
  const totals = new Map<string, { name: string; unit: string; qty: number; available: number; cost: number }>();
  for (const c of cons) {
    const t = totals.get(c.component_variant_id) ?? {
      name: nameOf(c.product_variants),
      unit: c.product_variants.products.unit,
      qty: 0,
      available: Number(levelOf.get(c.component_variant_id)?.quantity ?? 0),
      cost: 0,
    };
    t.qty += Number(c.used_quantity) + Number(c.wasted_quantity);
    t.cost += Number(c.total_cost);
    totals.set(c.component_variant_id, t);
  }
  const productsLabel = outputs.map((o) => `${formatQty(o.actual_quantity ?? o.planned_quantity, o.product_variants.products.unit)} × ${nameOf(o.product_variants)}`).join(", ");

  return (
    <>
      <PageHeader
        title={batch.batch_number}
        back={{ href: "/production", label: "Production" }}
        badge={<><StatusBadge status={batch.status} />{batch.is_demo && <DemoBadge />}</>}
        description={`${formatDate(batch.production_date)} · ${productsLabel}`}
        actions={
          completed ? (
            <ConfirmAction
              trigger={<Button variant="ghost"><Trash2 /> Delete</Button>}
              title="Delete this completed batch?"
              description={
                <ul className="list-disc space-y-1 pl-5">
                  <li>The materials it used (and wasted) go back into stock.</li>
                  <li>The products it made are removed from stock. If some were already sold or used, the delete stops and nothing changes.</li>
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
                outputs={outputs.map((o) => ({
                  id: o.id,
                  name: nameOf(o.product_variants),
                  unit: o.product_variants.products.unit,
                  planned_quantity: Number(o.planned_quantity),
                  lines: cons.filter((c) => c.output_id === o.id).map((c) => ({
                    id: c.id,
                    name: nameOf(c.product_variants),
                    unit: c.product_variants.products.unit,
                    planned_quantity: Number(c.planned_quantity),
                    used_quantity: Number(c.used_quantity),
                    wasted_quantity: Number(c.wasted_quantity),
                    available: Number(levelOf.get(c.component_variant_id)?.quantity ?? 0),
                    avg_cost: Number(levelOf.get(c.component_variant_id)?.avg_cost ?? 0),
                  })),
                }))}
              />
            </>
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Products</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Product</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Made</TableHead>
                    {completed && <TableHead className="text-right">Total cost</TableHead>}
                    {completed && <TableHead className="pr-6 text-right">Per unit</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outputs.map((o) => {
                    const u = o.product_variants.products.unit;
                    return (
                      <TableRow key={o.id}>
                        <TableCell className="pl-6">
                          <Link href={`/inventory/${o.variant_id}`} className="font-medium hover:underline">{nameOf(o.product_variants)}</Link>
                          {o.recipes && <div className="text-xs text-muted-foreground">Recipe: {o.recipes.name}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular">{formatQty(o.planned_quantity, u)}</TableCell>
                        <TableCell className="text-right tabular">{o.actual_quantity == null ? "—" : formatQty(o.actual_quantity, u)}</TableCell>
                        {completed && <TableCell className="text-right"><Money value={o.total_cost} /></TableCell>}
                        {completed && <TableCell className="pr-6 text-right"><Money value={o.unit_cost} /></TableCell>}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Materials{outputs.length > 1 ? " (all products together)" : ""}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Material</TableHead>
                    <TableHead className="text-right">{open ? "Needed" : "Used + wasted"}</TableHead>
                    {open ? <TableHead className="pr-6 text-right">In stock</TableHead> : <TableHead className="pr-6 text-right">Cost</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...totals.entries()].map(([vid, t]) => (
                    <TableRow key={vid}>
                      <TableCell className="pl-6"><Link href={`/inventory/${vid}`} className="hover:underline">{t.name}</Link></TableCell>
                      <TableCell className="text-right tabular">{formatQty(t.qty, t.unit)}</TableCell>
                      {open ? (
                        <TableCell className={`pr-6 text-right tabular ${t.qty > t.available ? "font-medium text-destructive" : ""}`}>{formatQty(t.available, t.unit)}</TableCell>
                      ) : (
                        <TableCell className="pr-6 text-right"><Money value={t.cost} /></TableCell>
                      )}
                    </TableRow>
                  ))}
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
            {completed ? (
              <>
                <TotalsPanel
                  rows={[
                    { label: "Materials used", value: batch.material_cost },
                    { label: "Materials wasted", value: batch.wastage_cost },
                    { label: "Additional cost", value: batch.additional_cost },
                    { label: "Total cost", value: batch.total_cost, strong: true },
                  ]}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  Completed {formatDateTime(batch.completed_at, ctx.business.timezone)}. Each product entered stock at its own cost per unit
                  {outputs.length > 1 ? "; the additional cost was split by each product's material cost" : ""}.
                </p>
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
