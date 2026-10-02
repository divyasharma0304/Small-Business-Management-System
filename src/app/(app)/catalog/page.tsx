import type { Metadata } from "next";
import Link from "next/link";
import { ImageIcon, Package, Plus, Tags } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatQty, titleCase } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import { signedUrls } from "@/lib/storage";

export const metadata: Metadata = { title: "Products & Services" };

interface Row {
  id: string;
  name: string;
  item_type: string;
  category_name: string | null;
  unit: string;
  track_inventory: boolean;
  has_variants: boolean;
  is_active: boolean;
  is_demo: boolean;
  image_path: string | null;
  variant_count: number;
  min_price: number | null;
  max_price: number | null;
  skus: string | null;
  stock_quantity: number | null;
  is_low: boolean | null;
}

export default async function CatalogPage({ searchParams }: PageProps<"/catalog">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const lp = parseListParams(sp, { sortable: ["name", "created_at", "min_price", "stock_quantity"], defaultSort: "name", defaultDir: "asc" });

  const { data: categories } = await ctx.supabase.from("product_categories").select("id, name").eq("business_id", ctx.businessId).order("name");

  let q = ctx.supabase.from("catalog_overview").select("*", { count: "exact" }).eq("business_id", ctx.businessId);
  if (lp.q) q = q.or(`name.ilike.${ilikeTerm(lp.q)},skus.ilike.${ilikeTerm(lp.q)}`);
  const type = lp.get("type");
  if (type) q = q.eq("item_type", type);
  const category = lp.get("category");
  if (category) q = category === "none" ? q.is("category_id", null) : q.eq("category_id", category);
  const status = lp.get("status");
  if (status === "active") q = q.eq("is_active", true);
  if (status === "inactive") q = q.eq("is_active", false);
  if (status === "low") q = q.eq("is_low", true);
  const { data, count } = await q.order(lp.sort, { ascending: lp.dir === "asc", nullsFirst: false }).range(lp.from, lp.to);
  const rows = (data ?? []) as Row[];
  const urls = await signedUrls(ctx.supabase, rows.map((r) => r.image_path));
  const filtered = Boolean(lp.q || type || category || lp.get("status"));

  return (
    <>
      <PageHeader
        title="Products & Services"
        description="Everything you sell, and the materials you use."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/catalog/categories"><Tags /> Categories</Link></Button>
            <Button asChild><Link href="/catalog/new"><Plus /> Add item</Link></Button>
          </>
        }
      />
      <ListToolbar
        searchPlaceholder="Search name or SKU…"
        filters={[
          { key: "type", label: "Types", options: [{ value: "product", label: "Products" }, { value: "service", label: "Services" }, { value: "material", label: "Materials" }] },
          { key: "category", label: "Categories", options: [{ value: "none", label: "Uncategorised" }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))] },
          { key: "status", label: "Statuses", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "low", label: "Low stock" }] },
        ]}
      />
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={Package} title="No items match" description="Try a different search or clear the filters." />
        ) : (
          <EmptyState
            icon={Package}
            title="No products added yet"
            description="Add the products and services you sell, and any materials you buy to make them."
            action={<Button asChild><Link href="/catalog/new"><Plus /> Add product</Link></Button>}
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader column="name" label="Item" pathname="/catalog" searchParams={sp} current={lp.sort} dir={lp.dir} />
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Category</TableHead>
                  <SortHeader column="min_price" label="Price" pathname="/catalog" searchParams={sp} current={lp.sort} dir={lp.dir} className="text-right" align="right" />
                  <SortHeader column="stock_quantity" label="Stock" pathname="/catalog" searchParams={sp} current={lp.sort} dir={lp.dir} className="text-right" align="right" />
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="relative">
                    <TableCell>
                      <Link href={`/catalog/${r.id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                          {r.image_path && urls.get(r.image_path) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={urls.get(r.image_path)} alt="" className="size-full object-cover" />
                          ) : (
                            <ImageIcon className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.has_variants ? `${r.variant_count} variants` : r.skus || "No SKU"}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{titleCase(r.item_type)}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{r.category_name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {r.item_type === "material" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : r.min_price !== r.max_price ? (
                        <span className="whitespace-nowrap"><Money value={r.min_price} /> – <Money value={r.max_price} /></span>
                      ) : (
                        <Money value={r.min_price} />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {r.track_inventory ? (
                        <span className={r.is_low ? "font-medium text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning" : ""}>
                          {formatQty(r.stock_quantity, r.unit)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not tracked</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {r.is_active ? (r.is_low ? <StatusBadge status="low" label="Low stock" /> : <StatusBadge status="active" />) : <StatusBadge status="inactive" />}
                        {r.is_demo && <DemoBadge />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/catalog" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
