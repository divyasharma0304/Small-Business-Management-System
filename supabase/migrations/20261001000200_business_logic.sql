-- =============================================================================
-- Velqora — business logic
--
-- Every multi-step operation (saving an order, receiving a purchase, completing a
-- production batch, ...) is a single Postgres function, so it runs in ONE
-- transaction: either everything is written or nothing is.
--
-- These functions are SECURITY DEFINER because the tables they write
-- (inventory, orders, purchases, production) are read-only to API users — that
-- is what guarantees stock can never be changed silently. Each public function
-- starts with public.assert_member() so a user can only act on their own business.
--
-- Errors meant for the user are raised with SQLSTATE P0001 and a readable message.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.assert_member(p_business_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'You do not have access to this business.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.write_audit(
  p_business uuid, p_action text, p_entity text, p_entity_id text,
  p_summary text default null, p_old jsonb default null, p_new jsonb default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (business_id, action, entity_type, entity_id, summary, old_value, new_value)
  values (p_business, p_action, p_entity, p_entity_id, p_summary, p_old, p_new);
$$;

create or replace function public.next_document_number(p_business uuid, p_type text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value integer;
begin
  insert into public.document_counters as c (business_id, doc_type, next_value)
  values (p_business, p_type, 2)
  on conflict (business_id, doc_type) do update set next_value = c.next_value + 1
  returning c.next_value - 1 into v_value;
  return coalesce(p_prefix, '') || lpad(v_value::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Business bootstrap (first-run setup)
-- ---------------------------------------------------------------------------
create or replace function public.create_business(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- MVP is single-business per user; the schema supports more later.
  if exists (select 1 from public.business_members where user_id = v_uid) then
    raise exception 'Your account is already linked to a business.';
  end if;

  insert into public.businesses (
    name, business_type, description, owner_name, email, phone, address, city, state,
    postal_code, country, currency, timezone, tax_enabled, tax_label, tax_number, default_tax_rate,
    prices_include_tax, purchase_tax_recoverable, default_unit, setup_completed
  ) values (
    p->>'name',
    coalesce(nullif(p->>'business_type', ''), 'other'),
    nullif(p->>'description', ''),
    nullif(p->>'owner_name', ''),
    nullif(p->>'email', ''),
    nullif(p->>'phone', ''),
    nullif(p->>'address', ''),
    nullif(p->>'city', ''),
    nullif(p->>'state', ''),
    nullif(p->>'postal_code', ''),
    coalesce(nullif(p->>'country', ''), 'India'),
    upper(coalesce(nullif(p->>'currency', ''), 'INR')),
    coalesce(nullif(p->>'timezone', ''), 'Asia/Kolkata'),
    coalesce((p->>'tax_enabled')::boolean, false),
    coalesce(nullif(p->>'tax_label', ''), 'GST'),
    nullif(p->>'tax_number', ''),
    coalesce((p->>'default_tax_rate')::numeric, 0),
    coalesce((p->>'prices_include_tax')::boolean, false),
    coalesce((p->>'purchase_tax_recoverable')::boolean, false),
    coalesce(nullif(p->>'default_unit', ''), 'pcs'),
    true
  ) returning id, name into v_id, v_name;

  insert into public.business_members (business_id, user_id, role) values (v_id, v_uid, 'owner');

  insert into public.business_settings (
    business_id, module_inventory, module_purchases, module_suppliers, module_customers,
    module_production, module_expenses, module_variants
  ) values (
    v_id,
    coalesce((p->'modules'->>'inventory')::boolean, true),
    coalesce((p->'modules'->>'purchases')::boolean, true),
    coalesce((p->'modules'->>'suppliers')::boolean, true),
    coalesce((p->'modules'->>'customers')::boolean, true),
    coalesce((p->'modules'->>'production')::boolean, false),
    coalesce((p->'modules'->>'expenses')::boolean, true),
    coalesce((p->'modules'->>'variants')::boolean, true)
  );

  insert into public.payment_methods (business_id, name, sort_order)
  select v_id, m.name, m.ord
  from unnest(array['Cash','UPI','Bank transfer','Card','Other']) with ordinality as m(name, ord);

  insert into public.expense_categories (business_id, name)
  select v_id, c
  from unnest(array['Materials','Packaging','Shipping','Marketing','Advertising','Equipment',
                    'Software','Utilities','Rent','Transportation','Labour','Miscellaneous']) as c;

  perform public.write_audit(v_id, 'business.create', 'business', v_id::text, 'Business "' || v_name || '" created');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- THE stock primitive. The only code path that changes inventory_levels.
--
-- Valuation: moving weighted-average cost (WAC).
--   Inbound  (qty > 0): new_avg = (old_qty × old_avg + qty × unit_cost) / (old_qty + qty)
--                       (if old_qty <= 0 the new average is simply unit_cost)
--   Outbound (qty < 0): leaves at the current average (unless an explicit cost is
--                       passed, e.g. reversing a sale at its original cost).
-- Returns the unit cost applied to the movement.
-- ---------------------------------------------------------------------------
create or replace function public.apply_stock_movement(
  p_business uuid,
  p_variant uuid,
  p_qty numeric,
  p_type public.inventory_txn_type,
  p_unit_cost numeric default null,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_ref_label text default null,
  p_notes text default null,
  p_batch_lot text default null
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level public.inventory_levels%rowtype;
  v_track boolean;
  v_name text;
  v_allow_negative boolean;
  v_min_default numeric;
  v_cost numeric;
  v_new_qty numeric;
  v_new_avg numeric;
begin
  if p_qty is null or p_qty = 0 then
    raise exception 'Quantity must not be zero.';
  end if;

  select p.track_inventory, p.name || case when v.is_default then '' else ' — ' || v.name end
    into v_track, v_name
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant and v.business_id = p_business;

  if not found then
    raise exception 'Item not found.';
  end if;
  if not v_track then
    raise exception '"%" does not track stock.', v_name;
  end if;

  select s.allow_negative_stock, s.default_min_stock into v_allow_negative, v_min_default
  from public.business_settings s where s.business_id = p_business;

  insert into public.inventory_levels (variant_id, business_id, min_stock)
  values (p_variant, p_business, coalesce(v_min_default, 0))
  on conflict (variant_id) do nothing;

  select * into v_level from public.inventory_levels where variant_id = p_variant for update;

  v_new_qty := v_level.quantity + p_qty;

  if p_qty < 0 then
    if v_new_qty < 0 and not coalesce(v_allow_negative, false) then
      raise exception 'Not enough stock for "%": % available, % required.',
        v_name, trim_scale(v_level.quantity), trim_scale(-p_qty);
    end if;
    v_cost := coalesce(p_unit_cost, v_level.avg_cost);
    v_new_avg := v_level.avg_cost;
  else
    v_cost := coalesce(p_unit_cost, v_level.avg_cost);
    if v_cost < 0 then
      raise exception 'Unit cost cannot be negative.';
    end if;
    if v_level.quantity <= 0 then
      v_new_avg := v_cost;
    else
      v_new_avg := round((v_level.quantity * v_level.avg_cost + p_qty * v_cost) / v_new_qty, 4);
    end if;
  end if;

  update public.inventory_levels
     set quantity = v_new_qty, avg_cost = v_new_avg, updated_at = now()
   where variant_id = p_variant;

  insert into public.inventory_transactions (
    business_id, variant_id, txn_type, quantity, unit_cost, total_cost,
    balance_after, avg_cost_after, reference_type, reference_id, reference_label, batch_lot, notes
  ) values (
    p_business, p_variant, p_type, p_qty, v_cost, round(p_qty * v_cost, 2),
    v_new_qty, v_new_avg, p_ref_type, p_ref_id, p_ref_label, nullif(p_batch_lot, ''), nullif(p_notes, '')
  );

  return v_cost;
end;
$$;

-- ---------------------------------------------------------------------------
-- Document calculator — shared by orders and purchases.
--
--   gross_i     = round(qty_i × unit_price_i, 2)
--   net_i       = gross_i − line_discount_i
--   subtotal    = Σ net_i
--   share_i     = document discount allocated pro-rata to net_i (last line takes the rounding remainder)
--   base_i      = net_i − share_i
--   Tax-exclusive prices: tax_i = round(base_i × rate_i / 100, 2); revenue_i = base_i;         total_i = base_i + tax_i
--   Tax-inclusive prices: tax_i = round(base_i − base_i / (1 + rate_i/100), 2); revenue_i = base_i − tax_i; total_i = base_i
--   When tax is disabled for the business every rate is treated as 0.
-- The TypeScript mirror lives in src/lib/calc/document.ts (used for live previews).
-- ---------------------------------------------------------------------------
create or replace function public.calc_document(
  p_lines jsonb, p_doc_discount numeric, p_inclusive boolean, p_tax_enabled boolean
) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer := coalesce(jsonb_array_length(p_lines), 0);
  v_line jsonb;
  v_qty numeric; v_price numeric; v_ldisc numeric; v_rate numeric;
  v_gross numeric[] := '{}'; v_ld numeric[] := '{}'; v_net numeric[] := '{}'; v_rates numeric[] := '{}';
  v_subtotal numeric := 0;
  v_disc numeric := coalesce(p_doc_discount, 0);
  v_alloc numeric := 0;
  v_share numeric; v_base numeric; v_tax numeric; v_rev numeric; v_total numeric;
  v_tax_sum numeric := 0; v_rev_sum numeric := 0; v_total_sum numeric := 0;
  v_out jsonb := '[]'::jsonb;
  i integer;
begin
  if v_n = 0 then
    raise exception 'Add at least one item.';
  end if;

  for i in 1..v_n loop
    v_line := p_lines -> (i - 1);
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_ldisc := coalesce((v_line->>'discount_amount')::numeric, 0);
    v_rate := case when p_tax_enabled then coalesce((v_line->>'tax_rate')::numeric, 0) else 0 end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line %: quantity must be greater than zero.', i;
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Line %: price cannot be negative.', i;
    end if;
    if v_rate < 0 or v_rate > 100 then
      raise exception 'Line %: tax rate must be between 0 and 100.', i;
    end if;
    v_gross[i] := round(v_qty * v_price, 2);
    if v_ldisc < 0 or v_ldisc > v_gross[i] then
      raise exception 'Line %: discount cannot be negative or exceed the line amount.', i;
    end if;
    v_ld[i] := round(v_ldisc, 2);
    v_net[i] := v_gross[i] - v_ld[i];
    v_rates[i] := v_rate;
    v_subtotal := v_subtotal + v_net[i];
  end loop;

  v_disc := round(v_disc, 2);
  if v_disc < 0 or v_disc > v_subtotal then
    raise exception 'Discount cannot be negative or exceed the subtotal.';
  end if;

  for i in 1..v_n loop
    if i = v_n then
      v_share := least(v_disc - v_alloc, v_net[i]);
    elsif v_subtotal = 0 then
      v_share := 0;
    else
      v_share := round(v_disc * v_net[i] / v_subtotal, 2);
    end if;
    v_alloc := v_alloc + v_share;
    v_base := v_net[i] - v_share;
    if p_inclusive then
      v_tax := round(v_base - v_base / (1 + v_rates[i] / 100), 2);
      v_rev := v_base - v_tax;
      v_total := v_base;
    else
      v_tax := round(v_base * v_rates[i] / 100, 2);
      v_rev := v_base;
      v_total := v_base + v_tax;
    end if;
    v_tax_sum := v_tax_sum + v_tax;
    v_rev_sum := v_rev_sum + v_rev;
    v_total_sum := v_total_sum + v_total;
    v_out := v_out || jsonb_build_object(
      'gross', v_gross[i], 'line_discount', v_ld[i], 'discount_share', v_share,
      'tax_rate', v_rates[i], 'tax', v_tax, 'net', v_rev, 'total', v_total
    );
  end loop;

  return jsonb_build_object(
    'subtotal', v_subtotal, 'discount', v_alloc, 'tax_total', v_tax_sum,
    'net_total', v_rev_sum, 'lines_total', v_total_sum, 'lines', v_out
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Products (atomic save of product + variants + stock setup + cost components)
-- ---------------------------------------------------------------------------
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
        is_default, is_active, sort_order
      ) values (
        p_business, v_id,
        case when v_has_variants then coalesce(nullif(v_var->>'name', ''), 'Variant ' || v_i) else 'Default' end,
        nullif(trim(v_var->>'sku'), ''),
        coalesce((v_var->>'selling_price')::numeric, 0),
        case when (p_product->>'cost_method') = 'components' and not v_has_variants
             then v_components_total else coalesce((v_var->>'cost_price')::numeric, 0) end,
        coalesce(v_var->'attributes', '{}'::jsonb), nullif(v_var->>'image_path', ''),
        not v_has_variants, coalesce((v_var->>'is_active')::boolean, true), v_i
      ) returning id into v_vid;
    else
      update public.product_variants set
        name = case when v_has_variants then coalesce(nullif(v_var->>'name', ''), 'Variant ' || v_i) else 'Default' end,
        sku = nullif(trim(v_var->>'sku'), ''),
        selling_price = coalesce((v_var->>'selling_price')::numeric, 0),
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

-- ---------------------------------------------------------------------------
-- Manual stock adjustments & wastage
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_business uuid, p_variant uuid, p_mode text, p_quantity numeric,
  p_unit_cost numeric default null, p_notes text default null, p_batch_lot text default null
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current numeric;
  v_delta numeric;
begin
  perform public.assert_member(p_business);
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be zero or more.';
  end if;
  select coalesce((select quantity from public.inventory_levels where variant_id = p_variant), 0) into v_current;

  v_delta := case p_mode
    when 'add' then p_quantity
    when 'remove' then -p_quantity
    when 'set' then p_quantity - v_current
    else null end;
  if v_delta is null then
    raise exception 'Unknown adjustment mode.';
  end if;
  if v_delta = 0 then
    raise exception 'No change: stock is already %.', trim_scale(v_current);
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Please give a reason for the adjustment.';
  end if;

  perform public.apply_stock_movement(p_business, p_variant, v_delta, 'adjustment',
    case when v_delta > 0 then p_unit_cost else null end, 'adjustment', null, 'Stock adjustment', p_notes, p_batch_lot);
  perform public.write_audit(p_business, 'inventory.adjust', 'product_variant', p_variant::text,
    'Stock adjusted by ' || trim_scale(v_delta) || ': ' || p_notes,
    jsonb_build_object('quantity', v_current), jsonb_build_object('quantity', v_current + v_delta));
  return v_current + v_delta;
end;
$$;

create or replace function public.record_wastage(
  p_business uuid, p_variant uuid, p_quantity numeric, p_reason public.wastage_reason,
  p_date date default current_date, p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_cost numeric;
  v_txn uuid;
begin
  perform public.assert_member(p_business);
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;
  v_cost := public.apply_stock_movement(p_business, p_variant, -p_quantity, 'wastage', null,
                                        'wastage', v_id, 'Wastage: ' || p_reason::text, p_notes);
  select id into v_txn from public.inventory_transactions
   where reference_type = 'wastage' and reference_id = v_id;
  insert into public.wastage (id, business_id, variant_id, quantity, wastage_date, reason, unit_cost, total_cost, inventory_transaction_id, notes)
  values (v_id, p_business, p_variant, p_quantity, coalesce(p_date, current_date), p_reason, v_cost,
          round(p_quantity * v_cost, 2), v_txn, nullif(p_notes, ''));
  perform public.write_audit(p_business, 'wastage.create', 'wastage', v_id::text,
    'Wastage recorded: ' || trim_scale(p_quantity) || ' (' || p_reason::text || ')');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create or replace function public.order_status_rank(p public.order_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p
    when 'draft' then 0 when 'confirmed' then 1 when 'processing' then 2 when 'ready' then 3
    when 'shipped' then 4 when 'delivered' then 5 else -1 end;
$$;

-- Recompute amount_paid / payment_status from the payments table.
create or replace function public.refresh_order_payment(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_paid numeric;
  v_effective numeric;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then return; end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_paid from public.payments where order_id = p_order;

  if v_paid < 0 then
    raise exception 'Refunds cannot exceed the payments received for this order.';
  end if;
  v_effective := case when v_order.status in ('cancelled', 'returned') then 0 else v_order.total end;
  if v_paid > v_order.total and v_order.status not in ('cancelled', 'returned') then
    raise exception 'Payments (%) would exceed the order total (%).', v_paid, v_order.total;
  end if;

  update public.orders set
    amount_paid = v_paid,
    payment_status = case
      when v_effective > 0 and v_paid >= v_effective then 'paid'::public.payment_status
      when v_paid > 0 then 'partial'::public.payment_status
      else 'unpaid'::public.payment_status end
  where id = p_order;
end;
$$;

-- Recognise the sale: deduct stock for tracked lines, snapshot unit cost / COGS.
create or replace function public.recognise_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_line public.order_items%rowtype;
  v_cost numeric;
  v_cogs numeric := 0;
begin
  select * into v_order from public.orders where id = p_order for update;
  if v_order.recognized_at is not null then return; end if;
  if not exists (select 1 from public.order_items where order_id = p_order) then
    raise exception 'The order has no items.';
  end if;

  for v_line in select * from public.order_items where order_id = p_order order by sort_order loop
    if v_line.track_inventory then
      v_cost := public.apply_stock_movement(v_order.business_id, v_line.variant_id, -v_line.quantity, 'sale',
                  null, 'order', v_order.id, v_order.order_number, null);
    else
      select cost_price into v_cost from public.product_variants where id = v_line.variant_id;
    end if;
    update public.order_items
       set unit_cost = v_cost, cogs_amount = round(v_line.quantity * coalesce(v_cost, 0), 2)
     where id = v_line.id;
    v_cogs := v_cogs + round(v_line.quantity * coalesce(v_cost, 0), 2);
  end loop;

  update public.orders set
    recognized_at = now(),
    stock_deducted = exists (select 1 from public.order_items where order_id = p_order and track_inventory),
    cogs_total = v_cogs
  where id = p_order;
end;
$$;

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
    select v.id, v.is_active, p.name, v.name as vname, v.is_default, v.sku, p.tax_rate, p.category_id,
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
      'tax_rate', coalesce(v_line->'tax_rate', to_jsonb(v_variant.tax_rate))
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
      discount_amount, order_discount_share, tax_rate, tax_amount, net_amount, line_total, sort_order
    ) values (
      p_business, v_id, (v_line->>'variant_id')::uuid, v_line->>'description', v_line->>'sku',
      (v_line->>'category_id')::uuid, (v_line->>'track_inventory')::boolean,
      (v_line->>'quantity')::numeric, round((v_line->>'unit_price')::numeric, 2),
      (v_c->>'line_discount')::numeric, (v_c->>'discount_share')::numeric, (v_c->>'tax_rate')::numeric,
      (v_c->>'tax')::numeric, (v_c->>'net')::numeric, (v_c->>'total')::numeric, v_i
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

create or replace function public.set_order_status(p_order uuid, p_status public.order_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_set public.business_settings%rowtype;
  v_line public.order_items%rowtype;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  perform public.assert_member(v_order.business_id);
  select * into v_set from public.business_settings where business_id = v_order.business_id;

  if v_order.status = p_status then return; end if;
  if v_order.status in ('cancelled', 'returned') then
    raise exception 'This order is % and can no longer change status.', v_order.status;
  end if;
  if p_status = 'draft' and v_order.recognized_at is not null then
    raise exception 'An order that has been recorded as a sale cannot go back to draft.';
  end if;
  if p_status = 'returned' and v_order.recognized_at is null then
    raise exception 'Only orders recorded as sales can be returned. Cancel this order instead.';
  end if;

  if p_status in ('cancelled', 'returned') then
    -- Put stock back at the exact cost it left with, so valuation and COGS stay consistent.
    if v_order.stock_deducted and not v_order.stock_reversed then
      for v_line in select * from public.order_items where order_id = p_order and track_inventory loop
        perform public.apply_stock_movement(v_order.business_id, v_line.variant_id, v_line.quantity,
          case when p_status = 'returned' then 'return' else 'sale_reversal' end::public.inventory_txn_type,
          v_line.unit_cost, 'order', v_order.id, v_order.order_number,
          case when p_status = 'returned' then 'Order returned' else 'Order cancelled' end);
      end loop;
      update public.orders set stock_reversed = true where id = p_order;
    end if;
  elsif public.order_status_rank(p_status) >= public.order_status_rank(v_set.inventory_deduction_status) then
    perform public.recognise_order(p_order);
  end if;

  update public.orders set status = p_status where id = p_order;
  perform public.refresh_order_payment(p_order);
  perform public.write_audit(v_order.business_id,
    case when p_status = 'cancelled' then 'order.cancel' when p_status = 'returned' then 'order.return' else 'order.status' end,
    'order', p_order::text, 'Order ' || v_order.order_number || ': ' || v_order.status || ' → ' || p_status,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.update_order_details(
  p_order uuid, p_notes text, p_due_date date, p_preferred_payment_method text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.orders where id = p_order;
  if not found then raise exception 'Order not found.'; end if;
  perform public.assert_member(v_business);
  update public.orders set notes = nullif(p_notes, ''), due_date = p_due_date,
    preferred_payment_method = nullif(p_preferred_payment_method, '')
  where id = p_order;
end;
$$;

create or replace function public.delete_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  perform public.assert_member(v_order.business_id);
  if v_order.recognized_at is not null then
    raise exception 'Orders recorded as sales cannot be deleted. Cancel or return them instead.';
  end if;
  if exists (select 1 from public.payments where order_id = p_order) then
    raise exception 'Delete this order''s payments first.';
  end if;
  delete from public.orders where id = p_order;
  perform public.write_audit(v_order.business_id, 'order.delete', 'order', p_order::text,
    'Order ' || v_order.order_number || ' deleted', to_jsonb(v_order), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
create or replace function public.refresh_purchase_payment(p_purchase uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
  v_paid numeric;
  v_effective numeric;
begin
  select * into v_p from public.purchases where id = p_purchase for update;
  if not found then return; end if;
  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_paid from public.payments where purchase_id = p_purchase;
  if v_paid < 0 then
    raise exception 'Refunds cannot exceed the payments made for this purchase.';
  end if;
  v_effective := case when v_p.status = 'cancelled' then 0 else v_p.total end;
  if v_paid > v_p.total and v_p.status <> 'cancelled' then
    raise exception 'Payments (%) would exceed the purchase total (%).', v_paid, v_p.total;
  end if;
  update public.purchases set
    amount_paid = v_paid,
    payment_status = case
      when v_effective > 0 and v_paid >= v_effective then 'paid'::public.payment_status
      when v_paid > 0 then 'partial'::public.payment_status
      else 'unpaid'::public.payment_status end
  where id = p_purchase;
end;
$$;

create or replace function public.save_purchase(p_business uuid, p_purchase jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_purchase->>'id', '')::uuid;
  v_old public.purchases%rowtype;
  v_biz public.businesses%rowtype;
  v_set public.business_settings%rowtype;
  v_supplier uuid := nullif(p_purchase->>'supplier_id', '')::uuid;
  v_charges numeric := round(coalesce((p_purchase->>'other_charges')::numeric, 0), 2);
  v_status public.purchase_status := coalesce(nullif(p_purchase->>'status', ''), 'draft')::public.purchase_status;
  v_calc jsonb;
  v_calc_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_c jsonb;
  v_variant record;
  v_n integer;
  v_i integer;
  v_base_total numeric := 0;
  v_base numeric;
  v_share numeric;
  v_alloc numeric := 0;
  v_cost_basis numeric;
  v_number text;
begin
  perform public.assert_member(p_business);
  select * into v_biz from public.businesses where id = p_business;
  select * into v_set from public.business_settings where business_id = p_business;

  if v_status not in ('draft', 'ordered') then
    raise exception 'A purchase can only be saved as draft or ordered. Use "Receive" to add stock.';
  end if;
  if v_charges < 0 then raise exception 'Other charges cannot be negative.'; end if;
  if v_supplier is not null and not exists (
    select 1 from public.suppliers where id = v_supplier and business_id = p_business
  ) then
    raise exception 'Supplier not found.';
  end if;

  if v_id is not null then
    select * into v_old from public.purchases where id = v_id and business_id = p_business for update;
    if not found then raise exception 'Purchase not found.'; end if;
    if v_old.status not in ('draft', 'ordered') or exists (
      select 1 from public.purchase_items where purchase_id = v_id and received_quantity > 0
    ) then
      raise exception 'Only draft or ordered purchases with nothing received can be edited.';
    end if;
  end if;

  v_n := coalesce(jsonb_array_length(p_lines), 0);
  for v_i in 0 .. v_n - 1 loop
    v_line := p_lines -> v_i;
    select v.id, p.name, v.name as vname, v.is_default, p.track_inventory
      into v_variant
    from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = (v_line->>'variant_id')::uuid and v.business_id = p_business;
    if not found then raise exception 'Line %: item not found.', v_i + 1; end if;
    if not v_variant.track_inventory then
      raise exception 'Line %: "%" does not track stock. Record non-stock purchases as expenses.', v_i + 1, v_variant.name;
    end if;
    v_calc_lines := v_calc_lines || jsonb_build_object(
      'variant_id', v_variant.id,
      'description', v_variant.name || case when v_variant.is_default then '' else ' — ' || v_variant.vname end,
      'quantity', v_line->'quantity',
      'unit_price', v_line->'unit_price',
      'discount_amount', coalesce(v_line->'discount_amount', '0'::jsonb),
      'tax_rate', coalesce(v_line->'tax_rate', '0'::jsonb)
    );
  end loop;

  -- Purchase prices are always entered excluding tax (as on a supplier's tax invoice).
  v_calc := public.calc_document(v_calc_lines, (p_purchase->>'discount_amount')::numeric, false, v_biz.tax_enabled);

  if v_id is null then
    v_number := public.next_document_number(p_business, 'purchase', v_set.purchase_prefix);
    insert into public.purchases (
      business_id, purchase_number, supplier_id, purchase_date, invoice_number, status, subtotal,
      discount_amount, tax_total, other_charges, total, attachment_path, notes, is_demo
    ) values (
      p_business, v_number, v_supplier, coalesce((p_purchase->>'purchase_date')::date, current_date),
      nullif(p_purchase->>'invoice_number', ''), v_status, (v_calc->>'subtotal')::numeric,
      (v_calc->>'discount')::numeric, (v_calc->>'tax_total')::numeric, v_charges,
      (v_calc->>'lines_total')::numeric + v_charges, nullif(p_purchase->>'attachment_path', ''),
      nullif(p_purchase->>'notes', ''), coalesce((p_purchase->>'is_demo')::boolean, false)
    ) returning id into v_id;
  else
    update public.purchases set
      supplier_id = v_supplier,
      purchase_date = coalesce((p_purchase->>'purchase_date')::date, purchase_date),
      invoice_number = nullif(p_purchase->>'invoice_number', ''),
      status = v_status,
      subtotal = (v_calc->>'subtotal')::numeric,
      discount_amount = (v_calc->>'discount')::numeric,
      tax_total = (v_calc->>'tax_total')::numeric,
      other_charges = v_charges,
      total = (v_calc->>'lines_total')::numeric + v_charges,
      attachment_path = nullif(p_purchase->>'attachment_path', ''),
      notes = nullif(p_purchase->>'notes', '')
    where id = v_id;
    delete from public.purchase_items where purchase_id = v_id;
  end if;

  -- Landed cost per unit = (line amount after discounts
  --                         + tax if it is NOT recoverable
  --                         + share of other charges, allocated by line amount) / quantity
  for v_i in 0 .. v_n - 1 loop
    v_c := v_calc -> 'lines' -> v_i;
    v_base_total := v_base_total + ((v_c->>'gross')::numeric - (v_c->>'line_discount')::numeric - (v_c->>'discount_share')::numeric);
  end loop;

  for v_i in 0 .. v_n - 1 loop
    v_line := v_calc_lines -> v_i;
    v_c := v_calc -> 'lines' -> v_i;
    v_base := (v_c->>'gross')::numeric - (v_c->>'line_discount')::numeric - (v_c->>'discount_share')::numeric;
    if v_i = v_n - 1 then
      v_share := v_charges - v_alloc;
    elsif v_base_total = 0 then
      v_share := 0;
    else
      v_share := round(v_charges * v_base / v_base_total, 2);
    end if;
    v_alloc := v_alloc + v_share;
    v_cost_basis := v_base + v_share + case when v_biz.purchase_tax_recoverable then 0 else (v_c->>'tax')::numeric end;
    insert into public.purchase_items (
      business_id, purchase_id, variant_id, description, quantity, unit_price, discount_amount,
      order_discount_share, tax_rate, tax_amount, charges_share, line_total, landed_unit_cost, sort_order
    ) values (
      p_business, v_id, (v_line->>'variant_id')::uuid, v_line->>'description',
      (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_c->>'line_discount')::numeric,
      (v_c->>'discount_share')::numeric, (v_c->>'tax_rate')::numeric, (v_c->>'tax')::numeric, v_share,
      (v_c->>'total')::numeric, round(v_cost_basis / (v_line->>'quantity')::numeric, 4), v_i
    );
  end loop;

  perform public.refresh_purchase_payment(v_id);
  perform public.write_audit(p_business, case when v_old.id is null then 'purchase.create' else 'purchase.update' end,
    'purchase', v_id::text,
    'Purchase ' || coalesce(v_number, v_old.purchase_number) || case when v_old.id is null then ' created' else ' updated' end,
    case when v_old.id is null then null else to_jsonb(v_old) end,
    jsonb_build_object('purchase', p_purchase, 'lines', p_lines));
  return v_id;
end;
$$;

-- p_receipts: [{ "item_id": uuid, "quantity": number }]. Null = receive everything outstanding.
create or replace function public.receive_purchase(p_purchase uuid, p_receipts jsonb default null, p_batch_lot text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
  v_item public.purchase_items%rowtype;
  v_qty numeric;
  v_any boolean := false;
begin
  select * into v_p from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Purchase not found.'; end if;
  perform public.assert_member(v_p.business_id);
  if v_p.status in ('cancelled', 'received') then
    raise exception 'This purchase is already %.', replace(v_p.status::text, '_', ' ');
  end if;

  for v_item in select * from public.purchase_items where purchase_id = p_purchase order by sort_order for update loop
    if p_receipts is null then
      v_qty := v_item.quantity - v_item.received_quantity;
    else
      select coalesce(sum((r->>'quantity')::numeric), 0) into v_qty
      from jsonb_array_elements(p_receipts) r where (r->>'item_id')::uuid = v_item.id;
    end if;
    if v_qty < 0 then raise exception 'Received quantity cannot be negative.'; end if;
    if v_qty = 0 then continue; end if;
    if v_item.received_quantity + v_qty > v_item.quantity then
      raise exception 'Cannot receive more than ordered for "%": % outstanding.',
        v_item.description, trim_scale(v_item.quantity - v_item.received_quantity);
    end if;
    perform public.apply_stock_movement(v_p.business_id, v_item.variant_id, v_qty, 'purchase',
      v_item.landed_unit_cost, 'purchase', v_p.id, v_p.purchase_number, null, p_batch_lot);
    update public.purchase_items set received_quantity = received_quantity + v_qty where id = v_item.id;
    v_any := true;
  end loop;

  if not v_any then
    raise exception 'Enter a quantity to receive.';
  end if;

  update public.purchases set
    status = case when exists (
      select 1 from public.purchase_items where purchase_id = p_purchase and received_quantity < quantity
    ) then 'partially_received'::public.purchase_status else 'received'::public.purchase_status end,
    received_at = now()
  where id = p_purchase;

  perform public.write_audit(v_p.business_id, 'purchase.receive', 'purchase', p_purchase::text,
    'Purchase ' || v_p.purchase_number || ' received', null, p_receipts);
end;
$$;

create or replace function public.set_purchase_status(p_purchase uuid, p_status public.purchase_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Purchase not found.'; end if;
  perform public.assert_member(v_p.business_id);
  if p_status not in ('draft', 'ordered', 'cancelled') then
    raise exception 'Use "Receive" to mark items as received.';
  end if;
  if v_p.status in ('cancelled', 'received', 'partially_received') then
    raise exception 'A % purchase cannot change to %.', replace(v_p.status::text, '_', ' '), p_status;
  end if;
  update public.purchases set status = p_status where id = p_purchase;
  perform public.refresh_purchase_payment(p_purchase);
  perform public.write_audit(v_p.business_id, 'purchase.status', 'purchase', p_purchase::text,
    'Purchase ' || v_p.purchase_number || ': ' || v_p.status || ' → ' || p_status);
end;
$$;

create or replace function public.delete_purchase(p_purchase uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
begin
  select * into v_p from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Purchase not found.'; end if;
  perform public.assert_member(v_p.business_id);
  if exists (select 1 from public.purchase_items where purchase_id = p_purchase and received_quantity > 0) then
    raise exception 'Purchases with received stock cannot be deleted.';
  end if;
  if exists (select 1 from public.payments where purchase_id = p_purchase) then
    raise exception 'Delete this purchase''s payments first.';
  end if;
  delete from public.purchases where id = p_purchase;
  perform public.write_audit(v_p.business_id, 'purchase.delete', 'purchase', p_purchase::text,
    'Purchase ' || v_p.purchase_number || ' deleted', to_jsonb(v_p), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments: keep order/purchase paid amounts in sync, validate links.
-- ---------------------------------------------------------------------------
create or replace function public.payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_owner uuid;
begin
  if new.order_id is not null then
    select status::text, customer_id into v_status, v_owner from public.orders
     where id = new.order_id and business_id = new.business_id;
    if not found then raise exception 'Order not found.'; end if;
    if v_status in ('cancelled', 'returned') and new.kind = 'payment' then
      raise exception 'Payments cannot be added to a % order. Record a refund instead.', v_status;
    end if;
    new.customer_id := v_owner;
  end if;
  if new.purchase_id is not null then
    select status::text, supplier_id into v_status, v_owner from public.purchases
     where id = new.purchase_id and business_id = new.business_id;
    if not found then raise exception 'Purchase not found.'; end if;
    if v_status = 'cancelled' and new.kind = 'payment' then
      raise exception 'Payments cannot be added to a cancelled purchase.';
    end if;
    new.supplier_id := v_owner;
  end if;
  if new.customer_id is not null and not exists (
    select 1 from public.customers where id = new.customer_id and business_id = new.business_id
  ) then
    raise exception 'Customer not found.';
  end if;
  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers where id = new.supplier_id and business_id = new.business_id
  ) then
    raise exception 'Supplier not found.';
  end if;
  return new;
end;
$$;

create trigger payments_before_write before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.payments_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.order_id is not null then perform public.refresh_order_payment(old.order_id); end if;
    if old.purchase_id is not null then perform public.refresh_purchase_payment(old.purchase_id); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.order_id is not null then perform public.refresh_order_payment(new.order_id); end if;
    if new.purchase_id is not null then perform public.refresh_purchase_payment(new.purchase_id); end if;
  end if;
  return null;
end;
$$;

create trigger payments_after_write after insert or update or delete on public.payments
  for each row execute function public.payments_after_write();

-- ---------------------------------------------------------------------------
-- Production
-- ---------------------------------------------------------------------------
create or replace function public.save_recipe(p_business uuid, p_recipe jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_recipe->>'id', '')::uuid;
  v_output uuid := (p_recipe->>'variant_id')::uuid;
  v_item jsonb;
  v_ord integer := 0;
begin
  perform public.assert_member(p_business);
  if not exists (
    select 1 from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = v_output and v.business_id = p_business and p.track_inventory
  ) then
    raise exception 'The output item must exist and track stock.';
  end if;
  if coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'Add at least one component.';
  end if;

  if v_id is null then
    insert into public.recipes (business_id, variant_id, name, yield_quantity, notes, is_active, is_demo)
    values (p_business, v_output, p_recipe->>'name', coalesce((p_recipe->>'yield_quantity')::numeric, 1),
            nullif(p_recipe->>'notes', ''), coalesce((p_recipe->>'is_active')::boolean, true),
            coalesce((p_recipe->>'is_demo')::boolean, false))
    returning id into v_id;
  else
    update public.recipes set variant_id = v_output, name = p_recipe->>'name',
      yield_quantity = coalesce((p_recipe->>'yield_quantity')::numeric, 1),
      notes = nullif(p_recipe->>'notes', ''), is_active = coalesce((p_recipe->>'is_active')::boolean, true)
    where id = v_id and business_id = p_business;
    if not found then raise exception 'Recipe not found.'; end if;
    delete from public.recipe_items where recipe_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_ord := v_ord + 1;
    if (v_item->>'component_variant_id')::uuid = v_output then
      raise exception 'An item cannot be a component of itself.';
    end if;
    if not exists (
      select 1 from public.product_variants v join public.products p on p.id = v.product_id
      where v.id = (v_item->>'component_variant_id')::uuid and v.business_id = p_business and p.track_inventory
    ) then
      raise exception 'Component % must exist and track stock.', v_ord;
    end if;
    insert into public.recipe_items (business_id, recipe_id, component_variant_id, quantity, wastage_pct, sort_order)
    values (p_business, v_id, (v_item->>'component_variant_id')::uuid, (v_item->>'quantity')::numeric,
            coalesce((v_item->>'wastage_pct')::numeric, 0), v_ord);
  end loop;

  perform public.write_audit(p_business, 'recipe.save', 'recipe', v_id::text, 'Recipe "' || (p_recipe->>'name') || '" saved');
  return v_id;
end;
$$;

create or replace function public.create_production_batch(
  p_business uuid, p_recipe uuid, p_planned_quantity numeric, p_date date default current_date,
  p_notes text default null, p_is_demo boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe public.recipes%rowtype;
  v_set public.business_settings%rowtype;
  v_id uuid;
  v_number text;
  v_scale numeric;
begin
  perform public.assert_member(p_business);
  select * into v_recipe from public.recipes where id = p_recipe and business_id = p_business;
  if not found then raise exception 'Recipe not found.'; end if;
  if p_planned_quantity is null or p_planned_quantity <= 0 then
    raise exception 'Planned quantity must be greater than zero.';
  end if;
  select * into v_set from public.business_settings where business_id = p_business;
  v_number := public.next_document_number(p_business, 'batch', v_set.batch_prefix);
  v_scale := p_planned_quantity / v_recipe.yield_quantity;

  insert into public.production_batches (business_id, batch_number, recipe_id, variant_id, planned_quantity,
    production_date, notes, is_demo)
  values (p_business, v_number, p_recipe, v_recipe.variant_id, p_planned_quantity, coalesce(p_date, current_date),
    nullif(p_notes, ''), p_is_demo)
  returning id into v_id;

  -- Planned consumption; expected wastage is pre-filled from the recipe's wastage %.
  insert into public.production_consumption (business_id, batch_id, component_variant_id, planned_quantity,
    used_quantity, wasted_quantity, sort_order)
  select p_business, v_id, ri.component_variant_id, round(ri.quantity * v_scale, 4), round(ri.quantity * v_scale, 4),
         round(ri.quantity * v_scale * ri.wastage_pct / 100, 4), ri.sort_order
  from public.recipe_items ri where ri.recipe_id = p_recipe;

  perform public.write_audit(p_business, 'production.create', 'production_batch', v_id::text, 'Batch ' || v_number || ' planned');
  return v_id;
end;
$$;

create or replace function public.set_batch_status(p_batch uuid, p_status public.production_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.production_batches%rowtype;
begin
  select * into v_b from public.production_batches where id = p_batch for update;
  if not found then raise exception 'Batch not found.'; end if;
  perform public.assert_member(v_b.business_id);
  if p_status = 'completed' then
    raise exception 'Use "Complete batch" to finish production.';
  end if;
  if v_b.status in ('completed', 'cancelled') then
    raise exception 'This batch is already %.', v_b.status;
  end if;
  update public.production_batches set status = p_status where id = p_batch;
  perform public.write_audit(v_b.business_id, 'production.status', 'production_batch', p_batch::text,
    'Batch ' || v_b.batch_number || ': ' || v_b.status || ' → ' || p_status);
end;
$$;

-- p_lines: [{ "id": consumption_id, "used_quantity": n, "wasted_quantity": n }]
-- Cost of finished goods = materials used + materials wasted during the batch + additional cost.
create or replace function public.complete_production_batch(
  p_batch uuid, p_actual_quantity numeric, p_lines jsonb, p_additional_cost numeric default 0, p_notes text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.production_batches%rowtype;
  v_c public.production_consumption%rowtype;
  v_line jsonb;
  v_used numeric;
  v_wasted numeric;
  v_cost numeric;
  v_wcost numeric;
  v_material numeric := 0;
  v_waste_total numeric := 0;
  v_total numeric;
  v_unit numeric;
  v_wid uuid;
  v_txn uuid;
begin
  select * into v_b from public.production_batches where id = p_batch for update;
  if not found then raise exception 'Batch not found.'; end if;
  perform public.assert_member(v_b.business_id);
  if v_b.status in ('completed', 'cancelled') then
    raise exception 'This batch is already %.', v_b.status;
  end if;
  if p_actual_quantity is null or p_actual_quantity <= 0 then
    raise exception 'Actual quantity produced must be greater than zero. If the batch failed, cancel it and record wastage.';
  end if;
  if coalesce(p_additional_cost, 0) < 0 then
    raise exception 'Additional cost cannot be negative.';
  end if;

  for v_c in select * from public.production_consumption where batch_id = p_batch order by sort_order for update loop
    v_line := null;
    select l into v_line from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l where (l->>'id')::uuid = v_c.id;
    v_used := coalesce((v_line->>'used_quantity')::numeric, v_c.used_quantity);
    v_wasted := coalesce((v_line->>'wasted_quantity')::numeric, v_c.wasted_quantity);
    if v_used < 0 or v_wasted < 0 then
      raise exception 'Consumed quantities cannot be negative.';
    end if;
    v_cost := 0; v_wcost := 0;
    if v_used > 0 then
      v_cost := public.apply_stock_movement(v_b.business_id, v_c.component_variant_id, -v_used, 'production_consumption',
        null, 'production_batch', v_b.id, v_b.batch_number, null);
    end if;
    if v_wasted > 0 then
      v_wid := gen_random_uuid();
      v_wcost := public.apply_stock_movement(v_b.business_id, v_c.component_variant_id, -v_wasted, 'wastage',
        null, 'production_batch', v_b.id, v_b.batch_number, 'Production wastage');
      select id into v_txn from public.inventory_transactions
       where reference_type = 'production_batch' and reference_id = v_b.id and variant_id = v_c.component_variant_id
         and txn_type = 'wastage' order by created_at desc limit 1;
      insert into public.wastage (id, business_id, variant_id, quantity, wastage_date, reason, batch_id,
        unit_cost, total_cost, inventory_transaction_id, notes, is_demo)
      values (v_wid, v_b.business_id, v_c.component_variant_id, v_wasted, current_date, 'production', v_b.id,
        v_wcost, round(v_wasted * v_wcost, 2), v_txn, 'Batch ' || v_b.batch_number, v_b.is_demo);
    end if;
    update public.production_consumption set
      used_quantity = v_used, wasted_quantity = v_wasted,
      unit_cost = coalesce(nullif(v_cost, 0), v_wcost),
      total_cost = round(v_used * v_cost, 2) + round(v_wasted * v_wcost, 2)
    where id = v_c.id;
    v_material := v_material + round(v_used * v_cost, 2);
    v_waste_total := v_waste_total + round(v_wasted * v_wcost, 2);
  end loop;

  v_total := v_material + v_waste_total + round(coalesce(p_additional_cost, 0), 2);
  v_unit := round(v_total / p_actual_quantity, 4);

  perform public.apply_stock_movement(v_b.business_id, v_b.variant_id, p_actual_quantity, 'production_output',
    v_unit, 'production_batch', v_b.id, v_b.batch_number, null, v_b.batch_number);

  update public.production_batches set
    status = 'completed', actual_quantity = p_actual_quantity, material_cost = v_material,
    wastage_cost = v_waste_total, additional_cost = round(coalesce(p_additional_cost, 0), 2),
    total_cost = v_total, unit_cost = v_unit, completed_at = now(),
    notes = coalesce(nullif(p_notes, ''), notes)
  where id = p_batch;

  perform public.write_audit(v_b.business_id, 'production.complete', 'production_batch', p_batch::text,
    'Batch ' || v_b.batch_number || ' completed: ' || trim_scale(p_actual_quantity) || ' produced',
    null, jsonb_build_object('actual_quantity', p_actual_quantity, 'total_cost', v_total, 'unit_cost', v_unit));
end;
$$;

create or replace function public.delete_production_batch(p_batch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.production_batches%rowtype;
begin
  select * into v_b from public.production_batches where id = p_batch for update;
  if not found then raise exception 'Batch not found.'; end if;
  perform public.assert_member(v_b.business_id);
  if v_b.status = 'completed' then
    raise exception 'Completed batches cannot be deleted; they are part of your stock history.';
  end if;
  delete from public.production_batches where id = p_batch;
  perform public.write_audit(v_b.business_id, 'production.delete', 'production_batch', p_batch::text,
    'Batch ' || v_b.batch_number || ' deleted');
end;
$$;
