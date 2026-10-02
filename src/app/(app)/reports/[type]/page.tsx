import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileSpreadsheet, Printer } from "lucide-react";
import { RangePicker } from "@/components/data/range-picker";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/context";
import { formatDate, formatMoney, formatPct, localeFor } from "@/lib/format";
import { getReport } from "@/lib/reports/definitions";
import { filterControls } from "@/lib/reports/filter-options";
import { parseReportParams, queryString } from "@/lib/reports/params";

export async function generateMetadata({ params }: PageProps<"/reports/[type]">): Promise<Metadata> {
  const { type } = await params;
  return { title: getReport(type)?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[type]">) {
  const { type } = await params;
  const sp = await searchParams;
  const def = getReport(type);
  if (!def) notFound();
  const ctx = await requireContext();
  if (def.module && !ctx.settings[def.module]) notFound();

  const { range, params: p } = parseReportParams(sp, ctx.business.timezone);
  const [report, controls] = await Promise.all([def.load(ctx, p), filterControls(ctx, def.filters)]);
  const qs = queryString(sp);
  const fmt = (v: number, t: "money" | "number" | "pct") =>
    t === "money" ? formatMoney(v, ctx.business.currency, localeFor(ctx.business.country)) : t === "pct" ? formatPct(v) : v.toLocaleString("en-IN");

  return (
    <>
      <PageHeader
        title={def.title}
        description={def.filters.includes("range") ? `${formatDate(range.from)} – ${formatDate(range.to)}` : "Current snapshot"}
        back={{ href: "/reports", label: "Reports" }}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/reports/${def.key}?${qs}`} download><FileSpreadsheet /> CSV / Excel</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/print/report/${def.key}?${qs}`} target="_blank" rel="noreferrer"><Printer /> Print / PDF</a>
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {def.filters.includes("range") && <RangePicker value={range.preset} from={range.from} to={range.to} />}
        <ReportFilters controls={controls} />
      </div>
      {report.summary.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {report.summary.map((s) => (
            <StatCard key={s.label} label={s.label} value={fmt(s.value, s.type)} tone={s.emphasis ? (s.type === "money" && s.value < 0 ? "danger" : "default") : "default"} />
          ))}
        </div>
      )}
      {report.note && <p className="mb-4 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{report.note}</p>}
      {report.rows.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No data for these filters" description="Try a wider date range or clear some filters." />
      ) : (
        <ReportTable report={report} />
      )}
    </>
  );
}
