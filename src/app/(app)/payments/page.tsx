import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PaymentDialog } from "@/components/payments/payment-dialog";
import { PaymentRowActions } from "@/components/payments/payment-row-actions";
import { StatCard } from "@/components/stat-card";
import { Badge, DemoBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatDate, formatMoney, localeFor } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import { loadCustomers, loadPaymentMethods, loadSuppliers } from "@/lib/queries/documents";
import type { Payment } from "@/lib/types";

export const metadata: Metadata = { title: "Payments" };

type Row = Payment & {
  customers: { name: string } | null;
  suppliers: { name: string } | null;
  orders: { order_number: string } | null;
  purchases: { purchase_number: string } | null;
};

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const lp = parseListParams(sp, { sortable: ["payment_date"], defaultSort: "payment_date", timeZone: ctx.business.timezone });

  const build = (select: string, head = false) => {
    let q = ctx.supabase.from("payments").select(select, { count: "exact", head }).eq("business_id", ctx.businessId);
    const dir = lp.get("direction");
    if (dir) q = q.eq("direction", dir);
    const method = lp.get("method");
    if (method) q = q.eq("method", method);
    if (lp.q) q = q.or(`reference.ilike.${ilikeTerm(lp.q)},notes.ilike.${ilikeTerm(lp.q)}`);
    if (lp.range) q = q.gte("payment_date", lp.range.from).lte("payment_date", lp.range.to);
    return q;
  };

  const [{ data, count }, { data: sums }, methods, customers, suppliers] = await Promise.all([
    build("*, customers(name), suppliers(name), orders(order_number), purchases(purchase_number)").order("payment_date", { ascending: false }).order("created_at", { ascending: false }).range(lp.from, lp.to),
    build("direction, kind, amount").limit(10000),
    loadPaymentMethods(ctx),
    ctx.settings.module_customers ? loadCustomers(ctx) : Promise.resolve([]),
    ctx.settings.module_suppliers ? loadSuppliers(ctx) : Promise.resolve([]),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const totals = ((sums ?? []) as unknown as Pick<Payment, "direction" | "kind" | "amount">[]).reduce(
    (a, p) => {
      const signed = p.kind === "refund" ? -Number(p.amount) : Number(p.amount);
      if (p.direction === "in") a.in += signed;
      else a.out += signed;
      return a;
    },
    { in: 0, out: 0 },
  );
  const money = (n: number) => formatMoney(n, ctx.business.currency, localeFor(ctx.business.country));
  const today = todayIn(ctx.business.timezone);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from customers and paid to suppliers. Record order payments from the order page."
        actions={
          <>
            <PaymentDialog direction="out" methods={methods} today={today} parties={suppliers} title="Record payment made" trigger={<Button variant="outline"><ArrowUpRight /> Payment made</Button>} />
            <PaymentDialog direction="in" methods={methods} today={today} parties={customers} title="Record payment received" trigger={<Button><ArrowDownLeft /> Payment received</Button>} />
          </>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={`Received${lp.range ? ` · ${lp.range.label}` : ""}`} value={money(totals.in)} icon={ArrowDownLeft} tone="success" />
        <StatCard label={`Paid out${lp.range ? ` · ${lp.range.label}` : ""}`} value={money(totals.out)} icon={ArrowUpRight} />
        <StatCard label="Net cash flow" value={money(totals.in - totals.out)} icon={Wallet} hint="Payments only — expenses are recorded separately" />
      </div>
      <ListToolbar
        searchPlaceholder="Search reference or notes…"
        dateFilter
        filters={[
          { key: "direction", label: "Directions", options: [{ value: "in", label: "Received" }, { value: "out", label: "Paid out" }] },
          { key: "method", label: "Methods", options: methods.map((m) => ({ value: m, label: m })) },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments recorded" description="Payments you record against orders and purchases appear here." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>From / to</TableHead>
                  <TableHead className="hidden md:table-cell">For</TableHead>
                  <TableHead className="hidden sm:table-cell">Method</TableHead>
                  <TableHead className="hidden lg:table-cell">Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const signed = (p.direction === "in" ? 1 : -1) * (p.kind === "refund" ? -1 : 1) * Number(p.amount);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(p.payment_date)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {p.direction === "in" ? <ArrowDownLeft className="size-4 text-success" /> : <ArrowUpRight className="size-4 text-muted-foreground" />}
                          <span className="truncate">{p.customers?.name ?? p.suppliers?.name ?? "—"}</span>
                          {p.kind === "refund" && <Badge tone="warning">Refund</Badge>}
                          {p.is_demo && <DemoBadge />}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {p.order_id && p.orders ? <Link href={`/orders/${p.order_id}`} className="text-primary hover:underline">{p.orders.order_number}</Link>
                          : p.purchase_id && p.purchases ? <Link href={`/purchases/${p.purchase_id}`} className="text-primary hover:underline">{p.purchases.purchase_number}</Link>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{p.method}</TableCell>
                      <TableCell className="hidden max-w-40 truncate text-muted-foreground lg:table-cell">{p.reference ?? "—"}</TableCell>
                      <TableCell className="text-right"><Money value={signed} signed /></TableCell>
                      <TableCell><PaymentRowActions payment={p} methods={methods} today={today} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/payments" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
