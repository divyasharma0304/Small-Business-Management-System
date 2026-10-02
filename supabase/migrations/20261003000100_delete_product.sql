-- =============================================================================
-- Delete an item together with everything that only exists because of it.
--
-- public.product_delete_impact(product)  → what would be removed / what blocks it
-- public.delete_product_completely(product) → performs it, in one transaction
--
-- Blocked when the item is part of real business history that must stay correct:
--   * it appears on any order (sales history, revenue, COGS)
--   * it is used in a production batch
--   * it is on a purchase that also has other items, or has payments
-- Otherwise removed together: stock levels & movements (opening stock,
-- adjustments, wastage), purchases that contain only this item and have no
-- payments, recipes that produce it, and its lines in other recipes.
-- =============================================================================

create or replace function public.product_delete_impact(p_product uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_name text;
  v_variants uuid[];
  v_orders jsonb;
  v_batches jsonb;
  v_blocking_purchases jsonb;
  v_purchases jsonb;
  v_recipes_output jsonb;
  v_recipes_component jsonb;
  v_movements integer;
begin
  select business_id, name into v_business, v_name from public.products where id = p_product;
  if not found then raise exception 'Item not found.'; end if;
  perform public.assert_member(v_business);
  select coalesce(array_agg(id), '{}') into v_variants from public.product_variants where product_id = p_product;

  select coalesce(jsonb_agg(distinct o.order_number), '[]') into v_orders
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where oi.variant_id = any(v_variants);

  select coalesce(jsonb_agg(distinct b.batch_number), '[]') into v_batches
  from public.production_batches b
  where b.variant_id = any(v_variants)
     or b.id in (select batch_id from public.production_consumption where component_variant_id = any(v_variants));

  -- Purchases containing this item: deletable only if they hold nothing else and have no payments.
  with p as (
    select distinct pu.id, pu.purchase_number,
      exists (select 1 from public.purchase_items x where x.purchase_id = pu.id and not (x.variant_id = any(v_variants))) as other_items,
      exists (select 1 from public.payments pay where pay.purchase_id = pu.id) as has_payments
    from public.purchases pu join public.purchase_items pi on pi.purchase_id = pu.id
    where pi.variant_id = any(v_variants)
  )
  select
    coalesce(jsonb_agg(purchase_number) filter (where other_items or has_payments), '[]'),
    coalesce(jsonb_agg(purchase_number) filter (where not other_items and not has_payments), '[]')
    into v_blocking_purchases, v_purchases
  from p;

  select coalesce(jsonb_agg(name), '[]') into v_recipes_output from public.recipes where variant_id = any(v_variants);
  select coalesce(jsonb_agg(distinct r.name), '[]') into v_recipes_component
  from public.recipe_items ri join public.recipes r on r.id = ri.recipe_id
  where ri.component_variant_id = any(v_variants) and not (r.variant_id = any(v_variants));

  select count(*) into v_movements from public.inventory_transactions where variant_id = any(v_variants);

  return jsonb_build_object(
    'name', v_name,
    'can_delete', jsonb_array_length(v_orders) = 0 and jsonb_array_length(v_batches) = 0 and jsonb_array_length(v_blocking_purchases) = 0,
    'orders', v_orders,
    'batches', v_batches,
    'blocking_purchases', v_blocking_purchases,
    'purchases', v_purchases,
    'recipes_output', v_recipes_output,
    'recipes_component', v_recipes_component,
    'stock_movements', v_movements
  );
end;
$$;

create or replace function public.delete_product_completely(p_product uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_impact jsonb := public.product_delete_impact(p_product);
  v_business uuid;
  v_variants uuid[];
  v_product jsonb;
begin
  if not (v_impact->>'can_delete')::boolean then
    raise exception 'This item can''t be deleted because it is part of your sales, production or purchase history. Deactivate it instead.';
  end if;
  select business_id, to_jsonb(p) into v_business, v_product from public.products p where id = p_product for update;
  select coalesce(array_agg(id), '{}') into v_variants from public.product_variants where product_id = p_product;

  delete from public.purchases pu
  where pu.business_id = v_business
    and pu.purchase_number in (select jsonb_array_elements_text(v_impact->'purchases'));
  delete from public.wastage where variant_id = any(v_variants);
  delete from public.inventory_transactions where variant_id = any(v_variants);
  delete from public.inventory_levels where variant_id = any(v_variants);
  delete from public.recipe_items where component_variant_id = any(v_variants);
  delete from public.recipes where variant_id = any(v_variants);
  delete from public.products where id = p_product;

  perform public.write_audit(v_business, 'product.delete', 'product', p_product::text,
    'Item "' || (v_impact->>'name') || '" deleted with its stock history'
      || case when jsonb_array_length(v_impact->'purchases') > 0
              then ' and purchase(s) ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_impact->'purchases') x) else '' end,
    v_product, v_impact);
  return v_impact;
end;
$$;

revoke execute on function public.product_delete_impact(uuid) from public, anon;
revoke execute on function public.delete_product_completely(uuid) from public, anon;
grant execute on function public.product_delete_impact(uuid) to authenticated;
grant execute on function public.delete_product_completely(uuid) to authenticated;
