"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { SimpleSelect } from "@/components/forms/simple-select";
import { useCurrency } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adjustStockAction, recordWastageAction, updateStockLevelsAction } from "@/lib/actions/inventory";
import { formatQty } from "@/lib/format";
import type { ActionResult } from "@/lib/types";

export interface StockItem {
  variant_id: string;
  item_name: string;
  unit: string;
  quantity: number;
  avg_cost: number;
  min_stock?: number;
  max_stock?: number | null;
  location?: string | null;
}

function useDialogAction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      setErrors({});
      setOpen(false);
      router.refresh();
    });
  }
  return { open, setOpen, errors, pending, run };
}

export function AdjustStockDialog({ item, trigger }: { item: StockItem; trigger: ReactNode }) {
  const { open, setOpen, errors, pending, run } = useDialogAction();
  const { format, symbol } = useCurrency();
  const [mode, setMode] = useState<"add" | "remove" | "set">("set");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [lot, setLot] = useState("");
  const n = Number(qty || 0);
  const after = mode === "add" ? item.quantity + n : mode === "remove" ? item.quantity - n : n;
  const adding = after > item.quantity;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>{item.item_name} — currently {formatQty(item.quantity, item.unit)}. Every adjustment is recorded in the stock history.</DialogDescription>
        </DialogHeader>
        <form
          id="adjust-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => adjustStockAction({ variant_id: item.variant_id, mode, quantity: qty, unit_cost: adding ? cost : null, notes, batch_lot: lot }));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Adjustment" htmlFor="adj-mode">
              <SimpleSelect id="adj-mode" value={mode} onChange={(v) => setMode(v as typeof mode)} options={[
                { value: "set", label: "Set counted quantity" },
                { value: "add", label: "Add stock" },
                { value: "remove", label: "Remove stock" },
              ]} />
            </Field>
            <Field label={mode === "set" ? "Counted quantity" : "Quantity"} htmlFor="adj-qty" error={errors.quantity}>
              <Input id="adj-qty" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
            </Field>
          </div>
          {adding && (
            <Field label={`Unit cost of added stock (${symbol})`} htmlFor="adj-cost" hint={`Leave empty to use the current average cost (${format(item.avg_cost)}).`} error={errors.unit_cost}>
              <Input id="adj-cost" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
          )}
          <Field label="Reason" htmlFor="adj-notes" required error={errors.notes}>
            <Textarea id="adj-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Monthly stock count" />
          </Field>
          <Field label="Batch / lot (optional)" htmlFor="adj-lot">
            <Input id="adj-lot" value={lot} onChange={(e) => setLot(e.target.value)} />
          </Field>
          {qty !== "" && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              New stock: <span className="font-medium tabular">{formatQty(after, item.unit)}</span>
              {after < 0 && <span className="text-destructive"> — below zero</span>}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="adjust-form" disabled={pending || qty === ""}>
            {pending && <Loader2 className="animate-spin" />} Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const WASTAGE_REASONS = [
  { value: "damage", label: "Damage" },
  { value: "spillage", label: "Spillage" },
  { value: "production_failure", label: "Production failure" },
  { value: "broken", label: "Broken item" },
  { value: "expired", label: "Expired stock" },
  { value: "packaging_loss", label: "Packaging loss" },
  { value: "other", label: "Other" },
];

export function WastageDialog({ items, trigger, today, defaultVariant }: { items: StockItem[]; trigger: ReactNode; today: string; defaultVariant?: string }) {
  const { open, setOpen, errors, pending, run } = useDialogAction();
  const [variant, setVariant] = useState(defaultVariant ?? "");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("damage");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const item = items.find((i) => i.variant_id === variant);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record wastage</DialogTitle>
          <DialogDescription>Removes the quantity from stock and records its value as a loss.</DialogDescription>
        </DialogHeader>
        <form
          id="wastage-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => recordWastageAction({ variant_id: variant, quantity: qty, reason, date, notes }));
          }}
        >
          <Field label="Item" htmlFor="w-item" error={errors.variant_id}>
            <SimpleSelect id="w-item" value={variant || undefined} onChange={setVariant} placeholder="Choose an item" options={items.map((i) => ({ value: i.variant_id, label: i.item_name, hint: formatQty(i.quantity, i.unit) }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="w-qty" error={errors.quantity} hint={item ? `Available: ${formatQty(item.quantity, item.unit)}` : undefined}>
              <Input id="w-qty" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor="w-date" error={errors.date}>
              <Input id="w-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" htmlFor="w-reason">
            <SimpleSelect id="w-reason" value={reason} onChange={setReason} options={WASTAGE_REASONS} />
          </Field>
          <Field label="Notes" htmlFor="w-notes">
            <Textarea id="w-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="wastage-form" disabled={pending || !variant || !qty}>
            {pending && <Loader2 className="animate-spin" />} Record wastage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StockLevelsDialog({ item, trigger }: { item: StockItem; trigger: ReactNode }) {
  const { open, setOpen, errors, pending, run } = useDialogAction();
  const [min, setMin] = useState(String(item.min_stock ?? 0));
  const [max, setMax] = useState(item.max_stock == null ? "" : String(item.max_stock));
  const [location, setLocation] = useState(item.location ?? "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stock levels</DialogTitle>
          <DialogDescription>{item.item_name}</DialogDescription>
        </DialogHeader>
        <form id="levels-form" className="grid gap-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); run(() => updateStockLevelsAction({ variant_id: item.variant_id, min_stock: min, max_stock: max, location })); }}>
          <Field label="Minimum" htmlFor="l-min" error={errors.min_stock}><Input id="l-min" type="number" min={0} step="any" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
          <Field label="Maximum" htmlFor="l-max" error={errors.max_stock}><Input id="l-max" type="number" min={0} step="any" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
          <Field label="Location" htmlFor="l-loc"><Input id="l-loc" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="levels-form" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
