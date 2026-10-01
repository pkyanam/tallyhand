import type { LucideIcon } from "lucide-react";
import {
  Clock,
  Folder,
  ChartColumn,
  LayoutDashboard,
  FileClock,
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
  { href: "/timesheet", label: "Timesheet", icon: Clock },
  { href: "/ledger", label: "Ledger", icon: FileClock },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  { href: "/tax", label: "Tax", icon: Landmark },
  { href: "/settings", label: "Settings", icon: Settings },
];
