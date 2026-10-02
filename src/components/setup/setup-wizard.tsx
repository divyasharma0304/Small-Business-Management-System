"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FileUpload } from "@/components/forms/file-upload";
import {
  DEFAULT_PROFILE,
  IdentityFields,
  LocationFields,
  TaxFields,
  ToggleRow,
  type BusinessProfileState,
} from "@/components/settings/business-profile-fields";
import { Button } from "@/components/ui/button";
import { createBusinessAction, setBusinessLogoAction } from "@/lib/actions/business";
import { cn } from "@/lib/utils";

const STEPS = ["Your business", "Location & tax", "Features", "Logo"] as const;

export const MODULE_INFO = [
  { key: "inventory", label: "Inventory", description: "Track stock quantities, low-stock alerts and stock value." },
  { key: "purchases", label: "Purchases", description: "Record purchases from suppliers and receive stock.", requires: "inventory" },
  { key: "suppliers", label: "Suppliers", description: "Keep a list of the businesses you buy from." },
  { key: "customers", label: "Customers", description: "Keep customer details and see who owes you money." },
  { key: "production", label: "Production", description: "Make products from materials using recipes (BOMs).", requires: "inventory" },
  { key: "expenses", label: "Expenses", description: "Record running costs like rent, ads and software." },
  { key: "variants", label: "Product variants", description: "Sizes, colours, flavours… each with its own SKU, price and stock." },
] as const;

export type ModuleKey = (typeof MODULE_INFO)[number]["key"];
export type ModulesState = Record<ModuleKey, boolean>;

/** Suggested modules per business type; the owner can change them freely. */
function suggestedModules(type: string): ModulesState {
  const base: ModulesState = { inventory: true, purchases: true, suppliers: true, customers: true, production: false, expenses: true, variants: true };
  if (type === "services") return { ...base, inventory: false, purchases: false, suppliers: false, variants: false };
  if (type === "manufacturing" || type === "handmade" || type === "food") return { ...base, production: true };
  return base;
}

export function SetupWizard({ email }: { email: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<BusinessProfileState>({ ...DEFAULT_PROFILE, email });
  const [modules, setModules] = useState<ModulesState>(suggestedModules(DEFAULT_PROFILE.business_type));
  const [modulesTouched, setModulesTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patch = (p: Partial<BusinessProfileState>) => {
    setProfile((s) => ({ ...s, ...p }));
    if (p.business_type && !modulesTouched) setModules(suggestedModules(p.business_type));
  };

  function next() {
    if (step === 0 && !profile.name.trim()) {
      setErrors({ name: "Business name is required" });
      return;
    }
    setErrors({});
    setStep((s) => s + 1);
  }

  function create() {
    startTransition(async () => {
      const res = await createBusinessAction({ ...profile, modules });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        const f = Object.keys(res.fieldErrors ?? {});
        if (f.some((k) => ["name", "business_type", "email", "phone", "description", "owner_name"].includes(k))) setStep(0);
        else if (f.length) setStep(1);
        return;
      }
      setBusinessId(res.data.id);
      setStep(3);
    });
  }

  function finish() {
    startTransition(async () => {
      if (logo) {
        const res = await setBusinessLogoAction(logo);
        if (!res.ok) toast.error(res.error);
      }
      toast.success("Your business is ready");
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <ol className="flex border-b">
        {STEPS.map((label, i) => (
          <li key={label} className={cn("flex flex-1 items-center gap-2 px-3 py-3 text-xs sm:px-4 sm:text-sm", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs", i < step && "border-primary bg-primary text-primary-foreground", i === step && "border-primary text-primary")}>
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </li>
        ))}
      </ol>

      <div className="p-4 sm:p-6">
        {step === 0 && (
          <Section title="Tell us about your business" description="You can change all of this later in Settings.">
            <IdentityFields value={profile} onChange={patch} errors={errors} />
          </Section>
        )}
        {step === 1 && (
          <Section title="Location, currency & tax" description="Defaults are set for India (₹ INR). Tax is optional.">
            <LocationFields value={profile} onChange={patch} errors={errors} />
            <div className="mt-6 border-t pt-6">
              <TaxFields value={profile} onChange={patch} errors={errors} />
            </div>
          </Section>
        )}
        {step === 2 && (
          <Section title="Choose the features you need" description="Turn off anything that doesn't apply. You can enable it later.">
            <div className="grid gap-4">
              {MODULE_INFO.map((m) => {
                const blocked = "requires" in m && !modules[m.requires];
                return (
                  <ToggleRow
                    key={m.key}
                    id={`module-${m.key}`}
                    label={m.label}
                    description={blocked ? `${m.description} (needs Inventory)` : m.description}
                    checked={modules[m.key] && !blocked}
                    disabled={blocked}
                    onChange={(v) => {
                      setModulesTouched(true);
                      setModules((s) => ({ ...s, [m.key]: v }));
                    }}
                  />
                );
              })}
            </div>
          </Section>
        )}
        {step === 3 && businessId && (
          <Section title="Add your logo (optional)" description="Shown in the sidebar. PNG, JPG or WebP up to 10 MB.">
            <FileUpload businessId={businessId} folder="logos" value={logo} onChange={setLogo} label="Upload logo" />
          </Section>
        )}
      </div>

      <div className="flex items-center justify-between border-t px-4 py-3 sm:px-6">
        {step > 0 && step < 3 ? (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            <ArrowLeft /> Back
          </Button>
        ) : (
          <span />
        )}
        {step < 2 && (
          <Button onClick={next}>
            Continue <ArrowRight />
          </Button>
        )}
        {step === 2 && (
          <Button onClick={create} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Create business
          </Button>
        )}
        {step === 3 && (
          <Button onClick={finish} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {logo ? "Save & go to dashboard" : "Skip & go to dashboard"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-6 text-sm text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}
