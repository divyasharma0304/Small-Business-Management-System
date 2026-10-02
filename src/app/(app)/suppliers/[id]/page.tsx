import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PartyDialog } from "@/components/parties/party-dialog";
import { StatCard } from "@/components/stat-card";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteSupplierAction } from "@/lib/actions/parties";
import { requireContext } from "@/lib/context";
import { formatDate, formatMoney, formatQty, localeFor } from "@/lib/format";
import type { Purchase, Supplier } from "@/lib/types";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("suppliers").select("*").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const s = data as Supplier;

  const { data: purchaseRows } = await ctx.supabase.from("purchases").select("*").eq("supplier_id", id).order("purchase_date", { ascending: false }).limit(200);
  const purchases = (purchaseRows ?? []) as Purchase[];
  const active = purchases.filter((p) => !["draft", "cancelled"].includes(p.status));
  const { data: items } = active.length
    ? await ctx.supabase.from("purchase_items").select("variant_id, description, quantity, landed_unit_cost").in("purchase_id", active.map((p) => p.id))
    : { data: [] };
  const supplied = new Map<string, { name: string; qty: number; last: number }>();
  for (const i of items ?? []) {
    const e = supplied.get(i.variant_id) ?? { name: i.description, qty: 0, last: 0 };
    e.qty += Number(i.quantity);
    e.last = Number(i.landed_unit_cost);
    supplied.set(i.variant_id, e);
  }
  const total = active.reduce((a, p) => a + Number(p.total), 0);
  const due = active.reduce((a, p) => a + Math.max(0, Number(p.total) - Number(p.amount_paid)), 0);
  const money = (n: number) => formatMoney(n, ctx.business.currency, localeFor(ctx.business.country));

  return (
    <>
      <PageHeader
        title={s.name}
        back={{ href: "/suppliers", label: "Suppliers" }}
        badge={<>{!s.is_active && <StatusBadge status="inactive" />}{s.is_demo && <DemoBadge />}</>}
        actions={
          <>
            {purchases.length === 0 && (
              <ConfirmAction trigger={<Button variant="ghost"><Trash2 /> Delete</Button>} title={`Delete ${s.name}?`} description="This permanently removes the supplier." confirmLabel="Delete" destructive action={deleteSupplierAction.bind(null, s.id)} redirectTo="/suppliers" />
            )}
            <PartyDialog kind="supplier" initial={s} taxLabel={ctx.business.tax_label} trigger={<Button variant="outline"><Pencil /> Edit</Button>} />
            {ctx.settings.module_purchases && <Button asChild><Link href={`/purchases/new?supplier=${s.id}`}><Plus /> New purchase</Link></Button>}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Purchases" value={active.length} />
        <StatCard label="Total purchase value" value={money(total)} />
        <StatCard label="Outstanding (you owe)" value={money(due)} tone={due > 0 ? "warning" : "default"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <div>
            <h2 className="mb-3 text-base font-semibold">Purchase history</h2>
            {purchases.length === 0 ? (
              <EmptyState icon={ShoppingCart} title="No purchases yet" />
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Purchase</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell><Link href={`/purchases/${p.id}`} className="font-medium text-primary hover:underline">{p.purchase_number}</Link>{p.invoice_number && <div className="text-xs text-muted-foreground">Inv. {p.invoice_number}</div>}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(p.purchase_date)}</TableCell>
                        <TableCell><div className="flex gap-1"><StatusBadge status={p.status} />{p.status !== "draft" && p.status !== "cancelled" && <StatusBadge status={p.payment_status} />}</div></TableCell>
                        <TableCell className="text-right"><Money value={p.total} /></TableCell>
                        <TableCell className="text-right">{p.status === "cancelled" ? "—" : <Money value={Math.max(0, p.total - p.amount_paid)} />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          {supplied.size > 0 && (
            <div>
              <h2 className="mb-3 text-base font-semibold">Items supplied</h2>
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Total qty</TableHead><TableHead className="text-right">Last unit cost</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {[...supplied.entries()].map(([vid, e]) => (
                      <TableRow key={vid}>
                        <TableCell><Link href={`/inventory/${vid}`} className="hover:underline">{e.name}</Link></TableCell>
                        <TableCell className="text-right tabular">{formatQty(e.qty)}</TableCell>
                        <TableCell className="text-right"><Money value={e.last} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
        <Card className="content-start">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {[
              ["Contact", s.contact_person],
              ["Phone", s.phone],
              ["Email", s.email],
              ["Address", [s.address, s.city, s.state, s.country].filter(Boolean).join(", ")],
              [ctx.business.tax_label, s.tax_number],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[90px_1fr] gap-2"><span className="text-muted-foreground">{k}</span><span className="break-words">{v || "—"}</span></div>
            ))}
            {s.notes && <p className="mt-2 rounded-md bg-muted p-3 whitespace-pre-line">{s.notes}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
