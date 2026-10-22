import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, ImageIcon, Pencil, SlidersHorizontal } from "lucide-react";
import { ProductActiveToggle } from "@/components/catalog/product-active-toggle";
import { DeleteProductDialog } from "@/components/catalog/delete-product-dialog";
import { AdjustStockDialog } from "@/components/inventory/stock-dialogs";
import { Ledger, type LedgerRow } from "@/components/inventory/ledger";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { DemoBadge, StatusBadge, StockBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatPct, formatQty, titleCase } from "@/lib/format";
import { loadProduct, loadUndoneIds } from "@/lib/queries/catalog";
import { signedUrls } from "@/lib/storage";

export const metadata: Metadata = { title: "Item" };

export default async function ProductPage({ params }: PageProps<"/catalog/[id]">) {
  const { id } = await params;
  const ctx = await requireContext();
  const loaded = await loadProduct(ctx, id);
  if (!loaded) notFound();
  const { product, variants, components, levels } = loaded;
  const variantIds = variants.map((v) => v.id);

  const [{ data: category }, { data: txns }, { data: sales }, urls] = await Promise.all([
    product.category_id
      ? ctx.supabase.from("product_categories").select("name").eq("id", product.category_id).single()
      : Promise.resolve({ data: null }),
    ctx.supabase.from("inventory_transactions").select("*").in("variant_id", variantIds).order("occurred_at", { ascending: false }).limit(15),
    ctx.supabase
      .from("order_items")
      .select("quantity, net_amount, cogs_amount, orders!inner(status, recognized_at)")
      .in("variant_id", variantIds)
      .not("orders.recognized_at", "is", null)
      .not("orders.status", "in", "(cancelled,returned)"),
    signedUrls(ctx.supabase, [product.image_path, ...variants.map((v) => v.image_path)]),
  ]);

  const sold = (sales ?? []).reduce(
    (a, s) => ({ qty: a.qty + Number(s.quantity), revenue: a.revenue + Number(s.net_amount), cogs: a.cogs + Number(s.cogs_amount) }),
    { qty: 0, revenue: 0, cogs: 0 },
  );
  const tracks = product.track_inventory;
  const nameOf = (v: (typeof variants)[number]) => (v.is_default ? product.name : `${product.name} — ${v.name}`);
  const imageUrl = product.image_path ? urls.get(product.image_path) : null;

  return (
    <>
      <PageHeader
        title={product.name}
        back={{ href: "/catalog", label: "Products & Services" }}
        badge={
          <>
            {!product.is_active && <StatusBadge status="inactive" />}
            {product.is_demo && <DemoBadge />}
          </>
        }
        description={[titleCase(product.item_type), category?.name, product.unit].filter(Boolean).join(" · ")}
        actions={
          <>
            <ProductActiveToggle id={product.id} active={product.is_active} />
            <DeleteProductDialog id={product.id} name={product.name} active={product.is_active} />
            <Button asChild><Link href={`/catalog/${product.id}/edit`}><Pencil /> Edit</Link></Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>{product.has_variants ? "Variants" : "Pricing & stock"}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">{product.has_variants ? "Variant" : "SKU"}</TableHead>
                    {product.item_type !== "material" && <TableHead className="hidden text-right sm:table-cell">MRP</TableHead>}
                    {product.item_type !== "material" && <TableHead className="text-right">Price</TableHead>}
                    <TableHead className="text-right">Std. cost</TableHead>
                    {product.item_type !== "material" && <TableHead className="hidden text-right sm:table-cell">Margin</TableHead>}
                    {tracks && <TableHead className="text-right">Stock</TableHead>}
                    {tracks && <TableHead className="hidden text-right md:table-cell">Avg. cost</TableHead>}
                    {tracks && <TableHead className="pr-6" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map((v) => {
                    const l = levels.get(v.id);
                    const cost = tracks && l && Number(l.avg_cost) > 0 ? Number(l.avg_cost) : Number(v.cost_price);
                    const margin = v.selling_price > 0 ? ((v.selling_price - cost) / v.selling_price) * 100 : null;
                    return (
                      <TableRow key={v.id} className={v.is_active ? "" : "opacity-60"}>
                        <TableCell className="pl-6">
                          <div className="flex items-center gap-2">
                            {product.has_variants && v.image_path && urls.get(v.image_path) && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={urls.get(v.image_path)} alt="" className="size-8 rounded object-cover" />
                            )}
                            <div>
                              <div className="font-medium">{product.has_variants ? v.name : (v.sku ?? "—")}</div>
                              {product.has_variants && <div className="text-xs text-muted-foreground">{v.sku ?? "No SKU"}{Object.keys(v.attributes ?? {}).length > 0 && ` · ${Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(", ")}`}</div>}
                            </div>
                            {!v.is_active && <StatusBadge status="inactive" />}
                          </div>
                        </TableCell>
                        {product.item_type !== "material" && (
                          <TableCell className="hidden text-right sm:table-cell">
                            {v.mrp ? <><Money value={v.mrp} /><div className="text-xs text-muted-foreground">{Math.round(((v.mrp - v.selling_price) / v.mrp) * 1000) / 10}% off</div></> : "—"}
                          </TableCell>
                        )}
                        {product.item_type !== "material" && <TableCell className="text-right"><Money value={v.selling_price} /></TableCell>}
                        <TableCell className="text-right"><Money value={v.cost_price} /></TableCell>
                        {product.item_type !== "material" && <TableCell className="hidden text-right tabular sm:table-cell">{formatPct(margin)}</TableCell>}
                        {tracks && (
                          <TableCell className="text-right">
                            <div className="tabular">{formatQty(l?.quantity ?? 0, product.unit)}</div>
                            <StockBadge quantity={Number(l?.quantity ?? 0)} min={Number(l?.min_stock ?? 0)} max={l?.max_stock} />
                          </TableCell>
                        )}
                        {tracks && <TableCell className="hidden text-right md:table-cell"><Money value={l?.avg_cost ?? 0} /></TableCell>}
                        {tracks && (
                          <TableCell className="pr-6 text-right">
                            <div className="flex justify-end gap-1">
                              <AdjustStockDialog
                                item={{ variant_id: v.id, item_name: nameOf(v), unit: product.unit, quantity: Number(l?.quantity ?? 0), avg_cost: Number(l?.avg_cost ?? 0), highest_cost: Math.max(Number(v.cost_price), Number(l?.avg_cost ?? 0)) }}
                                trigger={<Button size="icon-sm" variant="ghost" aria-label="Adjust stock"><SlidersHorizontal /></Button>}
                              />
                              <Button size="icon-sm" variant="ghost" asChild aria-label="Stock history"><Link href={`/inventory/${v.id}`}><History /></Link></Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {tracks && (
            <div>
              <h2 className="mb-3 text-base font-semibold">Recent stock movements</h2>
              {(txns ?? []).length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No stock movements yet.</p>
              ) : (
                <Ledger
                  rows={(txns ?? []).map((t) => ({ ...t, item_name: nameOf(variants.find((v) => v.id === t.variant_id)!), unit: product.unit })) as LedgerRow[]}
                  timeZone={ctx.business.timezone}
                  showItem={product.has_variants}
                  undone={await loadUndoneIds(ctx, variantIds)}
                />
              )}
            </div>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-muted">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt={product.name} className="size-full object-cover" />
                ) : (
                  <ImageIcon className="size-10 text-muted-foreground" />
                )}
              </div>
              {product.description && <p className="text-sm whitespace-pre-line">{product.description}</p>}
              <dl className="mt-4 grid gap-2 text-sm">
                {product.brand && <Row label="Brand" value={product.brand} />}
                {ctx.business.tax_enabled && <Row label={ctx.business.tax_label} value={`${product.tax_rate}%`} />}
                <Row label="Stock tracking" value={tracks ? "On" : "Off"} />
                {Object.entries(product.attributes ?? {}).map(([k, v]) => <Row key={k} label={k} value={v} />)}
              </dl>
              {product.notes && <p className="mt-4 rounded-md bg-muted p-3 text-sm whitespace-pre-line">{product.notes}</p>}
            </CardContent>
          </Card>

          {product.item_type !== "material" && (
            <Card>
              <CardHeader><CardTitle>Sales to date</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  <Row label="Units sold" value={formatQty(sold.qty, product.unit)} />
                  <Row label="Revenue" value={<Money value={sold.revenue} />} />
                  <Row label="Cost of goods sold" value={<Money value={sold.cogs} />} />
                  <Row label="Gross profit" value={<Money value={sold.revenue - sold.cogs} />} />
                </dl>
              </CardContent>
            </Card>
          )}

          {components.length > 0 && product.cost_method === "components" && (
            <Card>
              <CardHeader><CardTitle>Cost build-up</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  {components.map((c, i) => <Row key={i} label={c.label} value={<Money value={c.amount} />} />)}
                  <div className="border-t pt-2"><Row label="Total" value={<Money value={components.reduce((a, c) => a + Number(c.amount), 0)} />} /></div>
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
