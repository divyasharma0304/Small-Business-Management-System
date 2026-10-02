import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, FileText, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { TotalsPanel } from "@/components/documents/lines-editor";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PaymentDialog } from "@/components/payments/payment-dialog";
import { PaymentsTable } from "@/components/payments/payments-table";
import { ReceiveDialog } from "@/components/purchases/receive-dialog";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deletePurchaseAction, setPurchaseStatusAction } from "@/lib/actions/purchases";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { loadPaymentMethods } from "@/lib/queries/documents";
import { signedUrl } from "@/lib/storage";
import type { Payment, Purchase, PurchaseItem, Supplier } from "@/lib/types";

export const metadata: Metadata = { title: "Purchase" };

export default async function PurchasePage({ params }: PageProps<"/purchases/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("purchases").select("*, suppliers(*)").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const purchase = data as Purchase & { suppliers: Supplier | null };

  const [{ data: itemRows }, { data: paymentRows }, methods, attachmentUrl] = await Promise.all([
    ctx.supabase.from("purchase_items").select("*").eq("purchase_id", id).order("sort_order"),
    ctx.supabase.from("payments").select("*").eq("purchase_id", id).order("payment_date"),
    loadPaymentMethods(ctx),
    signedUrl(ctx.supabase, purchase.attachment_path),
  ]);
  const items = (itemRows ?? []) as PurchaseItem[];
  const payments = (paymentRows ?? []) as Payment[];
  const anyReceived = items.some((i) => i.received_quantity > 0);
  const editable = ["draft", "ordered"].includes(purchase.status) && !anyReceived;
  const canReceive = ["draft", "ordered", "partially_received"].includes(purchase.status);
  const owed = purchase.status === "cancelled" ? 0 : Math.max(0, purchase.total - purchase.amount_paid);
  const today = todayIn(ctx.business.timezone);
  const tax = ctx.business;

  return (
    <>
      <PageHeader
        title={purchase.purchase_number}
        back={{ href: "/purchases", label: "Purchases" }}
        badge={
          <>
            <StatusBadge status={purchase.status} />
            {!["draft", "cancelled"].includes(purchase.status) && <StatusBadge status={purchase.payment_status} />}
            {purchase.is_demo && <DemoBadge />}
          </>
        }
        description={`${formatDate(purchase.purchase_date)} · ${purchase.suppliers?.name ?? "No supplier"}${purchase.invoice_number ? ` · Invoice ${purchase.invoice_number}` : ""}`}
        actions={
          <>
            {editable && payments.length === 0 && (
              <ConfirmAction trigger={<Button variant="ghost"><Trash2 /> Delete</Button>} title={`Delete ${purchase.purchase_number}?`} description="Nothing has been received, so the purchase can be deleted permanently." confirmLabel="Delete" destructive action={deletePurchaseAction.bind(null, purchase.id)} redirectTo="/purchases" />
            )}
            {editable && (
              <ConfirmAction trigger={<Button variant="ghost"><Ban /> Cancel</Button>} title="Cancel this purchase?" description="The purchase stays on record as cancelled. Nothing was received, so stock is unchanged." confirmLabel="Cancel purchase" destructive action={setPurchaseStatusAction.bind(null, purchase.id, "cancelled")} />
            )}
            {editable && <Button variant="outline" asChild><Link href={`/purchases/${purchase.id}/edit`}><Pencil /> Edit</Link></Button>}
            {purchase.status === "draft" && (
              <ConfirmAction trigger={<Button variant="outline"><Send /> Mark ordered</Button>} title="Mark as ordered?" description="Use this once you've placed the order with the supplier." confirmLabel="Mark ordered" action={setPurchaseStatusAction.bind(null, purchase.id, "ordered")} />
            )}
            {canReceive && <ReceiveDialog purchaseId={purchase.id} lines={items.map((i) => ({ id: i.id, description: i.description, quantity: Number(i.quantity), received_quantity: Number(i.received_quantity) }))} />}
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
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Landed cost</TableHead>
                    <TableHead className="pr-6 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-6"><Link href={`/inventory/${i.variant_id}`} className="font-medium hover:underline">{i.description}</Link></TableCell>
                      <TableCell className="text-right tabular">{formatQty(i.quantity)}</TableCell>
                      <TableCell className={`text-right tabular ${i.received_quantity >= i.quantity ? "text-success" : ""}`}>{formatQty(i.received_quantity)}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money value={i.unit_price} /></TableCell>
                      <TableCell className="hidden text-right md:table-cell"><Money value={i.landed_unit_cost} /></TableCell>
                      <TableCell className="pr-6 text-right"><Money value={i.line_total} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="px-6 pt-3 text-xs text-muted-foreground">
                Landed cost = unit cost after discounts{tax.tax_enabled && !tax.purchase_tax_recoverable ? `, plus ${tax.tax_label}` : ""}, plus a share of other charges. This is the cost that enters inventory.
              </p>
              <div className="ml-auto max-w-xs px-6 pt-4">
                <TotalsPanel
                  rows={[
                    { label: "Subtotal", value: purchase.subtotal },
                    ...(purchase.discount_amount > 0 ? [{ label: "Discount", value: purchase.discount_amount, negative: true }] : []),
                    ...(tax.tax_enabled ? [{ label: tax.tax_label, value: purchase.tax_total }] : []),
                    ...(purchase.other_charges > 0 ? [{ label: "Other charges", value: purchase.other_charges }] : []),
                    { label: "Total", value: purchase.total, strong: true },
                  ]}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Payments to supplier</CardTitle>
              {owed > 0 && purchase.status !== "draft" && (
                <PaymentDialog direction="out" methods={methods} today={today} purchaseId={purchase.id} suggestedAmount={owed} trigger={<Button size="sm"><Plus /> Record payment</Button>} />
              )}
            </CardHeader>
            <CardContent className="px-0"><PaymentsTable payments={payments} /></CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Balance</CardTitle></CardHeader>
            <CardContent>
              <TotalsPanel rows={[{ label: "Total", value: purchase.status === "cancelled" ? 0 : purchase.total }, { label: "Paid", value: purchase.amount_paid }, { label: "You owe", value: owed, strong: true }]} />
              {purchase.received_at && <p className="mt-3 text-xs text-muted-foreground">Last received {formatDateTime(purchase.received_at, ctx.business.timezone)}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {purchase.suppliers ? (
                <Link href={`/suppliers/${purchase.suppliers.id}`} className="font-medium hover:underline">{purchase.suppliers.name}</Link>
              ) : (
                <p className="text-muted-foreground">No supplier</p>
              )}
              {attachmentUrl && (
                <a href={attachmentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><FileText className="size-4" /> View invoice</a>
              )}
              {purchase.notes && <p className="rounded-md bg-muted p-3 whitespace-pre-line">{purchase.notes}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
