import { beforeAll, describe, expect, it } from "vitest";
import { calcDocument, type CalcLineInput } from "@/lib/calc/document";
import { createTestDb, type Db } from "./harness";

/**
 * The browser shows live totals using calcDocument(); the database recomputes with
 * public.calc_document() on save. They must agree to the paisa.
 */
let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

async function sqlCalc(lines: CalcLineInput[], disc: number, inclusive: boolean, taxEnabled: boolean) {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    "select public.calc_document($1::jsonb, $2, $3, $4) as r",
    [JSON.stringify(lines), disc, inclusive, taxEnabled],
  );
  return rows[0].r;
}

describe("calc_document parity", () => {
  it("matches on 300 random documents", async () => {
    const r = rand(42);
    for (let n = 0; n < 300; n++) {
      const count = 1 + Math.floor(r() * 5);
      const lines: CalcLineInput[] = Array.from({ length: count }, () => {
        const quantity = Math.round((0.5 + r() * 20) * 1000) / 1000;
        const unit_price = Math.round(r() * 5000 * 100) / 100;
        const gross = Math.round(quantity * unit_price * 100) / 100;
        return {
          quantity,
          unit_price,
          discount_amount: r() < 0.3 ? Math.round(r() * gross * 0.5 * 100) / 100 : 0,
          tax_rate: [0, 5, 12, 18, 28][Math.floor(r() * 5)],
        };
      });
      const inclusive = r() < 0.5;
      const taxEnabled = r() < 0.8;
      const ts = calcDocument(lines, 0, inclusive, taxEnabled);
      const disc = r() < 0.4 ? Math.round(r() * ts.subtotal * 0.3 * 100) / 100 : 0;
      const tsFinal = calcDocument(lines, disc, inclusive, taxEnabled);
      const sql = await sqlCalc(lines, disc, inclusive, taxEnabled);

      expect(tsFinal.errors).toEqual([]);
      for (const k of ["subtotal", "discount", "tax_total", "net_total", "lines_total"] as const) {
        expect(tsFinal[k], `doc ${n} ${k}`).toBeCloseTo(Number(sql[k]), 2);
      }
      const sqlLines = sql.lines as Record<string, number>[];
      tsFinal.lines.forEach((l, i) => {
        expect(l.tax, `doc ${n} line ${i} tax`).toBeCloseTo(Number(sqlLines[i].tax), 2);
        expect(l.total, `doc ${n} line ${i} total`).toBeCloseTo(Number(sqlLines[i].total), 2);
      });
    }
  });

  it("handles a known GST-inclusive example", () => {
    // ₹1180 incl. 18% GST → ₹1000 revenue + ₹180 tax
    const res = calcDocument([{ quantity: 1, unit_price: 1180, tax_rate: 18 }], 0, true, true);
    expect(res.tax_total).toBe(180);
    expect(res.net_total).toBe(1000);
    expect(res.lines_total).toBe(1180);
  });

  it("flags discount above subtotal", () => {
    const res = calcDocument([{ quantity: 1, unit_price: 100 }], 150, false, false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
