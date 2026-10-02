import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PurchaseForm } from "@/components/purchases/purchase-form";
import { requireContext } from "@/lib/context";
import { loadCatalogFormData, loadVariantParents } from "@/lib/queries/catalog";
import { loadPickerItems, loadSuppliers } from "@/lib/queries/documents";
import { signedUrl } from "@/lib/storage";
import type { Purchase, PurchaseItem } from "@/lib/types";

export const metadata: Metadata = { title: "Edit purchase" };

export default async function EditPurchasePage({ params }: PageProps<"/purchases/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("purchases").select("*").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const purchase = data as Purchase;
  const { data: lineRows } = await ctx.supabase.from("purchase_items").select("*").eq("purchase_id", id).order("sort_order");
  const lines = (lineRows ?? []) as PurchaseItem[];
  if (!["draft", "ordered"].includes(purchase.status) || lines.some((l) => l.received_quantity > 0)) redirect(`/purchases/${id}`);

  const [items, suppliers, attachmentUrl] = await Promise.all([
    loadPickerItems(ctx, "purchase"),
    loadSuppliers(ctx, purchase.supplier_id),
    signedUrl(ctx.supabase, purchase.attachment_path),
  ]);

  return (
    <>
      <PageHeader title={`Edit ${purchase.purchase_number}`} back={{ href: `/purchases/${id}`, label: purchase.purchase_number }} />
      <PurchaseForm
        init={{
          id: purchase.id,
          supplier_id: purchase.supplier_id,
          purchase_date: purchase.purchase_date,
          invoice_number: purchase.invoice_number ?? "",
          status: purchase.status as "draft" | "ordered",
          discount_amount: purchase.discount_amount ? String(purchase.discount_amount) : "",
          other_charges: purchase.other_charges ? String(purchase.other_charges) : "",
          attachment_path: purchase.attachment_path,
          notes: purchase.notes ?? "",
          lines: lines.map((l) => ({
            variant_id: l.variant_id,
            quantity: String(l.quantity),
            unit_price: String(l.unit_price),
            discount_amount: l.discount_amount ? String(l.discount_amount) : "",
            tax_rate: String(l.tax_rate),
          })),
        }}
        items={items}
        suppliers={suppliers}
        tax={{ enabled: ctx.business.tax_enabled, label: ctx.business.tax_label, recoverable: ctx.business.purchase_tax_recoverable }}
        suppliersEnabled={ctx.settings.module_suppliers}
        businessId={ctx.businessId}
        attachmentUrl={attachmentUrl}
        country={ctx.business.country}
        categories={(await loadCatalogFormData(ctx)).categories}
        units={ctx.settings.units}
        defaultUnit={ctx.business.default_unit}
        variantParents={await loadVariantParents(ctx)}
      />
    </>
  );
}
