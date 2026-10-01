"use client";

import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEMS } from "@/components/app/app-nav-items";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import dynamic from "next/dynamic";
import type { TallyAuth } from "@/lib/mode";
import { UserPill } from "./user-pill";
import { settingsRepo } from "@/lib/db/repos";
import { useLiveQuery } from "@/lib/data/use-live-query";
const ClerkUserPill = dynamic(() => import("./clerk-user-pill").then(m => m.ClerkUserPill), { ssr: false });

export function Sidebar({ authMode = "none" }: { authMode?: TallyAuth }) {
  const pathname = usePathname();
  const settings = useLiveQuery(() => settingsRepo.read(), []);
  const { dataMode } = useAppChrome();

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[244px] shrink-0 border-r bg-background md:flex md:flex-col">
      <div className="flex h-16 shrink-0 items-center px-7">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark className="-ml-2" />
          <span className="font-display text-[23px] font-semibold tracking-tight">
            Tallyhand
          </span>
        </Link>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-5 py-4">
        {APP_NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <Link href="/docs" className="mx-8 mb-3 text-xs text-muted-foreground underline underline-offset-4">Help & setup</Link>
      <div className="mx-5 shrink-0 border-t py-3">
        {dataMode === "cloud" && authMode === "clerk" ? <ClerkUserPill /> : <UserPill name={settings?.business.ownerName || settings?.business.name || (dataMode === "cloud" ? "My workspace" : "Local workspace")} cloud={dataMode === "cloud"} />}
      </div>
    </aside>
  );
}
