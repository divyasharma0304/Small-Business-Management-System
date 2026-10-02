import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { ProductionTabs } from "@/components/production/production-tabs";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatQty } from "@/lib/format";

export const metadata: Metadata = { title: "Recipes" };

export default async function RecipesPage() {
  const ctx = await requireContext();
  if (!ctx.settings.module_production) redirect("/settings?tab=features");
  const { data } = await ctx.supabase
    .from("recipes")
    .select("*, product_variants!inner(name, is_default, selling_price, products!inner(name, unit)), recipe_items(count)")
    .eq("business_id", ctx.businessId)
    .order("name");
  type Row = {
    id: string; name: string; yield_quantity: number; is_active: boolean; is_demo: boolean;
    product_variants: { name: string; is_default: boolean; selling_price: number; products: { name: string; unit: string } };
    recipe_items: { count: number }[];
  };
  const rows = (data ?? []) as unknown as Row[];
  const costs = await Promise.all(rows.map((r) => ctx.supabase.rpc("recipe_estimated_cost", { p_recipe: r.id }).then(({ data }) => Number(data ?? 0))));

  return (
    <>
      <PageHeader title="Production" description="Turn materials into finished goods using recipes." actions={<Button asChild><Link href="/production/recipes/new"><Plus /> New recipe</Link></Button>} />
      <ProductionTabs active="recipes" />
      {rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No recipes yet" description="A recipe (bill of materials) lists the components needed to make a product — defined entirely by you." action={<Button asChild><Link href="/production/recipes/new"><Plus /> New recipe</Link></Button>} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe</TableHead>
                <TableHead>Makes</TableHead>
                <TableHead className="text-right">Components</TableHead>
                <TableHead className="text-right">Est. cost / unit</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Price</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const v = r.product_variants;
                return (
                  <TableRow key={r.id} className="relative">
                    <TableCell>
                      <Link href={`/production/recipes/${r.id}`} className="font-medium text-primary after:absolute after:inset-0 hover:underline">{r.name}</Link>
                      {r.is_demo && <DemoBadge />}
                    </TableCell>
                    <TableCell>{formatQty(r.yield_quantity, v.products.unit)} × {v.is_default ? v.products.name : `${v.products.name} — ${v.name}`}</TableCell>
                    <TableCell className="text-right tabular">{r.recipe_items[0]?.count ?? 0}</TableCell>
                    <TableCell className="text-right"><Money value={costs[i]} /></TableCell>
                    <TableCell className="hidden text-right sm:table-cell"><Money value={v.selling_price} /></TableCell>
                    <TableCell><StatusBadge status={r.is_active ? "active" : "inactive"} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
