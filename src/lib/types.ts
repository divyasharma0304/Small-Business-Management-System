/**
 * Row types mirroring supabase/migrations. Numeric columns arrive from PostgREST
 * as numbers; keep these in sync when the schema changes.
 */

export type ItemType = "product" | "service" | "material";
export type CostMethod = "manual" | "components" | "recipe";
export type OrderStatus =
  | "draft" | "confirmed" | "processing" | "ready" | "shipped" | "delivered" | "cancelled" | "returned";
export type PurchaseStatus = "draft" | "ordered" | "partially_received" | "received" | "cancelled";
export type PaymentStatus = "unpaid" | "partial" | "paid";
export type PaymentDirection = "in" | "out";
export type PaymentKind = "payment" | "refund";
export type InventoryTxnType =
  | "initial_stock" | "purchase" | "sale" | "sale_reversal" | "return"
  | "production_output" | "production_consumption" | "wastage" | "adjustment";
export type ProductionStatus = "planned" | "in_progress" | "completed" | "cancelled";
export type WastageReason =
  | "damage" | "spillage" | "production_failure" | "broken" | "expired" | "packaging_loss" | "production" | "other";

export interface Business {
  id: string;
  name: string;
  business_type: string;
  description: string | null;
  logo_path: string | null;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  currency: string;
  timezone: string;
  tax_enabled: boolean;
  tax_label: string;
  tax_number: string | null;
  default_tax_rate: number;
  prices_include_tax: boolean;
  purchase_tax_recoverable: boolean;
  default_unit: string;
  setup_completed: boolean;
}

export interface BusinessSettings {
  business_id: string;
  module_inventory: boolean;
  module_purchases: boolean;
  module_suppliers: boolean;
  module_customers: boolean;
  module_production: boolean;
  module_expenses: boolean;
  module_variants: boolean;
  allow_negative_stock: boolean;
  default_min_stock: number;
  inventory_deduction_status: OrderStatus;
  default_order_status: OrderStatus;
  payment_due_days: number;
  default_wastage_pct: number;
  order_prefix: string;
  purchase_prefix: string;
  batch_prefix: string;
  units: string[];
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_demo: boolean;
}

export interface AttributeDefinition {
  id: string;
  name: string;
  options: string[];
  sort_order: number;
}

export interface Product {
  id: string;
  category_id: string | null;
  item_type: ItemType;
  name: string;
  description: string | null;
  unit: string;
  tax_rate: number;
  track_inventory: boolean;
  has_variants: boolean;
  cost_method: CostMethod;
  brand: string | null;
  attributes: Record<string, string>;
  image_path: string | null;
  notes: string | null;
  is_active: boolean;
  is_demo: boolean;
  created_at: string;
}

export interface Variant {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  selling_price: number;
  mrp: number | null;
  cost_price: number;
  attributes: Record<string, string>;
  image_path: string | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface InventoryLevel {
  variant_id: string;
  quantity: number;
  avg_cost: number;
  min_stock: number;
  max_stock: number | null;
  location: string | null;
  updated_at: string;
}

export interface InventoryTransaction {
  id: string;
  variant_id: string;
  txn_type: InventoryTxnType;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  balance_after: number;
  avg_cost_after: number;
  reference_type: string | null;
  reference_id: string | null;
  reference_label: string | null;
  batch_lot: string | null;
  notes: string | null;
  occurred_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  tax_number: string | null;
  notes: string | null;
  is_active: boolean;
  is_demo: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  tax_number: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface Purchase {
  id: string;
  purchase_number: string;
  supplier_id: string | null;
  purchase_date: string;
  invoice_number: string | null;
  status: PurchaseStatus;
  subtotal: number;
  discount_amount: number;
  tax_total: number;
  other_charges: number;
  total: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  attachment_path: string | null;
  notes: string | null;
  received_at: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  variant_id: string;
  description: string;
  quantity: number;
  received_quantity: number;
  unit_price: number;
  discount_amount: number;
  order_discount_share: number;
  tax_rate: number;
  tax_amount: number;
  charges_share: number;
  line_total: number;
  landed_unit_cost: number;
  sort_order: number;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string | null;
  order_date: string;
  due_date: string | null;
  status: OrderStatus;
  subtotal: number;
  discount_amount: number;
  tax_total: number;
  shipping_charge: number;
  total: number;
  revenue_amount: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  preferred_payment_method: string | null;
  cogs_total: number;
  recognized_at: string | null;
  stock_deducted: boolean;
  stock_reversed: boolean;
  is_imported: boolean;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string;
  description: string;
  sku: string | null;
  track_inventory: boolean;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  order_discount_share: number;
  tax_rate: number;
  tax_amount: number;
  net_amount: number;
  line_total: number;
  unit_cost: number | null;
  cogs_amount: number;
  sort_order: number;
  mrp: number | null;
  offer_id: string | null;
  offer_label: string | null;
}

export interface Payment {
  id: string;
  direction: PaymentDirection;
  kind: PaymentKind;
  payment_date: string;
  amount: number;
  method: string;
  reference: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  order_id: string | null;
  purchase_id: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Expense {
  id: string;
  expense_date: string;
  category_id: string | null;
  description: string;
  amount: number;
  vendor: string | null;
  supplier_id: string | null;
  payment_method: string | null;
  reference: string | null;
  receipt_path: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface Recipe {
  id: string;
  variant_id: string;
  name: string;
  yield_quantity: number;
  notes: string | null;
  is_active: boolean;
  is_demo: boolean;
}

export interface RecipeItem {
  id: string;
  recipe_id: string;
  component_variant_id: string;
  quantity: number;
  wastage_pct: number;
  sort_order: number;
}

export interface ProductionBatch {
  id: string;
  batch_number: string;
  production_date: string;
  status: ProductionStatus;
  material_cost: number;
  wastage_cost: number;
  additional_cost: number;
  total_cost: number;
  completed_at: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
}

/** One product made in a batch (a batch can make several). */
export interface ProductionBatchOutput {
  id: string;
  batch_id: string;
  recipe_id: string | null;
  variant_id: string;
  planned_quantity: number;
  actual_quantity: number | null;
  material_cost: number;
  wastage_cost: number;
  additional_cost: number;
  total_cost: number;
  unit_cost: number | null;
  sort_order: number;
}

export interface ProductionConsumption {
  id: string;
  batch_id: string;
  output_id: string;
  component_variant_id: string;
  planned_quantity: number;
  used_quantity: number;
  wasted_quantity: number;
  unit_cost: number | null;
  total_cost: number;
  sort_order: number;
}

export interface Wastage {
  id: string;
  variant_id: string;
  quantity: number;
  wastage_date: string;
  reason: WastageReason;
  batch_id: string | null;
  unit_cost: number;
  total_cost: number;
  notes: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

/** Result shape every server action returns. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
