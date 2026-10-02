import type { Metadata } from "next";
import { FormSection } from "@/components/forms/field";
import { PageHeader } from "@/components/page-header";
import { LookupList } from "@/components/settings/lookup-list";
import { requireContext } from "@/lib/context";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const ctx = await requireContext();
  const [{ data: cats }, { data: usage }] = await Promise.all([
    ctx.supabase.from("product_categories").select("id, name, is_active, is_demo").eq("business_id", ctx.businessId).order("name"),
    ctx.supabase.from("products").select("category_id").eq("business_id", ctx.businessId).not("category_id", "is", null),
  ]);
  const counts = new Map<string, number>();
  for (const u of usage ?? []) counts.set(u.category_id as string, (counts.get(u.category_id as string) ?? 0) + 1);

  return (
    <>
      <PageHeader title="Categories" description="Group your products, services and materials." back={{ href: "/catalog", label: "Products & Services" }} />
      <FormSection title="Categories" description="Examples: Candles, Clothing, Cakes, Accessories, Repairs — whatever fits your business.">
        <LookupList
          table="product_categories"
          noun="Category"
          placeholder="New category name"
          rows={(cats ?? []).map((c) => ({ ...c, usage: counts.get(c.id) ?? 0 }))}
        />
      </FormSection>
    </>
  );
}
