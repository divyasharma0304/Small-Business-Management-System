"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Factory, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { SimpleSelect } from "@/components/forms/simple-select";
import { useCurrency } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { completeBatchAction, createBatchAction } from "@/lib/actions/production";
import { formatQty } from "@/lib/format";

export function NewBatchDialog({ recipes, today, defaultRecipe }: {
  recipes: { id: string; name: string; output: string; unit: string; yield_quantity: number }[];
  today: string;
  defaultRecipe?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recipe, setRecipe] = useState(defaultRecipe ?? recipes[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const r = recipes.find((x) => x.id === recipe);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setQty(r ? String(r.yield_quantity) : ""); }}>
      <DialogTrigger asChild>
        <Button disabled={recipes.length === 0}><Factory /> Plan batch</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan a production batch</DialogTitle>
          <DialogDescription>Material quantities are calculated from the recipe. Stock only changes when you complete the batch.</DialogDescription>
        </DialogHeader>
        <form
          id="batch-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await createBatchAction({ recipe_id: recipe, planned_quantity: qty, production_date: date, notes });
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                toast.error(res.error);
                return;
              }
              toast.success(res.message);
              setOpen(false);
              router.push(`/production/batches/${res.data.id}`);
            });
          }}
        >
          <Field label="Recipe" htmlFor="b-recipe">
            <SimpleSelect id="b-recipe" value={recipe} onChange={setRecipe} options={recipes.map((x) => ({ value: x.id, label: x.name, hint: `→ ${x.output}` }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Planned quantity${r ? ` (${r.unit})` : ""}`} htmlFor="b-qty" error={errors.planned_quantity}>
              <Input id="b-qty" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor="b-date" error={errors.production_date}>
              <Input id="b-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="b-notes"><Textarea id="b-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="batch-form" disabled={pending || !recipe || !qty}>{pending && <Loader2 className="animate-spin" />} Plan batch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConsumptionLine {
  id: string;
  name: string;
  unit: string;
  planned_quantity: number;
  used_quantity: number;
  wasted_quantity: number;
  available: number;
  avg_cost: number;
}

export function CompleteBatchDialog({ batchId, plannedQuantity, unit, lines }: { batchId: string; plannedQuantity: number; unit: string; lines: ConsumptionLine[] }) {
  const router = useRouter();
  const { format, symbol } = useCurrency();
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(String(plannedQuantity));
  const [extra, setExtra] = useState("");
  const [notes, setNotes] = useState("");
  const [vals, setVals] = useState<Record<string, { used: string; wasted: string }>>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setActual(String(plannedQuantity));
    setVals(Object.fromEntries(lines.map((l) => [l.id, { used: String(l.used_quantity), wasted: String(l.wasted_quantity) }])));
  }
  const material = lines.reduce((a, l) => a + (Number(vals[l.id]?.used || 0) + Number(vals[l.id]?.wasted || 0)) * l.avg_cost, 0);
  const total = material + Number(extra || 0);
  const perUnit = Number(actual) > 0 ? total / Number(actual) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild><Button><CheckCircle2 /> Complete batch</Button></DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete batch</DialogTitle>
          <DialogDescription>Enter what was actually used, wasted and produced. Materials are deducted and finished goods added to stock in one step.</DialogDescription>
        </DialogHeader>
        <form
          id="complete-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await completeBatchAction(batchId, {
                actual_quantity: actual,
                additional_cost: extra || 0,
                notes,
                lines: lines.map((l) => ({ id: l.id, used_quantity: vals[l.id]?.used || 0, wasted_quantity: vals[l.id]?.wasted || 0 })),
              });
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-2">
            <div className="hidden grid-cols-[1fr_110px_110px] gap-2 text-xs font-medium text-muted-foreground sm:grid"><span>Material</span><span>Used</span><span>Wasted</span></div>
            {lines.map((l) => {
              const need = Number(vals[l.id]?.used || 0) + Number(vals[l.id]?.wasted || 0);
              return (
                <div key={l.id} className="grid gap-2 sm:grid-cols-[1fr_110px_110px] sm:items-center">
                  <div className="text-sm">
                    <span className="font-medium">{l.name}</span>
                    <span className={`block text-xs ${need > l.available ? "text-destructive" : "text-muted-foreground"}`}>
                      Planned {formatQty(l.planned_quantity, l.unit)} · in stock {formatQty(l.available, l.unit)}
                    </span>
                  </div>
                  <Input aria-label={`${l.name} used`} type="number" min={0} step="any" value={vals[l.id]?.used ?? ""} onChange={(e) => setVals((s) => ({ ...s, [l.id]: { ...s[l.id], used: e.target.value } }))} />
                  <Input aria-label={`${l.name} wasted`} type="number" min={0} step="any" value={vals[l.id]?.wasted ?? ""} onChange={(e) => setVals((s) => ({ ...s, [l.id]: { ...s[l.id], wasted: e.target.value } }))} />
                </div>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Quantity produced (${unit})`} htmlFor="c-actual" required>
              <Input id="c-actual" type="number" min={0} step="any" value={actual} onChange={(e) => setActual(e.target.value)} />
            </Field>
            <Field label={`Additional cost (${symbol})`} htmlFor="c-extra" hint="Labour, energy, etc. for this batch (optional)">
              <Input id="c-extra" type="number" min={0} step="0.01" value={extra} onChange={(e) => setExtra(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="c-notes"><Textarea id="c-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <dl className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
            <div><dt className="text-muted-foreground">Materials (incl. wastage)</dt><dd className="font-medium tabular">{format(material)}</dd></div>
            <div><dt className="text-muted-foreground">Total batch cost</dt><dd className="font-medium tabular">{format(total)}</dd></div>
            <div><dt className="text-muted-foreground">Cost per unit</dt><dd className="font-medium tabular">{format(perUnit)}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Estimate at current average costs; the exact figures are calculated when saved.</p>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="complete-form" disabled={pending || !actual}>{pending && <Loader2 className="animate-spin" />} Complete batch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
