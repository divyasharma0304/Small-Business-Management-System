-- =============================================================================
-- Velqora — core schema
-- Every business-owned table carries business_id so the same database can host
-- multiple businesses later. RLS (see the rls migration) scopes all access by
-- membership in business_members.
-- Money: numeric(14,2). Quantities: numeric(14,3). Unit costs: numeric(14,4).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.item_type as enum ('product', 'service', 'material');
create type public.cost_method as enum ('manual', 'components', 'recipe');
create type public.order_status as enum (
  'draft', 'confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled', 'returned'
);
create type public.purchase_status as enum (
  'draft', 'ordered', 'partially_received', 'received', 'cancelled'
);
create type public.payment_status as enum ('unpaid', 'partial', 'paid');
create type public.payment_direction as enum ('in', 'out');
create type public.payment_kind as enum ('payment', 'refund');
create type public.inventory_txn_type as enum (
  'initial_stock', 'purchase', 'sale', 'sale_reversal', 'return',
  'production_output', 'production_consumption', 'wastage', 'adjustment'
);
create type public.production_status as enum ('planned', 'in_progress', 'completed', 'cancelled');
create type public.wastage_reason as enum (
  'damage', 'spillage', 'production_failure', 'broken', 'expired', 'packaging_loss', 'production', 'other'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Businesses & membership
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  business_type text not null default 'other',
  description text,
  logo_path text,
  owner_name text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  currency text not null default 'INR' check (char_length(currency) = 3),
  timezone text not null default 'Asia/Kolkata',
  -- Tax is optional and generic: a label (e.g. "GST", "VAT"), a registration number,
  -- a default rate, and whether entered prices already include tax.
  tax_enabled boolean not null default false,
  tax_label text not null default 'GST',
  tax_number text,
  default_tax_rate numeric(6,3) not null default 0 check (default_tax_rate >= 0 and default_tax_rate <= 100),
  prices_include_tax boolean not null default false,
  -- When true, tax paid on purchases is reclaimable (input credit) and is excluded
  -- from inventory cost. When false it is part of the landed cost.
  purchase_tax_recoverable boolean not null default false,
  default_unit text not null default 'pcs',
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger businesses_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_members_user_idx on public.business_members(user_id);

create table public.business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  -- Module switches
  module_inventory boolean not null default true,
  module_purchases boolean not null default true,
  module_suppliers boolean not null default true,
  module_customers boolean not null default true,
  module_production boolean not null default false,
  module_expenses boolean not null default true,
  module_variants boolean not null default true,
  -- Inventory
  allow_negative_stock boolean not null default false,
  default_min_stock numeric(14,3) not null default 0 check (default_min_stock >= 0),
  -- Sales: the status at which an order is recognised as a sale AND stock is deducted.
  inventory_deduction_status public.order_status not null default 'confirmed'
    check (inventory_deduction_status in ('confirmed','processing','ready','shipped','delivered')),
  default_order_status public.order_status not null default 'draft'
    check (default_order_status in ('draft','confirmed')),
  payment_due_days integer not null default 0 check (payment_due_days between 0 and 365),
  -- Production
  default_wastage_pct numeric(6,3) not null default 0 check (default_wastage_pct between 0 and 100),
  -- Document numbering
  order_prefix text not null default 'ORD-',
  purchase_prefix text not null default 'PO-',
  batch_prefix text not null default 'BATCH-',
  -- Units offered in dropdowns
  units text[] not null default array['pcs','kg','g','l','ml','m','cm','box','pack','set','hour','job'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger business_settings_updated_at before update on public.business_settings
  for each row execute function public.set_updated_at();

create table public.document_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  doc_type text not null,
  next_value integer not null default 1,
  primary key (business_id, doc_type)
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create trigger payment_methods_updated_at before update on public.payment_methods
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create trigger product_categories_updated_at before update on public.product_categories
  for each row execute function public.set_updated_at();

-- Owner-defined attributes (e.g. "Colour", "Size", "Scent", "Material").
-- Values are stored on products/variants in an `attributes` jsonb object keyed by attribute name.
create table public.attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  options text[] not null default '{}',   -- empty = free text
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create trigger attribute_definitions_updated_at before update on public.attribute_definitions
  for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete set null,
  item_type public.item_type not null default 'product',
  name text not null check (char_length(name) between 1 and 200),
  description text,
  unit text not null default 'pcs',
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  track_inventory boolean not null default true,
  has_variants boolean not null default false,
  cost_method public.cost_method not null default 'manual',
  brand text,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  image_path text,
  notes text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- services never hold stock
  constraint services_not_stocked check (item_type <> 'service' or track_inventory = false)
);
create index products_business_idx on public.products(business_id, is_active);
create index products_category_idx on public.products(category_id);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- Every product has at least one variant. Simple products have exactly one
-- `is_default` variant which the UI hides. Stock, SKU, price and cost live here.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null default 'Default' check (char_length(name) between 1 and 200),
  sku text,
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  -- Standard/estimated unit cost used for pricing analysis and for items that do
  -- not track stock. Inventory-tracked items use inventory_levels.avg_cost for COGS.
  cost_price numeric(14,4) not null default 0 check (cost_price >= 0),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  image_path text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index product_variants_sku_uq on public.product_variants(business_id, lower(sku)) where sku is not null and sku <> '';
create index product_variants_product_idx on public.product_variants(product_id);
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

-- Optional itemised cost build-up (used when products.cost_method = 'components').
create table public.product_cost_components (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 100),
  amount numeric(14,4) not null check (amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_cost_components_product_idx on public.product_cost_components(product_id);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
-- One row per stock-tracked variant. quantity/avg_cost are ONLY changed by
-- public.apply_stock_movement(), which always writes an inventory_transactions row.
create table public.inventory_levels (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  quantity numeric(14,3) not null default 0,
  avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  max_stock numeric(14,3) check (max_stock is null or max_stock >= 0),
  location text,
  updated_at timestamptz not null default now()
);
create index inventory_levels_business_idx on public.inventory_levels(business_id);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- restrict: an item with stock history can be deactivated but never deleted
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  txn_type public.inventory_txn_type not null,
  quantity numeric(14,3) not null check (quantity <> 0),         -- signed: + in, − out
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) not null default 0,                   -- signed value moved
  balance_after numeric(14,3) not null,
  avg_cost_after numeric(14,4) not null,
  reference_type text,           -- 'order' | 'purchase' | 'production_batch' | 'wastage' | 'adjustment'
  reference_id uuid,
  reference_label text,
  batch_lot text,
  notes text,
  occurred_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index inventory_transactions_variant_idx on public.inventory_transactions(variant_id, occurred_at desc);
create index inventory_transactions_business_idx on public.inventory_transactions(business_id, occurred_at desc);
create index inventory_transactions_ref_idx on public.inventory_transactions(reference_type, reference_id);

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  country text,
  tax_number text,
  notes text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_business_idx on public.suppliers(business_id);
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  phone text,
  email text,
  address text,
  city text,
  state text,
  country text,
  tax_number text,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_business_idx on public.customers(business_id);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_number text not null,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  purchase_date date not null default current_date,
  invoice_number text,
  status public.purchase_status not null default 'draft',
  subtotal numeric(14,2) not null default 0,         -- Σ line (qty×price − line discount)
  discount_amount numeric(14,2) not null default 0,  -- purchase-level discount
  tax_total numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0 check (other_charges >= 0), -- freight etc., allocated into cost
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  payment_status public.payment_status not null default 'unpaid',
  attachment_path text,
  notes text,
  received_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, purchase_number)
);
create index purchases_business_date_idx on public.purchases(business_id, purchase_date desc);
create index purchases_supplier_idx on public.purchases(supplier_id);
create trigger purchases_updated_at before update on public.purchases
  for each row execute function public.set_updated_at();

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  description text not null,                 -- snapshot of item name at purchase time
  quantity numeric(14,3) not null check (quantity > 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  order_discount_share numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  charges_share numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  landed_unit_cost numeric(14,4) not null default 0,   -- cost per unit that enters inventory
  sort_order integer not null default 0,
  constraint purchase_received_le_ordered check (received_quantity <= quantity)
);
create index purchase_items_purchase_idx on public.purchase_items(purchase_id);
create index purchase_items_variant_idx on public.purchase_items(variant_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_number text not null,
  customer_id uuid references public.customers(id) on delete restrict,
  order_date date not null default current_date,
  due_date date,
  status public.order_status not null default 'draft',
  subtotal numeric(14,2) not null default 0,         -- Σ line (qty×price − line discount)
  discount_amount numeric(14,2) not null default 0,  -- order-level discount
  tax_total numeric(14,2) not null default 0,
  shipping_charge numeric(14,2) not null default 0 check (shipping_charge >= 0),
  total numeric(14,2) not null default 0,            -- amount the customer owes
  revenue_amount numeric(14,2) not null default 0,   -- total − tax (net sales incl. shipping)
  amount_paid numeric(14,2) not null default 0,      -- Σ payments − Σ refunds (maintained by trigger)
  payment_status public.payment_status not null default 'unpaid',
  preferred_payment_method text,
  cogs_total numeric(14,2) not null default 0,
  -- Set when the order reaches the configured deduction status. From then on the
  -- order counts as a sale and its lines are locked.
  recognized_at timestamptz,
  stock_deducted boolean not null default false,
  stock_reversed boolean not null default false,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_number)
);
create index orders_business_date_idx on public.orders(business_id, order_date desc);
create index orders_customer_idx on public.orders(customer_id);
create index orders_status_idx on public.orders(business_id, status);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  -- Snapshots so history never changes when the catalog changes
  description text not null,
  sku text,
  category_id uuid references public.product_categories(id) on delete set null,
  track_inventory boolean not null default false,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  order_discount_share numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,     -- revenue for this line (excl. tax, after all discounts)
  line_total numeric(14,2) not null default 0,     -- what the customer pays for this line
  unit_cost numeric(14,4),                         -- set at recognition
  cogs_amount numeric(14,2) not null default 0,
  sort_order integer not null default 0
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_variant_idx on public.order_items(variant_id);

-- ---------------------------------------------------------------------------
-- Payments (money in from customers, money out to suppliers)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  direction public.payment_direction not null,
  kind public.payment_kind not null default 'payment',
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  method text not null,
  reference text,
  customer_id uuid references public.customers(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  purchase_id uuid references public.purchases(id) on delete restrict,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_direction_links check (
    (direction = 'in'  and supplier_id is null and purchase_id is null) or
    (direction = 'out' and customer_id is null and order_id is null)
  )
);
create index payments_business_date_idx on public.payments(business_id, payment_date desc);
create index payments_order_idx on public.payments(order_id);
create index payments_purchase_idx on public.payments(purchase_id);
create index payments_customer_idx on public.payments(customer_id);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create trigger expense_categories_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  expense_date date not null default current_date,
  category_id uuid references public.expense_categories(id) on delete restrict,
  description text not null check (char_length(description) between 1 and 500),
  amount numeric(14,2) not null check (amount > 0),
  vendor text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  payment_method text,
  reference text,
  receipt_path text,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_business_date_idx on public.expenses(business_id, expense_date desc);
create index expenses_category_idx on public.expenses(category_id);
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Production (optional module)
-- ---------------------------------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade, -- output item
  name text not null check (char_length(name) between 1 and 200),
  yield_quantity numeric(14,3) not null default 1 check (yield_quantity > 0),
  notes text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_variant_idx on public.recipes(variant_id);
create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  component_variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),     -- per recipe yield
  wastage_pct numeric(6,3) not null default 0 check (wastage_pct between 0 and 100),
  sort_order integer not null default 0
);
create index recipe_items_recipe_idx on public.recipe_items(recipe_id);

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  batch_number text not null,
  recipe_id uuid references public.recipes(id) on delete set null,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  planned_quantity numeric(14,3) not null check (planned_quantity > 0),
  actual_quantity numeric(14,3),
  production_date date not null default current_date,
  status public.production_status not null default 'planned',
  material_cost numeric(14,2) not null default 0,
  wastage_cost numeric(14,2) not null default 0,
  additional_cost numeric(14,2) not null default 0 check (additional_cost >= 0),
  total_cost numeric(14,2) not null default 0,
  unit_cost numeric(14,4),
  completed_at timestamptz,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, batch_number)
);
create index production_batches_business_idx on public.production_batches(business_id, production_date desc);
create trigger production_batches_updated_at before update on public.production_batches
  for each row execute function public.set_updated_at();

create table public.production_consumption (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  component_variant_id uuid not null references public.product_variants(id) on delete restrict,
  planned_quantity numeric(14,4) not null default 0,
  used_quantity numeric(14,4) not null default 0 check (used_quantity >= 0),
  wasted_quantity numeric(14,4) not null default 0 check (wasted_quantity >= 0),
  unit_cost numeric(14,4),
  total_cost numeric(14,2) not null default 0,
  sort_order integer not null default 0
);
create index production_consumption_batch_idx on public.production_consumption(batch_id);

create table public.wastage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  wastage_date date not null default current_date,
  reason public.wastage_reason not null default 'other',
  batch_id uuid references public.production_batches(id) on delete set null,
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) not null default 0,
  inventory_transaction_id uuid references public.inventory_transactions(id) on delete set null,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index wastage_business_date_idx on public.wastage(business_id, wastage_date desc);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid default auth.uid(),
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_business_idx on public.audit_logs(business_id, created_at desc);
