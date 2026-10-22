"use client";

import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";

const pctOf = (mrp: string, price: string) => {
  const m = Number(mrp);
  const p = Number(price);
  if (!(m > 0) || price === "" || !(p >= 0)) return "";
  return String(Math.round(((m - p) / m) * 1000) / 10);
};

/**
 * MRP, discount % and selling price. Enter any two: typing the discount sets
 * the price (MRP × (1 − %), rounded to the rupee); typing the price shows the %.
 */
export function PriceFields({ id, mrp, price, onChange, symbol, error, compact }: {
  id: string;
  mrp: string;
  price: string;
  onChange: (p: { mrp?: string; selling_price?: string }) => void;
  symbol: string;
  error?: string;
  compact?: boolean;
}) {
  const pct = pctOf(mrp, price);
  const over = Number(mrp) > 0 && Number(price) > Number(mrp);
  return (
    <>
      <Field label={`MRP (${symbol})`} htmlFor={`mrp-${id}`} hint={compact ? undefined : "Optional. Offers are calculated on MRP."}>
        <Input id={`mrp-${id}`} type="number" min={0} step="0.01" inputMode="decimal" value={mrp} onChange={(e) => onChange({ mrp: e.target.value })} />
      </Field>
      <Field label="Discount %" htmlFor={`pct-${id}`} hint={compact ? undefined : "Your everyday discount off MRP."}>
        <Input
          id={`pct-${id}`}
          type="number"
          min={0}
          max={100}
          step="any"
          disabled={!(Number(mrp) > 0)}
          placeholder={Number(mrp) > 0 ? "0" : "Set MRP first"}
          value={pct}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") return onChange({ selling_price: mrp });
            onChange({ selling_price: String(Math.round(Number(mrp) * (1 - Number(v) / 100))) });
          }}
        />
      </Field>
      <Field label={`Selling price (${symbol})`} htmlFor={`price-${id}`} error={error ?? (over ? "Higher than MRP" : undefined)}>
        <Input id={`price-${id}`} type="number" min={0} step="0.01" inputMode="decimal" value={price} onChange={(e) => onChange({ selling_price: e.target.value })} aria-invalid={!!error || over} />
      </Field>
    </>
  );
}
