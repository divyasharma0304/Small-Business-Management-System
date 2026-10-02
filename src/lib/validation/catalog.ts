import { z } from "zod";
import { bool, money, optionalNonNegative, optionalText, optionalUuid, percent, requiredText } from "./common";

const attributes = z
  .record(z.string().trim().min(1).max(60), z.string().trim().max(200))
  .default({})
  .transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "")));

export const variantSchema = z
  .object({
    id: optionalUuid,
    name: z.string().trim().max(200).default(""),
    sku: optionalText(64),
    selling_price: money("Selling price"),
    cost_price: money("Cost"),
    attributes,
    image_path: optionalText(500),
    is_active: bool.default(true),
    min_stock: optionalNonNegative("Minimum stock"),
    max_stock: optionalNonNegative("Maximum stock"),
    location: optionalText(100),
    opening_stock: optionalNonNegative("Opening stock"),
    opening_unit_cost: optionalNonNegative("Opening unit cost"),
  })
  .refine((v) => v.max_stock == null || v.min_stock == null || v.max_stock >= v.min_stock, {
    message: "Maximum stock must be at least the minimum",
    path: ["max_stock"],
  });

export const productSchema = z
  .object({
    id: optionalUuid,
    item_type: z.enum(["product", "service", "material"]),
    name: requiredText("Name"),
    category_id: optionalUuid,
    description: optionalText(2000),
    unit: z.string().trim().min(1, "Unit is required").max(20),
    tax_rate: percent("Tax rate"),
    track_inventory: bool,
    has_variants: bool,
    cost_method: z.enum(["manual", "components", "recipe"]),
    brand: optionalText(100),
    attributes,
    image_path: optionalText(500),
    notes: optionalText(2000),
    is_active: bool.default(true),
    variants: z.array(variantSchema).min(1, "Add at least one variant").max(200),
    components: z
      .array(z.object({ label: requiredText("Cost label", 100), amount: money("Cost amount") }))
      .max(50)
      .default([]),
  })
  .superRefine((p, ctx) => {
    if (p.has_variants) {
      p.variants.forEach((v, i) => {
        if (!v.name) ctx.addIssue({ code: "custom", message: "Variant name is required", path: ["variants", i, "name"] });
      });
      const names = p.variants.map((v) => v.name.toLowerCase());
      if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Variant names must be unique", path: ["variants"] });
    } else if (p.variants.length !== 1) {
      ctx.addIssue({ code: "custom", message: "Turn on variants to add more than one", path: ["variants"] });
    }
    const skus = p.variants.map((v) => v.sku?.toLowerCase()).filter(Boolean);
    if (new Set(skus).size !== skus.length) ctx.addIssue({ code: "custom", message: "Each SKU must be unique", path: ["variants"] });
  });

export type ProductInput = z.input<typeof productSchema>;
export type ProductParsed = z.output<typeof productSchema>;
