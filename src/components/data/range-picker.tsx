"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGE_PRESETS } from "@/lib/dates";

/** Date range selector stored in the URL (?range=…&from=…&to=…). */
export function RangePicker({ value, from, to }: { value: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <CalendarRange className="size-4 text-muted-foreground" />}
      <Select value={value} onValueChange={(v) => push({ range: v, from: v === "custom" ? from : null, to: v === "custom" ? to : null })}>
        <SelectTrigger className="w-40" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === "custom" && (
        <>
          <Input type="date" aria-label="From" className="w-auto" defaultValue={from} onChange={(e) => e.target.value && push({ range: "custom", from: e.target.value, to })} />
          <span className="text-muted-foreground">–</span>
          <Input type="date" aria-label="To" className="w-auto" defaultValue={to} onChange={(e) => e.target.value && push({ range: "custom", from, to: e.target.value })} />
        </>
      )}
    </div>
  );
}
