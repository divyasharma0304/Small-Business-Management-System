"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, PackageCheck, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { QuickItemDialog } from "@/components/catalog/quick-item-dialog";
import { LinesEditor, newLine, TotalsPanel, type LineDraft } from "@/components/documents/lines-editor";
import { Field, FormSection } from "@/components/forms/field";
import { FileUpload } from "@/components/forms/file-upload";
import type { PickerItem } from "@/components/forms/item-picker";
import { useCurrency } from "@/components/money";
import { SimpleSelect } from "@/components/forms/simple-select";
import { PartyDialog } from "@/components/parties/party-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { savePurchaseAction } from "@/lib/actions/purchases";
import { calcDocument } from "@/lib/calc/document";

export interface PurchaseDraftInit {
  id: string | null;
  supplier_id: string | null;
  purchase_date: string;
  invoice_number: string;
  status: "draft" | "ordered";
  discount_amount: string;
  other_charges: string;
  attachment_path: string | null;
  notes: string;
  lines: Omit<LineDraft, "key">[];
}

export function PurchaseForm({
  init,
  items: initialItems,
  suppliers: initialSuppliers,
  tax,
  suppliersEnabled,
  businessId,
  attachmentUrl,
  country,
  categories,
  units,
  defaultUnit,
  variantParents,
}: {
  init: PurchaseDraftInit;
  items: PickerItem[];
  suppliers: { id: string; name: string }[];
  tax: { enabled: boolean; label: string; recoverable: boolean };
  suppliersEnabled: boolean;
  businessId: string;
  attachmentUrl: string | null;
  country: string;
  categories: { id: string; name: string }[];
  units: string[];
  defaultUnit: string;
  variantParents: { id: string; name: string; unit: string }[];
}) {
  const router = useRouter();
  const { format } = useCurrency();
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [items, setItems] = useState(initialItems);
  const [p, setP] = useState(() => ({
    ...init,
    lines: init.lines.length ? init.lines.map((l) => ({ ...l, key: crypto.randomUUID() })) : [newLine()],
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const set = (x: Partial<typeof p>) => setP((s) => ({ ...s, ...x }));

  const calc = useMemo(
    () =>
      calcDocument(
        p.lines.filter((l) => l.variant_id).map((l) => ({
          quantity: Number(l.quantity || 0),
          unit_price: Number(l.unit_price || 0),
          discount_amount: Number(l.discount_amount || 0),
          tax_rate: Number(l.tax_rate || 0),
        })),
        Number(p.discount_amount || 0),
        false, // purchase prices are always entered excluding tax
        tax.enabled,
      ),
    [p.lines, p.discount_amount, tax.enabled],
  );
  const calcForRows = useMemo(() => {
    let j = 0;
    return { ...calc, lines: p.lines.map((l) => (l.variant_id ? calc.lines[j++] : undefined)) as typeof calc.lines };
  }, [calc, p.lines]);
  const charges = Number(p.other_charges || 0);
  const total = calc.lines_total + charges;
  const stockValue = calc.net_total + charges + (tax.recoverable ? 0 : calc.tax_total);

  function submit(status: "draft" | "ordered", receive = false) {
    const lines = p.lines.filter((l) => l.variant_id);
    if (lines.length === 0) {
      setErrors({ lines: "Add at least one item" });
      return;
    }
    startTransition(async () => {
      const res = await savePurchaseAction({
        id: p.id,
        supplier_id: p.supplier_id,
        purchase_date: p.purchase_date,
        invoice_number: p.invoice_number,
        status,
        discount_amount: p.discount_amount || 0,
        other_charges: p.other_charges || 0,
        attachment_path: p.attachment_path,
        notes: p.notes,
        receive_now: receive,
        lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price || 0, discount_amount: l.discount_amount || 0, tax_rate: l.tax_rate || 0 })),
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        if (res.error.startsWith("Purchase saved")) router.push("/purchases");
        return;
      }
      toast.success(res.message);
      router.push(`/purchases/${res.data.id}`);
      router.refresh();
    });
  }

  return (
    <form className="grid gap-6" onSubmit={(e) => { e.preventDefault(); submit(p.status); }} noValidate>
      <FormSection title="Purchase">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {suppliersEnabled && (
            <Field label="Supplier" htmlFor="supplier" className="sm:col-span-2">
              <div className="flex gap-2">
                <SimpleSelect id="supplier" value={p.supplier_id} allowNone noneLabel="No supplier" onChange={(v) => set({ supplier_id: v === "none" ? null : v })} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
                <PartyDialog
                  kind="supplier"
                  defaultCountry={country}
                  taxLabel={tax.label}
                  onSaved={(id, name) => {
                    setSuppliers((ss) => [...ss, { id, name }].sort((a, b) => a.name.localeCompare(b.name)));
                    set({ supplier_id: id });
                  }}
                  trigger={<Button type="button" variant="outline" size="icon" aria-label="Add new supplier"><Plus /></Button>}
                />
              </div>
            </Field>
          )}
          <Field label="Purchase date" htmlFor="pdate" error={errors.purchase_date}>
            <Input id="pdate" type="date" value={p.purchase_date} onChange={(e) => set({ purchase_date: e.target.value })} />
          </Field>
          <Field label="Supplier invoice no." htmlFor="inv">
            <Input id="inv" value={p.invoice_number} onChange={(e) => set({ invoice_number: e.target.value })} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Items" description={`Only stock-tracked items can be purchased here. Record other costs as expenses.${tax.enabled ? ` Enter costs excluding ${tax.label}.` : ""}`}>
        <LinesEditor
          mode="purchase"
          items={items}
          lines={p.lines}
          onChange={(lines) => set({ lines })}
          calc={calcForRows}
          taxEnabled={tax.enabled}
          taxLabel={tax.label}
          errors={errors}
          toolbar={
            <QuickItemDialog
              categories={categories}
              units={units}
              defaultUnit={defaultUnit}
              variantParents={variantParents}
              onCreated={(item) => {
                setItems((xs) => [...xs, item].sort((a, b) => a.item_name.localeCompare(b.item_name)));
                // Put the new item on the first empty line, or add a line for it.
                setP((s) => {
                  const empty = s.lines.findIndex((l) => !l.variant_id);
                  const filled = { ...newLine(), variant_id: item.variant_id, unit_price: "", tax_rate: "0" };
                  const lines = empty >= 0 ? s.lines.map((l, i) => (i === empty ? { ...filled, key: l.key, quantity: l.quantity } : l)) : [...s.lines, filled];
                  return { ...s, lines };
                });
              }}
            />
          }
        />
        <p className="text-xs text-muted-foreground">
          Fill in <span className="font-medium">either</span> the cost per unit or the line total — the other is calculated. Example: 100 ml of colour for ₹96 → Qty 100, Line total 96 (= ₹0.96 per ml).
        </p>
        <p className="text-xs text-muted-foreground">Buying something new? Use <span className="font-medium">New item</span> — don&apos;t also enter it as opening stock, or it will be counted twice.</p>
      </FormSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <FormSection title="Other details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount" htmlFor="pdisc" error={errors.discount_amount}>
              <Input id="pdisc" type="number" min={0} step="0.01" value={p.discount_amount} onChange={(e) => set({ discount_amount: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Freight / other charges" htmlFor="pcharges" error={errors.other_charges} hint="Added to the items' cost.">
              <Input id="pcharges" type="number" min={0} step="0.01" value={p.other_charges} onChange={(e) => set({ other_charges: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Invoice / bill" className="sm:col-span-2">
              <FileUpload businessId={businessId} folder="purchases" kind="document" value={p.attachment_path} previewUrl={attachmentUrl} onChange={(path) => set({ attachment_path: path })} label="Attach file" />
            </Field>
            <Field label="Notes" htmlFor="pnotes" className="sm:col-span-2">
              <Textarea id="pnotes" rows={3} value={p.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Summary">
          <TotalsPanel
            rows={[
              { label: "Subtotal", value: calc.subtotal },
              ...(calc.discount > 0 ? [{ label: "Discount", value: calc.discount, negative: true }] : []),
              ...(tax.enabled ? [{ label: tax.label, value: calc.tax_total }] : []),
              ...(charges > 0 ? [{ label: "Other charges", value: charges }] : []),
              { label: "Total payable", value: total, strong: true },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Value added to stock when received: <span className="font-medium text-foreground">{format(stockValue)}</span>
            {tax.enabled && (tax.recoverable ? ` (${tax.label} excluded — it is recoverable)` : ` (includes ${tax.label} — not recoverable)`)}.
          </p>
        </FormSection>
      </div>

      <div className="sticky bottom-0 -mx-3 flex flex-wrap justify-end gap-2 border-t bg-background/90 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => submit("draft")}>Save as draft</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => submit("ordered")}>
          <Save /> Save as ordered
        </Button>
        <Button type="button" disabled={pending} onClick={() => submit("ordered", true)}>
          {pending ? <Loader2 className="animate-spin" /> : <PackageCheck />} Save & receive all
        </Button>
      </div>
    </form>
  );
}
