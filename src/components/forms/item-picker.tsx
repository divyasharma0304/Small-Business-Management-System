"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface PickerItem {
  variant_id: string;
  item_name: string;
  sku: string | null;
  item_type: string;
  unit: string;
  tax_rate: number;
  track_inventory: boolean;
  selling_price: number;
  cost_price: number;
  stock_quantity: number | null;
  avg_cost: number | null;
  /** Highest of standard cost, average cost and highest price ever paid — used for estimates. */
  highest_cost: number | null;
}

/** Searchable item selector (name or SKU) showing stock where tracked. */
export function ItemPicker({
  items,
  value,
  onChange,
  placeholder = "Choose item…",
  id,
  invalid,
}: {
  items: PickerItem[];
  value: string | null;
  onChange: (item: PickerItem) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.variant_id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.item_name ?? placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command filter={(v, search) => (v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search name or SKU…" />
          <CommandList>
            <CommandEmpty>No matching items.</CommandEmpty>
            <CommandGroup>
              {items.map((i) => (
                <CommandItem
                  key={i.variant_id}
                  value={`${i.item_name} ${i.sku ?? ""} ${i.variant_id}`}
                  onSelect={() => {
                    onChange(i);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value === i.variant_id ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">
                    {i.item_name}
                    {i.sku && <span className="ml-1 text-xs text-muted-foreground">{i.sku}</span>}
                  </span>
                  {i.track_inventory && (
                    <span className={cn("text-xs tabular", Number(i.stock_quantity ?? 0) <= 0 ? "text-destructive" : "text-muted-foreground")}>
                      {formatQty(i.stock_quantity ?? 0, i.unit)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
