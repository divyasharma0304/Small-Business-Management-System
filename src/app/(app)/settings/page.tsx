import type { Metadata } from "next";
import Link from "next/link";
import { PasswordForm } from "@/components/auth/password-form";
import { FormSection } from "@/components/forms/field";
import { PageHeader } from "@/components/page-header";
import { LookupList } from "@/components/settings/lookup-list";
import {
  AttributesManager,
  BusinessProfileForm,
  DemoDataCard,
  ModulesForm,
  OperationsForm,
} from "@/components/settings/settings-forms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatDateTime, titleCase } from "@/lib/format";
import { signedUrl } from "@/lib/storage";
import type { AttributeDefinition, AuditLog } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  { key: "business", label: "Business" },
  { key: "features", label: "Features" },
  { key: "operations", label: "Inventory & sales" },
  { key: "payment-methods", label: "Payment methods" },
  { key: "expense-categories", label: "Expense categories" },
  { key: "attributes", label: "Attributes" },
  { key: "data", label: "Demo data" },
  { key: "account", label: "Account" },
  { key: "audit", label: "Audit log" },
] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "business";
  const ctx = await requireContext();
  const { supabase, businessId } = ctx;

  return (
    <>
      <PageHeader title="Settings" description="Configure how Velqora works for your business." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Settings sections">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/settings?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                tab === t.key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === "business" && (
            <BusinessProfileForm business={ctx.business} logoUrl={await signedUrl(supabase, ctx.business.logo_path)} />
          )}
          {tab === "features" && <ModulesForm settings={ctx.settings} />}
          {tab === "operations" && <OperationsForm settings={ctx.settings} />}
          {tab === "payment-methods" && (
            <FormSection title="Payment methods" description="Offered when recording payments and expenses. Inactive methods are hidden from new entries.">
              <LookupList
                table="payment_methods"
                noun="Payment method"
                rows={(await supabase.from("payment_methods").select("id, name, is_active").eq("business_id", businessId).order("sort_order").order("name")).data ?? []}
              />
            </FormSection>
          )}
          {tab === "expense-categories" && (
            <FormSection title="Expense categories" description="Group your running costs for the expense and profit reports.">
              <LookupList
                table="expense_categories"
                noun="Category"
                rows={(await supabase.from("expense_categories").select("id, name, is_active").eq("business_id", businessId).order("name")).data ?? []}
              />
            </FormSection>
          )}
          {tab === "attributes" && (
            <FormSection title="Item attributes" description="Custom fields for your products and variants — e.g. Size, Colour, Material, Scent, Flavour, Storage.">
              <AttributesManager
                attributes={((await supabase.from("attribute_definitions").select("*").eq("business_id", businessId).order("sort_order").order("name")).data ?? []) as AttributeDefinition[]}
              />
            </FormSection>
          )}
          {tab === "data" && (
            <DemoDataCard
              hasDemo={((await supabase.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_demo", true)).count ?? 0) > 0}
            />
          )}
          {tab === "account" && (
            <div className="grid gap-6">
              <FormSection title="Account">
                <p className="text-sm">Signed in as <span className="font-medium">{ctx.email}</span></p>
              </FormSection>
              <FormSection title="Change password">
                <PasswordForm />
              </FormSection>
            </div>
          )}
          {tab === "audit" && <AuditTable ctx={ctx} />}
        </div>
      </div>
    </>
  );
}

async function AuditTable({ ctx }: { ctx: Awaited<ReturnType<typeof requireContext>> }) {
  const { data } = await ctx.supabase
    .from("audit_logs")
    .select("*")
    .eq("business_id", ctx.businessId)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as AuditLog[];
  return (
    <FormSection title="Audit log" description="The latest 200 important actions.">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at, ctx.business.timezone)}</TableCell>
                  <TableCell className="whitespace-nowrap">{titleCase(r.action.replace(".", " "))}</TableCell>
                  <TableCell className="max-w-md truncate">{r.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </FormSection>
  );
}
