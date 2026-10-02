import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { DemoBadge, ImportedBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import type { Order } from "@/lib/types";

export const metadata: Metadata = { title: "Orders & Sales" };

const ORDER_STATUS_OPTIONS = ["draft", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled", "returned"].map((s) => ({
  value: s,
  label: s[0].toUpperCase() + s.slice(1),
}));

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const lp = parseListParams(sp, { sortable: ["order_date", "order_number", "total"], defaultSort: "order_date", timeZone: ctx.business.timezone });

  let q = ctx.supabase.from("orders").select("*, customers(name)", { count: "exact" }).eq("business_id", ctx.businessId);
  if (lp.q) {
    // Search order number, or customer name (resolved to ids first)
    const { data: matches } = await ctx.supabase.from("customers").select("id").eq("business_id", ctx.businessId).ilike("name", ilikeTerm(lp.q)).limit(200);
    const ids = (matches ?? []).map((m) => m.id);
    q = q.or([`order_number.ilike.${ilikeTerm(lp.q)}`, `notes.ilike.${ilikeTerm(lp.q)}`, ...(ids.length ? [`customer_id.in.(${ids.join(",")})`] : [])].join(","));
  }
  const status = lp.get("status");
  if (status === "open") q = q.in("status", ["confirmed", "processing", "ready", "shipped"]);
  else if (status) q = q.eq("status", status);
  const payment = lp.get("payment");
  if (payment) q = q.eq("payment_status", payment).not("status", "in", "(draft,cancelled,returned)");
  if (lp.range) q = q.gte("order_date", lp.range.from).lte("order_date", lp.range.to);
  const { data, count } = await q
    .order(lp.sort, { ascending: lp.dir === "asc" })
    .order("created_at", { ascending: false })
    .range(lp.from, lp.to);
  const orders = (data ?? []) as (Order & { customers: { name: string } | null })[];
  const filtered = Boolean(lp.q || status || payment || lp.range);

  return (
    <>
      <PageHeader
        title="Orders & Sales"
        description="Create orders, move them through your workflow and track what's been paid."
        actions={<Button asChild><Link href="/orders/new"><Plus /> New order</Link></Button>}
      />
      <ListToolbar
        searchPlaceholder="Search order no., customer, notes…"
        dateFilter
        filters={[
          { key: "status", label: "Statuses", options: [{ value: "open", label: "Open (confirmed → shipped)" }, ...ORDER_STATUS_OPTIONS] },
          { key: "payment", label: "Payment", options: [{ value: "unpaid", label: "Unpaid" }, { value: "partial", label: "Partially paid" }, { value: "paid", label: "Paid" }] },
        ]}
      />
      {orders.length === 0 ? (
        filtered ? (
          <EmptyState icon={Receipt} title="No orders match" description="Try a different search or filter." />
        ) : (
          <EmptyState icon={Receipt} title="No orders yet" description="Record your first sale — stock and profit update automatically." action={<Button asChild><Link href="/orders/new"><Plus /> New order</Link></Button>} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader column="order_number" label="Order" pathname="/orders" searchParams={sp} current={lp.sort} dir={lp.dir} />
                  <SortHeader column="order_date" label="Date" pathname="/orders" searchParams={sp} current={lp.sort} dir={lp.dir} className="hidden sm:table-cell" />
                  <TableHead className="hidden md:table-cell">Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <SortHeader column="total" label="Total" pathname="/orders" searchParams={sp} current={lp.sort} dir={lp.dir} className="text-right" align="right" />
                  <TableHead className="hidden text-right lg:table-cell">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const closed = ["cancelled", "returned"].includes(o.status);
                  const due = closed ? 0 : Math.max(0, o.total - o.amount_paid);
                  return (
                    <TableRow key={o.id} className="relative">
                      <TableCell>
                        <Link href={`/orders/${o.id}`} className="font-medium text-primary after:absolute after:inset-0 hover:underline">{o.order_number}</Link>
                        {o.is_demo && <DemoBadge />}
                        {o.is_imported && <ImportedBadge />}
                        <div className="text-xs text-muted-foreground sm:hidden">{formatDate(o.order_date)}</div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(o.order_date)}</TableCell>
                      <TableCell className="hidden max-w-48 truncate md:table-cell">{o.customers?.name ?? <span className="text-muted-foreground">Walk-in</span>}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={o.status} />
                          {o.status !== "draft" && !closed && <StatusBadge status={o.payment_status} />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right"><Money value={o.total} /></TableCell>
                      <TableCell className="hidden text-right lg:table-cell">{due > 0 ? <Money value={due} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/orders" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
