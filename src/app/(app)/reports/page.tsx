import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireContext } from "@/lib/context";
import { REPORTS } from "@/lib/reports/definitions";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireContext();
  const available = REPORTS.filter((r) => !r.module || ctx.settings[r.module]);
  return (
    <>
      <PageHeader title="Reports" description="Every figure comes from your recorded transactions. Export to CSV/Excel or print to PDF." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {available.map((r) => (
          <Link key={r.key} href={`/reports/${r.key}`} className="group flex flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-primary" />
              <span className="font-medium">{r.title}</span>
              <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="text-sm text-muted-foreground">{r.description}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
