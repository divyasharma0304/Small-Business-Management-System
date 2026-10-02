"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGE_PRESETS } from "@/lib/dates";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Search box + filter dropdowns + optional date range, all stored in the URL so
 * lists are shareable, bookmarkable and rendered on the server.
 */
export function ListToolbar({
  searchPlaceholder = "Search…",
  filters = [],
  dateFilter = false,
  children,
}: {
  searchPlaceholder?: string;
  filters?: FilterDef[];
  dateFilter?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Debounced search
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => push({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const range = params.get("range") ?? "all";
  const active = filters.some((f) => params.get(f.key)) || params.get("q") || params.get("range");

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-8"
          aria-label="Search"
        />
        {pending && <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {filters.map((f) => (
        <Select key={f.key} value={params.get(f.key) ?? "all"} onValueChange={(v) => push({ [f.key]: v })}>
          <SelectTrigger className="w-full sm:w-44" aria-label={f.label}>
            <SelectValue placeholder={f.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {f.label.toLowerCase()}</SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {dateFilter && (
        <>
          <Select value={range} onValueChange={(v) => push({ range: v, ...(v !== "custom" ? { from: null, to: null } : {}) })}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Date range">
              <SelectValue placeholder="Any date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any date</SelectItem>
              {RANGE_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {range === "custom" && (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From" className="w-auto" defaultValue={params.get("from") ?? ""} onChange={(e) => push({ from: e.target.value, range: "custom" })} />
              <span className="text-muted-foreground">–</span>
              <Input type="date" aria-label="To" className="w-auto" defaultValue={params.get("to") ?? ""} onChange={(e) => push({ to: e.target.value, range: "custom" })} />
            </div>
          )}
        </>
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X /> Clear
        </Button>
      )}
      {children && <div className="flex items-center gap-2 sm:ml-auto">{children}</div>}
    </div>
  );
}
