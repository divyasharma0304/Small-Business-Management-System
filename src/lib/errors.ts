import type { ActionResult } from "@/lib/types";

interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Turns a Supabase/Postgres error into a message a business owner can act on.
 * Messages raised deliberately by our SQL functions (SQLSTATE P0001) are already
 * written for users and are passed through. Everything else is logged on the
 * server and replaced with a generic message — no stack traces reach the browser.
 */
export function friendlyDbError(error: DbErrorLike | null | undefined, context?: string): string {
  if (!error) return "Something went wrong. Please try again.";
  const msg = error.message ?? "";
  switch (error.code) {
    case "P0001":
      return msg;
    case "42501":
      return msg.includes("do not have access") ? msg : "You don't have permission to do that.";
    case "23505":
      if (/sku/i.test(msg) || /sku/i.test(error.details ?? "")) return "That SKU is already used by another item.";
      return "A record with the same name already exists.";
    case "23503":
      return "This record is linked to other records (orders, purchases, stock history…), so it can't be deleted. Deactivate it instead.";
    case "23514":
      return "Some values are outside the allowed range. Check amounts, quantities and percentages.";
    case "22P02":
    case "22007":
    case "22008":
      return "One of the values has an invalid format.";
    case "PGRST116":
      return "Record not found.";
  }
  console.error(`[db] ${context ?? "query"} failed`, error);
  return "Something went wrong while saving. Please try again.";
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

/** Flatten a Zod error into { field: message } for forms. */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
