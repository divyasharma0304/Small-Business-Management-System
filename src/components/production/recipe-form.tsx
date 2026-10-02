"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormSection } from "@/components/forms/field";
import { ItemPicker, type PickerItem } from "@/components/forms/item-picker";
import { useCurrency } from "@/components/money";
import { ToggleRow } from "@/components/settings/business-profile-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveRecipeAction } from "@/lib/actions/production";

export interface RecipeInit {
  id: string | null;
  name: string;
  variant_id: string | null;
  yield_quantity: string;
  notes: string;
  is_active: boolean;
  items: { component_variant_id: string | null; quantity: string; wastage_pct: string }[];
}

/** Bill of materials: what goes into making `yield_quantity` units of the output item. */
export function RecipeForm({ init, items, defaultWastage }: { init: RecipeInit; items: PickerItem[]; defaultWastage: number }) {
  const router = useRouter();
  const { format } = useCurrency();
  const [r, setR] = useState(() => ({
    ...init,
    items: (init.items.length ? init.items : [{ component_variant_id: null, quantity: "", wastage_pct: String(defaultWastage) }]).map((i) => ({ ...i, key: crypto.randomUUID() })),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const set = (p: Partial<typeof r>) => setR((s) => ({ ...s, ...p }));
  const byId = useMemo(() => new Map(items.map((i) => [i.variant_id, i])), [items]);
  const outputs = items.filter((i) => i.item_type !== "material");

  const unitCost = (i: PickerItem | undefined) => (i ? (i.avg_cost && i.avg_cost > 0 ? i.avg_cost : i.cost_price) : 0);
  const batchCost = r.items.reduce((a, it) => {
    const comp = it.component_variant_id ? byId.get(it.component_variant_id) : undefined;
    return a + Number(it.quantity || 0) * (1 + Number(it.wastage_pct || 0) / 100) * unitCost(comp);
  }, 0);
  const yieldQty = Number(r.yield_quantity || 0);
  const perUnit = yieldQty > 0 ? batchCost / yieldQty : 0;
  const output = r.variant_id ? byId.get(r.variant_id) : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveRecipeAction({
        id: r.id,
        name: r.name,
        variant_id: r.variant_id,
        yield_quantity: r.yield_quantity,
        notes: r.notes,
        is_active: r.is_active,
        items: r.items.filter((i) => i.component_variant_id).map((i) => ({ component_variant_id: i.component_variant_id, quantity: i.quantity, wastage_pct: i.wastage_pct || 0 })),
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push("/production/recipes");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <FormSection title="Recipe">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Recipe name" htmlFor="r-name" required error={errors.name} className="sm:col-span-3">
            <Input id="r-name" value={r.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Standard batch" />
          </Field>
          <Field label="Makes (output item)" htmlFor="r-out" required error={errors.variant_id} className="sm:col-span-2" hint="Must be a stock-tracked product.">
            <ItemPicker id="r-out" items={outputs} value={r.variant_id} onChange={(i) => set({ variant_id: i.variant_id, name: r.name || i.item_name })} invalid={!!errors.variant_id} />
          </Field>
          <Field label={`Yield${output ? ` (${output.unit})` : ""}`} htmlFor="r-yield" error={errors.yield_quantity} hint="Units this recipe produces">
            <Input id="r-yield" type="number" min={0} step="any" value={r.yield_quantity} onChange={(e) => set({ yield_quantity: e.target.value })} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Components" description="Materials (or other items) consumed. Wastage % is the expected extra loss during production.">
        <div className="grid gap-2">
          <div className="hidden grid-cols-[minmax(0,1fr)_120px_110px_110px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
            <span>Component</span><span>Quantity</span><span>Wastage %</span><span className="text-right">Est. cost</span><span />
          </div>
          {r.items.map((it, idx) => {
            const comp = it.component_variant_id ? byId.get(it.component_variant_id) : undefined;
            const cost = Number(it.quantity || 0) * (1 + Number(it.wastage_pct || 0) / 100) * unitCost(comp);
            return (
              <div key={it.key} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_120px_110px_110px_36px] sm:items-center sm:border-0 sm:p-0">
                <ItemPicker items={items.filter((i) => i.variant_id !== r.variant_id)} value={it.component_variant_id} onChange={(i) => set({ items: r.items.map((x) => (x.key === it.key ? { ...x, component_variant_id: i.variant_id } : x)) })} invalid={!!errors[`items.${idx}.component_variant_id`]} />
                <div className="flex items-center gap-1">
                  <Input aria-label="Quantity" type="number" min={0} step="any" value={it.quantity} onChange={(e) => set({ items: r.items.map((x) => (x.key === it.key ? { ...x, quantity: e.target.value } : x)) })} aria-invalid={!!errors[`items.${idx}.quantity`]} />
                  <span className="w-10 truncate text-xs text-muted-foreground">{comp?.unit}</span>
                </div>
                <Input aria-label="Wastage %" type="number" min={0} max={100} step="any" value={it.wastage_pct} onChange={(e) => set({ items: r.items.map((x) => (x.key === it.key ? { ...x, wastage_pct: e.target.value } : x)) })} />
                <span className="text-right text-sm tabular">{format(cost)}</span>
                <Button type="button" size="icon" variant="ghost" aria-label="Remove component" disabled={r.items.length === 1} onClick={() => set({ items: r.items.filter((x) => x.key !== it.key) })}><Trash2 /></Button>
              </div>
            );
          })}
          {errors.items && <p className="text-sm text-destructive">{errors.items}</p>}
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => set({ items: [...r.items, { key: crypto.randomUUID(), component_variant_id: null, quantity: "", wastage_pct: String(defaultWastage) }] })}>
            <Plus /> Add component
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Materials per batch</dt><dd className="font-medium tabular">{format(batchCost)}</dd></div>
          <div><dt className="text-muted-foreground">Estimated cost / unit</dt><dd className="font-medium tabular">{format(perUnit)}</dd></div>
          {output && output.selling_price > 0 && (
            <div><dt className="text-muted-foreground">Margin at {format(output.selling_price)}</dt><dd className="font-medium tabular">{(((output.selling_price - perUnit) / output.selling_price) * 100).toFixed(1)}%</dd></div>
          )}
        </dl>
        <p className="text-xs text-muted-foreground">Estimates use current average stock costs. Actual batch cost is calculated when the batch is completed.</p>
      </FormSection>

      <FormSection title="Other">
        <Field label="Notes / method" htmlFor="r-notes"><Textarea id="r-notes" rows={3} value={r.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <ToggleRow id="r-active" label="Active" description="Inactive recipes can't be used for new batches." checked={r.is_active} onChange={(v) => set({ is_active: v })} />
      </FormSection>

      <div className="sticky bottom-0 -mx-3 flex justify-end gap-2 border-t bg-background/90 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save recipe</Button>
      </div>
    </form>
  );
}
