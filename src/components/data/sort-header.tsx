import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { SearchParams } from "@/lib/list-params";
import { cn } from "@/lib/utils";

/** Column header that toggles ?sort=&dir= in the URL. */
export function SortHeader({
  column,
  label,
  pathname,
  searchParams,
  current,
  dir,
  className,
  align = "left",
}: {
  column: string;
  label: string;
  pathname: string;
  searchParams: SearchParams;
  current: string;
  dir: "asc" | "desc";
  className?: string;
  align?: "left" | "right";
}) {
  const active = current === column;
  const nextDir = active && dir === "desc" ? "asc" : "desc";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "page") p.set(k, v);
  p.set("sort", column);
  p.set("dir", nextDir);
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link
        href={`${pathname}?${p.toString()}`}
        scroll={false}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", align === "right" && "flex-row-reverse", active && "text-foreground")}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-40")} />
      </Link>
    </TableHead>
  );
}
