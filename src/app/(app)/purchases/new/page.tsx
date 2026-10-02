import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PurchaseForm } from "@/components/purchases/purchase-form";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { loadCatalogFormData, loadVariantParents } from "@/lib/queries/catalog";
import { loadPickerItems, loadSuppliers } from "@/lib/queries/documents";

export const metadata: Metadata = { title: "New purchase" };

export default async function NewPurchasePage({ searchParams }: PageProps<"/purchases/new">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.settings.module_purchases) redirect("/settings?tab=features");
  const [items, suppliers] = await Promise.all([loadPickerItems(ctx, "purchase"), loadSuppliers(ctx)]);
  const supplier = typeof sp.supplier === "string" && suppliers.some((s) => s.id === sp.supplier) ? sp.supplier : null;

  return (
    <>
      <PageHeader title="New purchase" back={{ href: "/purchases", label: "Purchases" }} />
      <PurchaseForm
        init={{
          id: null,
          supplier_id: supplier,
          purchase_date: todayIn(ctx.business.timezone),
          invoice_number: "",
          status: "ordered",
          discount_amount: "",
          other_charges: "",
          attachment_path: null,
          notes: "",
          lines: [],
        }}
        items={items}
        suppliers={suppliers}
        tax={{ enabled: ctx.business.tax_enabled, label: ctx.business.tax_label, recoverable: ctx.business.purchase_tax_recoverable }}
        suppliersEnabled={ctx.settings.module_suppliers}
        businessId={ctx.businessId}
        attachmentUrl={null}
        country={ctx.business.country}
        categories={(await loadCatalogFormData(ctx)).categories}
        units={ctx.settings.units}
        defaultUnit={ctx.business.default_unit}
        variantParents={await loadVariantParents(ctx)}
      />
    </>
  );
}
