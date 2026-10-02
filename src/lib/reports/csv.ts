import type { ReportResult } from "./types";

function cell(v: unknown) {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
  // Neutralise spreadsheet formula injection for text cells
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV with a UTF-8 byte-order mark so Excel opens it with the right encoding
 * (₹ and other symbols intact). Numbers are plain (no currency symbols) so they
 * stay numeric in spreadsheets.
 */
export function toCsv(report: ReportResult) {
  const cols = report.columns;
  const lines = [cols.map((c) => cell(c.label)).join(",")];
  for (const r of report.rows) lines.push(cols.map((c) => cell(r[c.key])).join(","));
  if (cols.some((c) => c.total)) {
    lines.push(cols.map((c, i) => (i === 0 ? "Total" : c.total ? cell(report.rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0)) : "")).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
