"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { ToggleRow } from "@/components/settings/business-profile-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveCustomerAction, saveSupplierAction } from "@/lib/actions/parties";

export interface PartyValues {
  id?: string | null;
  name: string;
  contact_person?: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  tax_number: string | null;
  notes: string | null;
  is_active?: boolean;
}

/**
 * Create/edit dialog for suppliers and customers. `onSaved` lets other forms
 * (e.g. a new order) create a customer inline and select it immediately.
 */
export function PartyDialog({
  kind,
  initial,
  trigger,
  defaultCountry,
  onSaved,
  taxLabel = "GST",
}: {
  kind: "supplier" | "customer";
  initial?: PartyValues;
  trigger: ReactNode;
  defaultCountry?: string;
  onSaved?: (id: string, name: string) => void;
  taxLabel?: string;
}) {
  const router = useRouter();
  const blank: PartyValues = { name: "", contact_person: "", phone: "", email: "", address: "", city: "", state: "", country: defaultCountry ?? "", tax_number: "", notes: "", is_active: true };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<PartyValues>(initial ?? blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const set = (p: Partial<PartyValues>) => setV((s) => ({ ...s, ...p }));
  const noun = kind === "supplier" ? "supplier" : "customer";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await (kind === "supplier" ? saveSupplierAction(v) : saveCustomerAction(v));
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      setErrors({});
      if (onSaved) onSaved(res.data.id, v.name);
      if (!initial) setV(blank);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setV(initial ?? blank); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
          <DialogDescription>Only the name is required.</DialogDescription>
        </DialogHeader>
        <form id={`party-${kind}`} onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Name" htmlFor="p-name" required error={errors.name} className="sm:col-span-2">
            <Input id="p-name" value={v.name} onChange={(e) => set({ name: e.target.value })} autoFocus aria-invalid={!!errors.name} />
          </Field>
          {kind === "supplier" && (
            <Field label="Contact person" htmlFor="p-contact" className="sm:col-span-2">
              <Input id="p-contact" value={v.contact_person ?? ""} onChange={(e) => set({ contact_person: e.target.value })} />
            </Field>
          )}
          <Field label="Phone" htmlFor="p-phone" error={errors.phone}>
            <Input id="p-phone" type="tel" value={v.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!errors.phone} />
          </Field>
          <Field label="Email" htmlFor="p-email" error={errors.email}>
            <Input id="p-email" type="email" value={v.email ?? ""} onChange={(e) => set({ email: e.target.value })} aria-invalid={!!errors.email} />
          </Field>
          <Field label="Address" htmlFor="p-address" className="sm:col-span-2">
            <Textarea id="p-address" rows={2} value={v.address ?? ""} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          <Field label="City" htmlFor="p-city"><Input id="p-city" value={v.city ?? ""} onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label="State" htmlFor="p-state"><Input id="p-state" value={v.state ?? ""} onChange={(e) => set({ state: e.target.value })} /></Field>
          <Field label="Country" htmlFor="p-country"><Input id="p-country" value={v.country ?? ""} onChange={(e) => set({ country: e.target.value })} /></Field>
          <Field label={`${taxLabel} / tax number`} htmlFor="p-tax"><Input id="p-tax" value={v.tax_number ?? ""} onChange={(e) => set({ tax_number: e.target.value })} /></Field>
          <Field label="Notes" htmlFor="p-notes" className="sm:col-span-2">
            <Textarea id="p-notes" rows={2} value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          {kind === "supplier" && initial && (
            <ToggleRow id="p-active" className="sm:col-span-2" label="Active" description="Inactive suppliers are hidden when creating purchases." checked={v.is_active ?? true} onChange={(x) => set({ is_active: x })} />
          )}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form={`party-${kind}`} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {initial ? "Save" : `Add ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
