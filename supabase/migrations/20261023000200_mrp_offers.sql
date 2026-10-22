-- =============================================================================
-- MRP, individual discounts and pack offers.
--   * product_variants.mrp: maximum retail price; selling_price is the regular
--     (discounted) price. Discount % = (mrp − selling_price) / mrp.
--   * offers: quantity-based pack offers ("Pack of 2 – 28% off MRP"), limited to
--     categories/products, with optional dates. Applied in the order form; each
--     order line records the MRP and the offer used, so history stays accurate.
-- =============================================================================

alter table public.product_variants add column mrp numeric(14,2) check (mrp is null or mrp >= 0);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  is_active boolean not null default true,
  starts_on date,
  ends_on date,
  -- [{ "min_qty": 2, "discount_pct": 28 }, …] — the highest tier reached applies, as % off MRP
  tiers jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array'),
  category_ids uuid[] not null default '{}',
  product_ids uuid[] not null default '{}',
  exclude_product_ids uuid[] not null default '{}',
  priority integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offer_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index offers_business_idx on public.offers(business_id);
create trigger offers_updated_at before update on public.offers for each row execute function public.set_updated_at();
alter table public.offers enable row level security;
revoke all on public.offers from anon;
create policy "members full access" on public.offers for all to authenticated
  using ((select public.is_business_member(business_id))) with check ((select public.is_business_member(business_id)));

alter table public.order_items
  add column mrp numeric(14,2),
  add column offer_id uuid references public.offers(id) on delete set null,
  add column offer_label text;

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
  public.variant_highest_cost(v.id) as highest_cost,
  v.mrp,
  p.category_id
from public.product_variants v
join public.products p on p.id = v.product_id
left join public.inventory_levels l on l.variant_id = v.id
where v.is_active and p.is_active;
grant select on public.item_picker to authenticated;

create or replace function public.save_order(p_business uuid, p_order jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_order->>'id', '')::uuid;
  v_old public.orders%rowtype;
  v_biz public.businesses%rowtype;
  v_set public.business_settings%rowtype;
  v_calc jsonb;
  v_calc_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_c jsonb;
  v_i integer;
  v_variant record;
  v_customer uuid := nullif(p_order->>'customer_id', '')::uuid;
  v_shipping numeric := round(coalesce((p_order->>'shipping_charge')::numeric, 0), 2);
  v_initial public.order_status;
  v_number text;
begin
  perform public.assert_member(p_business);
  select * into v_biz from public.businesses where id = p_business;
  select * into v_set from public.business_settings where business_id = p_business;

  if v_shipping < 0 then
    raise exception 'Shipping charge cannot be negative.';
  end if;
  if v_customer is not null and not exists (
    select 1 from public.customers where id = v_customer and business_id = p_business
  ) then
    raise exception 'Customer not found.';
  end if;

  if v_id is not null then
    select * into v_old from public.orders where id = v_id and business_id = p_business for update;
    if not found then raise exception 'Order not found.'; end if;
    if v_old.status in ('cancelled', 'returned') then
      raise exception 'Cancelled or returned orders cannot be edited.';
    end if;
    if v_old.recognized_at is not null then
      raise exception 'This order has already been recorded as a sale, so its items are locked. Cancel or return it instead.';
    end if;
  end if;

  -- Resolve tax rates (default: the item's rate) and validate items.
  for v_i in 0 .. coalesce(jsonb_array_length(p_lines), 0) - 1 loop
    v_line := p_lines -> v_i;
    select v.id, v.is_active, p.name, v.name as vname, v.is_default, v.sku, p.tax_rate, p.category_id, v.mrp,
           p.track_inventory and v_set.module_inventory as tracked
      into v_variant
    from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = (v_line->>'variant_id')::uuid and v.business_id = p_business;
    if not found then
      raise exception 'Line %: item not found.', v_i + 1;
    end if;
    v_calc_lines := v_calc_lines || jsonb_build_object(
      'variant_id', v_variant.id,
      'description', v_variant.name || case when v_variant.is_default then '' else ' — ' || v_variant.vname end,
      'sku', v_variant.sku,
      'category_id', v_variant.category_id,
      'track_inventory', v_variant.tracked,
      'quantity', v_line->'quantity',
      'unit_price', v_line->'unit_price',
      'discount_amount', coalesce(v_line->'discount_amount', '0'::jsonb),
      'tax_rate', coalesce(v_line->'tax_rate', to_jsonb(v_variant.tax_rate)),
      'mrp', to_jsonb(v_variant.mrp),
      'offer_id', v_line->'offer_id',
      'offer_label', v_line->'offer_label'
    );
  end loop;

  v_calc := public.calc_document(v_calc_lines, (p_order->>'discount_amount')::numeric,
                                 v_biz.prices_include_tax, v_biz.tax_enabled);

  if v_id is null then
    v_initial := coalesce(nullif(p_order->>'status', ''), v_set.default_order_status::text)::public.order_status;
    if v_initial not in ('draft', 'confirmed') then
      v_initial := 'draft';
    end if;
    v_number := public.next_document_number(p_business, 'order', v_set.order_prefix);
    insert into public.orders (
      business_id, order_number, customer_id, order_date, due_date, status, subtotal, discount_amount,
      tax_total, shipping_charge, total, revenue_amount, preferred_payment_method, notes, is_demo
    ) values (
      p_business, v_number, v_customer, coalesce((p_order->>'order_date')::date, current_date),
      coalesce((p_order->>'due_date')::date,
               coalesce((p_order->>'order_date')::date, current_date) + v_set.payment_due_days),
      'draft', (v_calc->>'subtotal')::numeric, (v_calc->>'discount')::numeric, (v_calc->>'tax_total')::numeric,
      v_shipping, (v_calc->>'lines_total')::numeric + v_shipping, (v_calc->>'net_total')::numeric + v_shipping,
      nullif(p_order->>'preferred_payment_method', ''), nullif(p_order->>'notes', ''),
      coalesce((p_order->>'is_demo')::boolean, false)
    ) returning id into v_id;
  else
    update public.orders set
      customer_id = v_customer,
      order_date = coalesce((p_order->>'order_date')::date, order_date),
      due_date = (p_order->>'due_date')::date,
      subtotal = (v_calc->>'subtotal')::numeric,
      discount_amount = (v_calc->>'discount')::numeric,
      tax_total = (v_calc->>'tax_total')::numeric,
      shipping_charge = v_shipping,
      total = (v_calc->>'lines_total')::numeric + v_shipping,
      revenue_amount = (v_calc->>'net_total')::numeric + v_shipping,
      preferred_payment_method = nullif(p_order->>'preferred_payment_method', ''),
      notes = nullif(p_order->>'notes', '')
    where id = v_id;
    delete from public.order_items where order_id = v_id;
  end if;

  for v_i in 0 .. jsonb_array_length(v_calc_lines) - 1 loop
    v_line := v_calc_lines -> v_i;
    v_c := v_calc -> 'lines' -> v_i;
    insert into public.order_items (
      business_id, order_id, variant_id, description, sku, category_id, track_inventory, quantity, unit_price,
      discount_amount, order_discount_share, tax_rate, tax_amount, net_amount, line_total, sort_order,
      mrp, offer_id, offer_label
    ) values (
      p_business, v_id, (v_line->>'variant_id')::uuid, v_line->>'description', v_line->>'sku',
      (v_line->>'category_id')::uuid, (v_line->>'track_inventory')::boolean,
      (v_line->>'quantity')::numeric, round((v_line->>'unit_price')::numeric, 2),
      (v_c->>'line_discount')::numeric, (v_c->>'discount_share')::numeric, (v_c->>'tax_rate')::numeric,
      (v_c->>'tax')::numeric, (v_c->>'net')::numeric, (v_c->>'total')::numeric, v_i,
      (v_line->>'mrp')::numeric,
      (select o.id from public.offers o where o.id = nullif(v_line->>'offer_id', '')::uuid and o.business_id = p_business),
      nullif(v_line->>'offer_label', '')
    );
  end loop;

  perform public.refresh_order_payment(v_id);

  if v_old.id is null then
    perform public.write_audit(p_business, 'order.create', 'order', v_id::text, 'Order ' || v_number || ' created',
      null, jsonb_build_object('order', p_order, 'lines', p_lines));
    if v_initial <> 'draft' then
      perform public.set_order_status(v_id, v_initial);
    end if;
  else
    perform public.write_audit(p_business, 'order.update', 'order', v_id::text, 'Order ' || v_old.order_number || ' updated',
      to_jsonb(v_old), jsonb_build_object('order', p_order, 'lines', p_lines));
  end if;
  return v_id;
end;
$$;


create or replace function public.save_product(
  p_business uuid, p_product jsonb, p_variants jsonb, p_components jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_product->>'id', '')::uuid;
  v_old public.products%rowtype;
  v_is_new boolean := v_id is null;
  v_type public.item_type := coalesce(nullif(p_product->>'item_type', ''), 'product')::public.item_type;
  v_track boolean := coalesce((p_product->>'track_inventory')::boolean, true);
  v_has_variants boolean := coalesce((p_product->>'has_variants')::boolean, false);
  v_category uuid := nullif(p_product->>'category_id', '')::uuid;
  v_keep uuid[] := '{}';
  v_var jsonb;
  v_vid uuid;
  v_i integer := 0;
  v_opening numeric;
  v_opening_cost numeric;
  v_default_min numeric;
  v_components_total numeric;
  v_stock numeric;
  r record;
begin
  perform public.assert_member(p_business);

  if v_type = 'service' then
    v_track := false;
  end if;
  if coalesce(jsonb_array_length(p_variants), 0) = 0 then
    raise exception 'At least one variant is required.';
  end if;
  if not v_has_variants and jsonb_array_length(p_variants) > 1 then
    raise exception 'Enable variants to add more than one.';
  end if;
  if v_category is not null and not exists (
    select 1 from public.product_categories where id = v_category and business_id = p_business
  ) then
    raise exception 'Category not found.';
  end if;

  select default_min_stock into v_default_min from public.business_settings where business_id = p_business;

  if v_is_new then
    insert into public.products (
      business_id, category_id, item_type, name, description, unit, tax_rate, track_inventory,
      has_variants, cost_method, brand, attributes, image_path, notes, is_active, is_demo
    ) values (
      p_business, v_category, v_type, p_product->>'name', nullif(p_product->>'description', ''),
      coalesce(nullif(p_product->>'unit', ''), 'pcs'), coalesce((p_product->>'tax_rate')::numeric, 0),
      v_track, v_has_variants, coalesce(nullif(p_product->>'cost_method', ''), 'manual')::public.cost_method,
      nullif(p_product->>'brand', ''), coalesce(p_product->'attributes', '{}'::jsonb),
      nullif(p_product->>'image_path', ''), nullif(p_product->>'notes', ''),
      coalesce((p_product->>'is_active')::boolean, true), coalesce((p_product->>'is_demo')::boolean, false)
    ) returning id into v_id;
  else
    select * into v_old from public.products where id = v_id and business_id = p_business for update;
    if not found then
      raise exception 'Product not found.';
    end if;
    if v_old.track_inventory and not v_track then
      select coalesce(sum(l.quantity), 0) into v_stock
      from public.inventory_levels l join public.product_variants v on v.id = l.variant_id
      where v.product_id = v_id;
      if v_stock <> 0 then
        raise exception 'This item still has stock (%). Adjust stock to zero before turning off stock tracking.', trim_scale(v_stock);
      end if;
    end if;
    update public.products set
      category_id = v_category, item_type = v_type, name = p_product->>'name',
      description = nullif(p_product->>'description', ''),
      unit = coalesce(nullif(p_product->>'unit', ''), 'pcs'),
      tax_rate = coalesce((p_product->>'tax_rate')::numeric, 0),
      track_inventory = v_track, has_variants = v_has_variants,
      cost_method = coalesce(nullif(p_product->>'cost_method', ''), 'manual')::public.cost_method,
      brand = nullif(p_product->>'brand', ''), attributes = coalesce(p_product->'attributes', '{}'::jsonb),
      image_path = nullif(p_product->>'image_path', ''), notes = nullif(p_product->>'notes', ''),
      is_active = coalesce((p_product->>'is_active')::boolean, true)
    where id = v_id;
  end if;

  -- Cost components (replace set)
  delete from public.product_cost_components where product_id = v_id;
  insert into public.product_cost_components (business_id, product_id, label, amount, sort_order)
  select p_business, v_id, c->>'label', (c->>'amount')::numeric, ord::int
  from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) with ordinality as t(c, ord)
  where coalesce(c->>'label', '') <> '';
  select coalesce(sum(amount), 0) into v_components_total from public.product_cost_components where product_id = v_id;

  -- Variants
  for v_var in select * from jsonb_array_elements(p_variants) loop
    v_i := v_i + 1;
    v_vid := nullif(v_var->>'id', '')::uuid;
    if v_vid is not null and not exists (
      select 1 from public.product_variants where id = v_vid and product_id = v_id
    ) then
      raise exception 'Variant not found.';
    end if;

    if v_vid is null then
      insert into public.product_variants (
        business_id, product_id, name, sku, selling_price, cost_price, attributes, image_path,
        is_default, is_active, sort_order, mrp
      ) values (
        p_business, v_id,
        case when v_has_variants then coalesce(nullif(v_var->>'name', ''), 'Variant ' || v_i) else 'Default' end,
        nullif(trim(v_var->>'sku'), ''),
        coalesce((v_var->>'selling_price')::numeric, 0),
        case when (p_product->>'cost_method') = 'components' and not v_has_variants
             then v_components_total else coalesce((v_var->>'cost_price')::numeric, 0) end,
        coalesce(v_var->'attributes', '{}'::jsonb), nullif(v_var->>'image_path', ''),
        not v_has_variants, coalesce((v_var->>'is_active')::boolean, true), v_i,
        nullif(v_var->>'mrp', '')::numeric
      ) returning id into v_vid;
    else
      update public.product_variants set
        name = case when v_has_variants then coalesce(nullif(v_var->>'name', ''), 'Variant ' || v_i) else 'Default' end,
        sku = nullif(trim(v_var->>'sku'), ''),
        selling_price = coalesce((v_var->>'selling_price')::numeric, 0),
        mrp = nullif(v_var->>'mrp', '')::numeric,
        cost_price = case when (p_product->>'cost_method') = 'components' and not v_has_variants
                          then v_components_total else coalesce((v_var->>'cost_price')::numeric, 0) end,
        attributes = coalesce(v_var->'attributes', '{}'::jsonb),
        image_path = nullif(v_var->>'image_path', ''),
        is_default = not v_has_variants,
        is_active = coalesce((v_var->>'is_active')::boolean, true),
        sort_order = v_i
      where id = v_vid;
    end if;
    v_keep := v_keep || v_vid;

    if v_track then
      insert into public.inventory_levels (variant_id, business_id, min_stock, max_stock, location)
      values (
        v_vid, p_business,
        coalesce((v_var->>'min_stock')::numeric, v_default_min, 0),
        (v_var->>'max_stock')::numeric,
        nullif(v_var->>'location', '')
      )
      on conflict (variant_id) do update set
        min_stock = coalesce((v_var->>'min_stock')::numeric, public.inventory_levels.min_stock),
        max_stock = (v_var->>'max_stock')::numeric,
        location = nullif(v_var->>'location', '');

      v_opening := coalesce((v_var->>'opening_stock')::numeric, 0);
      if v_opening < 0 then
        raise exception 'Opening stock cannot be negative.';
      end if;
      if v_opening > 0 then
        if exists (select 1 from public.inventory_transactions where variant_id = v_vid) then
          raise exception 'Opening stock can only be set once. Use a stock adjustment instead.';
        end if;
        v_opening_cost := coalesce((v_var->>'opening_unit_cost')::numeric,
                                   (select cost_price from public.product_variants where id = v_vid));
        perform public.apply_stock_movement(p_business, v_vid, v_opening, 'initial_stock', v_opening_cost,
                                            'product', v_id, 'Opening stock', null);
      end if;
    end if;
  end loop;

  -- Variants removed from the form: delete if unused, otherwise deactivate.
  for r in select id from public.product_variants where product_id = v_id and not (id = any(v_keep)) loop
    begin
      delete from public.inventory_levels where variant_id = r.id and quantity = 0;
      delete from public.product_variants where id = r.id;
    exception when foreign_key_violation then
      update public.product_variants set is_active = false where id = r.id;
    end;
  end loop;

  perform public.write_audit(p_business, case when v_is_new then 'product.create' else 'product.update' end,
    'product', v_id::text, 'Product "' || (p_product->>'name') || '" ' || case when v_is_new then 'created' else 'updated' end,
    case when v_is_new then null else to_jsonb(v_old) end, p_product);
  return v_id;
exception
  when unique_violation then
    raise exception 'That SKU is already used by another item.';
end;
$$;

