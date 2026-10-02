"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FilterControl {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/** Dropdown filters that write to the URL; the server re-renders the report. */
export function ReportFilters({ controls }: { controls: FilterControl[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  return (
    <>
      {controls.map((c) => (
        <Select
          key={c.key}
          value={params.get(c.key) ?? "all"}
          onValueChange={(v) => {
            const next = new URLSearchParams(params.toString());
            if (v === "all") next.delete(c.key);
            else next.set(c.key, v);
            startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
          }}
        >
          <SelectTrigger className="w-44" aria-label={c.label}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {c.label.toLowerCase()}</SelectItem>
            {c.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ))}
    </>
  );
}
