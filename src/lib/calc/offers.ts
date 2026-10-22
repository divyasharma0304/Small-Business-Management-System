/**
 * Pack offers ("Pack of 2 – 28% off MRP").
 *
 * Rules:
 *  - An item qualifies for an offer if it has an MRP and is in one of the offer's
 *    categories or products, and is not excluded.
 *  - Quantities of all qualifying lines are added up (sizes and fragrances can be
 *    mixed). The highest tier reached applies to every qualifying unit.
 *  - Offer price = MRP × (1 − tier %), rounded to the nearest rupee.
 *  - Each line belongs to at most one offer (offers are tried in priority order).
 *  - Lines whose price the user typed by hand are left alone.
 */

export interface Offer {
  id: string;
  name: string;
  is_active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  tiers: { min_qty: number; discount_pct: number }[];
  category_ids: string[];
  product_ids: string[];
  exclude_product_ids: string[];
  priority: number;
}

export interface OfferItem {
  variant_id: string;
  product_id: string;
  category_id: string | null;
  mrp: number | null;
  selling_price: number;
}

export interface OfferLine {
  key: string;
  variant_id: string | null;
  quantity: string;
  unit_price: string;
  offer_id?: string | null;
  offer_label?: string | null;
  /** The user typed this price; offers don't touch it. */
  price_locked?: boolean;
}

export const offerIsLive = (o: Offer, date: string) =>
  o.is_active && (!o.starts_on || o.starts_on <= date) && (!o.ends_on || o.ends_on >= date);

export const offerCovers = (o: Offer, item: OfferItem) =>
  Number(item.mrp) > 0 &&
  !o.exclude_product_ids.includes(item.product_id) &&
  (o.product_ids.includes(item.product_id) || (item.category_id != null && o.category_ids.includes(item.category_id)));

export function tierFor(o: Offer, qty: number) {
  return [...o.tiers].sort((a, b) => b.min_qty - a.min_qty).find((t) => qty >= t.min_qty) ?? null;
}

export const offerLabel = (o: Offer, t: { min_qty: number; discount_pct: number }) => `${o.name}: Pack of ${t.min_qty} – ${t.discount_pct}% off MRP`;

/** Returns new lines with offer prices applied/removed. Unchanged lines keep their identity. */
export function applyOffers<L extends OfferLine>(lines: L[], items: Map<string, OfferItem>, offers: Offer[], date: string): L[] {
  const live = offers.filter((o) => offerIsLive(o, date)).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const claimed = new Map<string, { offer: Offer; label: string; pct: number } | null>();

  for (const o of live) {
    const eligible = lines.filter((l) => {
      if (!l.variant_id || l.price_locked || claimed.has(l.key)) return false;
      const it = items.get(l.variant_id);
      return it ? offerCovers(o, it) : false;
    });
    const qty = eligible.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
    const tier = tierFor(o, qty);
    if (!tier) continue;
    for (const l of eligible) claimed.set(l.key, { offer: o, label: offerLabel(o, tier), pct: tier.discount_pct });
  }

  return lines.map((l) => {
    if (!l.variant_id || l.price_locked) return l;
    const it = items.get(l.variant_id);
    if (!it) return l;
    const c = claimed.get(l.key);
    if (c) {
      const price = String(Math.round(Number(it.mrp) * (1 - c.pct / 100)));
      if (l.offer_id === c.offer.id && l.unit_price === price && l.offer_label === c.label) return l;
      return { ...l, unit_price: price, offer_id: c.offer.id, offer_label: c.label };
    }
    if (l.offer_id) return { ...l, unit_price: String(it.selling_price), offer_id: null, offer_label: null };
    return l;
  });
}
