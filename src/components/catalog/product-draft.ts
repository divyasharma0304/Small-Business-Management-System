import type { CostMethod, ItemType } from "@/lib/types";

/** Form state for the product editor (shared by server pages and the client form). */
export interface VariantDraft {
  key: string;
  id: string | null;
  name: string;
  sku: string;
  selling_price: string;
  mrp: string;
  cost_price: string;
  attributes: Record<string, string>;
  image_path: string | null;
  is_active: boolean;
  min_stock: string;
  max_stock: string;
  location: string;
  opening_stock: string;
  opening_unit_cost: string;
  hasHistory: boolean;
  currentStock: number | null;
}

export interface ProductDraft {
  id: string | null;
  item_type: ItemType;
  name: string;
  category_id: string | null;
  description: string;
  unit: string;
  tax_rate: string;
  track_inventory: boolean;
  has_variants: boolean;
  cost_method: CostMethod;
  brand: string;
  attributes: Record<string, string>;
  image_path: string | null;
  notes: string;
  is_active: boolean;
  variants: VariantDraft[];
  components: { key: string; label: string; amount: string }[];
}

export function emptyVariant(defaults?: Partial<VariantDraft>): VariantDraft {
  return {
    key: crypto.randomUUID(),
    id: null,
    name: "",
    sku: "",
    selling_price: "",
    mrp: "",
    cost_price: "",
    attributes: {},
    image_path: null,
    is_active: true,
    min_stock: "",
    max_stock: "",
    location: "",
    opening_stock: "",
    opening_unit_cost: "",
    hasHistory: false,
    currentStock: null,
    ...defaults,
  };
}

