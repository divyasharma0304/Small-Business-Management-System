import { CurrencyProvider } from "@/components/money";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireContext } from "@/lib/context";
import { localeFor } from "@/lib/format";
import { signedUrl } from "@/lib/storage";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireContext();

  const [logoUrl, lowStock] = await Promise.all([
    signedUrl(ctx.supabase, ctx.business.logo_path),
    ctx.settings.module_inventory
      ? ctx.supabase
          .from("inventory_overview")
          .select("variant_id", { count: "exact", head: true })
          .eq("is_low", true)
          .eq("is_active", true)
          .then(({ count }) => count ?? 0)
      : Promise.resolve(0),
  ]);

  const brand = { name: ctx.business.name, logoUrl };
  const badges: Record<string, number> = lowStock ? { "/inventory": lowStock } : {};

  return (
    <div className="flex min-h-svh">
      <Sidebar settings={ctx.settings} brand={brand} badges={badges} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-6">
          <MobileNav settings={ctx.settings} brand={brand} badges={badges} />
          <span className="truncate font-medium lg:hidden">{ctx.business.name}</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu email={ctx.email} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-6 sm:py-6">
          <CurrencyProvider currency={ctx.business.currency} locale={localeFor(ctx.business.country)}>
            {children}
          </CurrencyProvider>
        </main>
      </div>
    </div>
  );
}
