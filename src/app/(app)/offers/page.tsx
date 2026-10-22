import type { Metadata } from "next";
import { BadgePercent, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { OfferDialog } from "@/components/offers/offer-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { deleteOfferAction } from "@/lib/actions/offers";
import { offerIsLive } from "@/lib/calc/offers";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { loadOffers } from "@/lib/queries/documents";

export const metadata: Metadata = { title: "Offers" };

export default async function OffersPage() {
  const ctx = await requireContext();
  const [offers, { data: cats }, { data: prods }] = await Promise.all([
    loadOffers(ctx),
    ctx.supabase.from("product_categories").select("id, name").eq("business_id", ctx.businessId).order("name"),
    ctx.supabase.from("products").select("id, name").eq("business_id", ctx.businessId).neq("item_type", "material").eq("is_active", true).order("name"),
  ]);
  const categories = cats ?? [];
  const products = prods ?? [];
  const nameOf = (list: { id: string; name: string }[], ids: string[]) => ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean).join(", ");
  const today = todayIn(ctx.business.timezone);
  const add = <OfferDialog categories={categories} products={products} trigger={<Button><Plus /> New offer</Button>} />;

  return (
    <>
      <PageHeader title="Offers" description="Pack discounts on MRP, applied automatically to new orders." actions={add} />
      {offers.length === 0 ? (
        <EmptyState icon={BadgePercent} title="No offers yet" description="Create offers like “Pack of 2 – 28% off MRP”." action={add} />
      ) : (
        <div className="grid gap-3">
          {offers.map((o) => {
            const live = offerIsLive(o, today);
            return (
              <div key={o.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{o.name}</h2>
                      {live ? <StatusBadge status="active" label="Running" /> : <StatusBadge status="inactive" label={o.is_active ? (o.starts_on && o.starts_on > today ? "Not started" : "Ended") : "Off"} />}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {o.starts_on || o.ends_on ? `${o.starts_on ? formatDate(o.starts_on) : "Any time"} – ${o.ends_on ? formatDate(o.ends_on) : "no end"}` : "No date limit"}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <OfferDialog initial={o} categories={categories} products={products} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Edit ${o.name}`}><Pencil /></Button>} />
                    <ConfirmAction
                      trigger={<Button size="icon-sm" variant="ghost" aria-label={`Delete ${o.name}`}><Trash2 /></Button>}
                      title={`Delete offer "${o.name}"?`}
                      description="It won't be applied to new orders. Orders already made keep their prices."
                      confirmLabel="Delete"
                      destructive
                      action={deleteOfferAction.bind(null, o.id)}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {o.tiers.map((t) => <Badge key={t.min_qty} tone="primary">Pack of {t.min_qty}+ → {t.discount_pct}% off MRP</Badge>)}
                </div>
                <dl className="mt-3 grid gap-1 text-sm">
                  {o.category_ids.length > 0 && <div><dt className="inline text-muted-foreground">Categories: </dt><dd className="inline">{nameOf(categories, o.category_ids)}</dd></div>}
                  {o.product_ids.length > 0 && <div><dt className="inline text-muted-foreground">Also: </dt><dd className="inline">{nameOf(products, o.product_ids)}</dd></div>}
                  {o.exclude_product_ids.length > 0 && <div><dt className="inline text-muted-foreground">Except: </dt><dd className="inline">{nameOf(products, o.exclude_product_ids)}</dd></div>}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
