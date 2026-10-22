import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OrderForm } from "@/components/orders/order-form";
import { PageHeader } from "@/components/page-header";
import { requireContext } from "@/lib/context";
import { loadCustomers, loadPaymentMethods, loadPickerItems } from "@/lib/queries/documents";
import type { Order, OrderItem } from "@/lib/types";

export const metadata: Metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: PageProps<"/orders/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("orders").select("*").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const order = data as Order;
  if (["cancelled", "returned"].includes(order.status)) redirect(`/orders/${id}`);

  const [{ data: lineRows }, items, customers, methods] = await Promise.all([
    ctx.supabase.from("order_items").select("*").eq("order_id", id).order("sort_order"),
    loadPickerItems(ctx, "sale"),
    loadCustomers(ctx),
    loadPaymentMethods(ctx),
  ]);
  const lines = (lineRows ?? []) as OrderItem[];
  // Items that have since been deactivated still need to show on this order.
  const missing = lines.filter((l) => !items.some((i) => i.variant_id === l.variant_id));
  const allItems = [
    ...items,
    ...missing.map((l) => ({ variant_id: l.variant_id, item_name: `${l.description} (inactive)`, sku: l.sku, item_type: "product", unit: "", tax_rate: l.tax_rate, track_inventory: l.track_inventory, selling_price: l.unit_price, cost_price: 0, stock_quantity: null, avg_cost: null, highest_cost: null })),
  ];

  return (
    <>
      <PageHeader title={`Edit ${order.order_number}`} back={{ href: `/orders/${id}`, label: order.order_number }} />
      {order.recognized_at && !order.is_imported && (
        <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          This order is already recorded as a sale. When you save, its items are put back into stock, your changes are saved, and the sale is recorded again at today&apos;s stock cost — all in one step. Payments stay as they are.
        </p>
      )}
      <OrderForm
        init={{
          id: order.id,
          customer_id: order.customer_id,
          order_date: order.order_date,
          due_date: order.due_date ?? "",
          status: "draft",
          discount_amount: order.discount_amount ? String(order.discount_amount) : "",
          shipping_charge: order.shipping_charge ? String(order.shipping_charge) : "",
          preferred_payment_method: order.preferred_payment_method ?? "",
          notes: order.notes ?? "",
          lines: lines.map((l) => ({
            variant_id: l.variant_id,
            quantity: String(l.quantity),
            unit_price: String(l.unit_price),
            discount_amount: l.discount_amount ? String(l.discount_amount) : "",
            tax_rate: String(l.tax_rate),
          })),
        }}
        items={allItems}
        customers={customers}
        paymentMethods={methods}
        tax={{ enabled: ctx.business.tax_enabled, label: ctx.business.tax_label, inclusive: ctx.business.prices_include_tax }}
        deductionStatus={ctx.settings.inventory_deduction_status}
        customersEnabled={ctx.settings.module_customers}
        country={ctx.business.country}
      />
    </>
  );
}
