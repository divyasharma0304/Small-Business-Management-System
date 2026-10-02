import { resolveRange } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import type { ReportParams } from "./types";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uuidOr = (v?: string) => (v && (v === "none" || /^[0-9a-f-]{36}$/i.test(v)) ? v : undefined);
const word = (v?: string) => (v && /^[a-z_]{1,30}$/.test(v) ? v : undefined);

export function parseReportParams(sp: SearchParams, timeZone: string) {
  const range = resolveRange({ range: one(sp.range), from: one(sp.from), to: one(sp.to) }, timeZone);
  const params: ReportParams = {
    from: range.from,
    to: range.to,
    category: uuidOr(one(sp.category)),
    product: uuidOr(one(sp.product)),
    customer: uuidOr(one(sp.customer)),
    supplier: uuidOr(one(sp.supplier)),
    expenseCategory: uuidOr(one(sp.expense_category)),
    status: word(one(sp.status)),
    payment: word(one(sp.payment)),
    direction: one(sp.direction) === "in" || one(sp.direction) === "out" ? one(sp.direction) : undefined,
  };
  return { range, params };
}

/** Re-serialise the current filters (for export/print links). */
export function queryString(sp: SearchParams, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) q.set(k, v);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}
