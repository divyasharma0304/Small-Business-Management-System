"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormSection } from "@/components/forms/field";
import { FileUpload } from "@/components/forms/file-upload";
import { SimpleSelect } from "@/components/forms/simple-select";
import { useCurrency } from "@/components/money";
import { ToggleRow } from "@/components/settings/business-profile-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveProductAction } from "@/lib/actions/catalog";
import { formatPct } from "@/lib/format";
import type { AttributeDefinition, CostMethod, ItemType } from "@/lib/types";
import { emptyVariant, type ProductDraft, type VariantDraft } from "./product-draft";
import { cn } from "@/lib/utils";

const TYPE_INFO: { value: ItemType; label: string; description: string }[] = [
  { value: "product", label: "Product", description: "Something you sell" },
  { value: "service", label: "Service", description: "Work or time you sell" },
  { value: "material", label: "Material", description: "Raw material / supply you use" },
];

const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

export function ProductForm({
  businessId,
  initial,
  categories,
  attributeDefs,
  units,
  features,
  imageUrls,
  estimatedRecipeCost,
}: {
  businessId: string;
  initial: ProductDraft;
  categories: { id: string; name: string }[];
  attributeDefs: AttributeDefinition[];
  units: string[];
  features: { inventory: boolean; variants: boolean; production: boolean; taxEnabled: boolean; defaultMinStock: number };
  imageUrls: Record<string, string>;
  estimatedRecipeCost: number | null;
}) {
  const router = useRouter();
  const { format, symbol } = useCurrency();
  const [p, setP] = useState<ProductDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const patch = (x: Partial<ProductDraft>) => setP((s) => ({ ...s, ...x }));
  const patchVariant = (key: string, x: Partial<VariantDraft>) =>
    setP((s) => ({ ...s, variants: s.variants.map((v) => (v.key === key ? { ...v, ...x } : v)) }));

  const isService = p.item_type === "service";
  const tracks = !isService && p.track_inventory && features.inventory;
  const sells = p.item_type !== "material";
  const componentsTotal = p.components.reduce((a, c) => a + num(c.amount), 0);
  const unitOptions = Array.from(new Set([...units, p.unit].filter(Boolean))).map((u) => ({ value: u, label: u }));

  function setType(t: ItemType) {
    patch({ item_type: t, track_inventory: t === "service" ? false : p.id ? p.track_inventory : features.inventory });
  }

  function toggleVariants(on: boolean) {
    if (on) {
      const first = p.variants[0];
      patch({ has_variants: true, variants: [{ ...first, name: first.name || "Standard" }] });
    } else {
      if (p.variants.length > 1) return toast.error("Remove the extra variants first.");
      patch({ has_variants: false });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      id: p.id,
      item_type: p.item_type,
      name: p.name,
      category_id: p.category_id,
      description: p.description,
      unit: p.unit,
      tax_rate: features.taxEnabled ? p.tax_rate || "0" : "0",
      track_inventory: tracks,
      has_variants: p.has_variants,
      cost_method: p.cost_method,
      brand: p.brand,
      attributes: p.attributes,
      image_path: p.image_path,
      notes: p.notes,
      is_active: p.is_active,
      components: p.components.filter((c) => c.label.trim()).map((c) => ({ label: c.label, amount: c.amount || "0" })),
      variants: p.variants.map((v) => ({
        id: v.id,
        name: p.has_variants ? v.name : "Default",
        sku: v.sku,
        selling_price: sells ? v.selling_price || "0" : "0",
        cost_price: p.cost_method === "components" && !p.has_variants ? String(componentsTotal) : v.cost_price || "0",
        attributes: v.attributes,
        image_path: v.image_path,
        is_active: v.is_active,
        min_stock: tracks ? v.min_stock : null,
        max_stock: tracks ? v.max_stock : null,
        location: tracks ? v.location : null,
        opening_stock: tracks && !v.hasHistory ? v.opening_stock : null,
        opening_unit_cost: tracks && !v.hasHistory ? v.opening_unit_cost || v.cost_price : null,
      })),
    };
    startTransition(async () => {
      const res = await saveProductAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/catalog/${res.data.id}`);
      router.refresh();
    });
  }

  const v0 = p.variants[0];
  const estCost = p.cost_method === "components" ? componentsTotal : p.cost_method === "recipe" && estimatedRecipeCost != null ? estimatedRecipeCost : num(v0.cost_price);
  const price = num(v0.selling_price);
  const margin = useMemo(() => (price > 0 ? ((price - estCost) / price) * 100 : null), [price, estCost]);

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <FormSection title="What is it?">
        <div role="radiogroup" aria-label="Item type" className="grid gap-2 sm:grid-cols-3">
          {TYPE_INFO.map((t) => (
            <button
              type="button"
              role="radio"
              aria-checked={p.item_type === t.value}
              key={t.value}
              onClick={() => setType(t.value)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                p.item_type === t.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
              )}
            >
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.description}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
            <Input id="name" value={p.name} onChange={(e) => patch({ name: e.target.value })} aria-invalid={!!errors.name} />
          </Field>
          <Field label="Category" htmlFor="category" hint={categories.length === 0 ? "Create categories under Products & Services → Categories." : undefined}>
            <SimpleSelect id="category" value={p.category_id} onChange={(v) => patch({ category_id: v === "none" ? null : v })} allowNone noneLabel="Uncategorised" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Unit" htmlFor="unit" error={errors.unit}>
            <SimpleSelect id="unit" value={p.unit} onChange={(v) => patch({ unit: v })} options={unitOptions} />
          </Field>
          {features.taxEnabled && sells && (
            <Field label="Tax rate (%)" htmlFor="tax_rate" error={errors.tax_rate}>
              <Input id="tax_rate" type="number" min={0} max={100} step="any" value={p.tax_rate} onChange={(e) => patch({ tax_rate: e.target.value })} />
            </Field>
          )}
          <Field label="Brand" htmlFor="brand">
            <Input id="brand" value={p.brand} onChange={(e) => patch({ brand: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea id="description" rows={3} value={p.description} onChange={(e) => patch({ description: e.target.value })} />
          </Field>
          <Field label="Image" className="sm:col-span-2">
            <FileUpload businessId={businessId} folder="products" value={p.image_path} previewUrl={p.image_path ? imageUrls[p.image_path] : null} onChange={(path) => patch({ image_path: path })} />
          </Field>
        </div>
      </FormSection>

      {attributeDefs.length > 0 && !p.has_variants && (
        <FormSection title="Attributes" description="Optional details. Manage the list in Settings → Attributes.">
          <AttributeInputs defs={attributeDefs} value={p.attributes} onChange={(a) => patch({ attributes: a })} />
        </FormSection>
      )}

      <FormSection title="Options">
        <div className="grid gap-4">
          {!isService && features.inventory && (
            <ToggleRow id="track" label="Track stock" description="Keep a stock count with a full history of every movement." checked={p.track_inventory} onChange={(v) => patch({ track_inventory: v })} />
          )}
          {features.variants && (
            <ToggleRow id="variants" label="This item has variants" description="e.g. sizes, colours, scents, capacities — each with its own SKU, price and stock." checked={p.has_variants} onChange={toggleVariants} />
          )}
          <ToggleRow id="active" label="Active" description="Inactive items are hidden from new orders and purchases." checked={p.is_active} onChange={(v) => patch({ is_active: v })} />
        </div>
      </FormSection>

      {!p.has_variants ? (
        <FormSection title={sells ? "Price, cost & stock" : "Cost & stock"}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SKU / code" htmlFor="sku" error={errors["variants.0.sku"]}>
              <Input id="sku" value={v0.sku} onChange={(e) => patchVariant(v0.key, { sku: e.target.value })} />
            </Field>
            {sells && (
              <Field label={`Selling price (${symbol})`} htmlFor="price" error={errors["variants.0.selling_price"]}>
                <Input id="price" type="number" min={0} step="0.01" inputMode="decimal" value={v0.selling_price} onChange={(e) => patchVariant(v0.key, { selling_price: e.target.value })} />
              </Field>
            )}
            {p.cost_method !== "components" && (
              <Field label={`Standard cost (${symbol})`} htmlFor="cost" error={errors["variants.0.cost_price"]} hint={tracks ? "Your estimate. Actual stock cost comes from purchases/production." : "Used as the cost of each sale."}>
                <Input id="cost" type="number" min={0} step="0.01" inputMode="decimal" value={v0.cost_price} onChange={(e) => patchVariant(v0.key, { cost_price: e.target.value })} />
              </Field>
            )}
          </div>
          {tracks && <StockFields v={v0} onChange={(x) => patchVariant(v0.key, x)} errors={errors} prefix="variants.0" symbol={symbol} defaultMin={features.defaultMinStock} />}
        </FormSection>
      ) : (
        <FormSection title="Variants" description="Each variant has its own SKU, price, cost and stock.">
          {errors.variants && <p className="text-sm text-destructive">{errors.variants}</p>}
          <div className="grid gap-3">
            {p.variants.map((v, i) => (
              <div key={v.key} className={cn("grid gap-3 rounded-lg border p-3", !v.is_active && "opacity-60")}>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Variant name" htmlFor={`vn-${v.key}`} required error={errors[`variants.${i}.name`]}>
                    <Input id={`vn-${v.key}`} value={v.name} placeholder="e.g. Large / Lavender" onChange={(e) => patchVariant(v.key, { name: e.target.value })} />
                  </Field>
                  <Field label="SKU" htmlFor={`vs-${v.key}`}>
                    <Input id={`vs-${v.key}`} value={v.sku} onChange={(e) => patchVariant(v.key, { sku: e.target.value })} />
                  </Field>
                  {sells && (
                    <Field label={`Price (${symbol})`} htmlFor={`vp-${v.key}`} error={errors[`variants.${i}.selling_price`]}>
                      <Input id={`vp-${v.key}`} type="number" min={0} step="0.01" value={v.selling_price} onChange={(e) => patchVariant(v.key, { selling_price: e.target.value })} />
                    </Field>
                  )}
                  <Field label={`Standard cost (${symbol})`} htmlFor={`vc-${v.key}`}>
                    <Input id={`vc-${v.key}`} type="number" min={0} step="0.01" value={v.cost_price} onChange={(e) => patchVariant(v.key, { cost_price: e.target.value })} />
                  </Field>
                </div>
                {attributeDefs.length > 0 && (
                  <AttributeInputs defs={attributeDefs} value={v.attributes} onChange={(a) => patchVariant(v.key, { attributes: a })} compact />
                )}
                {tracks && <StockFields v={v} onChange={(x) => patchVariant(v.key, x)} errors={errors} prefix={`variants.${i}`} symbol={symbol} defaultMin={features.defaultMinStock} compact />}
                <div className="flex items-center justify-between gap-2">
                  <FileUpload businessId={businessId} folder="products" value={v.image_path} previewUrl={v.image_path ? imageUrls[v.image_path] : null} onChange={(path) => patchVariant(v.key, { image_path: path })} />
                  {v.id ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => patchVariant(v.key, { is_active: !v.is_active })}>
                      {v.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" onClick={() => patch({ variants: p.variants.filter((x) => x.key !== v.key) })} disabled={p.variants.length === 1}>
                      <Trash2 /> Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => patch({ variants: [...p.variants, emptyVariant({ selling_price: v0.selling_price, cost_price: v0.cost_price })] })}>
            <Plus /> Add variant
          </Button>
        </FormSection>
      )}

      <FormSection title="Costing" description="How you estimate what one unit costs you. Used for margins and — for items without stock — the cost of each sale.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cost method" htmlFor="cost_method">
            <SimpleSelect
              id="cost_method"
              value={p.cost_method}
              onChange={(v) => patch({ cost_method: v as CostMethod })}
              options={[
                { value: "manual", label: "Single standard cost" },
                ...(!p.has_variants ? [{ value: "components", label: "Itemised cost build-up" }] : []),
                ...(features.production && tracks ? [{ value: "recipe", label: "From recipe (BOM)" }] : []),
              ]}
            />
          </Field>
        </div>
        {p.cost_method === "components" && (
          <div className="grid gap-2">
            {p.components.map((c) => (
              <div key={c.key} className="flex gap-2">
                <Input aria-label="Cost label" placeholder="e.g. Packaging, Labour (1 h), Materials" value={c.label} onChange={(e) => patch({ components: p.components.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)) })} />
                <Input aria-label="Amount" type="number" min={0} step="0.01" className="w-32" value={c.amount} onChange={(e) => patch({ components: p.components.map((x) => (x.key === c.key ? { ...x, amount: e.target.value } : x)) })} />
                <Button type="button" size="icon" variant="ghost" aria-label="Remove cost" onClick={() => patch({ components: p.components.filter((x) => x.key !== c.key) })}><Trash2 /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => patch({ components: [...p.components, { key: crypto.randomUUID(), label: "", amount: "" }] })}>
              <Plus /> Add cost line
            </Button>
          </div>
        )}
        {p.cost_method === "recipe" && (
          <p className="text-sm text-muted-foreground">
            {estimatedRecipeCost != null
              ? `Estimated from the recipe at current material costs: ${format(estimatedRecipeCost)} per unit.`
              : "Save the item, then create a recipe under Production → Recipes. Finished stock is valued at actual batch cost."}
          </p>
        )}
        {!p.has_variants && sells && (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Selling price</dt><dd className="font-medium tabular">{format(price)}</dd></div>
            <div><dt className="text-muted-foreground">Estimated cost</dt><dd className="font-medium tabular">{format(estCost)}</dd></div>
            <div><dt className="text-muted-foreground">Gross profit / unit</dt><dd className="font-medium tabular">{format(price - estCost)}</dd></div>
            <div><dt className="text-muted-foreground">Gross margin</dt><dd className={cn("font-medium tabular", margin != null && margin < 0 && "text-destructive")}>{formatPct(margin)}</dd></div>
          </dl>
        )}
      </FormSection>

      <FormSection title="Notes">
        <Textarea aria-label="Notes" rows={3} value={p.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </FormSection>

      <div className="sticky bottom-0 -mx-3 flex justify-end gap-2 border-t bg-background/90 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {p.id ? "Save changes" : "Create item"}
        </Button>
      </div>
    </form>
  );
}

function StockFields({ v, onChange, errors, prefix, symbol, defaultMin, compact }: {
  v: VariantDraft;
  onChange: (x: Partial<VariantDraft>) => void;
  errors: Record<string, string>;
  prefix: string;
  symbol: string;
  defaultMin: number;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", compact ? "sm:grid-cols-5" : "border-t pt-4 sm:grid-cols-3")}>
      <Field label="Min. stock" htmlFor={`min-${v.key}`} error={errors[`${prefix}.min_stock`]} hint={compact ? undefined : "Below this: LOW STOCK"}>
        <Input id={`min-${v.key}`} type="number" min={0} step="any" placeholder={String(defaultMin)} value={v.min_stock} onChange={(e) => onChange({ min_stock: e.target.value })} />
      </Field>
      <Field label="Max. stock" htmlFor={`max-${v.key}`} error={errors[`${prefix}.max_stock`]}>
        <Input id={`max-${v.key}`} type="number" min={0} step="any" value={v.max_stock} onChange={(e) => onChange({ max_stock: e.target.value })} />
      </Field>
      <Field label="Location" htmlFor={`loc-${v.key}`}>
        <Input id={`loc-${v.key}`} placeholder="e.g. Shelf A" value={v.location} onChange={(e) => onChange({ location: e.target.value })} />
      </Field>
      {v.hasHistory ? (
        <div className={cn("text-sm text-muted-foreground", compact ? "sm:col-span-2 self-end pb-2" : "sm:col-span-3")}>
          Current stock: <span className="font-medium text-foreground tabular">{v.currentStock ?? 0}</span>. Change it with a stock adjustment on the Inventory page.
        </div>
      ) : (
        <OpeningStock v={v} onChange={onChange} errors={errors} prefix={prefix} symbol={symbol} compact={compact} />
      )}
    </div>
  );
}

/**
 * Opening stock is only for stock you already had before using Velqora. It is
 * hidden behind a checkbox so that new purchases aren't entered twice (here AND
 * as a purchase, which would double the stock).
 */
function OpeningStock({ v, onChange, errors, prefix, symbol, compact }: {
  v: VariantDraft;
  onChange: (x: Partial<VariantDraft>) => void;
  errors: Record<string, string>;
  prefix: string;
  symbol: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(v.opening_stock !== "");
  const qty = Number(v.opening_stock || 0);
  const cost = Number(v.opening_unit_cost || 0);
  return (
    <div className={cn("grid gap-3 rounded-lg border border-dashed p-3", compact ? "sm:col-span-5" : "sm:col-span-3")}>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={open}
          onChange={(e) => {
            setOpen(e.target.checked);
            if (!e.target.checked) onChange({ opening_stock: "", opening_unit_cost: "" });
          }}
        />
        <span>
          <span className="font-medium">I already have some of this in stock</span>
          <span className="block text-muted-foreground">
            Only for stock you had <em>before</em> using Velqora. Just bought it? Leave this unticked and record it in{" "}
            <span className="font-medium text-foreground">Purchases</span> instead — otherwise it will be counted twice.
          </span>
        </span>
      </label>
      {open && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Quantity on hand" htmlFor={`os-${v.key}`} error={errors[`${prefix}.opening_stock`]}>
            <Input id={`os-${v.key}`} type="number" min={0} step="any" value={v.opening_stock} onChange={(e) => onChange({ opening_stock: e.target.value })} />
          </Field>
          <Field label={`Cost per unit (${symbol})`} htmlFor={`oc-${v.key}`} hint="Price of ONE unit, not the total. Empty = standard cost.">
            <Input id={`oc-${v.key}`} type="number" min={0} step="0.01" value={v.opening_unit_cost} onChange={(e) => onChange({ opening_unit_cost: e.target.value })} />
          </Field>
          {qty > 0 && cost > 0 && (
            <p className="self-end pb-2 text-sm text-muted-foreground">
              Total value: <span className="font-medium text-foreground tabular">{symbol}{(qty * cost).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AttributeInputs({ defs, value, onChange, compact }: {
  defs: AttributeDefinition[];
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", compact ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
      {defs.map((d) => (
        <Field key={d.id} label={d.name} htmlFor={`attr-${d.id}`}>
          {d.options.length ? (
            <SimpleSelect
              id={`attr-${d.id}`}
              value={value[d.name] || "none"}
              allowNone
              noneLabel="—"
              options={d.options.map((o) => ({ value: o, label: o }))}
              onChange={(v) => onChange({ ...value, [d.name]: v === "none" ? "" : v })}
            />
          ) : (
            <Input id={`attr-${d.id}`} value={value[d.name] ?? ""} onChange={(e) => onChange({ ...value, [d.name]: e.target.value })} />
          )}
        </Field>
      ))}
    </div>
  );
}
