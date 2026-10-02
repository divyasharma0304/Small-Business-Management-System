import { z } from "zod";

/** Optional free text: trims, turns "" into null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalEmail = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address");

export const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[+\d][\d\s\-()]{5,}$/.test(v), "Enter a valid phone number");

const toNumber = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : Number(v));

export const money = (label = "Amount") =>
  z.preprocess(
    toNumber,
    z
      .number({ error: `${label} must be a number` })
      .finite()
      .min(0, `${label} cannot be negative`)
      .max(1_000_000_000, `${label} is too large`),
  );

export const positiveMoney = (label = "Amount") =>
  z.preprocess(toNumber, z.number({ error: `${label} is required` }).finite().gt(0, `${label} must be greater than zero`).max(1_000_000_000));

export const quantity = (label = "Quantity") =>
  z.preprocess(toNumber, z.number({ error: `${label} is required` }).finite().gt(0, `${label} must be greater than zero`).max(1_000_000_000));

export const nonNegativeQty = (label = "Quantity") =>
  z.preprocess(toNumber, z.number({ error: `${label} must be a number` }).finite().min(0, `${label} cannot be negative`).max(1_000_000_000));

export const optionalNonNegative = (label = "Value") =>
  z.preprocess(toNumber, z.number({ error: `${label} must be a number` }).finite().min(0, `${label} cannot be negative`).optional().nullable());

export const percent = (label = "Percentage") =>
  z.preprocess(toNumber, z.number({ error: `${label} must be a number` }).min(0, `${label} cannot be negative`).max(100, `${label} cannot exceed 100`));

export const isoDate = (label = "Date") =>
  z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is invalid`);

export const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date");

export const uuid = z.uuid({ error: "Invalid reference" });
export const optionalUuid = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v && v !== "none" ? v : null))
  .refine((v) => v === null || z.uuid().safeParse(v).success, "Invalid reference");

export const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === 1, z.boolean());
