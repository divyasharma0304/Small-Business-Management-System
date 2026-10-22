"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Factory, Loader2, Plus, Trash2 } from "lucide-react";
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

export interface RecipeOption {
  id: string;
  name: string;
  output: string;
  unit: string;
  yield_quantity: number;
}

/** Plan a batch that makes one or more products, each from its own recipe. */
export function NewBatchDialog({ recipes, today, defaultRecipe }: { recipes: RecipeOption[]; today: string; defaultRecipe?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const newRow = (recipeId?: string) => {
    const r = recipes.find((x) => x.id === recipeId);
    return { key: crypto.randomUUID(), recipe: recipeId ?? "", qty: r ? String(r.yield_quantity) : "" };
  };
  const [rows, setRows] = useState(() => [newRow(defaultRecipe ?? recipes[0]?.id)]);
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const patch = (key: string, p: Partial<{ recipe: string; qty: string }>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const ready = rows.length > 0 && rows.every((r) => r.recipe && Number(r.qty) > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setRows([newRow(defaultRecipe ?? recipes[0]?.id)]); setDate(today); setNotes(""); } }}>
      <DialogTrigger asChild>
        <Button disabled={recipes.length === 0}><Factory /> Plan batch</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Plan a production batch</DialogTitle>
          <DialogDescription>Add every product you&apos;re making in this session. Materials are calculated from each recipe; stock only changes when you complete the batch.</DialogDescription>
        </DialogHeader>
        <form
          id="batch-form"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await createBatchAction({
                outputs: rows.map((r) => ({ recipe_id: r.recipe, planned_quantity: r.qty })),
                production_date: date,
                notes,
              });
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message);
              setOpen(false);
              router.push(`/production/batches/${res.data.id}`);
            });
          }}
        >
          <div className="grid gap-2">
            <div className="hidden grid-cols-[minmax(0,1fr)_120px_36px] gap-2 text-xs font-medium text-muted-foreground sm:grid">
              <span>Product (recipe)</span><span>Quantity</span><span />
            </div>
            {rows.map((r, i) => {
              const rec = recipes.find((x) => x.id === r.recipe);
              return (
                <div key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_36px] sm:items-center">
                  <SimpleSelect
                    id={`b-recipe-${i}`}
                    value={r.recipe || undefined}
                    placeholder="Choose recipe"
                    onChange={(v) => patch(r.key, { recipe: v, qty: r.qty || String(recipes.find((x) => x.id === v)?.yield_quantity ?? "") })}
                    options={recipes.map((x) => ({ value: x.id, label: x.output, hint: x.name !== x.output ? `· ${x.name}` : undefined }))}
                  />
                  <div className="flex items-center gap-1">
                    <Input aria-label={`Quantity for line ${i + 1}`} type="number" min={0} step="any" value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value })} />
                    <span className="w-8 text-xs text-muted-foreground">{rec?.unit}</span>
                  </div>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setRows((rs) => [...rs, newRow()])}>
              <Plus /> Add product
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="b-date">
              <Input id="b-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="b-notes"><Textarea id="b-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="batch-form" disabled={pending || !ready}>{pending && <Loader2 className="animate-spin" />} Plan batch</Button>
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

export interface OutputLine {
  id: string;
  name: string;
  unit: string;
  planned_quantity: number;
  lines: ConsumptionLine[];
}

/** Complete a batch: quantity produced per product, and materials actually used/wasted. */
export function CompleteBatchDialog({ batchId, outputs }: { batchId: string; outputs: OutputLine[] }) {
  const router = useRouter();
  const { format, symbol } = useCurrency();
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState("");
  const [notes, setNotes] = useState("");
  const [vals, setVals] = useState<Record<string, { used: string; wasted: string }>>({});
  const [pending, startTransition] = useTransition();
  const allLines = outputs.flatMap((o) => o.lines);

  function reset() {
    setMade(Object.fromEntries(outputs.map((o) => [o.id, String(o.planned_quantity)])));
    setVals(Object.fromEntries(allLines.map((l) => [l.id, { used: String(l.used_quantity), wasted: String(l.wasted_quantity) }])));
    setExtra("");
    setNotes("");
  }
  const matOf = (o: OutputLine) => o.lines.reduce((a, l) => a + (Number(vals[l.id]?.used || 0) + Number(vals[l.id]?.wasted || 0)) * l.avg_cost, 0);
  const totalMat = outputs.reduce((a, o) => a + matOf(o), 0);
  const extraN = Number(extra || 0);
  // Need per material across the whole batch (same material can be in several products)
  const need = new Map<string, { name: string; unit: string; qty: number; available: number }>();
  for (const o of outputs) for (const l of o.lines) {
    const key = l.name;
    const n = need.get(key) ?? { name: l.name, unit: l.unit, qty: 0, available: l.available };
    n.qty += Number(vals[l.id]?.used || 0) + Number(vals[l.id]?.wasted || 0);
    need.set(key, n);
  }
  const short = [...need.values()].filter((n) => n.qty > n.available);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild><Button><CheckCircle2 /> Complete batch</Button></DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete batch</DialogTitle>
          <DialogDescription>Enter what you actually made, used and wasted. Materials are deducted and finished goods added to stock in one step.</DialogDescription>
        </DialogHeader>
        <form
          id="complete-form"
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await completeBatchAction(batchId, {
                outputs: outputs.map((o) => ({ id: o.id, actual_quantity: made[o.id] || 0 })),
                additional_cost: extra || 0,
                notes,
                lines: allLines.map((l) => ({ id: l.id, used_quantity: vals[l.id]?.used || 0, wasted_quantity: vals[l.id]?.wasted || 0 })),
              });
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {outputs.map((o) => {
            const mat = matOf(o);
            const share = totalMat > 0 ? (extraN * mat) / totalMat : outputs.length ? extraN / outputs.length : 0;
            const qty = Number(made[o.id] || 0);
            return (
              <div key={o.id} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="font-medium">{o.name}</div>
                  <Field label={`Made (${o.unit})`} htmlFor={`made-${o.id}`} className="w-32">
                    <Input id={`made-${o.id}`} type="number" min={0} step="any" value={made[o.id] ?? ""} onChange={(e) => setMade((s) => ({ ...s, [o.id]: e.target.value }))} />
                  </Field>
                </div>
                <div className="hidden grid-cols-[1fr_100px_100px] gap-2 text-xs font-medium text-muted-foreground sm:grid"><span>Material</span><span>Used</span><span>Wasted</span></div>
                {o.lines.map((l) => (
                  <div key={l.id} className="grid gap-2 sm:grid-cols-[1fr_100px_100px] sm:items-center">
                    <div className="text-sm">
                      {l.name}
                      <span className="block text-xs text-muted-foreground">Planned {formatQty(l.planned_quantity, l.unit)}</span>
                    </div>
                    <Input aria-label={`${l.name} used`} type="number" min={0} step="any" value={vals[l.id]?.used ?? ""} onChange={(e) => setVals((s) => ({ ...s, [l.id]: { ...s[l.id], used: e.target.value } }))} />
                    <Input aria-label={`${l.name} wasted`} type="number" min={0} step="any" value={vals[l.id]?.wasted ?? ""} onChange={(e) => setVals((s) => ({ ...s, [l.id]: { ...s[l.id], wasted: e.target.value } }))} />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground tabular">
                  Est. cost: materials {format(mat)}{extraN > 0 ? ` + share of extra ${format(share)}` : ""}
                  {qty > 0 ? ` = ${format((mat + share) / qty)} per ${o.unit}` : ""}
                </p>
              </div>
            );
          })}
          {short.length > 0 && (
            <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              Not enough in stock: {short.map((n) => `${n.name} (need ${formatQty(n.qty, n.unit)}, have ${formatQty(n.available, n.unit)})`).join("; ")}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Additional cost for the batch (${symbol})`} htmlFor="c-extra" hint="Labour, gas, electricity… split across products by their material cost.">
              <Input id="c-extra" type="number" min={0} step="0.01" value={extra} onChange={(e) => setExtra(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="c-notes"><Textarea id="c-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">Estimates use current average costs; exact figures are calculated when saved.</p>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="complete-form" disabled={pending || outputs.some((o) => !(Number(made[o.id]) > 0))}>
            {pending && <Loader2 className="animate-spin" />} Complete batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
