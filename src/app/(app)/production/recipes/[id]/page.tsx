import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { deleteRecipeAction } from "@/lib/actions/production";
import { PageHeader } from "@/components/page-header";
import { NewBatchDialog } from "@/components/production/batch-dialogs";
import { RecipeForm } from "@/components/production/recipe-form";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { loadPickerItems } from "@/lib/queries/documents";
import { loadRecipeOptions } from "@/lib/queries/production";
import type { Recipe, RecipeItem } from "@/lib/types";

export const metadata: Metadata = { title: "Edit recipe" };

export default async function EditRecipePage({ params }: PageProps<"/production/recipes/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const { data } = await ctx.supabase.from("recipes").select("*, recipe_items(*)").eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
  if (!data) notFound();
  const recipe = data as Recipe & { recipe_items: RecipeItem[] };
  const [items, recipes] = await Promise.all([loadPickerItems(ctx, "component"), loadRecipeOptions(ctx)]);

  return (
    <>
      <PageHeader
        title={recipe.name}
        back={{ href: "/production/recipes", label: "Recipes" }}
        actions={
          <>
            <ConfirmAction
              trigger={<Button variant="ghost"><Trash2 /> Delete</Button>}
              title={`Delete recipe "${recipe.name}"?`}
              description="The recipe is removed. Production batches already made with it are kept, and your stock doesn't change."
              confirmLabel="Delete recipe"
              destructive
              action={deleteRecipeAction.bind(null, recipe.id)}
              redirectTo="/production/recipes"
            />
            {recipe.is_active && <NewBatchDialog recipes={recipes} today={todayIn(ctx.business.timezone)} defaultRecipe={recipe.id} />}
          </>
        }
      />
      <RecipeForm
        init={{
          id: recipe.id,
          name: recipe.name,
          variant_id: recipe.variant_id,
          yield_quantity: String(recipe.yield_quantity),
          notes: recipe.notes ?? "",
          is_active: recipe.is_active,
          items: [...recipe.recipe_items].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ component_variant_id: i.component_variant_id, quantity: String(i.quantity), wastage_pct: String(i.wastage_pct) })),
        }}
        items={items}
        defaultWastage={Number(ctx.settings.default_wastage_pct)}
      />
    </>
  );
}
