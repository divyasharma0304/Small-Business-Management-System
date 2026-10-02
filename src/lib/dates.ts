/**
 * Calendar-date helpers. Business dates (order_date, expense_date, …) are plain
 * 'YYYY-MM-DD' strings interpreted in the business's timezone, so "today" must be
 * computed in that timezone — not the server's and not UTC.
 */

export function todayIn(timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

function parse(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: string, n: number) {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}
export function daysBetween(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

export const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_year", label: "This year" },
  { value: "custom", label: "Custom range" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export interface DateRange {
  preset: RangePreset;
  from: string;
  to: string;
  label: string;
  bucket: "day" | "week" | "month";
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Resolve ?range=…&from=…&to=… into a concrete date range. Default: this month. */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  timeZone: string,
  fallback: RangePreset = "this_month",
): DateRange {
  const today = todayIn(timeZone);
  const t = parse(today);
  const preset = (RANGE_PRESETS.some((p) => p.value === params.range) ? params.range : fallback) as RangePreset;
  let from = today;
  let to = today;

  switch (preset) {
    case "yesterday":
      from = to = addDays(today, -1);
      break;
    case "this_week": {
      const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
      from = addDays(today, -dow);
      break;
    }
    case "this_month":
      from = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
      break;
    case "last_month":
      from = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)));
      to = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)));
      break;
    case "last_30":
      from = addDays(today, -29);
      break;
    case "this_year":
      from = `${t.getUTCFullYear()}-01-01`;
      break;
    case "custom":
      from = isDate(params.from) ? params.from : addDays(today, -29);
      to = isDate(params.to) ? params.to : today;
      if (from > to) [from, to] = [to, from];
      break;
  }

  const span = daysBetween(from, to);
  const bucket = span > 120 ? "month" : span > 45 ? "week" : "day";
  const label = RANGE_PRESETS.find((p) => p.value === preset)!.label;
  return { preset, from, to, label, bucket };
}

/** UTC offset of a timezone on a given date, e.g. "+05:30". */
export function tzOffset(date: string, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+00:00";
}

/** Timestamp of local midnight at the start of `date` in the business timezone. */
export function startOfDay(date: string, timeZone: string) {
  return `${date}T00:00:00${tzOffset(date, timeZone)}`;
}
