/**
 * TypeScript mirror of public.calc_document() (supabase/migrations/…_business_logic.sql).
 * Used for live totals while the user types. The database recomputes on save and
 * is authoritative; tests/unit/document.test.ts keeps the two in agreement.
 *
 *   gross_i   = round(qty × price, 2)
 *   net_i     = gross_i − line discount_i
 *   subtotal  = Σ net_i
 *   share_i   = document discount allocated pro-rata to net_i (last line takes the remainder)
 *   base_i    = net_i − share_i
 *   exclusive: tax_i = round(base_i × rate/100, 2), revenue_i = base_i,         total_i = base_i + tax_i
 *   inclusive: tax_i = round(base_i − base_i/(1+rate/100), 2), revenue_i = base_i − tax_i, total_i = base_i
 */

export interface CalcLineInput {
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_rate?: number;
}

export interface CalcLine {
  gross: number;
  line_discount: number;
  discount_share: number;
  tax_rate: number;
  tax: number;
  net: number;
  total: number;
}

export interface CalcResult {
  subtotal: number;
  discount: number;
  tax_total: number;
  net_total: number;
  lines_total: number;
  lines: CalcLine[];
  errors: string[];
}

/** Round half away from zero to 2 dp, like Postgres round(numeric, 2). */
export function round2(n: number) {
  const sign = n < 0 ? -1 : 1;
  // toPrecision strips binary noise (1.005 × 100 = 100.49999…) before rounding.
  return (sign * Math.round(parseFloat((Math.abs(n) * 100).toPrecision(12)))) / 100;
}

export function calcDocument(
  lines: CalcLineInput[],
  docDiscount: number,
  inclusive: boolean,
  taxEnabled: boolean,
): CalcResult {
  const errors: string[] = [];
  const gross: number[] = [];
  const ld: number[] = [];
  const net: number[] = [];
  const rates: number[] = [];
  let subtotal = 0;

  lines.forEach((l, i) => {
    const qty = Number(l.quantity) || 0;
    const price = Number(l.unit_price) || 0;
    const disc = round2(Number(l.discount_amount) || 0);
    const rate = taxEnabled ? Number(l.tax_rate) || 0 : 0;
    if (qty <= 0) errors.push(`Line ${i + 1}: quantity must be greater than zero.`);
    if (price < 0) errors.push(`Line ${i + 1}: price cannot be negative.`);
    gross[i] = round2(qty * price);
    if (disc < 0 || disc > gross[i]) errors.push(`Line ${i + 1}: discount cannot exceed the line amount.`);
    ld[i] = Math.min(Math.max(disc, 0), gross[i]);
    net[i] = round2(gross[i] - ld[i]);
    rates[i] = rate;
    subtotal = round2(subtotal + net[i]);
  });

  let discount = round2(Number(docDiscount) || 0);
  if (discount < 0 || discount > subtotal) {
    errors.push("Discount cannot exceed the subtotal.");
    discount = Math.min(Math.max(discount, 0), subtotal);
  }

  let alloc = 0;
  let taxSum = 0;
  let revSum = 0;
  let totalSum = 0;
  const out: CalcLine[] = lines.map((_, i) => {
    let share: number;
    if (i === lines.length - 1) share = Math.min(round2(discount - alloc), net[i]);
    else if (subtotal === 0) share = 0;
    else share = round2((discount * net[i]) / subtotal);
    alloc = round2(alloc + share);
    const base = round2(net[i] - share);
    let tax: number;
    let rev: number;
    let total: number;
    if (inclusive) {
      tax = round2(base - base / (1 + rates[i] / 100));
      rev = round2(base - tax);
      total = base;
    } else {
      tax = round2((base * rates[i]) / 100);
      rev = base;
      total = round2(base + tax);
    }
    taxSum = round2(taxSum + tax);
    revSum = round2(revSum + rev);
    totalSum = round2(totalSum + total);
    return { gross: gross[i], line_discount: ld[i], discount_share: share, tax_rate: rates[i], tax, net: rev, total };
  });

  return { subtotal, discount: alloc, tax_total: taxSum, net_total: revSum, lines_total: totalSum, lines: out, errors };
}
