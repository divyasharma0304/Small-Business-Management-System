/** Locale used for number/date formatting, derived from the business country. */
export function localeFor(country?: string | null) {
  switch ((country ?? "").toLowerCase()) {
    case "india":
      return "en-IN";
    case "united states":
    case "usa":
      return "en-US";
    case "united kingdom":
    case "uk":
      return "en-GB";
    default:
      return "en-IN";
  }
}

export function formatMoney(amount: number | null | undefined, currency = "INR", locale = "en-IN") {
  const value = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Compact money for chart axes and KPI cards, e.g. ₹1.2L / ₹3.4K. */
export function formatMoneyCompact(amount: number, currency = "INR", locale = "en-IN") {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatMoney(amount, currency, locale);
  }
}

export function currencySymbol(currency = "INR", locale = "en-IN") {
  try {
    return (
      new Intl.NumberFormat(locale, { style: "currency", currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

export function formatQty(q: number | null | undefined, unit?: string | null) {
  const n = Number(q ?? 0);
  const s = n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return unit ? `${s} ${unit}` : s;
}

export function formatPct(p: number | null | undefined) {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  return `${Number(p).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
}

/** Formats a plain calendar date ('YYYY-MM-DD') without timezone shifting. */
export function formatDate(date: string | null | undefined) {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Formats an instant in the business timezone. */
export function formatDateTime(ts: string | null | undefined, timeZone = "Asia/Kolkata") {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
