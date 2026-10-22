import type { Metadata } from "next";
import { OrderForm } from "@/components/orders/order-form";
import { PageHeader } from "@/components/page-header";
import { requireContext } from "@/lib/context";
import { addDays, todayIn } from "@/lib/dates";
import { loadCustomers, loadOffers, loadPaymentMethods, loadPickerItems } from "@/lib/queries/documents";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [items, customers, methods] = await Promise.all([loadPickerItems(ctx, "sale"), loadCustomers(ctx), loadPaymentMethods(ctx)]);
  const today = todayIn(ctx.business.timezone);
  const customer = typeof sp.customer === "string" && customers.some((c) => c.id === sp.customer) ? sp.customer : null;

  return (
    <>
      <PageHeader title="New order" back={{ href: "/orders", label: "Orders & Sales" }} />
      <OrderForm
        init={{
          id: null,
          customer_id: customer,
          order_date: today,
          due_date: addDays(today, ctx.settings.payment_due_days),
          status: ctx.settings.default_order_status === "confirmed" ? "confirmed" : "draft",
          discount_amount: "",
          shipping_charge: "",
          extra_charges: [],
          preferred_payment_method: "",
          notes: "",
          lines: [],
        }}
        items={items}
        customers={customers}
        paymentMethods={methods}
        tax={{ enabled: ctx.business.tax_enabled, label: ctx.business.tax_label, inclusive: ctx.business.prices_include_tax }}
        deductionStatus={ctx.settings.inventory_deduction_status}
        customersEnabled={ctx.settings.module_customers}
        country={ctx.business.country}
        offers={await loadOffers(ctx)}
      />
    </>
  );
}
