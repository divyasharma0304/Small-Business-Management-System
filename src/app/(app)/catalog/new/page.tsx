import type { Metadata } from "next";
import { emptyVariant, type ProductDraft } from "@/components/catalog/product-draft";
import { ProductForm } from "@/components/catalog/product-form";
import { PageHeader } from "@/components/page-header";
import { requireContext } from "@/lib/context";
import { loadCatalogFormData } from "@/lib/queries/catalog";
import type { ItemType } from "@/lib/types";

export const metadata: Metadata = { title: "Add item" };

export default async function NewProductPage({ searchParams }: PageProps<"/catalog/new">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { categories, attributeDefs } = await loadCatalogFormData(ctx);
  const type = (["product", "service", "material"].includes(String(sp.type)) ? sp.type : "product") as ItemType;

  const initial: ProductDraft = {
    id: null,
    item_type: type,
    name: "",
    category_id: typeof sp.category === "string" ? sp.category : null,
    description: "",
    unit: type === "service" ? (ctx.settings.units.includes("job") ? "job" : ctx.business.default_unit) : ctx.business.default_unit,
    tax_rate: String(ctx.business.default_tax_rate),
    track_inventory: type !== "service" && ctx.settings.module_inventory,
    has_variants: false,
    cost_method: "manual",
    brand: "",
    attributes: {},
    image_path: null,
    notes: "",
    is_active: true,
    variants: [emptyVariant()],
    components: [],
  };

  return (
    <>
      <PageHeader title="Add item" back={{ href: "/catalog", label: "Products & Services" }} />
      <ProductForm
        businessId={ctx.businessId}
        initial={initial}
        categories={categories}
        attributeDefs={attributeDefs}
        units={ctx.settings.units}
        features={{
          inventory: ctx.settings.module_inventory,
          variants: ctx.settings.module_variants,
          production: ctx.settings.module_production,
          taxEnabled: ctx.business.tax_enabled,
          defaultMinStock: ctx.settings.default_min_stock,
        }}
        imageUrls={{}}
        estimatedRecipeCost={null}
      />
    </>
  );
}
