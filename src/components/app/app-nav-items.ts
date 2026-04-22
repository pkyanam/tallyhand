import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ListChecks,
  Users,
  FileText,
  Wallet,
  Settings,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ledger", label: "Ledger", icon: ListChecks },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];
