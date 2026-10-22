-- =============================================================================
-- Extra charges on orders (white labelling, custom design, custom packaging…).
-- Like shipping, they are added to the order total and count as revenue; they
-- are not taxed in the MVP. Stored per order as [{label, amount}].
-- =============================================================================
alter table public.orders
  add column extra_charges jsonb not null default '[]'::jsonb check (jsonb_typeof(extra_charges) = 'array'),
  add column extra_charges_total numeric(14,2) not null default 0 check (extra_charges_total >= 0);

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
  v_charges jsonb := '[]'::jsonb;
  v_extra numeric := 0;
  v_ch jsonb;
  v_initial public.order_status;
  v_number text;
begin
  perform public.assert_member(p_business);
  select * into v_biz from public.businesses where id = p_business;
  select * into v_set from public.business_settings where business_id = p_business;

  if v_shipping < 0 then
    raise exception 'Shipping charge cannot be negative.';
  end if;
  -- Extra charges: [{ "label": "White labelling", "amount": 150 }, …]
  for v_ch in select * from jsonb_array_elements(coalesce(p_order->'extra_charges', '[]'::jsonb)) loop
    if coalesce(trim(v_ch->>'label'), '') = '' then
      raise exception 'Every extra charge needs a name.';
    end if;
    if (v_ch->>'amount') is null or (v_ch->>'amount')::numeric < 0 then
      raise exception 'Extra charge "%" must be zero or more.', trim(v_ch->>'label');
    end if;
    v_charges := v_charges || jsonb_build_object('label', left(trim(v_ch->>'label'), 100), 'amount', round((v_ch->>'amount')::numeric, 2));
    v_extra := v_extra + round((v_ch->>'amount')::numeric, 2);
  end loop;
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
      tax_total, shipping_charge, total, revenue_amount, preferred_payment_method, notes, is_demo,
      extra_charges, extra_charges_total
    ) values (
      p_business, v_number, v_customer, coalesce((p_order->>'order_date')::date, current_date),
      coalesce((p_order->>'due_date')::date,
               coalesce((p_order->>'order_date')::date, current_date) + v_set.payment_due_days),
      'draft', (v_calc->>'subtotal')::numeric, (v_calc->>'discount')::numeric, (v_calc->>'tax_total')::numeric,
      v_shipping, (v_calc->>'lines_total')::numeric + v_shipping + v_extra, (v_calc->>'net_total')::numeric + v_shipping + v_extra,
      nullif(p_order->>'preferred_payment_method', ''), nullif(p_order->>'notes', ''),
      coalesce((p_order->>'is_demo')::boolean, false),
      v_charges, v_extra
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
      total = (v_calc->>'lines_total')::numeric + v_shipping + v_extra,
      revenue_amount = (v_calc->>'net_total')::numeric + v_shipping + v_extra,
      extra_charges = v_charges,
      extra_charges_total = v_extra,
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


create or replace function public.report_profit_summary(p_business uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_revenue numeric; v_shipping numeric; v_extra numeric; v_tax numeric; v_discounts numeric; v_cogs numeric;
  v_orders integer; v_gross_sales numeric;
  v_expenses numeric; v_losses numeric; v_wastage numeric; v_adjust numeric;
begin
  select timezone into v_tz from public.businesses where id = p_business;

  select coalesce(sum(o.revenue_amount), 0), coalesce(sum(o.shipping_charge), 0), coalesce(sum(o.tax_total), 0),
         coalesce(sum(o.cogs_total), 0), count(*), coalesce(sum(o.total), 0), coalesce(sum(o.extra_charges_total), 0)
    into v_revenue, v_shipping, v_tax, v_cogs, v_orders, v_gross_sales, v_extra
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
    'extra_charges_revenue', v_extra,
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

