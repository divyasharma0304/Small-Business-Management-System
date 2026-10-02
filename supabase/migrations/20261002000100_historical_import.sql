-- =============================================================================
-- Historical order import (e.g. from a spreadsheet kept before Velqora).
--
-- Imported orders keep their original number, date, prices, discounts, shipping
-- and payments, and count as sales on their order date. Two deliberate differences
-- from normal orders:
--   * they never touch stock (the stock of that time isn't known), and
--   * their cost of goods is ₹0, because before Velqora every material purchase
--     was recorded as an expense — counting product cost as well would double it.
-- They are flagged with orders.is_imported so this is always visible.
-- =============================================================================

alter table public.orders add column if not exists is_imported boolean not null default false;

create or replace function public.import_historical_order(
  p_business uuid, p_order jsonb, p_lines jsonb, p_payments jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_number text := nullif(trim(p_order->>'order_number'), '');
  v_status public.order_status := coalesce(nullif(p_order->>'status', ''), 'delivered')::public.order_status;
  v_tz text;
  v_pay jsonb;
begin
  perform public.assert_member(p_business);
  if v_number is null then
    raise exception 'Imported orders need their original order number.';
  end if;
  if exists (select 1 from public.orders where business_id = p_business and order_number = v_number) then
    raise exception 'Order % already exists.', v_number;
  end if;
  if v_status = 'returned' then
    raise exception 'Returned orders cannot be imported.';
  end if;
  select timezone into v_tz from public.businesses where id = p_business;

  -- Reuse the normal calculation (totals, discounts, shipping, snapshots) as a draft…
  v_id := public.save_order(p_business, (p_order - 'status') || '{"status":"draft"}'::jsonb, p_lines);

  -- …then mark it as an imported historical sale.
  update public.order_items set track_inventory = false, unit_cost = 0, cogs_amount = 0 where order_id = v_id;
  update public.orders set
    order_number = v_number,
    is_imported = true,
    status = v_status,
    stock_deducted = false,
    cogs_total = 0,
    recognized_at = case when v_status in ('draft', 'cancelled') then null
                         else (order_date + time '12:00') at time zone coalesce(v_tz, 'UTC') end
  where id = v_id;

  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    insert into public.payments (business_id, direction, kind, payment_date, amount, method, reference, order_id, notes)
    values (p_business, 'in', 'payment', (v_pay->>'payment_date')::date, (v_pay->>'amount')::numeric,
            v_pay->>'method', nullif(v_pay->>'reference', ''), v_id, nullif(v_pay->>'notes', ''));
  end loop;
  perform public.refresh_order_payment(v_id);

  perform public.write_audit(p_business, 'order.import', 'order', v_id::text, 'Order ' || v_number || ' imported from history');
  return v_id;
end;
$$;

revoke execute on function public.import_historical_order(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.import_historical_order(uuid, jsonb, jsonb, jsonb) to authenticated;
