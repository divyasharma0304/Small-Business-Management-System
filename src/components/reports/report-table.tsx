import Link from "next/link";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatPct, formatQty } from "@/lib/format";
import type { ReportColumn, ReportResult } from "@/lib/reports/types";
import { cn } from "@/lib/utils";

function Value({ col, v }: { col: ReportColumn; v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  switch (col.type) {
    case "money": return <Money value={Number(v)} className={Number(v) < 0 ? "text-destructive" : ""} />;
    case "qty": return <span className="tabular">{formatQty(Number(v))}</span>;
    case "number": return <span className="tabular">{Number(v).toLocaleString("en-IN")}</span>;
    case "pct": return <span className="tabular">{formatPct(Number(v))}</span>;
    case "date": return <span className="whitespace-nowrap">{formatDate(String(v))}</span>;
    case "status": return <StatusBadge status={String(v)} label={v === "ok" ? "In stock" : v === "low" ? "Low stock" : v === "out" ? "Out of stock" : undefined} />;
    default: return <>{String(v)}</>;
  }
}

const numeric = (c: ReportColumn) => ["money", "qty", "number", "pct"].includes(c.type);

export function ReportTable({ report, print }: { report: ReportResult; print?: boolean }) {
  const hasTotals = report.columns.some((c) => c.total) && report.rows.length > 1;
  return (
    <div className={cn("overflow-x-auto rounded-xl border bg-card", print && "rounded-none border-0")}>
      <Table>
        <TableHeader>
          <TableRow>
            {report.columns.map((c) => (
              <TableHead key={c.key} className={cn(numeric(c) && "text-right", c.secondary && !print && "hidden md:table-cell")}>{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((r, i) => (
            <TableRow key={i} className={cn(!print && r._href && "relative")}>
              {report.columns.map((c, j) => (
                <TableCell key={c.key} className={cn(numeric(c) && "text-right", c.secondary && !print && "hidden md:table-cell")}>
                  {j === 0 && r._href && !print ? (
                    <Link href={r._href} className="font-medium hover:underline after:absolute after:inset-0"><Value col={c} v={r[c.key]} /></Link>
                  ) : (
                    <Value col={c} v={r[c.key]} />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {hasTotals && (
          <TableFooter>
            <TableRow>
              {report.columns.map((c, i) => (
                <TableCell key={c.key} className={cn("font-semibold", numeric(c) && "text-right", c.secondary && !print && "hidden md:table-cell")}>
                  {i === 0 ? "Total" : c.total ? <Value col={c} v={report.rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0)} /> : null}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
