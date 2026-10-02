-- =============================================================================
-- Add one variant (e.g. a new colour) to an existing item that already has
-- variants — used from the purchase screen. Created with zero stock: the
-- purchase adds the stock when received.
-- =============================================================================
create or replace function public.add_product_variant(
  p_product uuid, p_name text, p_sku text default null, p_selling_price numeric default 0, p_cost_price numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.products%rowtype;
  v_id uuid;
  v_name text := nullif(trim(p_name), '');
  v_min numeric;
begin
  select * into v_p from public.products where id = p_product for update;
  if not found then raise exception 'Item not found.'; end if;
  perform public.assert_member(v_p.business_id);
  if v_name is null then raise exception 'Variant name is required.'; end if;
  if not v_p.has_variants then
    raise exception '"%" doesn''t use variants yet. Edit the item and turn on "This item has variants" first.', v_p.name;
  end if;
  if exists (select 1 from public.product_variants where product_id = p_product and lower(name) = lower(v_name)) then
    raise exception '"%" already has a variant called "%".', v_p.name, v_name;
  end if;
  if coalesce(p_selling_price, 0) < 0 or coalesce(p_cost_price, 0) < 0 then
    raise exception 'Prices cannot be negative.';
  end if;

  insert into public.product_variants (business_id, product_id, name, sku, selling_price, cost_price, is_default, sort_order)
  values (v_p.business_id, p_product, v_name, nullif(trim(p_sku), ''), coalesce(p_selling_price, 0), coalesce(p_cost_price, 0), false,
          coalesce((select max(sort_order) + 1 from public.product_variants where product_id = p_product), 1))
  returning id into v_id;

  if v_p.track_inventory then
    select default_min_stock into v_min from public.business_settings where business_id = v_p.business_id;
    insert into public.inventory_levels (variant_id, business_id, min_stock) values (v_id, v_p.business_id, coalesce(v_min, 0));
  end if;

  perform public.write_audit(v_p.business_id, 'product.variant_add', 'product', p_product::text,
    'Variant "' || v_name || '" added to "' || v_p.name || '"');
  return v_id;
exception
  when unique_violation then
    raise exception 'That SKU is already used by another item.';
end;
$$;

revoke execute on function public.add_product_variant(uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.add_product_variant(uuid, text, text, numeric, numeric) to authenticated;
