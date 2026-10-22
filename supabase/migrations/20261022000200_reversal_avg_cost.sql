-- =============================================================================
-- Taking stock back out at its original cost (deleting/editing a received
-- purchase, undoing an adjustment, deleting a batch) now recalculates the
-- weighted-average cost so the total stock value is conserved.
-- =============================================================================
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
    -- Normal outflows leave at the average, which doesn't change it. When an
    -- explicit cost is given (reversing a purchase/adjustment/batch at its
    -- original cost), recalculate so total stock value is conserved.
    if p_unit_cost is not null and v_new_qty > 0 then
      v_new_avg := greatest(round((v_level.quantity * v_level.avg_cost + p_qty * p_unit_cost) / v_new_qty, 4), 0);
    else
      v_new_avg := v_level.avg_cost;
    end if;
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

