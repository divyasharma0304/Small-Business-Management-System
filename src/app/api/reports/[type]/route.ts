import { NextResponse, type NextRequest } from "next/server";
import { requireContext } from "@/lib/context";
import { toCsv } from "@/lib/reports/csv";
import { getReport } from "@/lib/reports/definitions";
import { parseReportParams } from "@/lib/reports/params";

/** CSV export of any report (Excel-compatible: UTF-8 with BOM). */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/reports/[type]">) {
  const { type } = await params;
  const def = getReport(type);
  if (!def) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const ctx = await requireContext();
  if (def.module && !ctx.settings[def.module]) return NextResponse.json({ error: "Module disabled" }, { status: 404 });

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const { range, params: p } = parseReportParams(sp, ctx.business.timezone);
  try {
    const report = await def.load(ctx, p);
    const name = def.filters.includes("range") ? `${def.key}-${range.from}-to-${range.to}` : `${def.key}-${range.to}`;
    return new NextResponse(toCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not generate the report." }, { status: 500 });
  }
}
