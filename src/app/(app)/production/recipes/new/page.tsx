import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { RecipeForm } from "@/components/production/recipe-form";
import { requireContext } from "@/lib/context";
import { loadPickerItems } from "@/lib/queries/documents";

export const metadata: Metadata = { title: "New recipe" };

export default async function NewRecipePage({ searchParams }: PageProps<"/production/recipes/new">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const items = await loadPickerItems(ctx, "component");
  const output = typeof sp.variant === "string" && items.some((i) => i.variant_id === sp.variant) ? sp.variant : null;
  return (
    <>
      <PageHeader title="New recipe" back={{ href: "/production/recipes", label: "Recipes" }} />
      <RecipeForm
        init={{ id: null, name: "", variant_id: output, yield_quantity: "1", notes: "", is_active: true, items: [] }}
        items={items}
        defaultWastage={Number(ctx.settings.default_wastage_pct)}
      />
    </>
  );
}
