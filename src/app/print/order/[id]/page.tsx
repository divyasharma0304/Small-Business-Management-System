import { notFound } from "next/navigation";
import { Money } from "@/components/money";
import { requireContext } from "@/lib/context";
import { formatDate, formatPct, formatQty } from "@/lib/format";
import type { Customer, Order, OrderItem } from "@/lib/types";

/** Printable order / invoice. Labelled "Tax invoice" only when tax is enabled and a tax number is set. */
export default async function PrintOrderPage({ params }: PageProps<"/print/order/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("orders").select("*, customers(*)").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const order = data as Order & { customers: Customer | null };
  const { data: lineRows } = await ctx.supabase.from("order_items").select("*").eq("order_id", id).order("sort_order");
  const lines = (lineRows ?? []) as OrderItem[];
  const b = ctx.business;
  const c = order.customers;
  const title = b.tax_enabled && b.tax_number ? "Tax invoice" : order.status === "draft" ? "Quotation" : "Invoice";

  return (
    <article className="text-sm">
      <header className="mb-8 flex justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold">{b.name}</h1>
          <p className="whitespace-pre-line text-neutral-600">{[b.address, [b.city, b.state, b.postal_code].filter(Boolean).join(", "), b.country].filter(Boolean).join("\n")}</p>
          <p className="text-neutral-600">{[b.phone, b.email].filter(Boolean).join(" · ")}</p>
          {b.tax_enabled && b.tax_number && <p className="text-neutral-600">{b.tax_label}: {b.tax_number}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold uppercase tracking-wide text-neutral-700">{title}</p>
          <p>No. <span className="font-medium">{order.order_number}</span></p>
          <p>Date {formatDate(order.order_date)}</p>
          {order.due_date && <p>Due {formatDate(order.due_date)}</p>}
          {(order.status === "cancelled" || order.status === "returned") && <p className="font-semibold text-red-600 uppercase">{order.status}</p>}
        </div>
      </header>
      <section className="mb-6">
        <p className="text-xs text-neutral-500 uppercase">Bill to</p>
        {c ? (
          <>
            <p className="font-medium">{c.name}</p>
            <p className="whitespace-pre-line text-neutral-600">{[c.address, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join("\n")}</p>
            {c.tax_number && <p className="text-neutral-600">{b.tax_label}: {c.tax_number}</p>}
          </>
        ) : (
          <p>Walk-in customer</p>
        )}
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y text-left text-xs text-neutral-500 uppercase">
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Price</th>
            <th className="py-2 text-right">Discount</th>
            {b.tax_enabled && <th className="py-2 text-right">{b.tax_label}</th>}
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">{l.description}{l.sku && <span className="block text-xs text-neutral-500">{l.sku}</span>}</td>
              <td className="py-2 text-right tabular">{formatQty(l.quantity)}</td>
              <td className="py-2 text-right"><Money value={l.unit_price} /></td>
              <td className="py-2 text-right">{l.discount_amount + l.order_discount_share > 0 ? <Money value={l.discount_amount + l.order_discount_share} /> : "—"}</td>
              {b.tax_enabled && <td className="py-2 text-right"><Money value={l.tax_amount} /><span className="block text-xs text-neutral-500">{formatPct(l.tax_rate)}</span></td>}
              <td className="py-2 text-right"><Money value={l.line_total} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 ml-auto grid max-w-xs gap-1">
        <Row label="Subtotal" value={order.subtotal} />
        {order.discount_amount > 0 && <Row label="Discount" value={-order.discount_amount} />}
        {b.tax_enabled && <Row label={b.prices_include_tax ? `${b.tax_label} (included)` : b.tax_label} value={order.tax_total} />}
        {order.shipping_charge > 0 && <Row label="Shipping" value={order.shipping_charge} />}
        <div className="border-t pt-1"><Row label="Total" value={order.total} bold /></div>
        <Row label="Paid" value={order.amount_paid} />
        <Row label="Balance due" value={order.status === "cancelled" || order.status === "returned" ? 0 : Math.max(0, order.total - order.amount_paid)} bold />
      </dl>
      {order.notes && <p className="mt-8 whitespace-pre-line text-neutral-600">{order.notes}</p>}
      <p className="mt-12 text-center text-xs text-neutral-400">Thank you for your business.</p>
    </article>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd><Money value={value} /></dd>
    </div>
  );
}
