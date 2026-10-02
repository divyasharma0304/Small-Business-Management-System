import { z } from "zod";
import { bool, optionalEmail, optionalPhone, optionalText, percent, requiredText } from "./common";

export const BUSINESS_TYPES = [
  { value: "retail", label: "Retail" },
  { value: "wholesale", label: "Wholesale" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "handmade", label: "Handmade products" },
  { value: "food", label: "Food & beverage" },
  { value: "services", label: "Services" },
  { value: "reselling", label: "Reselling" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "other", label: "Other" },
] as const;

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "NPR", "LKR", "BDT"] as const;

export const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Colombo", "Asia/Dhaka",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Australia/Sydney", "UTC",
] as const;

export const businessProfileSchema = z.object({
  name: requiredText("Business name"),
  business_type: z.enum(BUSINESS_TYPES.map((t) => t.value) as [string, ...string[]]).default("other"),
  description: optionalText(1000),
  owner_name: optionalText(200),
  email: optionalEmail,
  phone: optionalPhone,
  address: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  postal_code: optionalText(20),
  country: requiredText("Country", 100),
  currency: z.string().trim().toUpperCase().length(3, "Use a 3-letter currency code"),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  tax_enabled: bool,
  tax_label: z.string().trim().max(20).default("GST"),
  tax_number: optionalText(50),
  default_tax_rate: percent("Default tax rate"),
  prices_include_tax: bool,
  purchase_tax_recoverable: bool,
  default_unit: z.string().trim().min(1).max(20).default("pcs"),
});

export const modulesSchema = z.object({
  inventory: bool,
  purchases: bool,
  suppliers: bool,
  customers: bool,
  production: bool,
  expenses: bool,
  variants: bool,
});

export const setupSchema = businessProfileSchema.extend({ modules: modulesSchema });

export type BusinessProfileInput = z.input<typeof businessProfileSchema>;
export type SetupInput = z.input<typeof setupSchema>;
