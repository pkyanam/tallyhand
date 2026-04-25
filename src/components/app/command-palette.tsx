"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useTheme } from "next-themes";
import {
  Banknote,
  Clock,
  FileText,
  FolderKanban,
  Keyboard,
  LayoutList,
  Moon,
  Plus,
  Receipt,
  Sun,
  Users,
  Wand2,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { persistThemeChoice } from "@/components/app/settings-theme-sync";
import {
  clientRepo,
  invoiceRepo,
  projectRepo,
  taskRepo,
} from "@/lib/db/repos";
import { useTimerStore } from "@/lib/timer-store";
import { formatDuration } from "@/lib/utils";

function norm(s: string) {
  return s.toLowerCase().trim();
}

function matchesQuery(haystack: string, query: string): boolean {
  const h = norm(haystack);
  const q = norm(query);
  if (!q) return true;
  if (h.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < h.length && qi < q.length; i++) {
    if (h[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette() {
  const router = useRouter();
  const { commandOpen, setCommandOpen } = useAppChrome();
  const { resolvedTheme, setTheme, theme } = useTheme();
  const running = useTimerStore((s) => s.running);
  const projectId = useTimerStore((s) => s.projectId);
  const start = useTimerStore((s) => s.start);
  const stop = useTimerStore((s) => s.stop);

  const clients = useLiveQuery(() => clientRepo.list(true), []);
  const projects = useLiveQuery(() => projectRepo.list(), []);
  const tasks = useLiveQuery(() => taskRepo.list(), []);
  const invoices = useLiveQuery(() => invoiceRepo.list(), []);

  const [input, setInput] = React.useState("");
  const deferredInput = React.useDeferredValue(input);

  React.useEffect(() => {
    if (!commandOpen) setInput("");
  }, [commandOpen]);

  const activeProjects = React.useMemo(
    () => (projects ?? []).filter((p) => !p.archived),
    [projects],
  );

  const recentTasks = React.useMemo(() => {
    if (!tasks) return [];
    return [...tasks]
      .sort((a, b) => b.startAt - a.startAt)
      .slice(0, 50);
  }, [tasks]);

  const q = deferredInput;

  const filteredClients = React.useMemo(() => {
    if (!clients) return [];
    return clients.filter((c) => matchesQuery(c.name, q));
  }, [clients, q]);

  const filteredProjects = React.useMemo(() => {
    return activeProjects.filter((p) => {
      const c = clients?.find((x) => x.id === p.clientId);
      const blob = `${p.name} ${c?.name ?? ""}`;
      return matchesQuery(blob, q);
    });
  }, [activeProjects, clients, q]);

  const filteredTasks = React.useMemo(() => {
    return recentTasks.filter((t) => {
      const p = projects?.find((x) => x.id === t.projectId);
      const c = p ? clients?.find((x) => x.id === p.clientId) : null;
      const blob = `${t.name} ${p?.name ?? ""} ${c?.name ?? ""} ${t.tags.join(" ")}`;
      return matchesQuery(blob, q);
    });
  }, [recentTasks, projects, clients, q]);

  const filteredInvoices = React.useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => matchesQuery(inv.invoiceNumber, q));
  }, [invoices, q]);

  const close = () => setCommandOpen(false);

  const cycleTheme = () => {
    const next =
      theme === "dark" || resolvedTheme === "dark" ? "light" : "dark";
    setTheme(next);
    void persistThemeChoice(next);
  };

  const actionMatches = (label: string) => matchesQuery(label, q);

  return (
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search or run an action…"
          value={input}
          onValueChange={setInput}
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>

          <CommandGroup heading="Actions">
            {actionMatches("Start timer") && (
              <CommandItem
                disabled={running}
                onSelect={() => {
                  start(projectId);
                  close();
                }}
              >
                <Clock className="h-4 w-4" />
                Start timer
                <CommandShortcut>⌘⇧T</CommandShortcut>
              </CommandItem>
            )}
            {actionMatches("Stop timer") && (
              <CommandItem
                disabled={!running}
                onSelect={() => {
                  stop();
                  close();
                }}
              >
                <Clock className="h-4 w-4" />
                Stop timer
                <CommandShortcut>⌘⇧T</CommandShortcut>
              </CommandItem>
            )}
            {actionMatches("New client") && (
              <CommandItem
                onSelect={() => {
                  router.push("/clients/new");
                  close();
                }}
              >
                <Plus className="h-4 w-4" />
                New client
              </CommandItem>
            )}
            {actionMatches("New project") && (
              <CommandItem
                onSelect={() => {
                  router.push("/clients");
                  close();
                }}
              >
                <FolderKanban className="h-4 w-4" />
                New project
                <CommandShortcut>Clients</CommandShortcut>
              </CommandItem>
            )}
            {actionMatches("New invoice") && (
              <CommandItem
                onSelect={() => {
                  router.push("/invoices/new");
                  close();
                }}
              >
                <Receipt className="h-4 w-4" />
                New invoice
              </CommandItem>
            )}
            {actionMatches("New expense") && (
              <CommandItem
                onSelect={() => {
                  router.push("/expenses/new");
                  close();
                }}
              >
                <Banknote className="h-4 w-4" />
                New expense
              </CommandItem>
            )}
            {actionMatches("Open ledger") && (
              <CommandItem
                onSelect={() => {
                  router.push("/ledger");
                  close();
                }}
              >
                <LayoutList className="h-4 w-4" />
                Open ledger
              </CommandItem>
            )}
            {actionMatches("Toggle theme") && (
              <CommandItem
                onSelect={() => {
                  cycleTheme();
                  close();
                }}
              >
                {theme === "dark" || resolvedTheme === "dark" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
                Toggle theme
              </CommandItem>
            )}
            {actionMatches("Weekly Reckoning") && (
              <CommandItem
                onSelect={() => {
                  router.push("/reckoning");
                  close();
                }}
              >
                <Wand2 className="h-4 w-4" />
                Weekly Reckoning
              </CommandItem>
            )}
            {actionMatches("Keyboard shortcuts") && (
              <CommandItem
                onSelect={() => {
                  router.push("/shortcuts");
                  close();
                }}
              >
                <Keyboard className="h-4 w-4" />
                Keyboard shortcuts
                <CommandShortcut>⌘K</CommandShortcut>
              </CommandItem>
            )}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Clients">
            {filteredClients.slice(0, 20).map((c) => (
              <CommandItem
                key={c.id}
                value={c.id}
                onSelect={() => {
                  router.push(`/clients/${c.id}`);
                  close();
                }}
              >
                <Users className="h-4 w-4" />
                {c.name}
                {c.archived ? " (archived)" : ""}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Projects">
            {filteredProjects.slice(0, 25).map((p) => {
              const c = clients?.find((x) => x.id === p.clientId);
              return (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    if (c) router.push(`/clients/${c.id}`);
                    else router.push("/clients");
                    close();
                  }}
                >
                  <FolderKanban className="h-4 w-4" />
                  <span className="truncate">{p.name}</span>
                  <span className="truncate text-muted-foreground">
                    {c?.name ?? ""}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandGroup heading="Recent tasks">
            {filteredTasks.slice(0, 25).map((t) => {
              const p = projects?.find((x) => x.id === t.projectId);
              const c = p ? clients?.find((x) => x.id === p.clientId) : null;
              return (
                <CommandItem
                  key={t.id}
                  value={t.id}
                  onSelect={() => {
                    router.push("/ledger");
                    close();
                  }}
                >
                  <Clock className="h-4 w-4" />
                  <span className="truncate">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(t.durationMinutes)}
                    {c ? ` · ${c.name}` : ""}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandGroup heading="Invoices">
            {filteredInvoices.slice(0, 20).map((inv) => (
              <CommandItem
                key={inv.id}
                value={inv.id}
                onSelect={() => {
                  router.push("/invoices");
                  close();
                }}
              >
                <FileText className="h-4 w-4" />
                {inv.invoiceNumber}
                <span className="text-xs text-muted-foreground">
                  {inv.status}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
