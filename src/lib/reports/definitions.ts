import "server-only";
import type { RequiredContext } from "@/lib/context";
import { titleCase } from "@/lib/format";
import { customerSummary, expenseBreakdown, itemPerformance, profitSummary, supplierSummary } from "@/lib/queries/reports";
import type { FilterKey, ReportParams, ReportResult, ReportRow } from "./types";

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  filters: FilterKey[];
  /** Module that must be enabled for the report to be listed */
  module?: "module_inventory" | "module_purchases" | "module_suppliers" | "module_customers" | "module_production" | "module_expenses";
  load: (ctx: RequiredContext, p: ReportParams) => Promise<ReportResult>;
}

const n = (v: unknown) => Number(v ?? 0);

/** Fetch all rows of a query in pages of 1000 (PostgREST's default cap). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) {
      console.error("[report] query failed", error);
      throw new Error("Could not load report data.");
    }
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    if (out.length >= 50_000) break;
  }
  return out;
}

const vName = (v: { name: string; is_default: boolean; products: { name: string } }) =>
  v.is_default ? v.products.name : `${v.products.name} — ${v.name}`;

export const REPORTS: ReportDefinition[] = [
  {
    key: "profit",
    title: "Profit & loss",
    description: "Revenue, cost of goods, gross profit, expenses and estimated net profit.",
    filters: ["range"],
    async load(ctx, p) {
      const s = await profitSummary(ctx, p.from, p.to);
      const rows: ReportRow[] = [
        { line: "Gross sales (incl. tax & shipping)", amount: s.gross_sales },
        { line: `Less: ${ctx.business.tax_label} collected`, amount: -s.tax_collected },
        { line: "Revenue (net sales)", amount: s.revenue },
        { line: "  of which shipping charged", amount: s.shipping_revenue },
        { line: "  discounts given (already deducted)", amount: s.discounts },
        { line: "Less: cost of goods sold (COGS)", amount: -s.cogs },
        { line: "Gross profit", amount: s.gross_profit },
        { line: "Less: operating expenses", amount: -s.operating_expenses },
        { line: "Less: stock write-offs (wastage)", amount: -s.wastage_losses },
        { line: "Less: stock adjustments (net)", amount: -s.adjustment_losses },
        { line: "Estimated net profit", amount: s.net_profit },
      ];
      return {
        columns: [
          { key: "line", label: "Line", type: "text" },
          { key: "amount", label: "Amount", type: "money" },
        ],
        rows,
        summary: [
          { label: "Revenue", value: s.revenue, type: "money" },
          { label: "Gross profit", value: s.gross_profit, type: "money" },
          { label: "Gross margin", value: s.gross_margin_pct ?? 0, type: "pct" },
          { label: "Estimated net profit", value: s.net_profit, type: "money", emphasis: true },
        ],
        note:
          "Revenue = recognised orders' totals after discounts, excluding tax, including shipping charged. COGS = cost frozen on each order line when the sale was recognised (weighted-average stock cost, or standard cost for untracked items). Gross profit = Revenue − COGS. Estimated net profit = Gross profit − Expenses − stock write-offs/adjustments. Purchases are not expenses: their cost reaches profit through COGS when the goods are sold.",
      };
    },
  },
  {
    key: "sales",
    title: "Sales",
    description: "Every item sold (recognised orders), with revenue, cost and profit per line.",
    filters: ["range", "customer", "category", "product"],
    async load(ctx, p) {
      type Line = {
        quantity: number; net_amount: number; tax_amount: number; line_total: number; cogs_amount: number; description: string; category_id: string | null; variant_id: string;
        orders: { id: string; order_number: string; order_date: string; customer_id: string | null; customers: { name: string } | null };
        product_variants: { product_id: string };
      };
      const lines = await fetchAll<Line>((from, to) => {
        let q = ctx.supabase
          .from("order_items")
          .select("quantity, net_amount, tax_amount, line_total, cogs_amount, description, category_id, variant_id, orders!inner(id, order_number, order_date, customer_id, status, recognized_at, customers(name)), product_variants!inner(product_id)")
          .eq("business_id", ctx.businessId)
          .not("orders.recognized_at", "is", null)
          .not("orders.status", "in", "(cancelled,returned)")
          .gte("orders.order_date", p.from)
          .lte("orders.order_date", p.to);
        if (p.customer) q = q.eq("orders.customer_id", p.customer);
        if (p.category) q = p.category === "none" ? q.is("category_id", null) : q.eq("category_id", p.category);
        if (p.product) q = q.eq("product_variants.product_id", p.product);
        return q.order("order_id").range(from, to) as unknown as PromiseLike<{ data: Line[] | null; error: unknown }>;
      });
      lines.sort((a, b) => (a.orders.order_date < b.orders.order_date ? 1 : -1));
      const { data: cats } = await ctx.supabase.from("product_categories").select("id, name").eq("business_id", ctx.businessId);
      const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));
      const rows = lines.map((l) => ({
        date: l.orders.order_date,
        order: l.orders.order_number,
        customer: l.orders.customers?.name ?? "Walk-in",
        item: l.description,
        category: l.category_id ? (catName.get(l.category_id) ?? "") : "Uncategorised",
        quantity: n(l.quantity),
        revenue: n(l.net_amount),
        tax: n(l.tax_amount),
        cogs: n(l.cogs_amount),
        profit: n(l.net_amount) - n(l.cogs_amount),
        _href: `/orders/${l.orders.id}`,
      }));
      const revenue = rows.reduce((a, r) => a + r.revenue, 0);
      const cogs = rows.reduce((a, r) => a + r.cogs, 0);
      return {
        columns: [
          { key: "date", label: "Date", type: "date" },
          { key: "order", label: "Order", type: "text" },
          { key: "customer", label: "Customer", type: "text", secondary: true },
          { key: "item", label: "Item", type: "text" },
          { key: "category", label: "Category", type: "text", secondary: true },
          { key: "quantity", label: "Qty", type: "qty", total: true },
          { key: "revenue", label: "Revenue", type: "money", total: true },
          { key: "tax", label: ctx.business.tax_label, type: "money", total: true, secondary: true },
          { key: "cogs", label: "COGS", type: "money", total: true, secondary: true },
          { key: "profit", label: "Gross profit", type: "money", total: true },
        ],
        rows,
        summary: [
          { label: "Revenue (excl. tax)", value: revenue, type: "money", emphasis: true },
          { label: "Cost of goods sold", value: cogs, type: "money" },
          { label: "Gross profit", value: revenue - cogs, type: "money" },
          { label: "Orders", value: new Set(lines.map((l) => l.orders.id)).size, type: "number" },
        ],
        note: "Line revenue excludes tax and is after line and order discounts. Shipping charges are order-level and appear in the Profit & loss and Orders reports, not here.",
      };
    },
  },
  {
    key: "orders",
    title: "Orders",
    description: "All orders with status, totals and what's still owed.",
    filters: ["range", "customer", "orderStatus", "paymentStatus"],
    async load(ctx, p) {
      type O = { id: string; order_number: string; order_date: string; status: string; payment_status: string; total: number; amount_paid: number; revenue_amount: number; cogs_total: number; recognized_at: string | null; customers: { name: string } | null };
      const orders = await fetchAll<O>((from, to) => {
        let q = ctx.supabase.from("orders").select("id, order_number, order_date, status, payment_status, total, amount_paid, revenue_amount, cogs_total, recognized_at, customers(name)").eq("business_id", ctx.businessId).gte("order_date", p.from).lte("order_date", p.to);
        if (p.customer) q = q.eq("customer_id", p.customer);
        if (p.status) q = q.eq("status", p.status);
        if (p.payment) q = q.eq("payment_status", p.payment);
        return q.order("order_date", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: O[] | null; error: unknown }>;
      });
      const rows = orders.map((o) => {
        const closed = o.status === "cancelled" || o.status === "returned";
        return {
          date: o.order_date, order: o.order_number, customer: o.customers?.name ?? "Walk-in", status: o.status, payment: closed || o.status === "draft" ? "" : o.payment_status,
          total: n(o.total), paid: n(o.amount_paid), due: closed ? 0 : Math.max(0, n(o.total) - n(o.amount_paid)),
          profit: o.recognized_at && !closed ? n(o.revenue_amount) - n(o.cogs_total) : null, _href: `/orders/${o.id}`,
        };
      });
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "order", label: "Order", type: "text" }, { key: "customer", label: "Customer", type: "text", secondary: true },
          { key: "status", label: "Status", type: "status" }, { key: "payment", label: "Payment", type: "status", secondary: true },
          { key: "total", label: "Total", type: "money", total: true }, { key: "paid", label: "Paid", type: "money", total: true, secondary: true },
          { key: "due", label: "Due", type: "money", total: true }, { key: "profit", label: "Gross profit", type: "money", total: true, secondary: true },
        ],
        rows,
        summary: [
          { label: "Orders", value: rows.length, type: "number" },
          { label: "Billed", value: rows.filter((r) => !["cancelled", "returned", "draft"].includes(r.status)).reduce((a, r) => a + r.total, 0), type: "money" },
          { label: "Outstanding", value: rows.filter((r) => r.status !== "draft").reduce((a, r) => a + r.due, 0), type: "money", emphasis: true },
        ],
      };
    },
  },
  {
    key: "payments",
    title: "Payments",
    description: "Money received and paid out, by method.",
    filters: ["range", "direction", "customer", "supplier"],
    async load(ctx, p) {
      type P = { id: string; payment_date: string; direction: string; kind: string; amount: number; method: string; reference: string | null; order_id: string | null; purchase_id: string | null; customers: { name: string } | null; suppliers: { name: string } | null; orders: { order_number: string } | null; purchases: { purchase_number: string } | null };
      const pays = await fetchAll<P>((from, to) => {
        let q = ctx.supabase.from("payments").select("id, payment_date, direction, kind, amount, method, reference, order_id, purchase_id, customers(name), suppliers(name), orders(order_number), purchases(purchase_number)").eq("business_id", ctx.businessId).gte("payment_date", p.from).lte("payment_date", p.to);
        if (p.direction) q = q.eq("direction", p.direction);
        if (p.customer) q = q.eq("customer_id", p.customer);
        if (p.supplier) q = q.eq("supplier_id", p.supplier);
        return q.order("payment_date", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: P[] | null; error: unknown }>;
      });
      const rows = pays.map((x) => {
        const signed = (x.kind === "refund" ? -1 : 1) * n(x.amount);
        return {
          date: x.payment_date, type: `${x.direction === "in" ? "Received" : "Paid out"}${x.kind === "refund" ? " (refund)" : ""}`,
          party: x.customers?.name ?? x.suppliers?.name ?? "", for: x.orders?.order_number ?? x.purchases?.purchase_number ?? "",
          method: x.method, reference: x.reference ?? "", received: x.direction === "in" ? signed : 0, paid: x.direction === "out" ? signed : 0,
          _href: x.order_id ? `/orders/${x.order_id}` : x.purchase_id ? `/purchases/${x.purchase_id}` : undefined,
        };
      });
      const byMethod = new Map<string, number>();
      for (const r of rows) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.received - r.paid);
      const received = rows.reduce((a, r) => a + r.received, 0);
      const paid = rows.reduce((a, r) => a + r.paid, 0);
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "type", label: "Type", type: "text" }, { key: "party", label: "Customer / supplier", type: "text" },
          { key: "for", label: "For", type: "text", secondary: true }, { key: "method", label: "Method", type: "text" }, { key: "reference", label: "Reference", type: "text", secondary: true },
          { key: "received", label: "Received", type: "money", total: true }, { key: "paid", label: "Paid out", type: "money", total: true },
        ],
        rows,
        summary: [
          { label: "Received", value: received, type: "money" },
          { label: "Paid out", value: paid, type: "money" },
          { label: "Net", value: received - paid, type: "money", emphasis: true },
          ...[...byMethod.entries()].slice(0, 3).map(([m, v]) => ({ label: `Net via ${m}`, value: v, type: "money" as const })),
        ],
      };
    },
  },
  {
    key: "expenses",
    title: "Expenses",
    description: "Operating expenses by date and category.",
    module: "module_expenses",
    filters: ["range", "expenseCategory"],
    async load(ctx, p) {
      type E = { id: string; expense_date: string; description: string; amount: number; vendor: string | null; payment_method: string | null; expense_categories: { name: string } | null };
      const exps = await fetchAll<E>((from, to) => {
        let q = ctx.supabase.from("expenses").select("id, expense_date, description, amount, vendor, payment_method, expense_categories(name)").eq("business_id", ctx.businessId).gte("expense_date", p.from).lte("expense_date", p.to);
        if (p.expenseCategory) q = p.expenseCategory === "none" ? q.is("category_id", null) : q.eq("category_id", p.expenseCategory);
        return q.order("expense_date", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: E[] | null; error: unknown }>;
      });
      const breakdown = await expenseBreakdown(ctx, p.from, p.to);
      const total = exps.reduce((a, e) => a + n(e.amount), 0);
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "description", label: "Description", type: "text" }, { key: "category", label: "Category", type: "text" },
          { key: "vendor", label: "Vendor", type: "text", secondary: true }, { key: "method", label: "Method", type: "text", secondary: true }, { key: "amount", label: "Amount", type: "money", total: true },
        ],
        rows: exps.map((e) => ({ date: e.expense_date, description: e.description, category: e.expense_categories?.name ?? "Uncategorised", vendor: e.vendor ?? "", method: e.payment_method ?? "", amount: n(e.amount) })),
        summary: [
          { label: "Total expenses", value: total, type: "money", emphasis: true },
          ...breakdown.slice(0, 3).map((b) => ({ label: b.category_name, value: b.amount, type: "money" as const })),
        ],
      };
    },
  },
  {
    key: "products",
    title: "Product performance",
    description: "Units sold, revenue, cost and margin for each product or service.",
    filters: ["range", "category"],
    async load(ctx, p) {
      let items = await itemPerformance(ctx, p.from, p.to);
      if (p.category) {
        const { data: cat } = await ctx.supabase.from("product_categories").select("name").eq("id", p.category).maybeSingle();
        items = items.filter((i) => (p.category === "none" ? !i.category_name : i.category_name === cat?.name));
      }
      const revenue = items.reduce((a, i) => a + i.revenue, 0);
      const cogs = items.reduce((a, i) => a + i.cogs, 0);
      return {
        columns: [
          { key: "item", label: "Item", type: "text" }, { key: "sku", label: "SKU", type: "text", secondary: true }, { key: "category", label: "Category", type: "text", secondary: true },
          { key: "orders", label: "Orders", type: "number", total: true, secondary: true }, { key: "quantity", label: "Qty sold", type: "qty", total: true },
          { key: "revenue", label: "Revenue", type: "money", total: true }, { key: "cogs", label: "COGS", type: "money", total: true, secondary: true },
          { key: "profit", label: "Gross profit", type: "money", total: true }, { key: "margin", label: "Margin", type: "pct" },
        ],
        rows: items.map((i) => ({ item: i.item_name, sku: i.sku ?? "", category: i.category_name ?? "Uncategorised", orders: i.orders, quantity: i.quantity, revenue: i.revenue, cogs: i.cogs, profit: i.gross_profit, margin: i.margin_pct, _href: `/catalog/${i.product_id}` })),
        summary: [
          { label: "Items sold", value: items.length, type: "number" },
          { label: "Revenue", value: revenue, type: "money" },
          { label: "Gross profit", value: revenue - cogs, type: "money", emphasis: true },
          { label: "Average margin", value: revenue ? ((revenue - cogs) / revenue) * 100 : 0, type: "pct" },
        ],
      };
    },
  },
  {
    key: "customers",
    title: "Customers",
    description: "Orders, revenue and outstanding balance per customer.",
    module: "module_customers",
    filters: ["range"],
    async load(ctx, p) {
      const rows = (await customerSummary(ctx, p.from, p.to)).filter((c) => c.orders > 0 || c.amount_due > 0);
      return {
        columns: [
          { key: "customer", label: "Customer", type: "text" }, { key: "orders", label: "Orders", type: "number", total: true },
          { key: "revenue", label: "Revenue (excl. tax)", type: "money", total: true }, { key: "billed", label: "Billed", type: "money", total: true, secondary: true },
          { key: "paid", label: "Paid", type: "money", total: true, secondary: true }, { key: "due", label: "Owes you", type: "money", total: true }, { key: "last", label: "Last order", type: "date", secondary: true },
        ],
        rows: rows.map((c) => ({ customer: c.customer_name, orders: c.orders, revenue: c.revenue, billed: c.total_billed, paid: c.amount_paid, due: c.amount_due, last: c.last_order, _href: `/customers/${c.customer_id}` })),
        summary: [
          { label: "Customers with orders", value: rows.length, type: "number" },
          { label: "Revenue", value: rows.reduce((a, r) => a + r.revenue, 0), type: "money" },
          { label: "Outstanding", value: rows.reduce((a, r) => a + r.amount_due, 0), type: "money", emphasis: true },
        ],
        note: "Includes recognised orders dated within the range. Walk-in sales without a customer are not listed.",
      };
    },
  },
  {
    key: "inventory",
    title: "Inventory valuation",
    description: "Current stock on hand and its value at weighted-average cost.",
    module: "module_inventory",
    filters: ["category"],
    async load(ctx, p) {
      type I = { variant_id: string; product_id: string; item_name: string; sku: string | null; item_type: string; unit: string; category_name: string | null; quantity: number; avg_cost: number; stock_value: number; min_stock: number; is_low: boolean; is_out: boolean; location: string | null };
      const items = await fetchAll<I>((from, to) => {
        let q = ctx.supabase.from("inventory_overview").select("*").eq("business_id", ctx.businessId).eq("is_active", true);
        if (p.category) q = p.category === "none" ? q.is("category_id", null) : q.eq("category_id", p.category);
        return q.order("item_name").range(from, to) as unknown as PromiseLike<{ data: I[] | null; error: unknown }>;
      });
      const value = items.reduce((a, i) => a + n(i.stock_value), 0);
      return {
        columns: [
          { key: "item", label: "Item", type: "text" }, { key: "sku", label: "SKU", type: "text", secondary: true }, { key: "type", label: "Type", type: "text", secondary: true },
          { key: "location", label: "Location", type: "text", secondary: true }, { key: "quantity", label: "On hand", type: "qty" }, { key: "min", label: "Min", type: "qty", secondary: true },
          { key: "avg_cost", label: "Avg. cost", type: "money" }, { key: "value", label: "Value", type: "money", total: true }, { key: "status", label: "Status", type: "status" },
        ],
        rows: items.map((i) => ({ item: i.item_name, sku: i.sku ?? "", type: titleCase(i.item_type), location: i.location ?? "", quantity: n(i.quantity), min: n(i.min_stock), avg_cost: n(i.avg_cost), value: n(i.stock_value), status: i.is_out ? "out" : i.is_low ? "low" : "ok", _href: `/inventory/${i.variant_id}` })),
        summary: [
          { label: "Inventory value", value, type: "money", emphasis: true },
          { label: "Items", value: items.length, type: "number" },
          { label: "Low stock", value: items.filter((i) => i.is_low).length, type: "number" },
          { label: "Out of stock", value: items.filter((i) => i.is_out).length, type: "number" },
        ],
        note: "A snapshot as of now (date filters don't apply). Value = quantity × weighted-average cost; negative quantities are valued at zero.",
      };
    },
  },
  {
    key: "purchases",
    title: "Purchases",
    description: "Purchases from suppliers, amounts paid and owed.",
    module: "module_purchases",
    filters: ["range", "supplier", "purchaseStatus", "paymentStatus"],
    async load(ctx, p) {
      type Pu = { id: string; purchase_number: string; purchase_date: string; invoice_number: string | null; status: string; payment_status: string; total: number; amount_paid: number; suppliers: { name: string } | null };
      const list = await fetchAll<Pu>((from, to) => {
        let q = ctx.supabase.from("purchases").select("id, purchase_number, purchase_date, invoice_number, status, payment_status, total, amount_paid, suppliers(name)").eq("business_id", ctx.businessId).gte("purchase_date", p.from).lte("purchase_date", p.to);
        if (p.supplier) q = q.eq("supplier_id", p.supplier);
        if (p.status) q = q.eq("status", p.status);
        if (p.payment) q = q.eq("payment_status", p.payment);
        return q.order("purchase_date", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: Pu[] | null; error: unknown }>;
      });
      const rows = list.map((x) => {
        const inactive = x.status === "cancelled" || x.status === "draft";
        return { date: x.purchase_date, purchase: x.purchase_number, invoice: x.invoice_number ?? "", supplier: x.suppliers?.name ?? "", status: x.status, payment: inactive ? "" : x.payment_status, total: n(x.total), paid: n(x.amount_paid), due: inactive ? 0 : Math.max(0, n(x.total) - n(x.amount_paid)), _href: `/purchases/${x.id}` };
      });
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "purchase", label: "Purchase", type: "text" }, { key: "invoice", label: "Invoice", type: "text", secondary: true },
          { key: "supplier", label: "Supplier", type: "text" }, { key: "status", label: "Status", type: "status" }, { key: "payment", label: "Payment", type: "status", secondary: true },
          { key: "total", label: "Total", type: "money", total: true }, { key: "paid", label: "Paid", type: "money", total: true, secondary: true }, { key: "due", label: "Owed", type: "money", total: true },
        ],
        rows,
        summary: [
          { label: "Purchases", value: rows.filter((r) => !["cancelled", "draft"].includes(r.status)).length, type: "number" },
          { label: "Total value", value: rows.filter((r) => !["cancelled", "draft"].includes(r.status)).reduce((a, r) => a + r.total, 0), type: "money" },
          { label: "Owed to suppliers", value: rows.reduce((a, r) => a + r.due, 0), type: "money", emphasis: true },
        ],
      };
    },
  },
  {
    key: "suppliers",
    title: "Suppliers",
    description: "Purchase value and outstanding balance per supplier.",
    module: "module_suppliers",
    filters: ["range"],
    async load(ctx, p) {
      const rows = (await supplierSummary(ctx, p.from, p.to)).filter((s) => s.purchases > 0);
      return {
        columns: [
          { key: "supplier", label: "Supplier", type: "text" }, { key: "purchases", label: "Purchases", type: "number", total: true },
          { key: "total", label: "Total", type: "money", total: true }, { key: "paid", label: "Paid", type: "money", total: true }, { key: "due", label: "You owe", type: "money", total: true }, { key: "last", label: "Last purchase", type: "date", secondary: true },
        ],
        rows: rows.map((s) => ({ supplier: s.supplier_name, purchases: s.purchases, total: s.total, paid: s.amount_paid, due: s.amount_due, last: s.last_purchase, _href: `/suppliers/${s.supplier_id}` })),
        summary: [
          { label: "Suppliers", value: rows.length, type: "number" },
          { label: "Purchased", value: rows.reduce((a, r) => a + r.total, 0), type: "money" },
          { label: "Owed", value: rows.reduce((a, r) => a + r.amount_due, 0), type: "money", emphasis: true },
        ],
      };
    },
  },
  {
    key: "production",
    title: "Production",
    description: "Production batches with quantities and actual costs.",
    module: "module_production",
    filters: ["range", "batchStatus"],
    async load(ctx, p) {
      type B = { id: string; batch_number: string; production_date: string; status: string; planned_quantity: number; actual_quantity: number | null; material_cost: number; wastage_cost: number; additional_cost: number; total_cost: number; unit_cost: number | null; product_variants: { name: string; is_default: boolean; products: { name: string; unit: string } } };
      const list = await fetchAll<B>((from, to) => {
        let q = ctx.supabase.from("production_batches").select("*, product_variants!inner(name, is_default, products!inner(name, unit))").eq("business_id", ctx.businessId).gte("production_date", p.from).lte("production_date", p.to);
        if (p.status) q = q.eq("status", p.status);
        return q.order("production_date", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: B[] | null; error: unknown }>;
      });
      const done = list.filter((b) => b.status === "completed");
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "batch", label: "Batch", type: "text" }, { key: "product", label: "Product", type: "text" }, { key: "status", label: "Status", type: "status" },
          { key: "planned", label: "Planned", type: "qty", secondary: true }, { key: "produced", label: "Produced", type: "qty", total: true },
          { key: "materials", label: "Materials", type: "money", total: true, secondary: true }, { key: "wastage", label: "Wastage", type: "money", total: true, secondary: true },
          { key: "total", label: "Total cost", type: "money", total: true }, { key: "unit", label: "Unit cost", type: "money" },
        ],
        rows: list.map((b) => ({ date: b.production_date, batch: b.batch_number, product: vName({ ...b.product_variants, products: b.product_variants.products }), status: b.status, planned: n(b.planned_quantity), produced: b.actual_quantity == null ? null : n(b.actual_quantity), materials: n(b.material_cost), wastage: n(b.wastage_cost), total: n(b.total_cost), unit: b.unit_cost == null ? null : n(b.unit_cost), _href: `/production/batches/${b.id}` })),
        summary: [
          { label: "Completed batches", value: done.length, type: "number" },
          { label: "Production cost", value: done.reduce((a, b) => a + n(b.total_cost), 0), type: "money", emphasis: true },
          { label: "Wastage cost", value: done.reduce((a, b) => a + n(b.wastage_cost), 0), type: "money" },
        ],
      };
    },
  },
  {
    key: "wastage",
    title: "Wastage",
    description: "Damaged, lost or wasted stock and its value.",
    module: "module_inventory",
    filters: ["range"],
    async load(ctx, p) {
      type W = { id: string; wastage_date: string; reason: string; quantity: number; total_cost: number; batch_id: string | null; notes: string | null; product_variants: { name: string; is_default: boolean; products: { name: string; unit: string } } };
      const list = await fetchAll<W>((from, to) =>
        ctx.supabase.from("wastage").select("*, product_variants!inner(name, is_default, products!inner(name, unit))").eq("business_id", ctx.businessId).gte("wastage_date", p.from).lte("wastage_date", p.to).order("wastage_date", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: W[] | null; error: unknown }>,
      );
      const standalone = list.filter((w) => !w.batch_id).reduce((a, w) => a + n(w.total_cost), 0);
      const inBatches = list.filter((w) => w.batch_id).reduce((a, w) => a + n(w.total_cost), 0);
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "item", label: "Item", type: "text" }, { key: "reason", label: "Reason", type: "text" },
          { key: "quantity", label: "Qty", type: "qty" }, { key: "value", label: "Value", type: "money", total: true }, { key: "notes", label: "Notes", type: "text", secondary: true },
        ],
        rows: list.map((w) => ({ date: w.wastage_date, item: vName(w.product_variants), reason: titleCase(w.reason), quantity: n(w.quantity), value: n(w.total_cost), notes: w.notes ?? "", _href: w.batch_id ? `/production/batches/${w.batch_id}` : undefined })),
        summary: [
          { label: "Stock write-offs (reduce profit)", value: standalone, type: "money", emphasis: true },
          { label: "Production wastage (in batch cost)", value: inBatches, type: "money" },
        ],
        note: "Production wastage is included in the finished goods' cost, so it reaches profit through COGS. Other wastage is written off directly in the profit & loss.",
      };
    },
  },
];

export function getReport(key: string) {
  return REPORTS.find((r) => r.key === key) ?? null;
}
