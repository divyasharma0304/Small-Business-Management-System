"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** Thin wrapper over the Radix select. Use value "none" for an empty choice. */
export function SimpleSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  disabled,
  allowNone,
  noneLabel = "None",
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <Select value={value ?? (allowNone ? "none" : undefined)} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn("w-full", className)} aria-invalid={ariaInvalid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="none">{noneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {o.hint && <span className="ml-1 text-xs text-muted-foreground">{o.hint}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
