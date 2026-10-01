"use client";
import Link from "next/link";
import Image from "next/image";
import { ChevronDown, Settings, KeyRound, Keyboard, LogOut, Cloud, HardDrive } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export function UserPill({ name, email, imageUrl, cloud, onSignOut }: {
  name: string; email?: string; imageUrl?: string; cloud: boolean; onSignOut?: () => void;
}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={`Account menu for ${name}`} className="flex w-full items-center gap-3 rounded-full border bg-background px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
          {imageUrl ? <Image src={imageUrl} alt="" width={32} height={32} unoptimized /> : initials}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</span>
        <ChevronDown className="mr-1 h-4 w-4 shrink-0" strokeWidth={1.7} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={10} className="w-56">
      <DropdownMenuLabel className="min-w-0"><div className="truncate">{name}</div>{email && <div className="truncate text-xs font-normal text-muted-foreground">{email}</div>}</DropdownMenuLabel>
      <div className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground">{cloud ? <Cloud className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}{cloud ? "Cloud workspace" : "Stored in this browser"}</div>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><Link href="/settings"><Settings className="mr-2 h-4 w-4" />Account & settings</Link></DropdownMenuItem>
      {cloud && <DropdownMenuItem asChild><Link href="/settings/connect"><KeyRound className="mr-2 h-4 w-4" />API keys & connections</Link></DropdownMenuItem>}
      <DropdownMenuItem asChild><Link href="/shortcuts"><Keyboard className="mr-2 h-4 w-4" />Keyboard shortcuts</Link></DropdownMenuItem>
      {onSignOut && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onSignOut}><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
