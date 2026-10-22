"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LinesEditor, newLine, TotalsPanel, type LineDraft } from "@/components/documents/lines-editor";
import { Field, FormSection } from "@/components/forms/field";
import type { PickerItem } from "@/components/forms/item-picker";
import { SimpleSelect } from "@/components/forms/simple-select";
import { PartyDialog } from "@/components/parties/party-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveOrderAction } from "@/lib/actions/orders";
import { calcDocument } from "@/lib/calc/document";
import { useCurrency } from "@/components/money";
import { applyOffers, type Offer, type OfferItem } from "@/lib/calc/offers";
import { ToggleRow } from "@/components/settings/business-profile-fields";

export interface OrderDraftInit {
  id: string | null;
  customer_id: string | null;
  order_date: string;
  due_date: string;
  status: "draft" | "confirmed";
  discount_amount: string;
  shipping_charge: string;
  extra_charges: { label: string; amount: string }[];
  preferred_payment_method: string;
  notes: string;
  lines: Omit<LineDraft, "key">[];
}

export function OrderForm({
  init,
  items,
  customers: initialCustomers,
  paymentMethods,
  tax,
  deductionStatus,
  customersEnabled,
  country,
  offers,
}: {
  init: OrderDraftInit;
  items: PickerItem[];
  customers: { id: string; name: string }[];
  paymentMethods: string[];
  tax: { enabled: boolean; label: string; inclusive: boolean };
  deductionStatus: string;
  customersEnabled: boolean;
  country: string;
  offers: Offer[];
}) {
  const router = useRouter();
  const { format } = useCurrency();
  const [customers, setCustomers] = useState(initialCustomers);
  const [o, setO] = useState(() => ({
    ...init,
    lines: init.lines.length ? init.lines.map((l) => ({ ...l, key: crypto.randomUUID() })) : [newLine()],
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const set = (p: Partial<typeof o>) => setO((s) => ({ ...s, ...p }));
  // Offers apply automatically to new orders; on existing orders you switch it on.
  const [autoOffers, setAutoOffers] = useState(!init.id);
  const offerItems = useMemo(
    () => new Map<string, OfferItem>(items.filter((i) => i.product_id).map((i) => [i.variant_id, { variant_id: i.variant_id, product_id: i.product_id!, category_id: i.category_id ?? null, mrp: i.mrp ?? null, selling_price: i.selling_price }])),
    [items],
  );
  const withOffers = (lines: typeof o.lines, date: string, on: boolean) => applyOffers(lines, offerItems, on ? offers : [], date);
  const setLines = (lines: typeof o.lines) => setO((s) => ({ ...s, lines: autoOffers ? withOffers(lines, s.order_date, true) : lines }));
  const mrpTotal = o.lines.reduce((a, l) => {
    const it = l.variant_id ? offerItems.get(l.variant_id) : undefined;
    return a + (it?.mrp ? Number(it.mrp) * Number(l.quantity || 0) : Number(l.unit_price || 0) * Number(l.quantity || 0));
  }, 0);

  const calc = useMemo(
    () =>
      calcDocument(
        o.lines.filter((l) => l.variant_id).map((l) => ({
          quantity: Number(l.quantity || 0),
          unit_price: Number(l.unit_price || 0),
          discount_amount: Number(l.discount_amount || 0),
          tax_rate: Number(l.tax_rate || 0),
        })),
        Number(o.discount_amount || 0),
        tax.inclusive,
        tax.enabled,
      ),
    [o.lines, o.discount_amount, tax.inclusive, tax.enabled],
  );
  // Align calc lines with all rows (rows without an item show 0)
  const calcForRows = useMemo(() => {
    let j = 0;
    // Keep one entry per row (undefined for rows without an item) so indexes line up.
    return { ...calc, lines: o.lines.map((l) => (l.variant_id ? calc.lines[j++] : undefined)) as typeof calc.lines };
  }, [calc, o.lines]);
  const shipping = Number(o.shipping_charge || 0);
  const extra = o.extra_charges.reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const total = calc.lines_total + shipping + extra;

  function submit(status?: "draft" | "confirmed") {
    const lines = o.lines.filter((l) => l.variant_id);
    if (lines.length === 0) {
      setErrors({ lines: "Add at least one item" });
      return;
    }
    const payload = {
      id: o.id,
      customer_id: o.customer_id,
      order_date: o.order_date,
      due_date: o.due_date || null,
      status: o.id ? undefined : (status ?? o.status),
      discount_amount: o.discount_amount || 0,
      shipping_charge: o.shipping_charge || 0,
      extra_charges: o.extra_charges.filter((c) => c.label.trim() || c.amount).map((c) => ({ label: c.label, amount: c.amount || 0 })),
      preferred_payment_method: o.preferred_payment_method || null,
      notes: o.notes,
      lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price || 0, discount_amount: l.discount_amount || 0, tax_rate: l.tax_rate || 0, offer_id: l.offer_id ?? null, offer_label: l.offer_label ?? null })),
    };
    startTransition(async () => {
      const res = await saveOrderAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/orders/${res.data.id}`);
      router.refresh();
    });
  }

  const confirmRecognises = deductionStatus === "confirmed";

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <FormSection title="Order">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {customersEnabled && (
            <Field label="Customer" htmlFor="customer" className="sm:col-span-2" hint="Leave empty for a walk-in sale.">
              <div className="flex gap-2">
                <SimpleSelect
                  id="customer"
                  value={o.customer_id}
                  allowNone
                  noneLabel="Walk-in / no customer"
                  onChange={(v) => set({ customer_id: v === "none" ? null : v })}
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
                <PartyDialog
                  kind="customer"
                  defaultCountry={country}
                  taxLabel={tax.label}
                  onSaved={(id, name) => {
                    setCustomers((cs) => [...cs, { id, name }].sort((a, b) => a.name.localeCompare(b.name)));
                    set({ customer_id: id });
                  }}
                  trigger={<Button type="button" variant="outline" size="icon" aria-label="Add new customer"><Plus /></Button>}
                />
              </div>
            </Field>
          )}
          <Field label="Order date" htmlFor="order_date" error={errors.order_date}>
            <Input id="order_date" type="date" value={o.order_date} onChange={(e) => { const d = e.target.value; setO((s) => ({ ...s, order_date: d, lines: autoOffers ? withOffers(s.lines, d, true) : s.lines })); }} />
          </Field>
          <Field label="Payment due" htmlFor="due_date" error={errors.due_date}>
            <Input id="due_date" type="date" value={o.due_date} onChange={(e) => set({ due_date: e.target.value })} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Items" description={tax.enabled ? (tax.inclusive ? `Prices include ${tax.label}.` : `${tax.label} is added on top of prices.`) : undefined}>
        <LinesEditor mode="sale" items={items} lines={o.lines} onChange={setLines} calc={calcForRows} taxEnabled={tax.enabled} taxLabel={tax.label} errors={errors} checkStock />
        {offers.length > 0 && (
          <ToggleRow
            id="auto-offers"
            label="Apply offers automatically"
            description={offers.filter((x) => x.is_active).map((x) => x.name).join(", ") || "No active offers"}
            checked={autoOffers}
            onChange={(v) => { setAutoOffers(v); setO((s) => ({ ...s, lines: withOffers(s.lines, s.order_date, v) })); }}
          />
        )}
      </FormSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <FormSection title="Other details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Order discount" htmlFor="discount" error={errors.discount_amount} hint="Amount off the whole order.">
              <Input id="discount" type="number" min={0} step="0.01" value={o.discount_amount} onChange={(e) => set({ discount_amount: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Shipping / delivery charge" htmlFor="shipping" error={errors.shipping_charge}>
              <Input id="shipping" type="number" min={0} step="0.01" value={o.shipping_charge} onChange={(e) => set({ shipping_charge: e.target.value })} placeholder="0" />
            </Field>
            <div className="grid gap-2 sm:col-span-2">
              <p className="text-sm font-medium">Extra charges</p>
              {o.extra_charges.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label="Charge name" list="extra-charge-names" placeholder="e.g. White labelling" value={c.label} onChange={(e) => set({ extra_charges: o.extra_charges.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-invalid={!!errors[`extra_charges.${i}.label`]} />
                  <Input aria-label="Charge amount" className="w-32" type="number" min={0} step="0.01" placeholder="0" value={c.amount} onChange={(e) => set({ extra_charges: o.extra_charges.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove charge" onClick={() => set({ extra_charges: o.extra_charges.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <datalist id="extra-charge-names">
                {["White labelling", "Custom design", "Custom packaging", "Gift wrapping", "Personalised message", "Rush order"].map((n) => <option key={n} value={n} />)}
              </datalist>
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ extra_charges: [...o.extra_charges, { label: "", amount: "" }] })}>
                <Plus /> Add extra charge
              </Button>
            </div>
            <Field label="Preferred payment method" htmlFor="pm">
              <SimpleSelect id="pm" value={o.preferred_payment_method || null} allowNone noneLabel="Not specified" onChange={(v) => set({ preferred_payment_method: v === "none" ? "" : v })} options={paymentMethods.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
              <Textarea id="notes" rows={3} value={o.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Summary">
          <TotalsPanel
            rows={[
              { label: "Subtotal", value: calc.subtotal },
              ...(calc.discount > 0 ? [{ label: "Order discount", value: calc.discount, negative: true }] : []),
              ...(tax.enabled ? [{ label: tax.inclusive ? `${tax.label} (included)` : tax.label, value: calc.tax_total, muted: tax.inclusive }] : []),
              ...(shipping > 0 ? [{ label: "Shipping", value: shipping }] : []),
              ...o.extra_charges.filter((c) => Number(c.amount) > 0).map((c) => ({ label: c.label || "Extra charge", value: Number(c.amount) })),
              { label: "Total", value: total, strong: true },
            ]}
          />
          {mrpTotal - (calc.subtotal - calc.discount) > 0.5 && (
            <p className="text-sm text-success">Customer saves {format(mrpTotal - (calc.subtotal - calc.discount))} on MRP ({format(mrpTotal)})</p>
          )}
          {calc.errors.length > 0 && <p className="text-sm text-destructive">{calc.errors[0]}</p>}
          <p className="text-xs text-muted-foreground">
            Payments are recorded separately after saving. Stock is deducted and the sale recorded when the order reaches “{deductionStatus}”.
          </p>
        </FormSection>
      </div>

      <div className="sticky bottom-0 -mx-3 flex flex-wrap justify-end gap-2 border-t bg-background/90 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        {o.id ? (
          <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save changes</Button>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={pending} onClick={() => submit("draft")}>Save as draft</Button>
            <Button type="button" disabled={pending} onClick={() => submit("confirmed")}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} {confirmRecognises ? "Confirm order" : "Save & confirm"}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
