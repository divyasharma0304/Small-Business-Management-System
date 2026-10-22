"use client";

import type React from "react";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { ItemPicker, type PickerItem } from "@/components/forms/item-picker";
import { useCurrency } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CalcResult } from "@/lib/calc/document";
import { formatQty } from "@/lib/format";

export interface LineDraft {
  key: string;
  variant_id: string | null;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_rate: string;
  /**
   * Purchases only: the line total as typed by the user (e.g. "96" for 100 ml).
   * While set, the unit cost is derived from it: unit cost = total ÷ qty.
   */
  amount?: string;
  /** Sales: pack offer applied to this line. */
  offer_id?: string | null;
  offer_label?: string | null;
  /** Sales: price typed by hand — offers leave it alone. */
  price_locked?: boolean;
}

/** Unit cost from a typed line total, to 4 decimals (e.g. ₹96 ÷ 100 ml = 0.96). */
function unitFromTotal(total: string, qty: string) {
  const q = Number(qty || 0);
  if (total.trim() === "" || !(q > 0)) return "";
  return String(Math.round((Number(total) / q) * 10000) / 10000);
}

export const newLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  variant_id: null,
  quantity: "1",
  unit_price: "",
  discount_amount: "",
  tax_rate: "0",
});

export function LinesEditor({
  mode,
  items,
  lines,
  onChange,
  calc,
  taxEnabled,
  taxLabel,
  errors,
  checkStock,
  toolbar,
}: {
  mode: "sale" | "purchase";
  items: PickerItem[];
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  calc: CalcResult;
  taxEnabled: boolean;
  taxLabel: string;
  errors: Record<string, string>;
  checkStock?: boolean;
  /** Extra controls shown next to "Add line" (e.g. creating a new item). */
  toolbar?: React.ReactNode;
}) {
  const { format } = useCurrency();
  const byId = new Map(items.map((i) => [i.variant_id, i]));
  const patch = (key: string, p: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));

  function pick(key: string, item: PickerItem) {
    patch(key, {
      variant_id: item.variant_id,
      unit_price: String(mode === "sale" ? item.selling_price : Math.max(item.highest_cost ?? 0, item.avg_cost ?? 0, item.cost_price ?? 0)),
      tax_rate: taxEnabled ? String(item.tax_rate ?? 0) : "0",
      amount: undefined,
      offer_id: null,
      offer_label: null,
      price_locked: false,
    });
  }

  // Total quantity requested per item (the same item may appear on several lines)
  const requested = new Map<string, number>();
  for (const l of lines) if (l.variant_id) requested.set(l.variant_id, (requested.get(l.variant_id) ?? 0) + Number(l.quantity || 0));

  return (
    <div className="grid gap-3">
      <div className="hidden grid-cols-[minmax(0,1fr)_90px_120px_110px_80px_110px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid">
        <span>Item</span>
        <span>Qty</span>
        <span>{mode === "sale" ? "Unit price" : "Cost per unit"}</span>
        <span>Discount</span>
        <span>{taxEnabled ? `${taxLabel} %` : ""}</span>
        <span className={mode === "sale" ? "text-right" : ""}>{mode === "sale" ? "Amount" : "Line total"}</span>
        <span />
      </div>
      {lines.map((l, i) => {
        const item = l.variant_id ? byId.get(l.variant_id) : undefined;
        const c = calc.lines[i];
        const short = checkStock && item?.track_inventory && (requested.get(item.variant_id) ?? 0) > Number(item.stock_quantity ?? 0);
        return (
          <div key={l.key} className="grid gap-2 rounded-lg border p-2 lg:grid-cols-[minmax(0,1fr)_90px_120px_110px_80px_110px_36px] lg:items-start lg:border-0 lg:p-0">
            <div>
              <ItemPicker items={items} value={l.variant_id} onChange={(it) => pick(l.key, it)} invalid={!!errors[`lines.${i}.variant_id`]} />
              {item && (
                <p className="mt-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
                  {item.track_inventory ? (
                    <span className={short ? "flex items-center gap-1 text-destructive" : ""}>
                      {short && <AlertTriangle className="size-3" />}
                      In stock: {formatQty(item.stock_quantity ?? 0, item.unit)}
                    </span>
                  ) : (
                    <span>{item.item_type === "service" ? "Service" : "Stock not tracked"}</span>
                  )}
                  {mode === "sale" && item.mrp ? <span className="ml-2">· MRP {format(item.mrp)}</span> : null}
                </p>
              )}
              {mode === "sale" && l.offer_label && <p className="px-1 text-xs font-medium text-success">{l.offer_label}</p>}
              {mode === "sale" && l.price_locked && item?.mrp ? (
                <button type="button" className="px-1 text-xs text-primary hover:underline" onClick={() => patch(l.key, { price_locked: false })}>
                  Price set by hand — use offers/standard price
                </button>
              ) : null}
            </div>
            <LabeledInput
              label="Qty"
              value={l.quantity}
              onChange={(v) => patch(l.key, l.amount !== undefined ? { quantity: v, unit_price: unitFromTotal(l.amount, v) } : { quantity: v })}
              step="any"
              invalid={!!errors[`lines.${i}.quantity`]}
            />
            <LabeledInput
              label={mode === "sale" ? "Unit price" : "Cost per unit"}
              value={l.unit_price}
              onChange={(v) => patch(l.key, mode === "sale" ? { unit_price: v, amount: undefined, price_locked: true, offer_id: null, offer_label: null } : { unit_price: v, amount: undefined })}
              step="any"
              invalid={!!errors[`lines.${i}.unit_price`]}
            />
            <LabeledInput label="Discount" value={l.discount_amount} onChange={(v) => patch(l.key, { discount_amount: v })} step="0.01" placeholder="0" invalid={!!errors[`lines.${i}.discount_amount`]} />
            {taxEnabled ? (
              <LabeledInput label={`${taxLabel} %`} value={l.tax_rate} onChange={(v) => patch(l.key, { tax_rate: v })} step="any" invalid={!!errors[`lines.${i}.tax_rate`]} />
            ) : (
              <span className="hidden lg:block" />
            )}
            {mode === "purchase" ? (
              <div>
                <LabeledInput
                  label="Line total"
                  value={l.amount ?? (l.unit_price !== "" && Number(l.quantity) > 0 ? String(Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100) : "")}
                  onChange={(v) => patch(l.key, { amount: v, unit_price: unitFromTotal(v, l.quantity) })}
                  step="0.01"
                  placeholder="0"
                />
                {c && c.tax > 0 && <span className="block px-1 pt-1 text-xs text-muted-foreground tabular">+ {taxLabel} {format(c.tax)} = {format(c.total)}</span>}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 lg:block lg:pt-1.5 lg:text-right">
                <span className="text-xs text-muted-foreground lg:hidden">Amount</span>
                <span className="font-medium tabular">{format(c?.total ?? 0)}</span>
                {c && c.tax > 0 && <span className="block text-xs text-muted-foreground tabular">incl. {taxLabel} {format(c.tax)}</span>}
              </div>
            )}
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(lines.filter((x) => x.key !== l.key))} disabled={lines.length === 1} className="justify-self-end">
              <Trash2 />
            </Button>
          </div>
        );
      })}
      {errors.lines && <p className="text-sm text-destructive">{errors.lines}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, newLine()])}>
          <Plus /> Add line
        </Button>
        {toolbar}
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, step, placeholder, invalid }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <label className="grid grid-cols-[90px_1fr] items-center gap-2 lg:block">
      <span className="text-xs text-muted-foreground lg:sr-only">{label}</span>
      <Input type="number" inputMode="decimal" min={0} step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-label={label} />
    </label>
  );
}

export function TotalsPanel({ rows }: { rows: { label: string; value: number; strong?: boolean; muted?: boolean; negative?: boolean }[] }) {
  const { format } = useCurrency();
  return (
    <dl className="grid gap-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.label} className={`flex justify-between gap-4 ${r.strong ? "border-t pt-2 text-base font-semibold" : ""} ${r.muted ? "text-muted-foreground" : ""}`}>
          <dt>{r.label}</dt>
          <dd className="tabular">{r.negative && r.value > 0 ? "−" : ""}{format(r.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
