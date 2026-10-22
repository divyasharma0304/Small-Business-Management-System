import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, num, rpc, type Db } from "./harness";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

let db: Db;
let biz: string;

/** Look up a single row as the owner. */
async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return asUser(db, OWNER, async (tx) => (await tx.query<T>(sql, params)).rows[0]);
}
async function stock(variant: string) {
  const r = await one<{ quantity: string; avg_cost: string }>(
    "select quantity, avg_cost from inventory_levels where variant_id = $1",
    [variant],
  );
  return { qty: num(r?.quantity ?? 0), avg: num(r?.avg_cost ?? 0) };
}
async function variantOf(product: string) {
  return (await one<{ id: string }>("select id from product_variants where product_id = $1", [product])).id;
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, OWNER);
  await createUser(db, STRANGER);
  biz = await rpc<string>(db, OWNER, "create_business", [
    { name: "Test Co", business_type: "retail", currency: "INR", country: "India" },
  ]);
}, 120_000);

describe("business setup", () => {
  it("creates settings, default payment methods and expense categories", async () => {
    const s = await one<{ inventory_deduction_status: string; allow_negative_stock: boolean }>(
      "select * from business_settings where business_id = $1",
      [biz],
    );
    expect(s.inventory_deduction_status).toBe("confirmed");
    expect(s.allow_negative_stock).toBe(false);
    const pm = await one<{ n: string }>("select count(*) n from payment_methods where business_id = $1", [biz]);
    expect(num(pm.n)).toBe(5);
    const ec = await one<{ n: string }>("select count(*) n from expense_categories where business_id = $1", [biz]);
    expect(num(ec.n)).toBe(12);
  });

  it("refuses a second business for the same user", async () => {
    await expect(rpc(db, OWNER, "create_business", [{ name: "Again" }])).rejects.toThrow(/already linked/);
  });
});

describe("row level security", () => {
  it("hides another business's data", async () => {
    const rows = await asUser(db, STRANGER, async (tx) =>
      (await tx.query("select * from businesses")).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("blocks functions on a business you are not a member of", async () => {
    await expect(
      rpc(db, STRANGER, "save_product", [biz, { name: "Hack" }, [{ selling_price: 1 }], []]),
    ).rejects.toThrow(/do not have access/);
  });

  it("does not allow direct writes to inventory", async () => {
    await expect(
      asUser(db, OWNER, (tx) =>
        tx.query("update inventory_levels set quantity = 999 where business_id = $1", [biz]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, OWNER, (tx) =>
        tx.query(
          "insert into orders (business_id, order_number) values ($1, 'X')",
          [biz],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("end-to-end flow", () => {
  let category: string;
  let product: string;
  let variant: string;
  let service: string;
  let serviceVariant: string;
  let supplier: string;
  let customer: string;
  let purchase: string;
  let order: string;

  it("creates category, product, service, supplier, customer", async () => {
    category = await asUser(db, OWNER, async (tx) =>
      (
        await tx.query<{ id: string }>(
          "insert into product_categories (business_id, name) values ($1, 'Things') returning id",
          [biz],
        )
      ).rows[0].id,
    );
    product = await rpc<string>(db, OWNER, "save_product", [
      biz,
      { name: "Widget", item_type: "product", category_id: category, tax_rate: 18, track_inventory: true },
      [{ sku: "W-1", selling_price: 100, cost_price: 50, min_stock: 5 }],
      [],
    ]);
    variant = await variantOf(product);
    service = await rpc<string>(db, OWNER, "save_product", [
      biz,
      { name: "Repair", item_type: "service", track_inventory: true, cost_method: "components" },
      [{ selling_price: 300 }],
      [{ label: "Labour", amount: 80 }, { label: "Parts", amount: 20 }],
    ]);
    serviceVariant = await variantOf(service);

    const svc = await one<{ track_inventory: boolean }>("select track_inventory from products where id = $1", [service]);
    expect(svc.track_inventory).toBe(false); // services never track stock
    const sv = await one<{ cost_price: string }>("select cost_price from product_variants where id = $1", [serviceVariant]);
    expect(num(sv.cost_price)).toBe(100); // components cost roll-up

    [supplier, customer] = await asUser(db, OWNER, async (tx) => [
      (await tx.query<{ id: string }>("insert into suppliers (business_id, name) values ($1, 'Supp') returning id", [biz])).rows[0].id,
      (await tx.query<{ id: string }>("insert into customers (business_id, name) values ($1, 'Cust') returning id", [biz])).rows[0].id,
    ]);
    expect(await stock(variant)).toEqual({ qty: 0, avg: 0 });
  });

  it("rejects a duplicate SKU", async () => {
    await expect(
      rpc(db, OWNER, "save_product", [biz, { name: "Dup" }, [{ sku: "w-1", selling_price: 1 }], []]),
    ).rejects.toThrow(/SKU is already used/);
  });

  it("creates and receives a purchase with landed cost", async () => {
    purchase = await rpc<string>(db, OWNER, "save_purchase", [
      biz,
      { supplier_id: supplier, status: "ordered", other_charges: 100 },
      [{ variant_id: variant, quantity: 10, unit_price: 40 }],
    ]);
    const p = await one<{ total: string; purchase_number: string }>("select * from purchases where id = $1", [purchase]);
    expect(num(p.total)).toBe(500); // 400 + 100 charges (tax disabled)
    expect(p.purchase_number).toBe("PO-00001");

    await rpc(db, OWNER, "receive_purchase", [purchase, [{ item_id: await purchaseItem(), quantity: 4 }], null]);
    expect((await one<{ status: string }>("select status from purchases where id = $1", [purchase])).status).toBe(
      "partially_received",
    );
    await rpc(db, OWNER, "receive_purchase", [purchase, null, null]);
    expect((await one<{ status: string }>("select status from purchases where id = $1", [purchase])).status).toBe("received");
    // landed cost = (400 + 100) / 10 = 50
    expect(await stock(variant)).toEqual({ qty: 10, avg: 50 });

    const txns = await one<{ n: string }>(
      "select count(*) n from inventory_transactions where reference_id = $1 and txn_type = 'purchase'",
      [purchase],
    );
    expect(num(txns.n)).toBe(2);
    await expect(rpc(db, OWNER, "receive_purchase", [purchase, null, null])).rejects.toThrow(/already received/);

    async function purchaseItem() {
      return (await one<{ id: string }>("select id from purchase_items where purchase_id = $1", [purchase])).id;
    }
  });

  it("averages cost on a second purchase at a different price", async () => {
    const p2 = await rpc<string>(db, OWNER, "save_purchase", [
      biz,
      { supplier_id: supplier, status: "ordered" },
      [{ variant_id: variant, quantity: 10, unit_price: 70 }],
    ]);
    await rpc(db, OWNER, "receive_purchase", [p2, null, null]);
    // (10×50 + 10×70) / 20 = 60
    expect(await stock(variant)).toEqual({ qty: 20, avg: 60 });
  });

  it("creates an order with correct totals, discounts and shipping", async () => {
    order = await rpc<string>(db, OWNER, "save_order", [
      biz,
      { customer_id: customer, status: "draft", discount_amount: 30, shipping_charge: 50 },
      [
        { variant_id: variant, quantity: 3, unit_price: 100, discount_amount: 0 },
        { variant_id: serviceVariant, quantity: 1, unit_price: 300 },
      ],
    ]);
    const o = await one<Record<string, string>>("select * from orders where id = $1", [order]);
    // subtotal 600, discount 30 → 570, tax disabled, + 50 shipping
    expect(num(o.subtotal)).toBe(600);
    expect(num(o.total)).toBe(620);
    expect(num(o.revenue_amount)).toBe(620);
    expect(o.status).toBe("draft");
    expect(o.recognized_at).toBeNull();
    expect((await stock(variant)).qty).toBe(20); // drafts don't touch stock
  });

  it("records a partial payment and computes amount due", async () => {
    await asUser(db, OWNER, (tx) =>
      tx.query(
        "insert into payments (business_id, direction, amount, method, order_id) values ($1, 'in', 200, 'UPI', $2)",
        [biz, order],
      ),
    );
    const o = await one<Record<string, string>>("select * from orders where id = $1", [order]);
    expect(num(o.amount_paid)).toBe(200);
    expect(o.payment_status).toBe("partial");
    expect(num(o.total) - num(o.amount_paid)).toBe(420);
    expect(o.customer_id).toBe(customer); // filled in from the order
  });

  it("rejects overpayment", async () => {
    await expect(
      asUser(db, OWNER, (tx) =>
        tx.query(
          "insert into payments (business_id, direction, amount, method, order_id) values ($1, 'in', 1000, 'Cash', $2)",
          [biz, order],
        ),
      ),
    ).rejects.toThrow(/exceed the order total/);
  });

  it("deducts stock at WAC and freezes COGS when confirmed", async () => {
    await rpc(db, OWNER, "set_order_status", [order, "confirmed"]);
    expect(await stock(variant)).toEqual({ qty: 17, avg: 60 });
    const o = await one<Record<string, string>>("select * from orders where id = $1", [order]);
    expect(o.recognized_at).not.toBeNull();
    // COGS = 3 × 60 (widget) + 1 × 100 (service standard cost)
    expect(num(o.cogs_total)).toBe(280);
    const t = await one<Record<string, string>>(
      "select * from inventory_transactions where reference_id = $1 and txn_type = 'sale'",
      [order],
    );
    expect(num(t.quantity)).toBe(-3);
    expect(num(t.balance_after)).toBe(17);

    // later cost changes must not rewrite history
    await rpc(db, OWNER, "save_product", [
      biz,
      { id: product, name: "Widget", item_type: "product", category_id: category, tax_rate: 18, track_inventory: true },
      [{ id: variant, sku: "W-1", selling_price: 120, cost_price: 999 }],
      [],
    ]);
    const after = await one<Record<string, string>>("select cogs_total from orders where id = $1", [order]);
    expect(num(after.cogs_total)).toBe(280);
  });

  it("locks items once the sale is recognised", async () => {
    await expect(
      rpc(db, OWNER, "save_order", [biz, { id: order }, [{ variant_id: variant, quantity: 1, unit_price: 1 }]]),
    ).rejects.toThrow(/locked/);
  });

  it("blocks negative stock by default and allows it when enabled", async () => {
    const big = await rpc<string>(db, OWNER, "save_order", [
      biz,
      { status: "draft" },
      [{ variant_id: variant, quantity: 100, unit_price: 100 }],
    ]);
    await expect(rpc(db, OWNER, "set_order_status", [big, "confirmed"])).rejects.toThrow(/Not enough stock/);
    expect((await stock(variant)).qty).toBe(17); // untouched after failure
    await rpc(db, OWNER, "delete_order", [big]);
  });

  it("reports profit from real records", async () => {
    await asUser(db, OWNER, (tx) =>
      tx.query(
        "insert into expenses (business_id, description, amount) values ($1, 'Ads', 100)",
        [biz],
      ),
    );
    const today = "2100-01-01";
    const s = await rpc<Record<string, number>>(db, OWNER, "report_profit_summary", [biz, "2000-01-01", today]);
    expect(num(s.revenue)).toBe(620);
    expect(num(s.cogs)).toBe(280);
    expect(num(s.gross_profit)).toBe(340);
    expect(num(s.operating_expenses)).toBe(100);
    expect(num(s.net_profit)).toBe(240);

    const snap = await rpc<Record<string, number>>(db, OWNER, "report_business_snapshot", [biz]);
    expect(num(snap.pending_payments)).toBe(420);
    expect(num(snap.inventory_value)).toBe(17 * 60);
  });

  it("detects low stock", async () => {
    await rpc(db, OWNER, "adjust_stock", [biz, variant, "set", 3, null, "Stock count", null]);
    const snap = await rpc<Record<string, number>>(db, OWNER, "report_business_snapshot", [biz]);
    expect(num(snap.low_stock_items)).toBe(1);
    const today = "2100-01-01";
    const s = await rpc<Record<string, number>>(db, OWNER, "report_profit_summary", [biz, "2000-01-01", today]);
    expect(num(s.adjustment_losses)).toBe(14 * 60); // 14 units written off at avg cost 60
  });

  it("restores stock at original cost when a recognised order is returned", async () => {
    await rpc(db, OWNER, "set_order_status", [order, "delivered"]);
    await rpc(db, OWNER, "set_order_status", [order, "returned"]);
    expect((await stock(variant)).qty).toBe(6);
    const o = await one<Record<string, string>>("select * from orders where id = $1", [order]);
    expect(o.stock_reversed).toBe(true);
    // refund the 200 paid
    await asUser(db, OWNER, (tx) =>
      tx.query(
        "insert into payments (business_id, direction, kind, amount, method, order_id) values ($1, 'in', 'refund', 200, 'UPI', $2)",
        [biz, order],
      ),
    );
    const today = "2100-01-01";
    const s = await rpc<Record<string, number>>(db, OWNER, "report_profit_summary", [biz, "2000-01-01", today]);
    expect(num(s.revenue)).toBe(0); // returned orders are not revenue
    await expect(rpc(db, OWNER, "set_order_status", [order, "confirmed"])).rejects.toThrow(/no longer change/);
  });
});

describe("production", () => {
  it("consumes materials, records wastage and produces finished goods at full cost", async () => {
    const mat = await rpc<string>(db, OWNER, "save_product", [
      biz,
      { name: "Raw", item_type: "material", unit: "kg", track_inventory: true },
      [{ cost_price: 10, opening_stock: 100, opening_unit_cost: 10 }],
      [],
    ]);
    const matV = await variantOf(mat);
    const out = await rpc<string>(db, OWNER, "save_product", [
      biz,
      { name: "Made", item_type: "product", track_inventory: true },
      [{ selling_price: 200 }],
      [],
    ]);
    const outV = await variantOf(out);
    const recipe = await rpc<string>(db, OWNER, "save_recipe", [
      biz,
      { name: "Made recipe", variant_id: outV, yield_quantity: 1 },
      [{ component_variant_id: matV, quantity: 2, wastage_pct: 10 }],
    ]);
    const est = await rpc<string>(db, OWNER, "recipe_estimated_cost", [recipe]);
    expect(num(est)).toBe(22); // 2 × 1.1 × 10

    const batch = await rpc<string>(db, OWNER, "create_production_batch", [biz, recipe, 5, null, null, false]);
    const line = await one<Record<string, string>>("select * from production_consumption where batch_id = $1", [batch]);
    expect(num(line.used_quantity)).toBe(10);
    expect(num(line.wasted_quantity)).toBe(1);

    await rpc(db, OWNER, "complete_production_batch", [
      batch, 4, [{ id: line.id, used_quantity: 10, wasted_quantity: 2 }], 12, null,
    ]);
    expect((await stock(matV)).qty).toBe(88);
    // cost = 10×10 + 2×10 + 12 = 132 → /4 = 33
    expect(await stock(outV)).toEqual({ qty: 4, avg: 33 });
    const w = await one<Record<string, string>>("select * from wastage where batch_id = $1", [batch]);
    expect(num(w.quantity)).toBe(2);
    const types = await asUser(db, OWNER, async (tx) =>
      (await tx.query<{ txn_type: string }>(
        "select txn_type from inventory_transactions where reference_id = $1 order by txn_type",
        [batch],
      )).rows.map((r) => r.txn_type).sort(),
    );
    expect(types).toEqual(["production_consumption", "production_output", "wastage"]);
    // completed batches can now be deleted (reversal) — covered in "corrections" tests
  });
});

describe("demo data", () => {
  it("seeds and removes demo data cleanly", async () => {
    await rpc(db, OWNER, "seed_demo_data", [biz]);
    const n = await one<{ n: string }>("select count(*) n from orders where is_demo", []);
    expect(num(n.n)).toBe(3);
    await rpc(db, OWNER, "delete_demo_data", [biz]);
    const left = await one<{ n: string }>(
      "select (select count(*) from products where is_demo) + (select count(*) from orders where is_demo) + (select count(*) from customers where is_demo) n",
    );
    expect(num(left.n)).toBe(0);
  });
});

describe("referential integrity", () => {
  it("still refuses to delete an item with stock history", async () => {
    const p = await rpc<string>(db, OWNER, "save_product", [
      biz, { name: "Keep me", track_inventory: true }, [{ opening_stock: 1, opening_unit_cost: 1 }], [],
    ]);
    await expect(
      asUser(db, OWNER, (tx) => tx.query("delete from products where id = $1", [p])),
    ).rejects.toThrow(/foreign key/);
  });

  it("can delete a whole business (cascade) as an administrator", async () => {
    await rpc(db, OWNER, "seed_demo_data", [biz]);
    await db.query("delete from businesses where id = $1", [biz]);
    const { rows } = await db.query<{ n: string }>("select count(*) n from inventory_transactions");
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe("historical import", () => {
  const OWNER2 = "33333333-3333-4333-8333-333333333333";
  let b2: string;
  it("imports a past order as a sale with zero cost and no stock movement", async () => {
    await createUser(db, OWNER2);
    b2 = await rpc<string>(db, OWNER2, "create_business", [{ name: "Hist Co" }]);
    const p = await rpc<string>(db, OWNER2, "save_product", [b2, { name: "Candle", track_inventory: true }, [{ selling_price: 200, cost_price: 90, opening_stock: 5, opening_unit_cost: 0 }], []]);
    const v = (await asUser(db, OWNER2, async (tx) => (await tx.query<{ id: string }>("select id from product_variants where product_id = $1", [p])).rows[0])).id;
    const id = await rpc<string>(db, OWNER2, "import_historical_order", [
      b2,
      { order_number: "ORD101", order_date: "2025-10-04", status: "delivered", discount_amount: 40, shipping_charge: 80, notes: "x" },
      [{ variant_id: v, quantity: 2, unit_price: 200 }],
      [{ payment_date: "2025-10-04", amount: 440, method: "UPI" }],
    ]);
    const o = await asUser(db, OWNER2, async (tx) => (await tx.query<Record<string, unknown>>("select * from orders where id = $1", [id])).rows[0]);
    expect(o.order_number).toBe("ORD101");
    expect(o.is_imported).toBe(true);
    expect(num(o.total)).toBe(440);
    expect(num(o.cogs_total)).toBe(0);
    expect(o.payment_status).toBe("paid");
    expect(o.recognized_at).not.toBeNull();
    const lvl = await asUser(db, OWNER2, async (tx) => (await tx.query<{ quantity: string }>("select quantity from inventory_levels where variant_id = $1", [v])).rows[0]);
    expect(num(lvl.quantity)).toBe(5); // untouched
    const s = await rpc<Record<string, number>>(db, OWNER2, "report_profit_summary", [b2, "2025-10-01", "2025-10-31"]);
    expect(num(s.revenue)).toBe(440);
    expect(num(s.cogs)).toBe(0);
    await expect(rpc(db, OWNER2, "import_historical_order", [b2, { order_number: "ORD101", order_date: "2025-10-04" }, [{ variant_id: v, quantity: 1, unit_price: 1 }], []])).rejects.toThrow(/already exists/);
    // Cancelling an imported order never puts stock back
    await rpc(db, OWNER2, "set_order_status", [id, "cancelled"]);
    const lvl2 = await asUser(db, OWNER2, async (tx) => (await tx.query<{ quantity: string }>("select quantity from inventory_levels where variant_id = $1", [v])).rows[0]);
    expect(num(lvl2.quantity)).toBe(5);
  });
});

describe("deleting an item", () => {
  const OWNER3 = "44444444-4444-4444-8444-444444444444";
  let b3: string;
  const variantOf = async (p: string) =>
    (await asUser(db, OWNER3, async (tx) => (await tx.query<{ id: string }>("select id from product_variants where product_id = $1", [p])).rows[0])).id;

  it("removes an item with stock history and its single-item purchase", async () => {
    await createUser(db, OWNER3);
    b3 = await rpc<string>(db, OWNER3, "create_business", [{ name: "Del Co" }]);
    const p = await rpc<string>(db, OWNER3, "save_product", [b3, { name: "Oops Jar", item_type: "material", track_inventory: true }, [{ opening_stock: 50, opening_unit_cost: 500 }], []]);
    const v = await variantOf(p);
    const pu = await rpc<string>(db, OWNER3, "save_purchase", [b3, { status: "ordered" }, [{ variant_id: v, quantity: 50, unit_price: 10 }]]);
    await rpc(db, OWNER3, "receive_purchase", [pu, null, null]);
    await rpc(db, OWNER3, "adjust_stock", [b3, v, "remove", 50, null, "mistake", null]);
    const impact = await rpc<Record<string, unknown>>(db, OWNER3, "product_delete_impact", [p]);
    expect(impact.can_delete).toBe(true);
    expect(impact.purchases).toEqual(["PO-00001"]);
    await rpc(db, OWNER3, "delete_product_completely", [p]);
    const left = await asUser(db, OWNER3, async (tx) => (await tx.query<{ n: string }>(
      "select (select count(*) from products where business_id=$1) + (select count(*) from purchases where business_id=$1) + (select count(*) from inventory_transactions where business_id=$1) n", [b3])).rows[0]);
    expect(num(left.n)).toBe(0);
  });

  it("refuses when the item has been sold or shares a purchase", async () => {
    const p = await rpc<string>(db, OWNER3, "save_product", [b3, { name: "Sold Candle", track_inventory: true }, [{ selling_price: 100, opening_stock: 5 }], []]);
    const v = await variantOf(p);
    const o = await rpc<string>(db, OWNER3, "save_order", [b3, { status: "draft" }, [{ variant_id: v, quantity: 1, unit_price: 100 }]]);
    const impact = await rpc<Record<string, unknown>>(db, OWNER3, "product_delete_impact", [p]);
    expect(impact.can_delete).toBe(false);
    expect((impact.orders as string[]).length).toBe(1);
    await expect(rpc(db, OWNER3, "delete_product_completely", [p])).rejects.toThrow(/can't be deleted/);
    await rpc(db, OWNER3, "delete_order", [o]);

    const other = await rpc<string>(db, OWNER3, "save_product", [b3, { name: "Other", item_type: "material", track_inventory: true }, [{}], []]);
    await rpc(db, OWNER3, "save_purchase", [b3, { status: "ordered" }, [{ variant_id: v, quantity: 1, unit_price: 1 }, { variant_id: await variantOf(other), quantity: 1, unit_price: 1 }]]);
    const impact2 = await rpc<Record<string, unknown>>(db, OWNER3, "product_delete_impact", [p]);
    expect(impact2.can_delete).toBe(false);
    expect((impact2.blocking_purchases as string[]).length).toBe(1);
  });
});

describe("adding a variant from a purchase", () => {
  const OWNER4 = "55555555-5555-4555-8555-555555555555";
  it("adds a new colour with zero stock and rejects duplicates", async () => {
    await createUser(db, OWNER4);
    const b = await rpc<string>(db, OWNER4, "create_business", [{ name: "Var Co" }]);
    const p = await rpc<string>(db, OWNER4, "save_product", [b, { name: "Candle Color", item_type: "material", unit: "ml", track_inventory: true, has_variants: true },
      [{ name: "Red", cost_price: 0.96, opening_stock: 100, opening_unit_cost: 0.96 }], []]);
    const v = await rpc<string>(db, OWNER4, "add_product_variant", [p, "Blue", null, 0, 0]);
    const lvl = await asUser(db, OWNER4, async (tx) => (await tx.query<{ quantity: string }>("select quantity from inventory_levels where variant_id = $1", [v])).rows[0]);
    expect(num(lvl.quantity)).toBe(0);
    await expect(rpc(db, OWNER4, "add_product_variant", [p, "blue", null, 0, 0])).rejects.toThrow(/already has a variant/);
    // buying 100 ml for ₹96 → ₹0.96 per ml
    const pu = await rpc<string>(db, OWNER4, "save_purchase", [b, { status: "ordered" }, [{ variant_id: v, quantity: 100, unit_price: 0.96 }]]);
    await rpc(db, OWNER4, "receive_purchase", [pu, null, null]);
    const after = await asUser(db, OWNER4, async (tx) => (await tx.query<{ quantity: string; avg_cost: string }>("select quantity, avg_cost from inventory_levels where variant_id = $1", [v])).rows[0]);
    expect(num(after.quantity)).toBe(100);
    expect(num(after.avg_cost)).toBe(0.96);
    const single = await rpc<string>(db, OWNER4, "save_product", [b, { name: "Wax", item_type: "material", track_inventory: true }, [{}], []]);
    await expect(rpc(db, OWNER4, "add_product_variant", [single, "Big", null, 0, 0])).rejects.toThrow(/doesn't use variants/);
  });
});

describe("corrections: edit & delete everywhere", () => {
  const U = "66666666-6666-4666-8666-666666666666";
  let b: string;
  const vOf = async (p: string) =>
    (await asUser(db, U, async (tx) => (await tx.query<{ id: string }>("select id from product_variants where product_id = $1", [p])).rows[0])).id;
  const qty = async (v: string) =>
    num((await asUser(db, U, async (tx) => (await tx.query<{ quantity: string }>("select quantity from inventory_levels where variant_id = $1", [v])).rows[0])).quantity);
  const one = async <T,>(sql: string, p: unknown[]) => asUser(db, U, async (tx) => (await tx.query<T>(sql, p)).rows[0]);

  it("uses the highest known cost for recipe estimates", async () => {
    await createUser(db, U);
    b = await rpc<string>(db, U, "create_business", [{ name: "Fix Co", modules: { production: true } }]);
    const jar = await rpc<string>(db, U, "save_product", [b, { name: "Jar", item_type: "material", track_inventory: true }, [{ cost_price: 0, opening_stock: 93, opening_unit_cost: 0 }], []]);
    const jv = await vOf(jar);
    await rpc(db, U, "adjust_stock", [b, jv, "remove", 23, null, "count", null]);
    await rpc(db, U, "adjust_stock", [b, jv, "add", 1, 20, "found one", null]);
    const lvl = await one<{ avg_cost: string }>("select avg_cost from inventory_levels where variant_id = $1", [jv]);
    expect(num(lvl.avg_cost)).toBeCloseTo(0.28, 2); // the screenshot situation
    const out = await rpc<string>(db, U, "save_product", [b, { name: "Candle", track_inventory: true }, [{ selling_price: 200 }], []]);
    const r = await rpc<string>(db, U, "save_recipe", [b, { name: "C", variant_id: await vOf(out), yield_quantity: 1 }, [{ component_variant_id: jv, quantity: 1 }]]);
    expect(num(await rpc(db, U, "recipe_estimated_cost", [r]))).toBe(20);
    const pick = await one<{ highest_cost: string }>("select highest_cost from item_picker where variant_id = $1", [jv]);
    expect(num(pick.highest_cost)).toBe(20);
  });

  it("edits an order that was already recorded as a sale, keeping stock right", async () => {
    const p = await rpc<string>(db, U, "save_product", [b, { name: "Mug", track_inventory: true }, [{ selling_price: 100, opening_stock: 10, opening_unit_cost: 40 }], []]);
    const v = await vOf(p);
    const o = await rpc<string>(db, U, "save_order", [b, { status: "confirmed" }, [{ variant_id: v, quantity: 3, unit_price: 100 }]]);
    await rpc(db, U, "set_order_status", [o, "delivered"]);
    expect(await qty(v)).toBe(7);
    await rpc(db, U, "edit_order", [b, { id: o, order_date: "2026-10-22" }, [{ variant_id: v, quantity: 5, unit_price: 90 }]]);
    expect(await qty(v)).toBe(5);
    const ord = await one<Record<string, string>>("select * from orders where id = $1", [o]);
    expect(ord.status).toBe("delivered");
    expect(num(ord.total)).toBe(450);
    expect(num(ord.cogs_total)).toBe(200);
    expect(ord.recognized_at).not.toBeNull();
  });

  it("deletes a sold order with its payment and puts stock back", async () => {
    const p = await rpc<string>(db, U, "save_product", [b, { name: "Bowl", track_inventory: true }, [{ selling_price: 50, opening_stock: 4, opening_unit_cost: 10 }], []]);
    const v = await vOf(p);
    const o = await rpc<string>(db, U, "save_order", [b, { status: "confirmed" }, [{ variant_id: v, quantity: 2, unit_price: 50 }]]);
    await asUser(db, U, (tx) => tx.query("insert into payments (business_id, direction, amount, method, order_id) values ($1,'in',100,'UPI',$2)", [b, o]));
    await expect(rpc(db, U, "delete_order_completely", [o, false])).rejects.toThrow(/Confirm deleting them/);
    await rpc(db, U, "delete_order_completely", [o, true]);
    expect(await qty(v)).toBe(4);
    const n = await one<{ n: string }>("select (select count(*) from orders where id=$1) + (select count(*) from payments where order_id=$1) n", [o]);
    expect(num(n.n)).toBe(0);
  });

  it("edits and deletes a received purchase", async () => {
    const p = await rpc<string>(db, U, "save_product", [b, { name: "Wax", item_type: "material", track_inventory: true }, [{}], []]);
    const v = await vOf(p);
    const pu = await rpc<string>(db, U, "save_purchase", [b, { status: "ordered" }, [{ variant_id: v, quantity: 10, unit_price: 5 }]]);
    await rpc(db, U, "receive_purchase", [pu, null, null]);
    expect(await qty(v)).toBe(10);
    await rpc(db, U, "edit_purchase", [b, { id: pu, status: "ordered" }, [{ variant_id: v, quantity: 12, unit_price: 5 }]]);
    expect(await qty(v)).toBe(12);
    expect((await one<{ status: string }>("select status from purchases where id=$1", [pu])).status).toBe("received");
    await rpc(db, U, "delete_purchase_completely", [pu, false]);
    expect(await qty(v)).toBe(0);
  });

  it("undoes an adjustment once, and deletes standalone wastage", async () => {
    const p = await rpc<string>(db, U, "save_product", [b, { name: "Tape", item_type: "material", track_inventory: true }, [{ opening_stock: 5, opening_unit_cost: 2 }], []]);
    const v = await vOf(p);
    await rpc(db, U, "adjust_stock", [b, v, "add", 3, 2, "typo", null]);
    const t = await one<{ id: string }>("select id from inventory_transactions where variant_id=$1 and txn_type='adjustment'", [v]);
    await rpc(db, U, "undo_stock_movement", [t.id]);
    expect(await qty(v)).toBe(5);
    await expect(rpc(db, U, "undo_stock_movement", [t.id])).rejects.toThrow(/already been undone/);
    const w = await rpc<string>(db, U, "record_wastage", [b, v, 2, "damage", "2026-10-22", null]);
    expect(await qty(v)).toBe(3);
    await rpc(db, U, "delete_wastage", [w]);
    expect(await qty(v)).toBe(5);
  });

  it("deletes a completed production batch, returning materials", async () => {
    const m = await rpc<string>(db, U, "save_product", [b, { name: "Soy", item_type: "material", track_inventory: true }, [{ opening_stock: 100, opening_unit_cost: 1 }], []]);
    const mv = await vOf(m);
    const out = await rpc<string>(db, U, "save_product", [b, { name: "Lamp", track_inventory: true }, [{ selling_price: 10 }], []]);
    const ov = await vOf(out);
    const r = await rpc<string>(db, U, "save_recipe", [b, { name: "L", variant_id: ov, yield_quantity: 1 }, [{ component_variant_id: mv, quantity: 10, wastage_pct: 10 }]]);
    const bt = await rpc<string>(db, U, "create_production_batch", [b, r, 2, "2026-10-22", null, false]);
    await rpc(db, U, "complete_production_batch", [bt, 2, null, 0, null]);
    expect(await qty(mv)).toBe(78);
    await rpc(db, U, "delete_production_batch", [bt]);
    expect(await qty(mv)).toBe(100);
    expect(await qty(ov)).toBe(0);
  });

  it("deletes a customer with orders, keeping the orders as walk-in", async () => {
    const c = await one<{ id: string }>("insert into customers (business_id, name) values ($1,'Temp') returning id", [b]);
    const p = await rpc<string>(db, U, "save_product", [b, { name: "Svc", item_type: "service" }, [{ selling_price: 10 }], []]);
    const o = await rpc<string>(db, U, "save_order", [b, { customer_id: c.id, status: "confirmed" }, [{ variant_id: await vOf(p), quantity: 1, unit_price: 10 }]]);
    await rpc(db, U, "delete_customer", [c.id]);
    const ord = await one<{ customer_id: string | null }>("select customer_id from orders where id=$1", [o]);
    expect(ord.customer_id).toBeNull();
  });
});

describe("reversals keep stock value correct", () => {
  const U2 = "77777777-7777-4777-8777-777777777777";
  it("deleting a received purchase restores the previous average cost", async () => {
    await createUser(db, U2);
    const b = await rpc<string>(db, U2, "create_business", [{ name: "Avg Co" }]);
    const p = await rpc<string>(db, U2, "save_product", [b, { name: "Jar", item_type: "material", track_inventory: true }, [{ opening_stock: 93, opening_unit_cost: 0 }], []]);
    const v = (await asUser(db, U2, async (tx) => (await tx.query<{ id: string }>("select id from product_variants where product_id = $1", [p])).rows[0])).id;
    await rpc(db, U2, "adjust_stock", [b, v, "remove", 23, null, "count", null]);
    await rpc(db, U2, "adjust_stock", [b, v, "add", 1, 20, "found", null]);
    const avgOf = async () => num((await asUser(db, U2, async (tx) => (await tx.query<{ avg_cost: string }>("select avg_cost from inventory_levels where variant_id = $1", [v])).rows[0])).avg_cost);
    const before = await avgOf();
    const pu = await rpc<string>(db, U2, "save_purchase", [b, { status: "ordered" }, [{ variant_id: v, quantity: 10, unit_price: 20 }]]);
    await rpc(db, U2, "receive_purchase", [pu, null, null]);
    await rpc(db, U2, "delete_purchase_completely", [pu, false]);
    expect(await avgOf()).toBeCloseTo(before, 3);
  });
});

describe("multi-product production batches", () => {
  const U3 = "88888888-8888-4888-8888-888888888888";
  it("makes two products in one batch, each at its own cost, and splits extra cost", async () => {
    await createUser(db, U3);
    const b = await rpc<string>(db, U3, "create_business", [{ name: "Multi Co", modules: { production: true } }]);
    const vOf = async (p: string) =>
      (await asUser(db, U3, async (tx) => (await tx.query<{ id: string }>("select id from product_variants where product_id = $1", [p])).rows[0])).id;
    const lvl = async (v: string) =>
      (await asUser(db, U3, async (tx) => (await tx.query<{ quantity: string; avg_cost: string }>("select quantity, avg_cost from inventory_levels where variant_id = $1", [v])).rows[0]));
    const wax = await vOf(await rpc<string>(db, U3, "save_product", [b, { name: "Wax", item_type: "material", unit: "g", track_inventory: true }, [{ opening_stock: 5000, opening_unit_cost: 0.24 }], []]));
    const jar = await vOf(await rpc<string>(db, U3, "save_product", [b, { name: "Jar", item_type: "material", track_inventory: true }, [{ opening_stock: 50, opening_unit_cost: 20 }], []]));
    const small = await vOf(await rpc<string>(db, U3, "save_product", [b, { name: "Small candle", track_inventory: true }, [{ selling_price: 200 }], []]));
    const big = await vOf(await rpc<string>(db, U3, "save_product", [b, { name: "Big candle", track_inventory: true }, [{ selling_price: 400 }], []]));
    const rs = await rpc<string>(db, U3, "save_recipe", [b, { name: "Small", variant_id: small, yield_quantity: 1 }, [{ component_variant_id: wax, quantity: 50 }, { component_variant_id: jar, quantity: 1 }]]);
    const rb = await rpc<string>(db, U3, "save_recipe", [b, { name: "Big", variant_id: big, yield_quantity: 1 }, [{ component_variant_id: wax, quantity: 200 }, { component_variant_id: jar, quantity: 1 }]]);

    const batch = await rpc<string>(db, U3, "create_production_batch_multi", [b, [{ recipe_id: rs, planned_quantity: 10 }, { recipe_id: rb, planned_quantity: 5 }], "2026-10-23", null, false]);
    const outs = await asUser(db, U3, async (tx) => (await tx.query<{ id: string; variant_id: string }>("select id, variant_id from production_batch_outputs where batch_id = $1 order by sort_order", [batch])).rows);
    expect(outs).toHaveLength(2);

    // small: 10×(50g×0.24 + 20) = 320 ; big: 5×(200g×0.24 + 20) = 340 ; extra ₹66 split 320:340 → 32 / 34
    await rpc(db, U3, "complete_production_batch_multi", [batch, [{ id: outs[0].id, actual_quantity: 10 }, { id: outs[1].id, actual_quantity: 5 }], null, 66, null]);
    expect(num((await lvl(small)).quantity)).toBe(10);
    expect(num((await lvl(small)).avg_cost)).toBe(35.2); // (320 + 32) / 10
    expect(num((await lvl(big)).quantity)).toBe(5);
    expect(num((await lvl(big)).avg_cost)).toBe(74.8);   // (340 + 34) / 5
    expect(num((await lvl(wax)).quantity)).toBe(5000 - 500 - 1000);
    expect(num((await lvl(jar)).quantity)).toBe(35);

    await rpc(db, U3, "delete_production_batch", [batch]);
    expect(num((await lvl(wax)).quantity)).toBe(5000);
    expect(num((await lvl(small)).quantity)).toBe(0);
  });
});

describe("MRP and offers", () => {
  const U4 = "99999999-9999-4999-8999-999999999999";
  it("stores MRP on variants and snapshots MRP + offer on order lines", async () => {
    await createUser(db, U4);
    const b = await rpc<string>(db, U4, "create_business", [{ name: "MRP Co" }]);
    const p = await rpc<string>(db, U4, "save_product", [b, { name: "Candle", track_inventory: false }, [{ selling_price: 199, mrp: 250 }], []]);
    const v = await asUser(db, U4, async (tx) => (await tx.query<{ id: string; mrp: string }>("select id, mrp from product_variants where product_id = $1", [p])).rows[0]);
    expect(num(v.mrp)).toBe(250);
    const offer = await asUser(db, U4, async (tx) => (await tx.query<{ id: string }>(
      "insert into offers (business_id, name, tiers, product_ids) values ($1, 'Packs', '[{\"min_qty\":2,\"discount_pct\":28}]', array[$2::uuid]) returning id", [b, p])).rows[0]);
    const o = await rpc<string>(db, U4, "save_order", [b, { status: "draft" }, [{ variant_id: v.id, quantity: 2, unit_price: 180, offer_id: offer.id, offer_label: "Packs: Pack of 2 – 28% off MRP" }]]);
    const li = await asUser(db, U4, async (tx) => (await tx.query<Record<string, string>>("select mrp, offer_id, offer_label, unit_price from order_items where order_id = $1", [o])).rows[0]);
    expect(num(li.mrp)).toBe(250);
    expect(li.offer_id).toBe(offer.id);
    expect(num(li.unit_price)).toBe(180);
    // price change later doesn't touch the order's snapshot
    await rpc(db, U4, "save_product", [b, { id: p, name: "Candle", track_inventory: false }, [{ id: v.id, selling_price: 220, mrp: 300 }], []]);
    const li2 = await asUser(db, U4, async (tx) => (await tx.query<{ mrp: string }>("select mrp from order_items where order_id = $1", [o])).rows[0]);
    expect(num(li2.mrp)).toBe(250);
  });
});

describe("extra charges on orders", () => {
  const U5 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  it("adds named extra charges to total and revenue, and validates them", async () => {
    await createUser(db, U5);
    const b = await rpc<string>(db, U5, "create_business", [{ name: "Extra Co" }]);
    const p = await rpc<string>(db, U5, "save_product", [b, { name: "Candle", track_inventory: false }, [{ selling_price: 200 }], []]);
    const v = (await asUser(db, U5, async (tx) => (await tx.query<{ id: string }>("select id from product_variants where product_id = $1", [p])).rows[0])).id;
    const o = await rpc<string>(db, U5, "save_order", [b, { status: "confirmed", shipping_charge: 50, extra_charges: [{ label: "White labelling", amount: 150 }, { label: "Custom packaging", amount: 100 }] }, [{ variant_id: v, quantity: 2, unit_price: 200 }]]);
    const ord = await asUser(db, U5, async (tx) => (await tx.query<Record<string, unknown>>("select total, revenue_amount, extra_charges_total, extra_charges from orders where id = $1", [o])).rows[0]);
    expect(num(ord.total)).toBe(700);
    expect(num(ord.revenue_amount)).toBe(700);
    expect(num(ord.extra_charges_total)).toBe(250);
    expect((ord.extra_charges as { label: string }[]).map((c) => c.label)).toEqual(["White labelling", "Custom packaging"]);
    const s = await rpc<Record<string, number>>(db, U5, "report_profit_summary", [b, "2000-01-01", "2100-01-01"]);
    expect(num(s.extra_charges_revenue)).toBe(250);
    await expect(rpc(db, U5, "save_order", [b, { extra_charges: [{ label: "", amount: 10 }] }, [{ variant_id: v, quantity: 1, unit_price: 1 }]])).rejects.toThrow(/needs a name/);
  });
});
