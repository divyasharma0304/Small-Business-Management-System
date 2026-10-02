-- =============================================================================
-- Velqora — reporting functions
--
-- These are SECURITY INVOKER: they read through RLS, so a user only ever sees
-- their own business's numbers.
--
-- Definitions (also documented in README "Financial logic"):
--   Recognised sale  = order with recognized_at set and status not cancelled/returned,
--                      attributed to its order_date.
--   Revenue          = Σ orders.revenue_amount   (after discounts, excluding tax, including shipping charged)
--   COGS             = Σ order_items.cogs_amount (unit cost frozen when the sale was recognised)
--   Gross profit     = Revenue − COGS
--   Operating exp.   = Σ expenses.amount
--   Inventory losses = value of stand-alone wastage + net value of manual stock adjustments
--                      (production wastage is already inside finished-goods cost)
--   Est. net profit  = Gross profit − Operating expenses − Inventory losses
-- =============================================================================

create or replace function public.recognised_orders(p_business uuid, p_from date, p_to date)
returns setof public.orders
language sql
stable
set search_path = ''
as $$
  select o.* from public.orders o
  where o.business_id = p_business
    and o.recognized_at is not null
    and o.status not in ('cancelled', 'returned')
    and o.order_date between p_from and p_to;
$$;

create or replace function public.report_profit_summary(p_business uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_revenue numeric; v_shipping numeric; v_tax numeric; v_discounts numeric; v_cogs numeric;
  v_orders integer; v_gross_sales numeric;
  v_expenses numeric; v_losses numeric; v_wastage numeric; v_adjust numeric;
begin
  select timezone into v_tz from public.businesses where id = p_business;

  select coalesce(sum(o.revenue_amount), 0), coalesce(sum(o.shipping_charge), 0), coalesce(sum(o.tax_total), 0),
         coalesce(sum(o.cogs_total), 0), count(*), coalesce(sum(o.total), 0)
    into v_revenue, v_shipping, v_tax, v_cogs, v_orders, v_gross_sales
  from public.recognised_orders(p_business, p_from, p_to) o;

  select coalesce(sum(oi.discount_amount + oi.order_discount_share), 0) into v_discounts
  from public.order_items oi
  join public.recognised_orders(p_business, p_from, p_to) o on o.id = oi.order_id;

  select coalesce(sum(e.amount), 0) into v_expenses
  from public.expenses e
  where e.business_id = p_business and e.expense_date between p_from and p_to;

  select coalesce(sum(-t.total_cost) filter (where t.txn_type = 'wastage' and t.reference_type = 'wastage'), 0),
         coalesce(sum(-t.total_cost) filter (where t.txn_type = 'adjustment'), 0)
    into v_wastage, v_adjust
  from public.inventory_transactions t
  where t.business_id = p_business
    and (t.occurred_at at time zone coalesce(v_tz, 'UTC'))::date between p_from and p_to;
  v_losses := v_wastage + v_adjust;

  return jsonb_build_object(
    'revenue', v_revenue,
    'shipping_revenue', v_shipping,
    'tax_collected', v_tax,
    'discounts', v_discounts,
    'gross_sales', v_gross_sales,
    'cogs', v_cogs,
    'gross_profit', v_revenue - v_cogs,
    'gross_margin_pct', case when v_revenue = 0 then null else round((v_revenue - v_cogs) * 100 / v_revenue, 2) end,
    'operating_expenses', v_expenses,
    'wastage_losses', v_wastage,
    'adjustment_losses', v_adjust,
    'inventory_losses', v_losses,
    'net_profit', v_revenue - v_cogs - v_expenses - v_losses,
    'orders', v_orders,
    'avg_order_value', case when v_orders = 0 then 0 else round(v_revenue / v_orders, 2) end
  );
end;
$$;

-- Snapshot KPIs that are not period-based.
create or replace function public.report_business_snapshot(p_business uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pending_payments', (
      select coalesce(sum(o.total - o.amount_paid), 0) from public.orders o
      where o.business_id = p_business and o.status not in ('draft', 'cancelled', 'returned')
        and o.total > o.amount_paid),
    'pending_payment_orders', (
      select count(*) from public.orders o
      where o.business_id = p_business and o.status not in ('draft', 'cancelled', 'returned')
        and o.total > o.amount_paid),
    'overdue_payments', (
      select coalesce(sum(o.total - o.amount_paid), 0) from public.orders o
      where o.business_id = p_business and o.status not in ('draft', 'cancelled', 'returned')
        and o.total > o.amount_paid and o.due_date < current_date),
    'pending_orders', (
      select count(*) from public.orders o
      where o.business_id = p_business and o.status in ('confirmed', 'processing', 'ready', 'shipped')),
    'draft_orders', (
      select count(*) from public.orders o where o.business_id = p_business and o.status = 'draft'),
    'low_stock_items', (
      select count(*) from public.inventory_levels l
      join public.product_variants v on v.id = l.variant_id
      join public.products p on p.id = v.product_id
      where l.business_id = p_business and p.track_inventory and p.is_active and v.is_active
        and l.quantity <= l.min_stock and l.min_stock > 0),
    'out_of_stock_items', (
      select count(*) from public.inventory_levels l
      join public.product_variants v on v.id = l.variant_id
      join public.products p on p.id = v.product_id
      where l.business_id = p_business and p.track_inventory and p.is_active and v.is_active
        and l.quantity <= 0),
    'inventory_value', (
      select coalesce(round(sum(l.quantity * l.avg_cost), 2), 0) from public.inventory_levels l
      where l.business_id = p_business and l.quantity > 0),
    'products', (
      select count(*) from public.products p where p.business_id = p_business and p.is_active and p.item_type <> 'material'),
    'materials', (
      select count(*) from public.products p where p.business_id = p_business and p.is_active and p.item_type = 'material'),
    'customers', (
      select count(*) from public.customers c where c.business_id = p_business),
    'payables', (
      select coalesce(sum(pu.total - pu.amount_paid), 0) from public.purchases pu
      where pu.business_id = p_business and pu.status not in ('draft', 'cancelled') and pu.total > pu.amount_paid)
  );
$$;

-- p_bucket: 'day' | 'week' | 'month'
create or replace function public.report_timeseries(p_business uuid, p_from date, p_to date, p_bucket text)
returns table (period date, revenue numeric, cogs numeric, expenses numeric, gross_profit numeric,
               net_profit numeric, orders bigint)
language sql
stable
set search_path = ''
as $$
  with buckets as (
    select generate_series(date_trunc(p_bucket, p_from::timestamp), date_trunc(p_bucket, p_to::timestamp),
                           ('1 ' || p_bucket)::interval)::date as period
  ),
  s as (
    select date_trunc(p_bucket, o.order_date::timestamp)::date as period,
           sum(o.revenue_amount) as revenue, sum(o.cogs_total) as cogs, count(*) as orders
    from public.recognised_orders(p_business, p_from, p_to) o
    group by 1
  ),
  e as (
    select date_trunc(p_bucket, x.expense_date::timestamp)::date as period, sum(x.amount) as expenses
    from public.expenses x
    where x.business_id = p_business and x.expense_date between p_from and p_to
    group by 1
  )
  select b.period,
         coalesce(s.revenue, 0), coalesce(s.cogs, 0), coalesce(e.expenses, 0),
         coalesce(s.revenue, 0) - coalesce(s.cogs, 0),
         coalesce(s.revenue, 0) - coalesce(s.cogs, 0) - coalesce(e.expenses, 0),
         coalesce(s.orders, 0)
  from buckets b
  left join s on s.period = b.period
  left join e on e.period = b.period
  order by b.period;
$$;

create or replace function public.report_sales_by_category(p_business uuid, p_from date, p_to date)
returns table (category_id uuid, category_name text, revenue numeric, cogs numeric, quantity numeric)
language sql
stable
set search_path = ''
as $$
  select oi.category_id, coalesce(c.name, 'Uncategorised'),
         sum(oi.net_amount), sum(oi.cogs_amount), sum(oi.quantity)
  from public.order_items oi
  join public.recognised_orders(p_business, p_from, p_to) o on o.id = oi.order_id
  left join public.product_categories c on c.id = oi.category_id
  group by 1, 2
  order by 3 desc;
$$;

create or replace function public.report_item_performance(p_business uuid, p_from date, p_to date)
returns table (variant_id uuid, product_id uuid, item_name text, sku text, item_type public.item_type,
               category_name text, quantity numeric, revenue numeric, cogs numeric, gross_profit numeric,
               margin_pct numeric, orders bigint)
language sql
stable
set search_path = ''
as $$
  select oi.variant_id, v.product_id,
         p.name || case when v.is_default then '' else ' — ' || v.name end,
         v.sku, p.item_type, c.name,
         sum(oi.quantity), sum(oi.net_amount), sum(oi.cogs_amount),
         sum(oi.net_amount) - sum(oi.cogs_amount),
         case when sum(oi.net_amount) = 0 then null
              else round((sum(oi.net_amount) - sum(oi.cogs_amount)) * 100 / sum(oi.net_amount), 2) end,
         count(distinct oi.order_id)
  from public.order_items oi
  join public.recognised_orders(p_business, p_from, p_to) o on o.id = oi.order_id
  join public.product_variants v on v.id = oi.variant_id
  join public.products p on p.id = v.product_id
  left join public.product_categories c on c.id = p.category_id
  group by oi.variant_id, v.product_id, p.name, v.is_default, v.name, v.sku, p.item_type, c.name
  order by 8 desc;
$$;

create or replace function public.report_expense_breakdown(p_business uuid, p_from date, p_to date)
returns table (category_id uuid, category_name text, amount numeric, entries bigint)
language sql
stable
set search_path = ''
as $$
  select e.category_id, coalesce(c.name, 'Uncategorised'), sum(e.amount), count(*)
  from public.expenses e
  left join public.expense_categories c on c.id = e.category_id
  where e.business_id = p_business and e.expense_date between p_from and p_to
  group by 1, 2
  order by 3 desc;
$$;

create or replace function public.report_customer_summary(p_business uuid, p_from date, p_to date)
returns table (customer_id uuid, customer_name text, orders bigint, revenue numeric, total_billed numeric,
               amount_paid numeric, amount_due numeric, last_order date)
language sql
stable
set search_path = ''
as $$
  select c.id, c.name,
         count(o.id), coalesce(sum(o.revenue_amount), 0), coalesce(sum(o.total), 0),
         coalesce(sum(o.amount_paid), 0), coalesce(sum(greatest(o.total - o.amount_paid, 0)), 0),
         max(o.order_date)
  from public.customers c
  left join public.recognised_orders(p_business, p_from, p_to) o on o.customer_id = c.id
  where c.business_id = p_business
  group by c.id, c.name
  order by 4 desc, c.name;
$$;

create or replace function public.report_supplier_summary(p_business uuid, p_from date, p_to date)
returns table (supplier_id uuid, supplier_name text, purchases bigint, total numeric, amount_paid numeric,
               amount_due numeric, last_purchase date)
language sql
stable
set search_path = ''
as $$
  select s.id, s.name, count(p.id), coalesce(sum(p.total), 0), coalesce(sum(p.amount_paid), 0),
         coalesce(sum(greatest(p.total - p.amount_paid, 0)), 0), max(p.purchase_date)
  from public.suppliers s
  left join public.purchases p on p.supplier_id = s.id and p.status not in ('draft', 'cancelled')
       and p.purchase_date between p_from and p_to
  where s.business_id = p_business
  group by s.id, s.name
  order by 4 desc, s.name;
$$;

-- Estimated unit cost of a recipe's output from current average component costs.
create or replace function public.recipe_estimated_cost(p_recipe uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(coalesce(sum(ri.quantity * (1 + ri.wastage_pct / 100)
                           * coalesce(nullif(l.avg_cost, 0), v.cost_price)), 0) / max(r.yield_quantity), 4)
  from public.recipes r
  join public.recipe_items ri on ri.recipe_id = r.id
  join public.product_variants v on v.id = ri.component_variant_id
  left join public.inventory_levels l on l.variant_id = ri.component_variant_id
  where r.id = p_recipe;
$$;

grant execute on function public.recognised_orders(uuid, date, date) to authenticated;
grant execute on function public.report_profit_summary(uuid, date, date) to authenticated;
grant execute on function public.report_business_snapshot(uuid) to authenticated;
grant execute on function public.report_timeseries(uuid, date, date, text) to authenticated;
grant execute on function public.report_sales_by_category(uuid, date, date) to authenticated;
grant execute on function public.report_item_performance(uuid, date, date) to authenticated;
grant execute on function public.report_expense_breakdown(uuid, date, date) to authenticated;
grant execute on function public.report_customer_summary(uuid, date, date) to authenticated;
grant execute on function public.report_supplier_summary(uuid, date, date) to authenticated;
grant execute on function public.recipe_estimated_cost(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Read models for list pages (security_invoker → RLS of the base tables applies)
-- ---------------------------------------------------------------------------
create or replace view public.inventory_overview with (security_invoker = true) as
select
  l.variant_id,
  l.business_id,
  v.product_id,
  p.name || case when v.is_default then '' else ' — ' || v.name end as item_name,
  v.name as variant_name,
  v.is_default,
  v.sku,
  p.item_type,
  p.unit,
  p.category_id,
  c.name as category_name,
  l.quantity,
  l.avg_cost,
  l.min_stock,
  l.max_stock,
  l.location,
  round(greatest(l.quantity, 0) * l.avg_cost, 2) as stock_value,
  (l.quantity <= 0) as is_out,
  (l.min_stock > 0 and l.quantity <= l.min_stock) as is_low,
  (l.max_stock is not null and l.quantity > l.max_stock) as is_over,
  (p.is_active and v.is_active) as is_active,
  v.selling_price,
  coalesce(v.image_path, p.image_path) as image_path,
  l.updated_at
from public.inventory_levels l
join public.product_variants v on v.id = l.variant_id
join public.products p on p.id = v.product_id
left join public.product_categories c on c.id = p.category_id
where p.track_inventory;

create or replace view public.catalog_overview with (security_invoker = true) as
select
  p.id,
  p.business_id,
  p.name,
  p.item_type,
  p.category_id,
  c.name as category_name,
  p.unit,
  p.track_inventory,
  p.has_variants,
  p.is_active,
  p.is_demo,
  p.image_path,
  p.created_at,
  count(v.id) filter (where v.is_active) as variant_count,
  min(v.selling_price) filter (where v.is_active) as min_price,
  max(v.selling_price) filter (where v.is_active) as max_price,
  min(v.cost_price) filter (where v.is_active) as min_cost,
  string_agg(v.sku, ', ') filter (where v.sku is not null and v.sku <> '') as skus,
  sum(l.quantity) as stock_quantity,
  bool_or(l.min_stock > 0 and l.quantity <= l.min_stock and v.is_active) as is_low
from public.products p
left join public.product_categories c on c.id = p.category_id
left join public.product_variants v on v.product_id = p.id
left join public.inventory_levels l on l.variant_id = v.id
group by p.id, c.name;

-- Sellable/purchasable item picker for order, purchase and recipe forms.
create or replace view public.item_picker with (security_invoker = true) as
select
  v.id as variant_id,
  v.business_id,
  v.product_id,
  p.name || case when v.is_default then '' else ' — ' || v.name end as item_name,
  v.sku,
  p.item_type,
  p.unit,
  p.tax_rate,
  p.track_inventory,
  v.selling_price,
  v.cost_price,
  l.quantity as stock_quantity,
  l.avg_cost
from public.product_variants v
join public.products p on p.id = v.product_id
left join public.inventory_levels l on l.variant_id = v.id
where v.is_active and p.is_active;

revoke all on public.inventory_overview, public.catalog_overview, public.item_picker from anon;
grant select on public.inventory_overview, public.catalog_overview, public.item_picker to authenticated;
