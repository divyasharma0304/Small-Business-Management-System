import { notFound } from "next/navigation";
import { ReportTable } from "@/components/reports/report-table";
import { requireContext } from "@/lib/context";
import { formatDate, formatDateTime, formatMoney, formatPct, localeFor } from "@/lib/format";
import { getReport } from "@/lib/reports/definitions";
import { parseReportParams } from "@/lib/reports/params";

export default async function PrintReportPage({ params, searchParams }: PageProps<"/print/report/[type]">) {
  const { type } = await params;
  const sp = await searchParams;
  const def = getReport(type);
  if (!def) notFound();
  const ctx = await requireContext();
  const { range, params: p } = parseReportParams(sp, ctx.business.timezone);
  const report = await def.load(ctx, p);
  const fmt = (v: number, t: string) => (t === "money" ? formatMoney(v, ctx.business.currency, localeFor(ctx.business.country)) : t === "pct" ? formatPct(v) : v.toLocaleString("en-IN"));

  return (
    <article className="text-sm">
      <header className="mb-6 flex items-start justify-between border-b pb-4">
        <div>
          <p className="text-xs tracking-wide text-neutral-500 uppercase">{ctx.business.name}</p>
          <h1 className="text-2xl font-semibold">{def.title}</h1>
          <p className="text-neutral-600">{def.filters.includes("range") ? `${formatDate(range.from)} – ${formatDate(range.to)}` : "Current snapshot"}</p>
        </div>
        <p className="text-right text-xs text-neutral-500">Generated {formatDateTime(new Date().toISOString(), ctx.business.timezone)}</p>
      </header>
      <dl className="mb-6 grid grid-cols-4 gap-4">
        {report.summary.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-neutral-500">{s.label}</dt>
            <dd className="text-lg font-semibold tabular">{fmt(s.value, s.type)}</dd>
          </div>
        ))}
      </dl>
      {report.note && <p className="mb-4 text-xs text-neutral-600">{report.note}</p>}
      {report.rows.length === 0 ? <p className="text-neutral-500">No data for these filters.</p> : <ReportTable report={report} print />}
    </article>
  );
}
