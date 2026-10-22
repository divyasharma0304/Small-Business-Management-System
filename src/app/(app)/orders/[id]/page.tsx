import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, Printer, Trash2, Undo2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { TotalsPanel } from "@/components/documents/lines-editor";
import { Money } from "@/components/money";
import { OrderStatusActions } from "@/components/orders/order-status-actions";
import { PageHeader } from "@/components/page-header";
import { PaymentDialog } from "@/components/payments/payment-dialog";
import { PaymentsTable } from "@/components/payments/payments-table";
import { DemoBadge, ImportedBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteOrderAction } from "@/lib/actions/orders";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatDate, formatDateTime, formatPct, formatQty } from "@/lib/format";
import { loadPaymentMethods } from "@/lib/queries/documents";
import type { Customer, Order, OrderItem, Payment } from "@/lib/types";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("orders").select("*, customers(*)").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const order = data as Order & { customers: Customer | null };

  const [{ data: itemRows }, { data: paymentRows }, methods] = await Promise.all([
    ctx.supabase.from("order_items").select("*").eq("order_id", id).order("sort_order"),
    ctx.supabase.from("payments").select("*").eq("order_id", id).order("payment_date").order("created_at"),
    loadPaymentMethods(ctx),
  ]);
  const items = (itemRows ?? []) as OrderItem[];
  const payments = (paymentRows ?? []) as Payment[];
  const closed = order.status === "cancelled" || order.status === "returned";
  const recognized = Boolean(order.recognized_at);
  const due = Math.max(0, order.total - order.amount_paid);
  const refundDue = closed ? order.amount_paid : Math.max(0, order.amount_paid - order.total);
  const grossProfit = order.revenue_amount - order.cogs_total;
  const today = todayIn(ctx.business.timezone);
  const tax = ctx.business;
  const overdue = !closed && order.status !== "draft" && due > 0 && order.due_date && order.due_date < today;

  return (
    <>
      <PageHeader
        title={order.order_number}
        back={{ href: "/orders", label: "Orders & Sales" }}
        badge={
          <>
            <StatusBadge status={order.status} />
            {order.status !== "draft" && !closed && <StatusBadge status={order.payment_status} />}
            {overdue && <StatusBadge status="unpaid" label="Overdue" />}
            {order.is_demo && <DemoBadge />}
            {order.is_imported && <ImportedBadge />}
          </>
        }
        description={`${formatDate(order.order_date)} · ${order.customers?.name ?? "Walk-in customer"}`}
        actions={
          <>
            <ConfirmAction
              trigger={<Button variant="ghost"><Trash2 /> Delete</Button>}
              title={`Delete ${order.order_number}?`}
              description={
                <ul className="list-disc space-y-1 pl-5">
                  <li>The order is removed permanently.</li>
                  {order.stock_deducted && !order.stock_reversed && <li>Its items are put back into stock.</li>}
                  {payments.length > 0 && <li><span className="font-medium text-foreground">{payments.length} payment{payments.length === 1 ? "" : "s"}</span> recorded on it will be deleted too.</li>}
                  <li>This can&apos;t be undone.</li>
                </ul>
              }
              confirmLabel="Delete order"
              destructive
              action={deleteOrderAction.bind(null, order.id, payments.length > 0)}
              redirectTo="/orders"
            />
            {!closed && <Button variant="outline" asChild><Link href={`/orders/${order.id}/edit`}><Pencil /> Edit</Link></Button>}
            <OrderStatusActions
              orderId={order.id}
              status={order.status}
              recognized={recognized}
              deductionStatus={ctx.settings.inventory_deduction_status}
              tracksStock={items.some((i) => i.track_inventory)}
              amountPaid={order.amount_paid}
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Discount</TableHead>
                    {tax.tax_enabled && <TableHead className="hidden text-right md:table-cell">{tax.tax_label}</TableHead>}
                    <TableHead className="pr-6 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-6">
                        <Link href={`/inventory/${i.variant_id}`} className="font-medium hover:underline">{i.description}</Link>
                        {i.sku && <div className="text-xs text-muted-foreground">{i.sku}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular">{formatQty(i.quantity)}</TableCell>
                      <TableCell className="text-right"><Money value={i.unit_price} /></TableCell>
                      <TableCell className="hidden text-right sm:table-cell">{i.discount_amount + i.order_discount_share > 0 ? <Money value={i.discount_amount + i.order_discount_share} /> : "—"}</TableCell>
                      {tax.tax_enabled && <TableCell className="hidden text-right md:table-cell"><Money value={i.tax_amount} /><div className="text-xs text-muted-foreground">{formatPct(i.tax_rate)}</div></TableCell>}
                      <TableCell className="pr-6 text-right"><Money value={i.line_total} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="ml-auto max-w-xs px-6 pt-4">
                <TotalsPanel
                  rows={[
                    { label: "Subtotal", value: order.subtotal },
                    ...(order.discount_amount > 0 ? [{ label: "Order discount", value: order.discount_amount, negative: true }] : []),
                    ...(tax.tax_enabled ? [{ label: tax.prices_include_tax ? `${tax.tax_label} (included)` : tax.tax_label, value: order.tax_total, muted: tax.prices_include_tax }] : []),
                    ...(order.shipping_charge > 0 ? [{ label: "Shipping", value: order.shipping_charge }] : []),
                    { label: "Total", value: order.total, strong: true },
                  ]}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Payments</CardTitle>
              <div className="flex gap-2">
                {order.amount_paid > 0 && (
                  <PaymentDialog
                    direction="in"
                    kind="refund"
                    methods={methods}
                    today={today}
                    orderId={order.id}
                    suggestedAmount={refundDue > 0 ? refundDue : order.amount_paid}
                    trigger={<Button size="sm" variant="outline"><Undo2 /> Refund</Button>}
                  />
                )}
                {!closed && due > 0 && (
                  <PaymentDialog
                    direction="in"
                    methods={methods}
                    today={today}
                    orderId={order.id}
                    suggestedAmount={due}
                    defaultMethod={order.preferred_payment_method}
                    trigger={<Button size="sm"><Plus /> Record payment</Button>}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent className="px-0">
              <PaymentsTable payments={payments} methods={methods} today={today} />
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Balance</CardTitle></CardHeader>
            <CardContent>
              <TotalsPanel
                rows={[
                  { label: "Order total", value: closed ? 0 : order.total },
                  { label: "Paid", value: order.amount_paid },
                  { label: closed ? "Refund due" : "Amount due", value: closed ? refundDue : due, strong: true },
                ]}
              />
              {order.due_date && !closed && <p className="mt-3 text-xs text-muted-foreground">Payment due {formatDate(order.due_date)}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Profit</CardTitle></CardHeader>
            <CardContent>
              {recognized && !closed ? (
                <>
                  <TotalsPanel
                    rows={[
                      { label: "Revenue (excl. tax)", value: order.revenue_amount },
                      { label: "Cost of goods sold", value: order.cogs_total, negative: true },
                      { label: "Gross profit", value: grossProfit, strong: true },
                    ]}
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    {order.is_imported
                      ? "Imported from your earlier records. Its cost is ₹0 here because materials bought in that period were recorded as expenses, and it did not change stock."
                      : `Recorded as a sale on ${formatDateTime(order.recognized_at, ctx.business.timezone)}. Costs are frozen at that moment.`}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {closed
                    ? "This order is not counted as a sale."
                    : `Profit is calculated when the order reaches “${ctx.settings.inventory_deduction_status}”.`}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {order.customers ? (
                <div>
                  <Link href={`/customers/${order.customers.id}`} className="font-medium hover:underline">{order.customers.name}</Link>
                  <div className="text-muted-foreground">{[order.customers.phone, order.customers.email].filter(Boolean).join(" · ")}</div>
                  <div className="text-muted-foreground">{[order.customers.address, order.customers.city].filter(Boolean).join(", ")}</div>
                </div>
              ) : (
                <p className="text-muted-foreground">Walk-in customer</p>
              )}
              {order.preferred_payment_method && <p><span className="text-muted-foreground">Preferred payment:</span> {order.preferred_payment_method}</p>}
              {order.notes && <p className="rounded-md bg-muted p-3 whitespace-pre-line">{order.notes}</p>}
              <Button variant="outline" size="sm" asChild className="mt-2 justify-self-start">
                <Link href={`/print/order/${order.id}`} target="_blank"><Printer /> Print / PDF</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
