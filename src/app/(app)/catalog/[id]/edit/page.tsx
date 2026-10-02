import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ProductDraft } from "@/components/catalog/product-draft";
import { ProductForm } from "@/components/catalog/product-form";
import { PageHeader } from "@/components/page-header";
import { requireContext } from "@/lib/context";
import { loadCatalogFormData, loadProduct } from "@/lib/queries/catalog";
import { signedUrls } from "@/lib/storage";

export const metadata: Metadata = { title: "Edit item" };

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export default async function EditProductPage({ params }: PageProps<"/catalog/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireContext();
  const [loaded, { categories, attributeDefs }] = await Promise.all([loadProduct(ctx, id), loadCatalogFormData(ctx)]);
  if (!loaded) notFound();
  const { product, variants, components, levels, withHistory } = loaded;

  const urls = await signedUrls(ctx.supabase, [product.image_path, ...variants.map((v) => v.image_path)]);
  let recipeCost: number | null = null;
  if (product.cost_method === "recipe") {
    const { data: recipe } = await ctx.supabase.from("recipes").select("id").in("variant_id", variants.map((v) => v.id)).eq("is_active", true).limit(1).maybeSingle();
    if (recipe) recipeCost = Number((await ctx.supabase.rpc("recipe_estimated_cost", { p_recipe: recipe.id })).data ?? 0);
  }

  const initial: ProductDraft = {
    id: product.id,
    item_type: product.item_type,
    name: product.name,
    category_id: product.category_id,
    description: product.description ?? "",
    unit: product.unit,
    tax_rate: String(product.tax_rate),
    track_inventory: product.track_inventory,
    has_variants: product.has_variants,
    cost_method: product.cost_method,
    brand: product.brand ?? "",
    attributes: product.attributes ?? {},
    image_path: product.image_path,
    notes: product.notes ?? "",
    is_active: product.is_active,
    components: components.map((c) => ({ key: crypto.randomUUID(), label: c.label, amount: String(c.amount) })),
    variants: variants.map((v) => {
      const l = levels.get(v.id);
      return {
        key: v.id,
        id: v.id,
        name: v.is_default ? "" : v.name,
        sku: v.sku ?? "",
        selling_price: String(v.selling_price),
        cost_price: String(v.cost_price),
        attributes: v.attributes ?? {},
        image_path: v.image_path,
        is_active: v.is_active,
        min_stock: str(l?.min_stock),
        max_stock: str(l?.max_stock),
        location: l?.location ?? "",
        opening_stock: "",
        opening_unit_cost: "",
        hasHistory: withHistory.has(v.id),
        currentStock: l ? Number(l.quantity) : null,
      };
    }),
  };

  return (
    <>
      <PageHeader title={`Edit ${product.name}`} back={{ href: `/catalog/${id}`, label: product.name }} />
      <ProductForm
        businessId={ctx.businessId}
        initial={initial}
        categories={categories}
        attributeDefs={attributeDefs}
        units={ctx.settings.units}
        features={{
          inventory: ctx.settings.module_inventory,
          variants: ctx.settings.module_variants || product.has_variants,
          production: ctx.settings.module_production,
          taxEnabled: ctx.business.tax_enabled,
          defaultMinStock: ctx.settings.default_min_stock,
        }}
        imageUrls={Object.fromEntries(urls)}
        estimatedRecipeCost={recipeCost}
      />
    </>
  );
}
