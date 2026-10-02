"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { BusinessSettings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { visibleNav } from "./nav";

interface Brand {
  name: string;
  logoUrl: string | null;
}

function NavList({ settings, badges, onNavigate }: { settings: BusinessSettings; badges: Record<string, number>; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Main">
      {visibleNav(settings).map((section, i) => (
        <div key={section.title ?? i} className="grid gap-0.5">
          {section.title && (
            <p className="px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{section.title}</p>
          )}
          {section.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badge = badges[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-foreground")} />
                <span className="flex-1 truncate">{item.label}</span>
                {badge ? (
                  <span className="rounded-full bg-warning px-1.5 text-[11px] font-medium text-warning-foreground tabular">{badge}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function BrandBlock({ brand }: { brand: Brand }) {
  return (
    <Link href="/dashboard" className="flex h-14 items-center gap-2.5 border-b px-4">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
        <img src={brand.logoUrl} alt="" className="size-7 rounded-md object-cover" />
      ) : (
        <LogoMark />
      )}
      <span className="truncate font-semibold tracking-tight">{brand.name}</span>
    </Link>
  );
}

export function Sidebar({ settings, brand, badges }: { settings: BusinessSettings; brand: Brand; badges: Record<string, number> }) {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <BrandBlock brand={brand} />
      <div className="flex-1 overflow-y-auto">
        <NavList settings={settings} badges={badges} />
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">Velqora</p>
    </aside>
  );
}

export function MobileNav({ settings, brand, badges }: { settings: BusinessSettings; brand: Brand; badges: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <BrandBlock brand={brand} />
        <div className="overflow-y-auto">
          <NavList settings={settings} badges={badges} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
