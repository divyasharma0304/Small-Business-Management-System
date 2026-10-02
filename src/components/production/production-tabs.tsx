import Link from "next/link";
import { cn } from "@/lib/utils";

export function ProductionTabs({ active }: { active: "batches" | "recipes" }) {
  const tabs = [
    { key: "batches", href: "/production", label: "Batches" },
    { key: "recipes", href: "/production/recipes", label: "Recipes (BOM)" },
  ];
  return (
    <nav className="mb-4 flex gap-1 border-b" aria-label="Production sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            active === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
