-- =============================================================================
-- Velqora — Row Level Security, grants and storage
--
-- Model: a signed-in user may access rows whose business_id belongs to a business
-- they are a member of (public.business_members). The anon role gets nothing.
--
-- Integrity-critical tables (inventory, orders, purchases, production, wastage)
-- are SELECT-only for API users; they can only be changed through the
-- SECURITY DEFINER functions in the business-logic migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','business_members','business_settings','document_counters','payment_methods',
    'product_categories','attribute_definitions','products','product_variants','product_cost_components',
    'inventory_levels','inventory_transactions','suppliers','customers','purchases','purchase_items',
    'orders','order_items','payments','expense_categories','expenses','recipes','recipe_items',
    'production_batches','production_consumption','wastage','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Businesses & membership
-- ---------------------------------------------------------------------------
create policy "members read business" on public.businesses
  for select to authenticated using ((select public.is_business_member(id)));
create policy "members update business" on public.businesses
  for update to authenticated using ((select public.is_business_member(id)))
  with check ((select public.is_business_member(id)));
revoke insert, delete on public.businesses from authenticated;

create policy "read own memberships" on public.business_members
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.business_members from authenticated;

create policy "members read settings" on public.business_settings
  for select to authenticated using ((select public.is_business_member(business_id)));
create policy "members update settings" on public.business_settings
  for update to authenticated using ((select public.is_business_member(business_id)))
  with check ((select public.is_business_member(business_id)));
revoke insert, delete on public.business_settings from authenticated;

revoke all on public.document_counters from authenticated;

-- ---------------------------------------------------------------------------
-- Plain CRUD tables: full access for members
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'payment_methods','product_categories','attribute_definitions','suppliers','customers',
    'payments','expense_categories','expenses'
  ] loop
    execute format($f$
      create policy "members full access" on public.%I
        for all to authenticated
        using ((select public.is_business_member(business_id)))
        with check ((select public.is_business_member(business_id)))
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Read-only tables (writes only via functions)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'product_cost_components','inventory_levels','inventory_transactions','purchases','purchase_items',
    'orders','order_items','recipe_items','production_batches','production_consumption','wastage'
  ] loop
    execute format($f$
      create policy "members read" on public.%I
        for select to authenticated
        using ((select public.is_business_member(business_id)))
    $f$, t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- Stock settings (not quantities!) may be edited directly.
create policy "members update stock settings" on public.inventory_levels
  for update to authenticated
  using ((select public.is_business_member(business_id)))
  with check ((select public.is_business_member(business_id)));
grant update (min_stock, max_stock, location) on public.inventory_levels to authenticated;

-- Products / variants / recipes: created & edited via functions; members may
-- toggle active flags, set images, and delete unused rows.
do $$
declare t text;
begin
  foreach t in array array['products','product_variants','recipes'] loop
    execute format($f$
      create policy "members read" on public.%I for select to authenticated
        using ((select public.is_business_member(business_id)))
    $f$, t);
    execute format($f$
      create policy "members update" on public.%I for update to authenticated
        using ((select public.is_business_member(business_id)))
        with check ((select public.is_business_member(business_id)))
    $f$, t);
    execute format($f$
      create policy "members delete" on public.%I for delete to authenticated
        using ((select public.is_business_member(business_id)))
    $f$, t);
    execute format('revoke insert, update on public.%I from authenticated', t);
  end loop;
end $$;
grant update (is_active, image_path) on public.products to authenticated;
grant update (is_active, image_path) on public.product_variants to authenticated;
grant update (is_active) on public.recipes to authenticated;

-- Audit log: append + read only
create policy "members read audit" on public.audit_logs
  for select to authenticated using ((select public.is_business_member(business_id)));
create policy "members append audit" on public.audit_logs
  for insert to authenticated with check ((select public.is_business_member(business_id)));
revoke update, delete on public.audit_logs from authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.create_business(jsonb) to authenticated;
grant execute on function public.save_product(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.adjust_stock(uuid, uuid, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.record_wastage(uuid, uuid, numeric, public.wastage_reason, date, text) to authenticated;
grant execute on function public.save_order(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.set_order_status(uuid, public.order_status) to authenticated;
grant execute on function public.update_order_details(uuid, text, date, text) to authenticated;
grant execute on function public.delete_order(uuid) to authenticated;
grant execute on function public.save_purchase(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.receive_purchase(uuid, jsonb, text) to authenticated;
grant execute on function public.set_purchase_status(uuid, public.purchase_status) to authenticated;
grant execute on function public.delete_purchase(uuid) to authenticated;
grant execute on function public.save_recipe(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.create_production_batch(uuid, uuid, numeric, date, text, boolean) to authenticated;
grant execute on function public.set_batch_status(uuid, public.production_status) to authenticated;
grant execute on function public.complete_production_batch(uuid, numeric, jsonb, numeric, text) to authenticated;
grant execute on function public.delete_production_batch(uuid) to authenticated;
grant execute on function public.calc_document(jsonb, numeric, boolean, boolean) to authenticated;

-- Lets the sign-in page know whether first-run owner registration is still open.
-- Reveals only a boolean.
create or replace function public.app_has_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.business_members where role = 'owner');
$$;
revoke execute on function public.app_has_owner() from public;
grant execute on function public.app_has_owner() to anon, authenticated;

-- Keep future functions private by default too.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, one folder per business: {business_id}/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-files', 'business-files', false, 10485760,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf']
)
on conflict (id) do nothing;

create policy "members read business files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid())
    )
  );

create policy "members upload business files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid())
    )
  );

create policy "members update business files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid())
    )
  );

create policy "members delete business files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-files'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid())
    )
  );
