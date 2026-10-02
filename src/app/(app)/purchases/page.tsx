import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShoppingCart } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import type { Purchase } from "@/lib/types";

export const metadata: Metadata = { title: "Purchases" };

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.settings.module_purchases) redirect("/settings?tab=features");
  const lp = parseListParams(sp, { sortable: ["purchase_date", "purchase_number", "total"], defaultSort: "purchase_date", timeZone: ctx.business.timezone });

  let q = ctx.supabase.from("purchases").select("*, suppliers(name)", { count: "exact" }).eq("business_id", ctx.businessId);
  if (lp.q) {
    const { data: matches } = await ctx.supabase.from("suppliers").select("id").eq("business_id", ctx.businessId).ilike("name", ilikeTerm(lp.q)).limit(200);
    const ids = (matches ?? []).map((m) => m.id);
    q = q.or([`purchase_number.ilike.${ilikeTerm(lp.q)}`, `invoice_number.ilike.${ilikeTerm(lp.q)}`, ...(ids.length ? [`supplier_id.in.(${ids.join(",")})`] : [])].join(","));
  }
  const status = lp.get("status");
  if (status) q = q.eq("status", status);
  const payment = lp.get("payment");
  if (payment) q = q.eq("payment_status", payment).not("status", "in", "(draft,cancelled)");
  const supplier = lp.get("supplier");
  if (supplier) q = q.eq("supplier_id", supplier);
  if (lp.range) q = q.gte("purchase_date", lp.range.from).lte("purchase_date", lp.range.to);
  const [{ data, count }, { data: suppliers }] = await Promise.all([
    q.order(lp.sort, { ascending: lp.dir === "asc" }).order("created_at", { ascending: false }).range(lp.from, lp.to),
    ctx.supabase.from("suppliers").select("id, name").eq("business_id", ctx.businessId).order("name"),
  ]);
  const rows = (data ?? []) as (Purchase & { suppliers: { name: string } | null })[];
  const filtered = Boolean(lp.q || status || payment || supplier || lp.range);

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Stock and materials bought from suppliers. Receiving a purchase adds it to inventory at landed cost."
        actions={<Button asChild><Link href="/purchases/new"><Plus /> New purchase</Link></Button>}
      />
      <ListToolbar
        searchPlaceholder="Search number, invoice, supplier…"
        dateFilter
        filters={[
          { key: "status", label: "Statuses", options: ["draft", "ordered", "partially_received", "received", "cancelled"].map((s) => ({ value: s, label: s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase()) })) },
          { key: "payment", label: "Payment", options: [{ value: "unpaid", label: "Unpaid" }, { value: "partial", label: "Partially paid" }, { value: "paid", label: "Paid" }] },
          ...(ctx.settings.module_suppliers ? [{ key: "supplier", label: "Suppliers", options: (suppliers ?? []).map((s) => ({ value: s.id, label: s.name })) }] : []),
        ]}
      />
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={ShoppingCart} title="No purchases match" />
        ) : (
          <EmptyState icon={ShoppingCart} title="No purchases yet" description="Record what you buy from suppliers. When it arrives, receive it to add stock." action={<Button asChild><Link href="/purchases/new"><Plus /> New purchase</Link></Button>} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader column="purchase_number" label="Purchase" pathname="/purchases" searchParams={sp} current={lp.sort} dir={lp.dir} />
                  <SortHeader column="purchase_date" label="Date" pathname="/purchases" searchParams={sp} current={lp.sort} dir={lp.dir} className="hidden sm:table-cell" />
                  <TableHead className="hidden md:table-cell">Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <SortHeader column="total" label="Total" pathname="/purchases" searchParams={sp} current={lp.sort} dir={lp.dir} className="text-right" align="right" />
                  <TableHead className="hidden text-right lg:table-cell">Owed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const owed = p.status === "cancelled" || p.status === "draft" ? 0 : Math.max(0, p.total - p.amount_paid);
                  return (
                    <TableRow key={p.id} className="relative">
                      <TableCell>
                        <Link href={`/purchases/${p.id}`} className="font-medium text-primary after:absolute after:inset-0 hover:underline">{p.purchase_number}</Link>
                        {p.is_demo && <DemoBadge />}
                        {p.invoice_number && <div className="text-xs text-muted-foreground">Inv. {p.invoice_number}</div>}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(p.purchase_date)}</TableCell>
                      <TableCell className="hidden max-w-48 truncate md:table-cell">{p.suppliers?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={p.status} />
                          {!["draft", "cancelled"].includes(p.status) && <StatusBadge status={p.payment_status} />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right"><Money value={p.total} /></TableCell>
                      <TableCell className="hidden text-right lg:table-cell">{owed > 0 ? <Money value={owed} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/purchases" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
