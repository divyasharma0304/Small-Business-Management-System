import { CurrencyProvider } from "@/components/money";
import { PrintToolbar } from "@/components/print-toolbar";
import { requireContext } from "@/lib/context";
import { localeFor } from "@/lib/format";

/** Minimal, light, paper-friendly layout for printing or "Save as PDF". */
export default async function PrintLayout({ children }: LayoutProps<"/print">) {
  const ctx = await requireContext();
  return (
    <div className="light min-h-svh bg-white text-neutral-900 [color-scheme:light]">
      <PrintToolbar />
      <div className="mx-auto max-w-4xl px-6 py-8 print:max-w-none print:p-0">
        <CurrencyProvider currency={ctx.business.currency} locale={localeFor(ctx.business.country)}>{children}</CurrencyProvider>
      </div>
    </div>
  );
}
