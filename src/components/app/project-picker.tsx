"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { clientRepo, projectRepo } from "@/lib/db/repos";

export interface ProjectPickerProps {
  value: string | null;
  onChange: (projectId: string | null) => void;
  placeholder?: string;
  className?: string;
  allowClear?: boolean;
  triggerClassName?: string;
  size?: "default" | "sm";
}

export function ProjectPicker({
  value,
  onChange,
  placeholder = "Pick a project",
  className,
  allowClear = true,
  triggerClassName,
  size = "sm",
}: ProjectPickerProps) {
  const [open, setOpen] = React.useState(false);

  const clients = useLiveQuery(() => clientRepo.list(false), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);

  const clientsById = React.useMemo(() => {
    const map = new Map<string, (typeof clients extends undefined ? never : NonNullable<typeof clients>)[number]>();
    (clients ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  const byClient = React.useMemo(() => {
    const activeProjects = (projects ?? []).filter((p) => !p.archived);
    const map = new Map<
      string,
      { clientName: string; projects: typeof activeProjects }
    >();
    for (const p of activeProjects) {
      const client = clientsById.get(p.clientId);
      if (!client) continue;
      const bucket = map.get(p.clientId) ?? {
        clientName: client.name,
        projects: [],
      };
      bucket.projects.push(p);
      map.set(p.clientId, bucket);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.clientName.localeCompare(b.clientName),
    );
  }, [projects, clientsById]);

  const selected = (projects ?? []).find((p) => p.id === value);
  const selectedClient = selected ? clientsById.get(selected.clientId) : null;

  const nothingToPick = byClient.length === 0;

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={size}
            role="combobox"
            aria-expanded={open}
            className={cn(
              "justify-between",
              !selected && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="truncate">
              {selected
                ? `${selectedClient?.name ?? "—"} · ${selected.name}`
                : placeholder}
            </span>
            <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search projects…" />
            <CommandList>
              <CommandEmpty>
                {nothingToPick ? (
                  <div className="space-y-2 px-2 py-4 text-sm">
                    <p className="text-muted-foreground">
                      No active projects yet.
                    </p>
                    <Button asChild size="sm" className="w-full">
                      <Link
                        href="/clients/new"
                        onClick={() => setOpen(false)}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Create a client
                      </Link>
                    </Button>
                  </div>
                ) : (
                  "No matches."
                )}
              </CommandEmpty>
              {allowClear && value != null && (
                <>
                  <CommandGroup>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => {
                        onChange(null);
                        setOpen(false);
                      }}
                    >
                      <span className="text-muted-foreground">
                        Clear selection
                      </span>
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              {byClient.map((bucket) => (
                <CommandGroup
                  key={bucket.clientName}
                  heading={bucket.clientName}
                >
                  {bucket.projects.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${bucket.clientName} ${p.name}`}
                      onSelect={() => {
                        onChange(p.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4",
                          value === p.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {p.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
