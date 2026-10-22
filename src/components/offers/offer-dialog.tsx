"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { ToggleRow } from "@/components/settings/business-profile-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveOfferAction } from "@/lib/actions/offers";
import type { Offer } from "@/lib/calc/offers";

type Opt = { id: string; name: string };

function CheckList({ options, value, onChange, empty }: { options: Opt[]; value: string[]; onChange: (v: string[]) => void; empty: string }) {
  if (options.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />
          <span className="truncate">{o.name}</span>
        </label>
      ))}
    </div>
  );
}

export function OfferDialog({ trigger, initial, categories, products }: { trigger: ReactNode; initial?: Offer & { notes?: string | null }; categories: Opt[]; products: Opt[] }) {
  const router = useRouter();
  const blank = { name: "", is_active: true, starts_on: "", ends_on: "", tiers: [{ min_qty: "2", discount_pct: "" }], category_ids: [] as string[], product_ids: [] as string[], exclude_product_ids: [] as string[], notes: "" };
  const fromInitial = () =>
    initial
      ? {
          name: initial.name, is_active: initial.is_active, starts_on: initial.starts_on ?? "", ends_on: initial.ends_on ?? "",
          tiers: initial.tiers.map((t) => ({ min_qty: String(t.min_qty), discount_pct: String(t.discount_pct) })),
          category_ids: initial.category_ids, product_ids: initial.product_ids, exclude_product_ids: initial.exclude_product_ids, notes: initial.notes ?? "",
        }
      : blank;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(fromInitial);
  const [pending, startTransition] = useTransition();
  const set = (p: Partial<typeof v>) => setV((s) => ({ ...s, ...p }));

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setV(fromInitial()); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit offer" : "New offer"}</DialogTitle>
          <DialogDescription>Pack discounts on MRP. Buying at least the pack size (sizes and variants can be mixed) gives that % off MRP on every qualifying item. Items without an MRP are never included.</DialogDescription>
        </DialogHeader>
        <form
          id="offer-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await saveOfferAction({ ...v, id: initial?.id ?? null });
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <Field label="Offer name" htmlFor="of-name" required>
            <Input id="of-name" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Regular candles" />
          </Field>
          <div className="grid gap-2">
            <p className="text-sm font-medium">Pack sizes</p>
            {v.tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Pack of</span>
                <Input aria-label="Pack size" className="w-20" type="number" min={1} value={t.min_qty} onChange={(e) => set({ tiers: v.tiers.map((x, j) => (j === i ? { ...x, min_qty: e.target.value } : x)) })} />
                <span className="text-muted-foreground">or more →</span>
                <Input aria-label="Discount %" className="w-24" type="number" min={0} max={100} step="any" value={t.discount_pct} onChange={(e) => set({ tiers: v.tiers.map((x, j) => (j === i ? { ...x, discount_pct: e.target.value } : x)) })} />
                <span className="text-muted-foreground">% off MRP</span>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove pack size" disabled={v.tiers.length === 1} onClick={() => set({ tiers: v.tiers.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ tiers: [...v.tiers, { min_qty: "", discount_pct: "" }] })}><Plus /> Add pack size</Button>
          </div>
          <Field label="Applies to categories">
            <CheckList options={categories} value={v.category_ids} onChange={(x) => set({ category_ids: x })} empty="No categories yet." />
          </Field>
          <Field label="…and these products (optional)" hint="Use this for items in another category, e.g. Winter Crème.">
            <CheckList options={products} value={v.product_ids} onChange={(x) => set({ product_ids: x })} empty="No products." />
          </Field>
          <Field label="Except these products (optional)">
            <CheckList options={products} value={v.exclude_product_ids} onChange={(x) => set({ exclude_product_ids: x })} empty="No products." />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts on (optional)" htmlFor="of-start"><Input id="of-start" type="date" value={v.starts_on} onChange={(e) => set({ starts_on: e.target.value })} /></Field>
            <Field label="Ends on (optional)" htmlFor="of-end"><Input id="of-end" type="date" value={v.ends_on} onChange={(e) => set({ ends_on: e.target.value })} /></Field>
          </div>
          <ToggleRow id="of-active" label="Active" description="Inactive offers are never applied." checked={v.is_active} onChange={(x) => set({ is_active: x })} />
          <Field label="Notes" htmlFor="of-notes"><Textarea id="of-notes" rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="offer-form" disabled={pending || !v.name.trim()}>{pending && <Loader2 className="animate-spin" />} Save offer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
