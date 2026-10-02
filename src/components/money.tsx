"use client";

import { createContext, useContext, type ReactNode } from "react";
import { currencySymbol, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CurrencyCtx {
  currency: string;
  locale: string;
}

const Ctx = createContext<CurrencyCtx>({ currency: "INR", locale: "en-IN" });

export function CurrencyProvider({ currency, locale, children }: CurrencyCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ currency, locale }}>{children}</Ctx.Provider>;
}

export function useCurrency() {
  const c = useContext(Ctx);
  return {
    ...c,
    symbol: currencySymbol(c.currency, c.locale),
    format: (n: number | null | undefined) => formatMoney(n, c.currency, c.locale),
  };
}

/** Formats an amount in the business currency. */
export function Money({ value, className, signed }: { value: number | null | undefined; className?: string; signed?: boolean }) {
  const { format } = useCurrency();
  const n = Number(value ?? 0);
  return (
    <span className={cn("tabular whitespace-nowrap", signed && n < 0 && "text-destructive", className)}>
      {signed && n > 0 ? "+" : ""}
      {format(n)}
    </span>
  );
}
