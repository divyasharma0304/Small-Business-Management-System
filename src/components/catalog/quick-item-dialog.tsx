"use client";

import { useState, useTransition } from "react";
import { Loader2, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import type { PickerItem } from "@/components/forms/item-picker";
import { SimpleSelect } from "@/components/forms/simple-select";
import { useCurrency } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { quickCreateItemAction, quickCreateVariantAction } from "@/lib/actions/catalog";
import { cn } from "@/lib/utils";

/**
 * Add an item that doesn't exist yet while recording a purchase.
 * The item is created with zero stock — the purchase itself adds the stock.
 */
export function QuickItemDialog({ categories, units, defaultUnit, variantParents = [], onCreated }: {
  categories: { id: string; name: string }[];
  /** Items with variants that a new variant can be added to (e.g. "Candle Color"). */
  variantParents?: { id: string; name: string; unit: string }[];
  units: string[];
  defaultUnit: string;
  onCreated: (item: PickerItem) => void;
}) {
  const { symbol } = useCurrency();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"item" | "variant">("item");
  const [parent, setParent] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"material" | "product">("material");
  const [category, setCategory] = useState<string | null>(null);
  const [unit, setUnit] = useState(defaultUnit);
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setMode("item"); setParent(null); setName(""); setType("material"); setCategory(null); setUnit(defaultUnit); setPrice(""); setErrors({}); }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm"><PackagePlus /> New item</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new item</DialogTitle>
          <DialogDescription>
            For something you&apos;re buying for the first time. It&apos;s created with zero stock — this purchase adds the stock when you receive it. You can add more details later under Products & Services.
          </DialogDescription>
        </DialogHeader>
        <form
          id="quick-item-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startTransition(async () => {
              const res =
                mode === "variant"
                  ? await quickCreateVariantAction({ product_id: parent, name })
                  : await quickCreateItemAction({ name, item_type: type, category_id: category, unit, selling_price: price || 0 });
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                toast.error(res.error);
                return;
              }
              toast.success(res.message);
              onCreated(res.data);
              setOpen(false);
            });
          }}
        >
          {variantParents.length > 0 && (
            <div role="radiogroup" aria-label="What are you adding?" className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              {([
                ["item", "A brand-new item", "e.g. a new kind of jar"],
                ["variant", "A new variant of an existing item", "e.g. a new colour of Candle Color"],
              ] as const).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn("rounded-lg border p-2.5 text-left text-sm", mode === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}
                >
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          )}
          {mode === "variant" ? (
            <>
              <Field label="Item" htmlFor="qi-parent" required error={errors.product_id}>
                <SimpleSelect id="qi-parent" value={parent ?? undefined} onChange={setParent} placeholder="Choose item" options={variantParents.map((p) => ({ value: p.id, label: p.name, hint: p.unit }))} />
              </Field>
              <Field label="Variant name" htmlFor="qi-vname" required error={errors.name} hint="e.g. Blue">
                <Input id="qi-vname" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Counted in the same unit as the item ({variantParents.find((p) => p.id === parent)?.unit ?? "—"}). Don&apos;t see your item here? Edit it and turn on “This item has variants” first.
              </p>
            </>
          ) : (
            <>
          <Field label="Name" htmlFor="qi-name" required error={errors.name} className="sm:col-span-2">
            <Input id="qi-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Vodka Shot Glass Jar" />
          </Field>
          <Field label="Type" htmlFor="qi-type">
            <SimpleSelect id="qi-type" value={type} onChange={(v) => setType(v as typeof type)} options={[
              { value: "material", label: "Material / supply (I use it)" },
              { value: "product", label: "Product (I resell it)" },
            ]} />
          </Field>
          <Field label="Unit" htmlFor="qi-unit" error={errors.unit} hint="How you count it: pcs, g, ml…">
            <SimpleSelect id="qi-unit" value={unit} onChange={setUnit} options={Array.from(new Set([...units, unit])).map((u) => ({ value: u, label: u }))} />
          </Field>
          <Field label="Category" htmlFor="qi-cat">
            <SimpleSelect id="qi-cat" value={category} allowNone noneLabel="Uncategorised" onChange={(v) => setCategory(v === "none" ? null : v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          {type === "product" && (
            <Field label={`Selling price (${symbol})`} htmlFor="qi-price" error={errors.selling_price}>
              <Input id="qi-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          )}
            </>
          )}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="quick-item-form" disabled={pending || !name.trim() || (mode === "variant" && !parent)}>
            {pending && <Loader2 className="animate-spin" />} {mode === "variant" ? "Add variant" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
