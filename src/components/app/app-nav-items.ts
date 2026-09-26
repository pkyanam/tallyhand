import type { LucideIcon } from "lucide-react";
import {
  CalendarRange,
  ChartColumn,
  LayoutDashboard,
  ListChecks,
  Users,
  FileText,
  Wallet,
  Landmark,
  Settings,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/timesheet", label: "Timesheet", icon: CalendarRange },
  { href: "/ledger", label: "Ledger", icon: ListChecks },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  { href: "/tax", label: "Tax", icon: Landmark },
  { href: "/settings", label: "Settings", icon: Settings },
];
