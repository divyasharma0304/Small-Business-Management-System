-- =============================================================================
-- "Today" in the business's own timezone.
-- Postgres current_date is UTC on Supabase, which is still "yesterday" in India
-- until 05:30. The app always sends business-local dates; these functions now do
-- the same where they previously relied on current_date.
-- =============================================================================

create or replace function public.business_today(p_business uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select timezone from public.businesses where id = p_business), 'UTC'))::date;
$$;
revoke execute on function public.business_today(uuid) from public, anon;
grant execute on function public.business_today(uuid) to authenticated;

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
        and o.total > o.amount_paid and o.due_date < public.business_today(p_business)),
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

create or replace function public.seed_demo_data(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat_products uuid; v_cat_services uuid; v_cat_accessories uuid;
  v_prod_a uuid; v_prod_b uuid; v_prod_c uuid; v_service uuid; v_mat_a uuid; v_mat_b uuid;
  v_var_a uuid; v_var_b_small uuid; v_var_b_large uuid; v_var_c uuid; v_var_service uuid;
  v_var_mat_a uuid; v_var_mat_b uuid;
  v_sup_a uuid; v_sup_b uuid; v_cus_a uuid; v_cus_b uuid;
  v_purchase uuid; v_purchase2 uuid; v_order1 uuid; v_order2 uuid; v_order3 uuid;
  v_recipe uuid;
  v_cat_mkt uuid; v_cat_pack uuid; v_cat_soft uuid;
  v_today date := public.business_today(p_business);
begin
  perform public.assert_member(p_business);
  if exists (select 1 from public.products where business_id = p_business and is_demo) then
    raise exception 'Demo data is already loaded.';
  end if;

  insert into public.product_categories (business_id, name, is_demo) values
    (p_business, 'Demo: Products', true) returning id into v_cat_products;
  insert into public.product_categories (business_id, name, is_demo) values
    (p_business, 'Demo: Services', true) returning id into v_cat_services;
  insert into public.product_categories (business_id, name, is_demo) values
    (p_business, 'Demo: Accessories', true) returning id into v_cat_accessories;

  v_prod_a := public.save_product(p_business,
    jsonb_build_object('name', 'Product A', 'item_type', 'product', 'category_id', v_cat_products, 'unit', 'pcs',
      'tax_rate', 0, 'track_inventory', true, 'has_variants', false, 'is_demo', true,
      'description', 'Demo product that is made in-house from Material A and Material B.'),
    jsonb_build_array(jsonb_build_object('sku', 'DEMO-A', 'selling_price', 500, 'cost_price', 200, 'min_stock', 5)));
  v_prod_b := public.save_product(p_business,
    jsonb_build_object('name', 'Product B', 'item_type', 'product', 'category_id', v_cat_products, 'unit', 'pcs',
      'track_inventory', true, 'has_variants', true, 'is_demo', true, 'description', 'Demo product with two variants.'),
    jsonb_build_array(
      jsonb_build_object('name', 'Small', 'sku', 'DEMO-B-S', 'selling_price', 300, 'cost_price', 120, 'min_stock', 3,
                         'attributes', jsonb_build_object('Size', 'Small'), 'opening_stock', 10, 'opening_unit_cost', 120),
      jsonb_build_object('name', 'Large', 'sku', 'DEMO-B-L', 'selling_price', 450, 'cost_price', 180, 'min_stock', 3,
                         'attributes', jsonb_build_object('Size', 'Large'), 'opening_stock', 2, 'opening_unit_cost', 180)));
  v_prod_c := public.save_product(p_business,
    jsonb_build_object('name', 'Product C', 'item_type', 'product', 'category_id', v_cat_accessories, 'unit', 'pcs',
      'track_inventory', true, 'is_demo', true),
    jsonb_build_array(jsonb_build_object('sku', 'DEMO-C', 'selling_price', 120, 'cost_price', 40, 'min_stock', 10)));
  v_service := public.save_product(p_business,
    jsonb_build_object('name', 'Service X', 'item_type', 'service', 'category_id', v_cat_services, 'unit', 'job',
      'track_inventory', false, 'is_demo', true, 'cost_method', 'components', 'description', 'Demo service.'),
    jsonb_build_array(jsonb_build_object('sku', 'DEMO-SVC', 'selling_price', 1500)),
    jsonb_build_array(jsonb_build_object('label', 'Labour (2 h)', 'amount', 400),
                      jsonb_build_object('label', 'Consumables', 'amount', 100)));
  v_mat_a := public.save_product(p_business,
    jsonb_build_object('name', 'Material A', 'item_type', 'material', 'unit', 'kg', 'track_inventory', true, 'is_demo', true),
    jsonb_build_array(jsonb_build_object('sku', 'DEMO-MAT-A', 'cost_price', 10, 'min_stock', 20)));
  v_mat_b := public.save_product(p_business,
    jsonb_build_object('name', 'Material B', 'item_type', 'material', 'unit', 'pcs', 'track_inventory', true, 'is_demo', true),
    jsonb_build_array(jsonb_build_object('sku', 'DEMO-MAT-B', 'cost_price', 15, 'min_stock', 10)));

  select id into v_var_a from public.product_variants where product_id = v_prod_a;
  select id into v_var_b_small from public.product_variants where product_id = v_prod_b and name = 'Small';
  select id into v_var_b_large from public.product_variants where product_id = v_prod_b and name = 'Large';
  select id into v_var_c from public.product_variants where product_id = v_prod_c;
  select id into v_var_service from public.product_variants where product_id = v_service;
  select id into v_var_mat_a from public.product_variants where product_id = v_mat_a;
  select id into v_var_mat_b from public.product_variants where product_id = v_mat_b;

  insert into public.suppliers (business_id, name, contact_person, phone, email, city, country, is_demo) values
    (p_business, 'Supplier A', 'Contact A', '+91 90000 00001', 'supplier.a@example.com', 'Mumbai', 'India', true)
    returning id into v_sup_a;
  insert into public.suppliers (business_id, name, contact_person, phone, city, country, is_demo) values
    (p_business, 'Supplier B', 'Contact B', '+91 90000 00002', 'Delhi', 'India', true)
    returning id into v_sup_b;
  insert into public.customers (business_id, name, phone, email, city, country, is_demo) values
    (p_business, 'Customer A', '+91 98000 00001', 'customer.a@example.com', 'Pune', 'India', true)
    returning id into v_cus_a;
  insert into public.customers (business_id, name, phone, city, country, is_demo) values
    (p_business, 'Customer B', '+91 98000 00002', 'Jaipur', 'India', true)
    returning id into v_cus_b;

  -- Purchases (received → stock in at landed cost)
  v_purchase := public.save_purchase(p_business,
    jsonb_build_object('supplier_id', v_sup_a, 'purchase_date', v_today - 20, 'invoice_number', 'DEMO-INV-001',
      'status', 'ordered', 'other_charges', 100, 'is_demo', true),
    jsonb_build_array(
      jsonb_build_object('variant_id', v_var_c, 'quantity', 50, 'unit_price', 38),
      jsonb_build_object('variant_id', v_var_mat_a, 'quantity', 100, 'unit_price', 9),
      jsonb_build_object('variant_id', v_var_mat_b, 'quantity', 60, 'unit_price', 14)));
  perform public.receive_purchase(v_purchase, null, 'LOT-DEMO-1');
  insert into public.payments (business_id, direction, payment_date, amount, method, supplier_id, purchase_id, notes, is_demo)
  values (p_business, 'out', v_today - 18, 2000, 'Bank transfer', v_sup_a, v_purchase, 'Demo part payment', true);

  v_purchase2 := public.save_purchase(p_business,
    jsonb_build_object('supplier_id', v_sup_b, 'purchase_date', v_today - 2, 'status', 'ordered', 'is_demo', true),
    jsonb_build_array(jsonb_build_object('variant_id', v_var_b_large, 'quantity', 10, 'unit_price', 175)));

  -- Production: recipe + completed batch for Product A
  v_recipe := public.save_recipe(p_business,
    jsonb_build_object('name', 'Product A — standard', 'variant_id', v_var_a, 'yield_quantity', 1, 'is_demo', true),
    jsonb_build_array(
      jsonb_build_object('component_variant_id', v_var_mat_a, 'quantity', 2, 'wastage_pct', 5),
      jsonb_build_object('component_variant_id', v_var_mat_b, 'quantity', 1)));
  perform public.complete_production_batch(
    public.create_production_batch(p_business, v_recipe, 10, v_today - 15, 'Demo batch', true),
    10, null, 150, null);

  -- Orders
  v_order1 := public.save_order(p_business,
    jsonb_build_object('customer_id', v_cus_a, 'order_date', v_today - 10, 'status', 'confirmed', 'is_demo', true,
      'preferred_payment_method', 'UPI'),
    jsonb_build_array(
      jsonb_build_object('variant_id', v_var_a, 'quantity', 2, 'unit_price', 500),
      jsonb_build_object('variant_id', v_var_service, 'quantity', 1, 'unit_price', 1500)));
  perform public.set_order_status(v_order1, 'delivered');
  insert into public.payments (business_id, direction, payment_date, amount, method, reference, order_id, is_demo)
  values (p_business, 'in', v_today - 10, 2500, 'UPI', 'DEMO-UPI-1', v_order1, true);

  v_order2 := public.save_order(p_business,
    jsonb_build_object('customer_id', v_cus_b, 'order_date', v_today - 3, 'status', 'confirmed',
      'shipping_charge', 60, 'discount_amount', 50, 'is_demo', true),
    jsonb_build_array(
      jsonb_build_object('variant_id', v_var_c, 'quantity', 5, 'unit_price', 120),
      jsonb_build_object('variant_id', v_var_b_small, 'quantity', 1, 'unit_price', 300)));
  insert into public.payments (business_id, direction, payment_date, amount, method, order_id, is_demo)
  values (p_business, 'in', v_today - 3, 500, 'Cash', v_order2, true);

  v_order3 := public.save_order(p_business,
    jsonb_build_object('customer_id', v_cus_a, 'order_date', v_today, 'status', 'draft', 'is_demo', true),
    jsonb_build_array(jsonb_build_object('variant_id', v_var_b_large, 'quantity', 1, 'unit_price', 450)));

  -- Expenses
  select id into v_cat_mkt from public.expense_categories where business_id = p_business and name = 'Marketing';
  select id into v_cat_pack from public.expense_categories where business_id = p_business and name = 'Packaging';
  select id into v_cat_soft from public.expense_categories where business_id = p_business and name = 'Software';
  insert into public.expenses (business_id, expense_date, category_id, description, amount, vendor, payment_method, is_demo) values
    (p_business, v_today - 12, v_cat_mkt, 'Demo: social media ads', 1200, 'Ad platform', 'Card', true),
    (p_business, v_today - 8, v_cat_pack, 'Demo: boxes and tape', 800, 'Supplier B', 'Cash', true),
    (p_business, v_today - 1, v_cat_soft, 'Demo: accounting app subscription', 499, 'Software vendor', 'UPI', true);

  perform public.write_audit(p_business, 'demo.seed', 'business', p_business::text, 'Demo data loaded');
end;
$$;
