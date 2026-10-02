import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE, type SearchParams } from "@/lib/list-params";

function hrefFor(pathname: string, sp: SearchParams, page: number) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "page") p.set(k, v);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `${pathname}?${s}` : pathname;
}

export function Pagination({ pathname, searchParams, page, total }: {
  pathname: string;
  searchParams: SearchParams;
  page: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-sm text-muted-foreground">
      <span className="tabular">{total === 0 ? "No results" : `${start}–${end} of ${total}`}</span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
            {page > 1 ? <Link href={hrefFor(pathname, searchParams, page - 1)} aria-label="Previous page"><ChevronLeft /></Link> : <span><ChevronLeft /></span>}
          </Button>
          <span className="px-2 tabular">{page} / {pages}</span>
          <Button variant="outline" size="sm" asChild={page < pages} disabled={page >= pages}>
            {page < pages ? <Link href={hrefFor(pathname, searchParams, page + 1)} aria-label="Next page"><ChevronRight /></Link> : <span><ChevronRight /></span>}
          </Button>
        </div>
      )}
    </div>
  );
}
