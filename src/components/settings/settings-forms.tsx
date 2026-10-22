"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import { Field, FormSection } from "@/components/forms/field";
import { FileUpload } from "@/components/forms/file-upload";
import { SimpleSelect } from "@/components/forms/simple-select";
import {
  IdentityFields,
  LocationFields,
  TaxFields,
  ToggleRow,
  type BusinessProfileState,
} from "@/components/settings/business-profile-fields";
import { MODULE_INFO, type ModulesState } from "@/components/setup/setup-wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteDemoDataAction,
  seedDemoDataAction,
  setBusinessLogoAction,
  updateBusinessProfileAction,
  updateModulesAction,
  updateOperationsAction,
} from "@/lib/actions/business";
import { deleteAttributeAction, saveAttributeAction } from "@/lib/actions/lookups";
import type { AttributeDefinition, Business, BusinessSettings } from "@/lib/types";

function useSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  function save(fn: () => Promise<{ ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success(res.message ?? "Saved");
      router.refresh();
    });
  }
  return { pending, errors, save };
}

function SaveBar({ pending, label = "Save changes" }: { pending: boolean; label?: string }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} {label}
      </Button>
    </div>
  );
}

export function BusinessProfileForm({ business, logoUrl }: { business: Business; logoUrl: string | null }) {
  const { pending, errors, save } = useSave();
  const [logoPending, startLogo] = useTransition();
  const router = useRouter();
  const [v, setV] = useState<BusinessProfileState>({
    name: business.name,
    business_type: business.business_type,
    description: business.description ?? "",
    owner_name: business.owner_name ?? "",
    email: business.email ?? "",
    phone: business.phone ?? "",
    address: business.address ?? "",
    city: business.city ?? "",
    state: business.state ?? "",
    postal_code: business.postal_code ?? "",
    country: business.country,
    currency: business.currency,
    timezone: business.timezone,
    tax_enabled: business.tax_enabled,
    tax_label: business.tax_label,
    tax_number: business.tax_number ?? "",
    default_tax_rate: String(business.default_tax_rate),
    prices_include_tax: business.prices_include_tax,
    purchase_tax_recoverable: business.purchase_tax_recoverable,
    default_unit: business.default_unit,
  });
  const patch = (p: Partial<BusinessProfileState>) => setV((s) => ({ ...s, ...p }));

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => updateBusinessProfileAction(v));
      }}
    >
      <FormSection title="Logo">
        <FileUpload
          businessId={business.id}
          folder="logos"
          value={business.logo_path}
          previewUrl={logoUrl}
          label="Upload logo"
          onChange={(path) =>
            startLogo(async () => {
              const res = await setBusinessLogoAction(path);
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
              router.refresh();
            })
          }
        />
        {logoPending && <p className="text-xs text-muted-foreground">Saving logo…</p>}
      </FormSection>
      <FormSection title="Business details">
        <IdentityFields value={v} onChange={patch} errors={errors} />
      </FormSection>
      <FormSection title="Location & currency" description="Changing the currency does not convert existing amounts.">
        <LocationFields value={v} onChange={patch} errors={errors} />
      </FormSection>
      <FormSection title="Tax" description="Applies to new orders and purchases. Existing documents keep the tax they were saved with.">
        <TaxFields value={v} onChange={patch} errors={errors} />
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  );
}

export function ModulesForm({ settings }: { settings: BusinessSettings }) {
  const { pending, save } = useSave();
  const [m, setM] = useState<ModulesState>({
    inventory: settings.module_inventory,
    purchases: settings.module_purchases,
    suppliers: settings.module_suppliers,
    customers: settings.module_customers,
    production: settings.module_production,
    expenses: settings.module_expenses,
    variants: settings.module_variants,
  });
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => updateModulesAction(m));
      }}
    >
      <FormSection title="Features" description="Hide what your business doesn't use. Turning a feature off never deletes data.">
        <div className="grid gap-5">
          {MODULE_INFO.map((info) => {
            const blocked = "requires" in info && !m[info.requires];
            return (
              <ToggleRow
                key={info.key}
                id={`mod-${info.key}`}
                label={info.label}
                description={blocked ? `${info.description} (needs Inventory)` : info.description}
                checked={m[info.key] && !blocked}
                disabled={blocked}
                onChange={(val) => setM((s) => ({ ...s, [info.key]: val }))}
              />
            );
          })}
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  );
}

const DEDUCTION_OPTIONS = [
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
];

export function OperationsForm({ settings }: { settings: BusinessSettings }) {
  const { pending, errors, save } = useSave();
  const [v, setV] = useState({
    allow_negative_stock: settings.allow_negative_stock,
    default_min_stock: String(settings.default_min_stock),
    inventory_deduction_status: settings.inventory_deduction_status as string,
    default_order_status: settings.default_order_status as string,
    payment_due_days: String(settings.payment_due_days),
    default_wastage_pct: String(settings.default_wastage_pct),
    order_prefix: settings.order_prefix,
    purchase_prefix: settings.purchase_prefix,
    batch_prefix: settings.batch_prefix,
    units: settings.units,
  });
  const [unit, setUnit] = useState("");
  const patch = (p: Partial<typeof v>) => setV((s) => ({ ...s, ...p }));

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => updateOperationsAction(v));
      }}
    >
      <FormSection title="Sales" description="When does an order count as a sale?">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Record sale & deduct stock at"
            htmlFor="deduction"
            hint="From this status on, the order counts as revenue, stock is deducted and its cost (COGS) is locked in."
          >
            <SimpleSelect id="deduction" value={v.inventory_deduction_status} onChange={(x) => patch({ inventory_deduction_status: x })} options={DEDUCTION_OPTIONS} />
          </Field>
          <Field label="New orders start as" htmlFor="default_status">
            <SimpleSelect
              id="default_status"
              value={v.default_order_status}
              onChange={(x) => patch({ default_order_status: x })}
              options={[{ value: "draft", label: "Draft" }, { value: "confirmed", label: "Confirmed" }]}
            />
          </Field>
          <Field label="Payment due after (days)" htmlFor="due_days" error={errors.payment_due_days} hint="0 = due on the order date. Used for overdue tracking.">
            <Input id="due_days" type="number" min={0} max={365} value={v.payment_due_days} onChange={(e) => patch({ payment_due_days: e.target.value })} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Inventory">
        <div className="grid gap-4">
          <ToggleRow
            id="negative"
            label="Allow negative stock"
            description="When off (recommended), sales and consumption that exceed available stock are blocked."
            checked={v.allow_negative_stock}
            onChange={(x) => patch({ allow_negative_stock: x })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default minimum stock" htmlFor="min_stock" error={errors.default_min_stock} hint="Pre-filled on new items; below this an item is LOW STOCK.">
              <Input id="min_stock" type="number" min={0} step="any" value={v.default_min_stock} onChange={(e) => patch({ default_min_stock: e.target.value })} />
            </Field>
            <Field label="Default production wastage (%)" htmlFor="wastage" error={errors.default_wastage_pct}>
              <Input id="wastage" type="number" min={0} max={100} step="any" value={v.default_wastage_pct} onChange={(e) => patch({ default_wastage_pct: e.target.value })} />
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection title="Units" description="Offered when creating items.">
        <div className="flex flex-wrap gap-2">
          {v.units.map((u) => (
            <span key={u} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm">
              {u}
              <button type="button" aria-label={`Remove ${u}`} className="text-muted-foreground hover:text-foreground" onClick={() => patch({ units: v.units.filter((x) => x !== u) })}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. dozen" className="max-w-40" aria-label="New unit" />
          <Button type="button" variant="outline" onClick={() => { if (unit.trim()) { patch({ units: [...v.units, unit.trim()] }); setUnit(""); } }}>
            <Plus /> Add unit
          </Button>
        </div>
        {errors.units && <p className="text-xs text-destructive">{errors.units}</p>}
      </FormSection>

      <FormSection title="Document numbers" description="Prefixes for new documents (e.g. ORD-00012).">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Orders" htmlFor="op"><Input id="op" value={v.order_prefix} onChange={(e) => patch({ order_prefix: e.target.value })} /></Field>
          <Field label="Purchases" htmlFor="pp"><Input id="pp" value={v.purchase_prefix} onChange={(e) => patch({ purchase_prefix: e.target.value })} /></Field>
          <Field label="Production batches" htmlFor="bp"><Input id="bp" value={v.batch_prefix} onChange={(e) => patch({ batch_prefix: e.target.value })} /></Field>
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  );
}

export function AttributesManager({ attributes }: { attributes: AttributeDefinition[] }) {
  const { pending, save } = useSave();
  const [name, setName] = useState("");
  const [options, setOptions] = useState("");
  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save(async () => {
            const res = await saveAttributeAction(null, { name, options: options.split(",").map((s) => s.trim()).filter(Boolean) });
            if (res.ok) { setName(""); setOptions(""); }
            return res;
          });
        }}
      >
        <Field label="Attribute" htmlFor="attr-name"><Input id="attr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Colour" /></Field>
        <Field label="Options (comma separated, optional)" htmlFor="attr-opts"><Input id="attr-opts" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Red, Blue, Green" /></Field>
        <Button type="submit" disabled={pending || !name.trim()}><Plus /> Add</Button>
      </form>
      {attributes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attributes yet. Add things like Size, Colour, Material, Scent or Flavour — whatever describes your items.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {attributes.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <span className="font-medium">{a.name}</span>
              <span className="flex-1 truncate text-sm text-muted-foreground">{a.options.length ? a.options.join(", ") : "Free text"}</span>
              <EditAttributeDialog attribute={a} />
              <ConfirmAction
                trigger={<Button size="icon-sm" variant="ghost" aria-label={`Delete ${a.name}`}><Trash2 /></Button>}
                title={`Delete attribute "${a.name}"?`}
                description="Existing items keep the values already saved on them."
                confirmLabel="Delete"
                destructive
                action={() => deleteAttributeAction(a.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DemoDataCard({ hasDemo }: { hasDemo: boolean }) {
  return (
    <FormSection
      title="Demo data"
      description="Sample products, customers, suppliers, a purchase, a production batch, orders, payments and expenses — created through the same logic as real data and marked “Demo”."
    >
      <div className="flex flex-wrap gap-2">
        {hasDemo ? (
          <ConfirmAction
            trigger={<Button variant="destructive"><Trash2 /> Delete all demo data</Button>}
            title="Delete all demo data?"
            description="Removes every record marked Demo, including its stock history. Your real records are not touched. If any real order or purchase uses a demo item, nothing is deleted and you'll be told why."
            confirmLabel="Delete demo data"
            destructive
            action={deleteDemoDataAction}
          />
        ) : (
          <ConfirmAction
            trigger={<Button variant="outline"><Plus /> Load demo data</Button>}
            title="Load demo data?"
            description="Adds sample records marked Demo so you can explore. You can delete them all with one click later."
            confirmLabel="Load demo data"
            action={seedDemoDataAction}
          />
        )}
      </div>
    </FormSection>
  );
}

function EditAttributeDialog({ attribute }: { attribute: AttributeDefinition }) {
  const { pending, save } = useSave();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(attribute.name);
  const [options, setOptions] = useState(attribute.options.join(", "));
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setName(attribute.name); setOptions(attribute.options.join(", ")); } }}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${attribute.name}`}><Pencil /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit attribute</DialogTitle>
          <DialogDescription>Values already saved on items are kept.</DialogDescription>
        </DialogHeader>
        <form
          id={`attr-${attribute.id}`}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save(async () => {
              const res = await saveAttributeAction(attribute.id, { name, options: options.split(",").map((s) => s.trim()).filter(Boolean) });
              if (res.ok) setOpen(false);
              return res;
            });
          }}
        >
          <Field label="Attribute" htmlFor={`an-${attribute.id}`}><Input id={`an-${attribute.id}`} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Options (comma separated, optional)" htmlFor={`ao-${attribute.id}`}><Input id={`ao-${attribute.id}`} value={options} onChange={(e) => setOptions(e.target.value)} /></Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form={`attr-${attribute.id}`} disabled={pending || !name.trim()}>{pending && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
