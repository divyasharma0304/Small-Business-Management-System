-- =============================================================================
-- Corrections: edit & delete everywhere, and "highest cost" for estimates.
--
-- Principle: correcting a mistake must keep stock and money consistent.
-- Wherever stock already moved, the correction first moves it back (with a
-- visible entry in the stock history) and only then changes or removes the
-- record — all inside one transaction.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Highest known cost of an item: max(standard cost, average cost, highest
-- price ever paid/entered for it). Used for recipe/BOM *estimates* so that
-- stock entered at ₹0 doesn't make recipes look free. Actual stock valuation
-- and COGS keep using weighted-average cost.
-- ---------------------------------------------------------------------------
create or replace function public.variant_highest_cost(p_variant uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce(v.cost_price, 0),
    coalesce(l.avg_cost, 0),
    coalesce((select max(t.unit_cost) from public.inventory_transactions t where t.variant_id = v.id and t.quantity > 0), 0)
  )
  from public.product_variants v
  left join public.inventory_levels l on l.variant_id = v.id
  where v.id = p_variant;
$$;

create or replace function public.recipe_estimated_cost(p_recipe uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select round(coalesce(sum(ri.quantity * (1 + ri.wastage_pct / 100) * public.variant_highest_cost(ri.component_variant_id)), 0)
               / max(r.yield_quantity), 4)
  from public.recipes r
  join public.recipe_items ri on ri.recipe_id = r.id
  where r.id = p_recipe;
$$;

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
  l.avg_cost,
  public.variant_highest_cost(v.id) as highest_cost
from public.product_variants v
join public.products p on p.id = v.product_id
left join public.inventory_levels l on l.variant_id = v.id
where v.is_active and p.is_active;

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
  l.updated_at,
  public.variant_highest_cost(v.id) as highest_cost
from public.inventory_levels l
join public.product_variants v on v.id = l.variant_id
join public.products p on p.id = v.product_id
left join public.product_categories c on c.id = p.category_id
where p.track_inventory;

grant execute on function public.variant_highest_cost(uuid) to authenticated;
grant select on public.item_picker, public.inventory_overview to authenticated;

-- ---------------------------------------------------------------------------
-- Orders: edit after it was recorded as a sale; delete in any state.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_order_stock(p_order uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_line public.order_items%rowtype;
begin
  select * into v_o from public.orders where id = p_order for update;
  if v_o.stock_deducted and not v_o.stock_reversed then
    for v_line in select * from public.order_items where order_id = p_order and track_inventory loop
      perform public.apply_stock_movement(v_o.business_id, v_line.variant_id, v_line.quantity, 'sale_reversal',
        v_line.unit_cost, 'order', v_o.id, v_o.order_number, p_note);
    end loop;
  end if;
end;
$$;

create or replace function public.edit_order(p_business uuid, p_order jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (p_order->>'id')::uuid;
  v_o public.orders%rowtype;
begin
  perform public.assert_member(p_business);
  select * into v_o from public.orders where id = v_id and business_id = p_business for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_o.recognized_at is null then
    return public.save_order(p_business, p_order, p_lines);
  end if;
  if v_o.status in ('cancelled', 'returned') then
    raise exception 'Cancelled or returned orders cannot be edited.';
  end if;

  -- 1. Put the stock back exactly as it left, 2. save the changes, 3. record the sale again.
  perform public.reverse_order_stock(v_id, 'Order edited — stock put back before saving the changes');
  update public.orders set recognized_at = null, stock_deducted = false, stock_reversed = false, cogs_total = 0, status = 'draft'
  where id = v_id;
  perform public.save_order(p_business, p_order, p_lines);

  if v_o.is_imported then
    update public.order_items set track_inventory = false, unit_cost = 0, cogs_amount = 0 where order_id = v_id;
    update public.orders set status = v_o.status, recognized_at = v_o.recognized_at, cogs_total = 0 where id = v_id;
  else
    update public.orders set status = v_o.status where id = v_id;
    perform public.recognise_order(v_id);
  end if;
  perform public.refresh_order_payment(v_id);
  perform public.write_audit(p_business, 'order.edit', 'order', v_id::text,
    'Order ' || v_o.order_number || ' edited after it was recorded as a sale', to_jsonb(v_o), jsonb_build_object('order', p_order, 'lines', p_lines));
  return v_id;
end;
$$;

create or replace function public.delete_order_completely(p_order uuid, p_delete_payments boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_payments integer;
begin
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  perform public.assert_member(v_o.business_id);
  select count(*) into v_payments from public.payments where order_id = p_order;
  if v_payments > 0 and not p_delete_payments then
    raise exception 'This order has % payment(s). Confirm deleting them too.', v_payments;
  end if;
  perform public.reverse_order_stock(p_order, 'Order deleted — stock put back');
  delete from public.payments where order_id = p_order;
  delete from public.orders where id = p_order;
  perform public.write_audit(v_o.business_id, 'order.delete', 'order', p_order::text,
    'Order ' || v_o.order_number || ' deleted' || case when v_payments > 0 then ' with ' || v_payments || ' payment(s)' else '' end,
    to_jsonb(v_o), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchases: edit / delete after receiving (received stock is taken back out).
-- ---------------------------------------------------------------------------
create or replace function public.reverse_purchase_receipts(p_purchase uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
  v_item public.purchase_items%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase for update;
  for v_item in select * from public.purchase_items where purchase_id = p_purchase and received_quantity > 0 for update loop
    perform public.apply_stock_movement(v_p.business_id, v_item.variant_id, -v_item.received_quantity, 'purchase',
      v_item.landed_unit_cost, 'purchase', v_p.id, v_p.purchase_number, p_note);
    update public.purchase_items set received_quantity = 0 where id = v_item.id;
  end loop;
  update public.purchases set status = case when status in ('received', 'partially_received') then 'ordered'::public.purchase_status else status end,
    received_at = null
  where id = p_purchase;
end;
$$;

create or replace function public.edit_purchase(p_business uuid, p_purchase jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (p_purchase->>'id')::uuid;
  v_p public.purchases%rowtype;
  v_was_received boolean;
begin
  perform public.assert_member(p_business);
  select * into v_p from public.purchases where id = v_id and business_id = p_business for update;
  if not found then raise exception 'Purchase not found.'; end if;
  if v_p.status = 'cancelled' then raise exception 'Cancelled purchases cannot be edited.'; end if;
  if not exists (select 1 from public.purchase_items where purchase_id = v_id and received_quantity > 0) then
    return public.save_purchase(p_business, p_purchase, p_lines);
  end if;

  v_was_received := v_p.status = 'received';
  perform public.reverse_purchase_receipts(v_id, 'Purchase edited — receipt reversed before saving the changes');
  perform public.save_purchase(p_business, (p_purchase - 'status') || '{"status":"ordered"}'::jsonb, p_lines);
  if v_was_received then
    perform public.receive_purchase(v_id, null, null);
  end if;
  perform public.write_audit(p_business, 'purchase.edit', 'purchase', v_id::text,
    'Purchase ' || v_p.purchase_number || ' edited after receiving', to_jsonb(v_p), jsonb_build_object('purchase', p_purchase, 'lines', p_lines));
  return v_id;
end;
$$;

create or replace function public.delete_purchase_completely(p_purchase uuid, p_delete_payments boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
  v_payments integer;
begin
  select * into v_p from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Purchase not found.'; end if;
  perform public.assert_member(v_p.business_id);
  select count(*) into v_payments from public.payments where purchase_id = p_purchase;
  if v_payments > 0 and not p_delete_payments then
    raise exception 'This purchase has % payment(s). Confirm deleting them too.', v_payments;
  end if;
  perform public.reverse_purchase_receipts(p_purchase, 'Purchase deleted — received stock removed');
  delete from public.payments where purchase_id = p_purchase;
  delete from public.purchases where id = p_purchase;
  perform public.write_audit(v_p.business_id, 'purchase.delete', 'purchase', p_purchase::text,
    'Purchase ' || v_p.purchase_number || ' deleted' || case when v_payments > 0 then ' with ' || v_payments || ' payment(s)' else '' end,
    to_jsonb(v_p), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock: undo a manual adjustment / opening stock; delete a wastage entry.
-- An "undo" is an opposite movement that points at the original
-- (reference_type = 'reversal', reference_id = original movement).
-- ---------------------------------------------------------------------------
create or replace function public.undo_stock_movement(p_txn uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.inventory_transactions%rowtype;
begin
  select * into v_t from public.inventory_transactions where id = p_txn for update;
  if not found then raise exception 'Stock movement not found.'; end if;
  perform public.assert_member(v_t.business_id);
  if v_t.txn_type not in ('adjustment', 'initial_stock') or v_t.reference_type = 'reversal' then
    raise exception 'Only stock adjustments and opening stock can be undone here. Purchases, sales, production and wastage are corrected from their own pages.';
  end if;
  if exists (select 1 from public.inventory_transactions where reference_type = 'reversal' and reference_id = p_txn) then
    raise exception 'This movement has already been undone.';
  end if;
  perform public.apply_stock_movement(v_t.business_id, v_t.variant_id, -v_t.quantity, 'adjustment', v_t.unit_cost,
    'reversal', v_t.id, 'Undo', 'Undo of: ' || coalesce(v_t.notes, case when v_t.txn_type = 'initial_stock' then 'opening stock' else 'adjustment' end));
  perform public.write_audit(v_t.business_id, 'inventory.undo', 'inventory_transaction', p_txn::text,
    'Stock movement undone (' || trim_scale(v_t.quantity) || ')', to_jsonb(v_t), null);
end;
$$;

create or replace function public.delete_wastage(p_wastage uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_w public.wastage%rowtype;
begin
  select * into v_w from public.wastage where id = p_wastage for update;
  if not found then raise exception 'Wastage entry not found.'; end if;
  perform public.assert_member(v_w.business_id);
  if v_w.batch_id is not null then
    raise exception 'This wastage belongs to a production batch. Delete or correct the batch instead.';
  end if;
  perform public.apply_stock_movement(v_w.business_id, v_w.variant_id, v_w.quantity, 'adjustment', v_w.unit_cost,
    'reversal', v_w.inventory_transaction_id, 'Wastage deleted', 'Wastage entry deleted — stock put back');
  delete from public.wastage where id = p_wastage;
  perform public.write_audit(v_w.business_id, 'wastage.delete', 'wastage', p_wastage::text,
    'Wastage entry deleted (' || trim_scale(v_w.quantity) || ')', to_jsonb(v_w), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Production: deleting a completed batch returns materials and removes output.
-- ---------------------------------------------------------------------------
create or replace function public.delete_production_batch(p_batch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.production_batches%rowtype;
  v_c public.production_consumption%rowtype;
begin
  select * into v_b from public.production_batches where id = p_batch for update;
  if not found then raise exception 'Batch not found.'; end if;
  perform public.assert_member(v_b.business_id);

  if v_b.status = 'completed' then
    -- Remove the finished goods first (fails clearly if they were already sold/used).
    perform public.apply_stock_movement(v_b.business_id, v_b.variant_id, -v_b.actual_quantity, 'production_output',
      v_b.unit_cost, 'production_batch', v_b.id, v_b.batch_number, 'Batch deleted — finished goods removed');
    for v_c in select * from public.production_consumption where batch_id = p_batch loop
      if v_c.used_quantity > 0 then
        perform public.apply_stock_movement(v_b.business_id, v_c.component_variant_id, v_c.used_quantity, 'production_consumption',
          v_c.unit_cost, 'production_batch', v_b.id, v_b.batch_number, 'Batch deleted — materials returned');
      end if;
      if v_c.wasted_quantity > 0 then
        perform public.apply_stock_movement(v_b.business_id, v_c.component_variant_id, v_c.wasted_quantity, 'wastage',
          v_c.unit_cost, 'production_batch', v_b.id, v_b.batch_number, 'Batch deleted — wasted materials returned');
      end if;
    end loop;
    delete from public.wastage where batch_id = p_batch;
  end if;

  delete from public.production_batches where id = p_batch;
  perform public.write_audit(v_b.business_id, 'production.delete', 'production_batch', p_batch::text,
    'Batch ' || v_b.batch_number || ' deleted' || case when v_b.status = 'completed' then ' (stock movements reversed)' else '' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers / suppliers with history: detach, then delete.
-- ---------------------------------------------------------------------------
create or replace function public.delete_customer(p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.customers%rowtype;
  v_orders integer;
begin
  select * into v_c from public.customers where id = p_customer for update;
  if not found then raise exception 'Customer not found.'; end if;
  perform public.assert_member(v_c.business_id);
  update public.orders set customer_id = null where customer_id = p_customer;
  get diagnostics v_orders = row_count;
  update public.payments set customer_id = null where customer_id = p_customer;
  delete from public.customers where id = p_customer;
  perform public.write_audit(v_c.business_id, 'customer.delete', 'customer', p_customer::text,
    'Customer "' || v_c.name || '" deleted' || case when v_orders > 0 then '; ' || v_orders || ' order(s) kept as walk-in' else '' end, to_jsonb(v_c), null);
end;
$$;

create or replace function public.delete_supplier(p_supplier uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.suppliers%rowtype;
  v_purchases integer;
begin
  select * into v_s from public.suppliers where id = p_supplier for update;
  if not found then raise exception 'Supplier not found.'; end if;
  perform public.assert_member(v_s.business_id);
  update public.purchases set supplier_id = null where supplier_id = p_supplier;
  get diagnostics v_purchases = row_count;
  update public.payments set supplier_id = null where supplier_id = p_supplier;
  delete from public.suppliers where id = p_supplier;
  perform public.write_audit(v_s.business_id, 'supplier.delete', 'supplier', p_supplier::text,
    'Supplier "' || v_s.name || '" deleted' || case when v_purchases > 0 then '; ' || v_purchases || ' purchase(s) kept without supplier' else '' end, to_jsonb(v_s), null);
end;
$$;

-- Function privileges
do $$
declare f text;
begin
  foreach f in array array[
    'reverse_order_stock(uuid, text)', 'reverse_purchase_receipts(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'edit_order(uuid, jsonb, jsonb)', 'delete_order_completely(uuid, boolean)', 'edit_purchase(uuid, jsonb, jsonb)',
    'delete_purchase_completely(uuid, boolean)', 'undo_stock_movement(uuid)', 'delete_wastage(uuid)',
    'delete_production_batch(uuid)', 'delete_customer(uuid)', 'delete_supplier(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
