import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
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
import { deleteCustomerAction } from "@/lib/actions/parties";
import { requireContext } from "@/lib/context";
import { formatDate, formatMoney, localeFor } from "@/lib/format";
import type { Customer, Order } from "@/lib/types";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data: customer } = await ctx.supabase.from("customers").select("*").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!customer) notFound();
  const c = customer as Customer;

  const { data: orderRows } = await ctx.supabase.from("orders").select("*").eq("customer_id", id).order("order_date", { ascending: false }).limit(200);
  const orders = (orderRows ?? []) as Order[];
  const active = orders.filter((o) => !["draft", "cancelled", "returned"].includes(o.status));
  const billed = active.reduce((a, o) => a + Number(o.total), 0);
  const paid = active.reduce((a, o) => a + Number(o.amount_paid), 0);
  const due = active.reduce((a, o) => a + Math.max(0, Number(o.total) - Number(o.amount_paid)), 0);
  const locale = localeFor(ctx.business.country);
  const money = (n: number) => formatMoney(n, ctx.business.currency, locale);

  return (
    <>
      <PageHeader
        title={c.name}
        back={{ href: "/customers", label: "Customers" }}
        badge={c.is_demo ? <DemoBadge /> : undefined}
        actions={
          <>
            <ConfirmAction
                trigger={<Button variant="ghost"><Trash2 /> Delete</Button>}
                title={`Delete ${c.name}?`}
                description={orders.length > 0 ? `The customer is removed. Their ${orders.length} order(s) and payments are kept, shown as walk-in sales.` : "This permanently removes the customer."}
                confirmLabel="Delete"
                destructive
                action={deleteCustomerAction.bind(null, c.id)}
                redirectTo="/customers"
              />
            <PartyDialog kind="customer" initial={c} taxLabel={ctx.business.tax_label} trigger={<Button variant="outline"><Pencil /> Edit</Button>} />
            <Button asChild><Link href={`/orders/new?customer=${c.id}`}><Plus /> New order</Link></Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders" value={active.length} hint={orders.length > active.length ? `${orders.length - active.length} draft/cancelled` : undefined} />
        <StatCard label="Total purchases" value={money(billed)} />
        <StatCard label="Paid" value={money(paid)} />
        <StatCard label="Pending payment" value={money(due)} tone={due > 0 ? "danger" : "default"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <h2 className="mb-3 text-base font-semibold">Order history</h2>
          {orders.length === 0 ? (
            <EmptyState icon={Receipt} title="No orders yet" action={<Button asChild><Link href={`/orders/new?customer=${c.id}`}><Plus /> Create order</Link></Button>} />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell><Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">{o.order_number}</Link></TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(o.order_date)}</TableCell>
                      <TableCell><div className="flex gap-1"><StatusBadge status={o.status} />{!["draft", "cancelled", "returned"].includes(o.status) && <StatusBadge status={o.payment_status} />}</div></TableCell>
                      <TableCell className="text-right"><Money value={o.total} /></TableCell>
                      <TableCell className="text-right">{["cancelled", "returned"].includes(o.status) ? "—" : <Money value={Math.max(0, o.total - o.amount_paid)} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <Card className="content-start">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Detail label="Phone" value={c.phone} />
            <Detail label="Email" value={c.email} />
            <Detail label="Address" value={[c.address, c.city, c.state, c.country].filter(Boolean).join(", ")} />
            <Detail label={ctx.business.tax_label} value={c.tax_number} />
            <Detail label="Last order" value={active[0] ? formatDate(active[0].order_date) : null} />
            {c.notes && <p className="mt-2 rounded-md bg-muted p-3 whitespace-pre-line">{c.notes}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value || "—"}</span>
    </div>
  );
}
