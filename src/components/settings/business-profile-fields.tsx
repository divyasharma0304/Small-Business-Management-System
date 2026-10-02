"use client";

import { Field } from "@/components/forms/field";
import { SimpleSelect } from "@/components/forms/simple-select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BUSINESS_TYPES, CURRENCIES, TIMEZONES } from "@/lib/validation/business";

export interface BusinessProfileState {
  name: string;
  business_type: string;
  description: string;
  owner_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  currency: string;
  timezone: string;
  tax_enabled: boolean;
  tax_label: string;
  tax_number: string;
  default_tax_rate: string;
  prices_include_tax: boolean;
  purchase_tax_recoverable: boolean;
  default_unit: string;
}

export const DEFAULT_PROFILE: BusinessProfileState = {
  name: "",
  business_type: "retail",
  description: "",
  owner_name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  postal_code: "",
  country: "India",
  currency: "INR",
  timezone: "Asia/Kolkata",
  tax_enabled: false,
  tax_label: "GST",
  tax_number: "",
  default_tax_rate: "0",
  prices_include_tax: false,
  purchase_tax_recoverable: false,
  default_unit: "pcs",
};

type Props = {
  value: BusinessProfileState;
  onChange: (patch: Partial<BusinessProfileState>) => void;
  errors: Record<string, string>;
};

export function IdentityFields({ value, onChange, errors }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Business name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
        <Input id="name" value={value.name} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!!errors.name} autoFocus />
      </Field>
      <Field label="Business type" htmlFor="business_type" error={errors.business_type}>
        <SimpleSelect
          id="business_type"
          value={value.business_type}
          onChange={(v) => onChange({ business_type: v })}
          options={BUSINESS_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
      </Field>
      <Field label="Owner name" htmlFor="owner_name" error={errors.owner_name}>
        <Input id="owner_name" value={value.owner_name} onChange={(e) => onChange({ owner_name: e.target.value })} />
      </Field>
      <Field label="Email" htmlFor="biz_email" error={errors.email}>
        <Input id="biz_email" type="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} aria-invalid={!!errors.email} />
      </Field>
      <Field label="Phone" htmlFor="phone" error={errors.phone}>
        <Input id="phone" type="tel" value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} aria-invalid={!!errors.phone} />
      </Field>
      <Field label="Description" htmlFor="description" error={errors.description} className="sm:col-span-2" hint="What does the business sell or do?">
        <Textarea id="description" rows={3} value={value.description} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
    </div>
  );
}

export function LocationFields({ value, onChange, errors }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Address" htmlFor="address" error={errors.address} className="sm:col-span-2">
        <Textarea id="address" rows={2} value={value.address} onChange={(e) => onChange({ address: e.target.value })} />
      </Field>
      <Field label="City" htmlFor="city" error={errors.city}>
        <Input id="city" value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
      </Field>
      <Field label="State / region" htmlFor="state" error={errors.state}>
        <Input id="state" value={value.state} onChange={(e) => onChange({ state: e.target.value })} />
      </Field>
      <Field label="Postal code" htmlFor="postal_code" error={errors.postal_code}>
        <Input id="postal_code" value={value.postal_code} onChange={(e) => onChange({ postal_code: e.target.value })} />
      </Field>
      <Field label="Country" htmlFor="country" required error={errors.country}>
        <Input id="country" value={value.country} onChange={(e) => onChange({ country: e.target.value })} aria-invalid={!!errors.country} />
      </Field>
      <Field label="Currency" htmlFor="currency" error={errors.currency}>
        <SimpleSelect id="currency" value={value.currency} onChange={(v) => onChange({ currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </Field>
      <Field label="Timezone" htmlFor="timezone" error={errors.timezone} hint="Used to decide what “today” means.">
        <SimpleSelect id="timezone" value={value.timezone} onChange={(v) => onChange({ timezone: v })} options={TIMEZONES.map((t) => ({ value: t, label: t }))} />
      </Field>
      <Field label="Default unit" htmlFor="default_unit" error={errors.default_unit} hint="e.g. pcs, kg, hour">
        <Input id="default_unit" value={value.default_unit} onChange={(e) => onChange({ default_unit: e.target.value })} />
      </Field>
    </div>
  );
}

export function TaxFields({ value, onChange, errors }: Props) {
  return (
    <div className="grid gap-4">
      <ToggleRow
        id="tax_enabled"
        label="Charge tax on sales"
        description="Turn on if you are registered for GST/VAT or similar. Leave off if you don't charge tax."
        checked={value.tax_enabled}
        onChange={(v) => onChange({ tax_enabled: v })}
      />
      {value.tax_enabled && (
        <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
          <Field label="Tax name" htmlFor="tax_label" error={errors.tax_label}>
            <Input id="tax_label" value={value.tax_label} onChange={(e) => onChange({ tax_label: e.target.value })} />
          </Field>
          <Field label="Registration no." htmlFor="tax_number" error={errors.tax_number} hint="e.g. GSTIN">
            <Input id="tax_number" value={value.tax_number} onChange={(e) => onChange({ tax_number: e.target.value })} />
          </Field>
          <Field label="Default rate (%)" htmlFor="default_tax_rate" error={errors.default_tax_rate}>
            <Input id="default_tax_rate" type="number" min={0} max={100} step="0.01" value={value.default_tax_rate}
              onChange={(e) => onChange({ default_tax_rate: e.target.value })} aria-invalid={!!errors.default_tax_rate} />
          </Field>
          <ToggleRow
            id="prices_include_tax"
            className="sm:col-span-3"
            label="My selling prices already include tax"
            description="If on, tax is extracted from the price (₹118 incl. 18% = ₹100 + ₹18). If off, tax is added on top."
            checked={value.prices_include_tax}
            onChange={(v) => onChange({ prices_include_tax: v })}
          />
          <ToggleRow
            id="purchase_tax_recoverable"
            className="sm:col-span-3"
            label="I can claim back tax paid on purchases (input credit)"
            description="If on, purchase tax is excluded from stock cost. If off, it becomes part of the cost."
            checked={value.purchase_tax_recoverable}
            onChange={(v) => onChange({ purchase_tax_recoverable: v })}
          />
        </div>
      )}
    </div>
  );
}

export function ToggleRow({ id, label, description, checked, onChange, disabled, className }: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className ?? ""}`}>
      <label htmlFor={id} className="grid gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium">{label}</span>
        {description && <span id={`${id}-desc`} className="text-sm text-muted-foreground">{description}</span>}
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
      />
    </div>
  );
}
