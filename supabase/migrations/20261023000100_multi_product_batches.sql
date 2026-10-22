-- =============================================================================
-- Production batches with several products.
--
-- A batch now has one or more OUTPUT lines (production_batch_outputs), each with
-- its own recipe, planned/actual quantity and cost. Material consumption lines
-- belong to an output, so every product's cost comes from its own recipe.
-- Additional batch cost (labour, energy…) is split across outputs in proportion
-- to their material cost.
--
-- Existing batches are converted into single-output batches.
-- =============================================================================

create table public.production_batch_outputs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete set null,
  variant_id uuid not null references public.product_variants(id),
  planned_quantity numeric(14,3) not null check (planned_quantity > 0),
  actual_quantity numeric(14,3),
  material_cost numeric(14,2) not null default 0,
  wastage_cost numeric(14,2) not null default 0,
  additional_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  unit_cost numeric(14,4),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index production_batch_outputs_batch_idx on public.production_batch_outputs(batch_id);
create index production_batch_outputs_variant_idx on public.production_batch_outputs(variant_id);

alter table public.production_consumption
  add column output_id uuid references public.production_batch_outputs(id) on delete cascade;

-- Convert existing batches (one output each)
insert into public.production_batch_outputs (business_id, batch_id, recipe_id, variant_id, planned_quantity, actual_quantity,
  material_cost, wastage_cost, additional_cost, total_cost, unit_cost)
select business_id, id, recipe_id, variant_id, planned_quantity, actual_quantity,
  material_cost, wastage_cost, additional_cost, total_cost, unit_cost
from public.production_batches;

update public.production_consumption c set output_id = o.id
from public.production_batch_outputs o where o.batch_id = c.batch_id;

alter table public.production_consumption alter column output_id set not null;

alter table public.production_batches
  drop column recipe_id,
  drop column variant_id,
  drop column planned_quantity,
  drop column actual_quantity,
  drop column unit_cost;

-- Security: read-only for API users, like the rest of production
alter table public.production_batch_outputs enable row level security;
revoke all on public.production_batch_outputs from anon;
revoke insert, update, delete on public.production_batch_outputs from authenticated;
create policy "members read" on public.production_batch_outputs
  for select to authenticated using ((select public.is_business_member(business_id)));

-- ---------------------------------------------------------------------------
-- Create a batch with several products.
-- p_outputs: [{ "recipe_id": uuid, "planned_quantity": number }, …]
-- ---------------------------------------------------------------------------
create or replace function public.create_production_batch_multi(
  p_business uuid, p_outputs jsonb, p_date date default null, p_notes text default null, p_is_demo boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.business_settings%rowtype;
  v_id uuid;
  v_number text;
  v_o jsonb;
  v_r public.recipes%rowtype;
  v_qty numeric;
  v_out uuid;
  v_i integer := 0;
begin
  perform public.assert_member(p_business);
  if coalesce(jsonb_array_length(p_outputs), 0) = 0 then
    raise exception 'Add at least one product to the batch.';
  end if;
  select * into v_set from public.business_settings where business_id = p_business;
  v_number := public.next_document_number(p_business, 'batch', v_set.batch_prefix);

  insert into public.production_batches (business_id, batch_number, production_date, notes, is_demo)
  values (p_business, v_number, coalesce(p_date, public.business_today(p_business)), nullif(p_notes, ''), coalesce(p_is_demo, false))
  returning id into v_id;

  for v_o in select * from jsonb_array_elements(p_outputs) loop
    v_i := v_i + 1;
    select * into v_r from public.recipes where id = (v_o->>'recipe_id')::uuid and business_id = p_business;
    if not found then raise exception 'Line %: recipe not found.', v_i; end if;
    v_qty := (v_o->>'planned_quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Line %: planned quantity must be greater than zero.', v_i; end if;

    insert into public.production_batch_outputs (business_id, batch_id, recipe_id, variant_id, planned_quantity, sort_order)
    values (p_business, v_id, v_r.id, v_r.variant_id, v_qty, v_i)
    returning id into v_out;

    insert into public.production_consumption (business_id, batch_id, output_id, component_variant_id, planned_quantity,
      used_quantity, wasted_quantity, sort_order)
    select p_business, v_id, v_out, ri.component_variant_id,
           round(ri.quantity * v_qty / v_r.yield_quantity, 4),
           round(ri.quantity * v_qty / v_r.yield_quantity, 4),
           round(ri.quantity * v_qty / v_r.yield_quantity * ri.wastage_pct / 100, 4),
           v_i * 1000 + ri.sort_order
    from public.recipe_items ri where ri.recipe_id = v_r.id;
  end loop;

  perform public.write_audit(p_business, 'production.create', 'production_batch', v_id::text,
    'Batch ' || v_number || ' planned (' || v_i || ' product' || case when v_i = 1 then '' else 's' end || ')');
  return v_id;
end;
$$;

-- Kept for compatibility (single product)
create or replace function public.create_production_batch(
  p_business uuid, p_recipe uuid, p_planned_quantity numeric, p_date date default current_date,
  p_notes text default null, p_is_demo boolean default false
) returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.create_production_batch_multi(p_business,
    jsonb_build_array(jsonb_build_object('recipe_id', p_recipe, 'planned_quantity', p_planned_quantity)),
    p_date, p_notes, p_is_demo);
$$;

-- ---------------------------------------------------------------------------
-- Complete a batch.
-- p_outputs: [{ "id": output_id, "actual_quantity": n }]
-- p_lines:   [{ "id": consumption_id, "used_quantity": n, "wasted_quantity": n }]
-- Each product's cost = its materials used + wasted + its share of p_additional_cost.
-- ---------------------------------------------------------------------------
create or replace function public.complete_production_batch_multi(
  p_batch uuid, p_outputs jsonb, p_lines jsonb, p_additional_cost numeric default 0, p_notes text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.production_batches%rowtype;
  v_o public.production_batch_outputs%rowtype;
  v_c public.production_consumption%rowtype;
  v_line jsonb;
  v_actual numeric;
  v_used numeric; v_wasted numeric; v_cost numeric; v_wcost numeric;
  v_mat numeric; v_waste numeric;
  v_total_basis numeric := 0;
  v_total_actual numeric := 0;
  v_add numeric := round(coalesce(p_additional_cost, 0), 2);
  v_alloc numeric := 0;
  v_share numeric; v_total numeric; v_unit numeric;
  v_n integer; v_i integer := 0;
  v_wid uuid; v_txn uuid;
begin
  select * into v_b from public.production_batches where id = p_batch for update;
  if not found then raise exception 'Batch not found.'; end if;
  perform public.assert_member(v_b.business_id);
  if v_b.status in ('completed', 'cancelled') then
    raise exception 'This batch is already %.', v_b.status;
  end if;
  if v_add < 0 then raise exception 'Additional cost cannot be negative.'; end if;

  -- 1. Materials, per product
  for v_o in select * from public.production_batch_outputs where batch_id = p_batch order by sort_order for update loop
    select (x->>'actual_quantity')::numeric into v_actual
    from jsonb_array_elements(coalesce(p_outputs, '[]'::jsonb)) x where (x->>'id')::uuid = v_o.id;
    v_actual := coalesce(v_actual, v_o.planned_quantity);
    if v_actual <= 0 then
      raise exception 'Quantity produced must be greater than zero for every product. If one failed completely, remove it by cancelling and re-planning, and record the wastage.';
    end if;

    v_mat := 0; v_waste := 0;
    for v_c in select * from public.production_consumption where output_id = v_o.id order by sort_order for update loop
      v_line := null;
      select l into v_line from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l where (l->>'id')::uuid = v_c.id;
      v_used := coalesce((v_line->>'used_quantity')::numeric, v_c.used_quantity);
      v_wasted := coalesce((v_line->>'wasted_quantity')::numeric, v_c.wasted_quantity);
      if v_used < 0 or v_wasted < 0 then raise exception 'Consumed quantities cannot be negative.'; end if;
      v_cost := 0; v_wcost := 0;
      if v_used > 0 then
        v_cost := public.apply_stock_movement(v_b.business_id, v_c.component_variant_id, -v_used, 'production_consumption',
          null, 'production_batch', v_b.id, v_b.batch_number, null);
      end if;
      if v_wasted > 0 then
        v_wid := gen_random_uuid();
        v_wcost := public.apply_stock_movement(v_b.business_id, v_c.component_variant_id, -v_wasted, 'wastage',
          null, 'production_batch', v_b.id, v_b.batch_number, 'Production wastage');
        select t.id into v_txn from public.inventory_transactions t
         where t.reference_type = 'production_batch' and t.reference_id = v_b.id and t.variant_id = v_c.component_variant_id
           and t.txn_type = 'wastage' and not exists (select 1 from public.wastage w where w.inventory_transaction_id = t.id)
         order by t.created_at desc limit 1;
        insert into public.wastage (id, business_id, variant_id, quantity, wastage_date, reason, batch_id,
          unit_cost, total_cost, inventory_transaction_id, notes, is_demo)
        values (v_wid, v_b.business_id, v_c.component_variant_id, v_wasted, v_b.production_date, 'production', v_b.id,
          v_wcost, round(v_wasted * v_wcost, 2), v_txn, 'Batch ' || v_b.batch_number, v_b.is_demo);
      end if;
      update public.production_consumption set
        used_quantity = v_used, wasted_quantity = v_wasted,
        unit_cost = coalesce(nullif(v_cost, 0), v_wcost),
        total_cost = round(v_used * v_cost, 2) + round(v_wasted * v_wcost, 2)
      where id = v_c.id;
      v_mat := v_mat + round(v_used * v_cost, 2);
      v_waste := v_waste + round(v_wasted * v_wcost, 2);
    end loop;

    update public.production_batch_outputs set actual_quantity = v_actual, material_cost = v_mat, wastage_cost = v_waste where id = v_o.id;
    v_total_basis := v_total_basis + v_mat + v_waste;
    v_total_actual := v_total_actual + v_actual;
  end loop;

  -- 2. Split additional cost, then add finished goods to stock at their own cost
  select count(*) into v_n from public.production_batch_outputs where batch_id = p_batch;
  for v_o in select * from public.production_batch_outputs where batch_id = p_batch order by sort_order loop
    v_i := v_i + 1;
    if v_i = v_n then
      v_share := v_add - v_alloc;
    elsif v_total_basis > 0 then
      v_share := round(v_add * (v_o.material_cost + v_o.wastage_cost) / v_total_basis, 2);
    else
      v_share := round(v_add * v_o.actual_quantity / v_total_actual, 2);
    end if;
    v_alloc := v_alloc + v_share;
    v_total := v_o.material_cost + v_o.wastage_cost + v_share;
    v_unit := round(v_total / v_o.actual_quantity, 4);
    perform public.apply_stock_movement(v_b.business_id, v_o.variant_id, v_o.actual_quantity, 'production_output',
      v_unit, 'production_batch', v_b.id, v_b.batch_number, null, v_b.batch_number);
    update public.production_batch_outputs set additional_cost = v_share, total_cost = v_total, unit_cost = v_unit where id = v_o.id;
  end loop;

  update public.production_batches set
    status = 'completed',
    material_cost = (select coalesce(sum(material_cost), 0) from public.production_batch_outputs where batch_id = p_batch),
    wastage_cost = (select coalesce(sum(wastage_cost), 0) from public.production_batch_outputs where batch_id = p_batch),
    additional_cost = v_add,
    total_cost = (select coalesce(sum(total_cost), 0) from public.production_batch_outputs where batch_id = p_batch),
    completed_at = now(),
    notes = coalesce(nullif(p_notes, ''), notes)
  where id = p_batch;

  perform public.write_audit(v_b.business_id, 'production.complete', 'production_batch', p_batch::text,
    'Batch ' || v_b.batch_number || ' completed (' || v_n || ' product' || case when v_n = 1 then '' else 's' end || ')');
end;
$$;

-- Kept for compatibility (single-product batches)
create or replace function public.complete_production_batch(
  p_batch uuid, p_actual_quantity numeric, p_lines jsonb, p_additional_cost numeric default 0, p_notes text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outputs jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', id, 'actual_quantity', p_actual_quantity)) into v_outputs
  from public.production_batch_outputs where batch_id = p_batch;
  if jsonb_array_length(coalesce(v_outputs, '[]'::jsonb)) > 1 then
    raise exception 'This batch has several products — enter the quantity produced for each.';
  end if;
  perform public.complete_production_batch_multi(p_batch, v_outputs, p_lines, p_additional_cost, p_notes);
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete a batch (completed: every product removed from stock, materials returned)
-- ---------------------------------------------------------------------------
create or replace function public.delete_production_batch(p_batch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.production_batches%rowtype;
  v_o public.production_batch_outputs%rowtype;
  v_c public.production_consumption%rowtype;
begin
  select * into v_b from public.production_batches where id = p_batch for update;
  if not found then raise exception 'Batch not found.'; end if;
  perform public.assert_member(v_b.business_id);

  if v_b.status = 'completed' then
    for v_o in select * from public.production_batch_outputs where batch_id = p_batch and actual_quantity > 0 loop
      perform public.apply_stock_movement(v_b.business_id, v_o.variant_id, -v_o.actual_quantity, 'production_output',
        v_o.unit_cost, 'production_batch', v_b.id, v_b.batch_number, 'Batch deleted — finished goods removed');
    end loop;
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

revoke execute on function public.create_production_batch_multi(uuid, jsonb, date, text, boolean) from public, anon;
revoke execute on function public.complete_production_batch_multi(uuid, jsonb, jsonb, numeric, text) from public, anon;
grant execute on function public.create_production_batch_multi(uuid, jsonb, date, text, boolean) to authenticated;
grant execute on function public.complete_production_batch_multi(uuid, jsonb, jsonb, numeric, text) to authenticated;
grant execute on function public.create_production_batch(uuid, uuid, numeric, date, text, boolean) to authenticated;
grant execute on function public.complete_production_batch(uuid, numeric, jsonb, numeric, text) to authenticated;
grant execute on function public.delete_production_batch(uuid) to authenticated;

-- Demo data removal and item-delete impact now look at batch outputs
create or replace function public.delete_demo_data(p_business uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demo_variants uuid[];
begin
  perform public.assert_member(p_business);

  select coalesce(array_agg(v.id), '{}') into v_demo_variants
  from public.product_variants v join public.products p on p.id = v.product_id
  where p.business_id = p_business and p.is_demo;

  if exists (
    select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.business_id = p_business and not o.is_demo and oi.variant_id = any(v_demo_variants)
  ) or exists (
    select 1 from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
    where pu.business_id = p_business and not pu.is_demo and pi.variant_id = any(v_demo_variants)
  ) or exists (
    select 1 from public.orders o join public.customers c on c.id = o.customer_id
    where o.business_id = p_business and not o.is_demo and c.is_demo
  ) or exists (
    select 1 from public.purchases pu join public.suppliers s on s.id = pu.supplier_id
    where pu.business_id = p_business and not pu.is_demo and s.is_demo
  ) then
    raise exception 'Some of your real orders or purchases use demo items, customers or suppliers. Change or delete those records first, or keep the demo data.';
  end if;

  delete from public.payments where business_id = p_business and (is_demo
    or order_id in (select id from public.orders where business_id = p_business and is_demo)
    or purchase_id in (select id from public.purchases where business_id = p_business and is_demo));
  delete from public.orders where business_id = p_business and is_demo;
  delete from public.wastage where business_id = p_business and (is_demo or variant_id = any(v_demo_variants));
  delete from public.production_batches where business_id = p_business and (is_demo
    or id in (select batch_id from public.production_batch_outputs where variant_id = any(v_demo_variants)));
  delete from public.recipes where business_id = p_business and (is_demo or variant_id = any(v_demo_variants));
  delete from public.purchases where business_id = p_business and is_demo;
  delete from public.inventory_transactions where variant_id = any(v_demo_variants);
  delete from public.inventory_levels where variant_id = any(v_demo_variants);
  delete from public.products where business_id = p_business and is_demo;
  delete from public.expenses where business_id = p_business and is_demo;
  delete from public.customers where business_id = p_business and is_demo;
  delete from public.suppliers where business_id = p_business and is_demo;
  delete from public.product_categories where business_id = p_business and is_demo;

  perform public.write_audit(p_business, 'demo.delete', 'business', p_business::text, 'Demo data deleted');
end;
$$;


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
  where b.id in (select batch_id from public.production_batch_outputs where variant_id = any(v_variants))
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

