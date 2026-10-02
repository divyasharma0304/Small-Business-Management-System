import { resolveRange, type DateRange } from "@/lib/dates";

export const PAGE_SIZE = 25;

export type SearchParams = Record<string, string | string[] | undefined>;

export interface ListParams {
  q: string;
  page: number;
  sort: string;
  dir: "asc" | "desc";
  from: number;
  to: number;
  get: (key: string) => string | undefined;
  range: DateRange | null;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Parses list-page query params. `sortable` whitelists sort columns so arbitrary
 * input never reaches the query builder.
 */
export function parseListParams(
  sp: SearchParams,
  opts: { sortable: string[]; defaultSort: string; defaultDir?: "asc" | "desc"; timeZone?: string },
): ListParams {
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);
  const sortRaw = one(sp.sort);
  const sort = sortRaw && opts.sortable.includes(sortRaw) ? sortRaw : opts.defaultSort;
  const dirRaw = one(sp.dir);
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : (opts.defaultDir ?? "desc");
  const rangeKey = one(sp.range);
  const range =
    rangeKey && opts.timeZone
      ? resolveRange({ range: rangeKey, from: one(sp.from), to: one(sp.to) }, opts.timeZone)
      : null;
  return {
    q: (one(sp.q) ?? "").trim().slice(0, 100),
    page,
    sort,
    dir,
    from: (page - 1) * PAGE_SIZE,
    to: page * PAGE_SIZE - 1,
    get: (k) => {
      const v = one(sp[k]);
      return v && v !== "all" ? v : undefined;
    },
    range,
  };
}

/** Escape user input for a PostgREST `ilike` inside an `or=(...)` filter. */
export function ilikeTerm(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()"]/g, " ")}%`;
}
