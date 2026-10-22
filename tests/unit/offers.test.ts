import { describe, expect, it } from "vitest";
import { applyOffers, type Offer, type OfferItem, type OfferLine } from "@/lib/calc/offers";

const JAR = "cat-jar";
const DIWALI = "cat-diwali";
const regular: Offer = {
  id: "o1", name: "Regular candles", is_active: true, starts_on: null, ends_on: null, priority: 0,
  tiers: [{ min_qty: 2, discount_pct: 28 }, { min_qty: 4, discount_pct: 32 }, { min_qty: 6, discount_pct: 36 }],
  category_ids: [JAR], product_ids: ["p-winter"], exclude_product_ids: [],
};
const diwali: Offer = {
  id: "o2", name: "Diwali special", is_active: true, starts_on: "2026-10-22", ends_on: "2026-11-15", priority: 0,
  tiers: [{ min_qty: 2, discount_pct: 30 }, { min_qty: 4, discount_pct: 35 }, { min_qty: 6, discount_pct: 40 }],
  category_ids: [DIWALI], product_ids: [], exclude_product_ids: [],
};
const items = new Map<string, OfferItem>([
  ["blush50", { variant_id: "blush50", product_id: "p-blush", category_id: JAR, mrp: 250, selling_price: 199 }],
  ["cocoa150", { variant_id: "cocoa150", product_id: "p-cocoa", category_id: JAR, mrp: 500, selling_price: 399 }],
  ["winter50", { variant_id: "winter50", product_id: "p-winter", category_id: "cat-xmas", mrp: 250, selling_price: 199 }],
  ["vodka", { variant_id: "vodka", product_id: "p-vodka", category_id: JAR, mrp: null, selling_price: 120 }],
  ["urli", { variant_id: "urli", product_id: "p-urli", category_id: DIWALI, mrp: 449, selling_price: 329 }],
]);
const line = (key: string, v: string, qty: number, price = String(items.get(v)!.selling_price)): OfferLine => ({ key, variant_id: v, quantity: String(qty), unit_price: price });

describe("pack offers", () => {
  it("single candle stays at its own discounted price", () => {
    const out = applyOffers([line("a", "blush50", 1)], items, [regular], "2026-10-23");
    expect(out[0].unit_price).toBe("199");
    expect(out[0].offer_id).toBeUndefined();
  });

  it("pack of 2 (same candle) → 28% off MRP = ₹180", () => {
    const out = applyOffers([line("a", "blush50", 2)], items, [regular], "2026-10-23");
    expect(out[0].unit_price).toBe("180");
    expect(out[0].offer_label).toContain("Pack of 2");
  });

  it("mixes sizes and includes Winter Crème from another category; 3 items → pack of 2 rate", () => {
    const out = applyOffers([line("a", "blush50", 1), line("b", "cocoa150", 1), line("c", "winter50", 1)], items, [regular], "2026-10-23");
    expect(out.map((l) => l.unit_price)).toEqual(["180", "360", "180"]);
  });

  it("4 items → 32%, 6 → 36%", () => {
    expect(applyOffers([line("a", "blush50", 4)], items, [regular], "2026-10-23")[0].unit_price).toBe("170");
    expect(applyOffers([line("a", "blush50", 6)], items, [regular], "2026-10-23")[0].unit_price).toBe("160");
  });

  it("items without MRP never get the offer and don't count", () => {
    const out = applyOffers([line("a", "blush50", 1), line("b", "vodka", 1)], items, [regular], "2026-10-23");
    expect(out.map((l) => l.unit_price)).toEqual(["199", "120"]);
  });

  it("regular and Diwali items count separately", () => {
    const out = applyOffers([line("a", "blush50", 1), line("b", "urli", 2)], items, [regular, diwali], "2026-10-23");
    expect(out[0].unit_price).toBe("199");
    expect(out[1].unit_price).toBe(String(Math.round(449 * 0.7)));
  });

  it("Diwali offer ends after 15 Nov", () => {
    expect(applyOffers([line("b", "urli", 2)], items, [diwali], "2026-11-16")[0].unit_price).toBe("329");
  });

  it("removes the offer price when quantity drops below the first tier", () => {
    const applied = applyOffers([line("a", "blush50", 2)], items, [regular], "2026-10-23");
    const dropped = applyOffers([{ ...applied[0], quantity: "1" }], items, [regular], "2026-10-23");
    expect(dropped[0].unit_price).toBe("199");
    expect(dropped[0].offer_id).toBeNull();
  });

  it("leaves hand-typed prices alone", () => {
    const out = applyOffers([{ ...line("a", "blush50", 2, "150"), price_locked: true }], items, [regular], "2026-10-23");
    expect(out[0].unit_price).toBe("150");
  });
});
