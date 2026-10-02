import {
  BarChart3,
  Boxes,
  CreditCard,
  Factory,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { BusinessSettings } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Module flag that must be on for this item to appear. */
  module?: keyof Pick<
    BusinessSettings,
    "module_inventory" | "module_purchases" | "module_suppliers" | "module_customers" | "module_production" | "module_expenses"
  >;
}

export const NAV_SECTIONS: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    title: "Sell",
    items: [
      { href: "/orders", label: "Orders & Sales", icon: Receipt },
      { href: "/customers", label: "Customers", icon: Users, module: "module_customers" },
      { href: "/payments", label: "Payments", icon: Wallet },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/catalog", label: "Products & Services", icon: Package },
      { href: "/inventory", label: "Inventory", icon: Boxes, module: "module_inventory" },
      { href: "/production", label: "Production", icon: Factory, module: "module_production" },
    ],
  },
  {
    title: "Buy & spend",
    items: [
      { href: "/purchases", label: "Purchases", icon: ShoppingCart, module: "module_purchases" },
      { href: "/suppliers", label: "Suppliers", icon: Truck, module: "module_suppliers" },
      { href: "/expenses", label: "Expenses", icon: CreditCard, module: "module_expenses" },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function visibleNav(settings: BusinessSettings) {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => !i.module || settings[i.module]) })).filter(
    (s) => s.items.length > 0,
  );
}
