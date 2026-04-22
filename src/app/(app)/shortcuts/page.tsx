import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

const rows: { action: string; keys: string }[] = [
  { action: "Open command palette", keys: "⌘K or Ctrl+K" },
  { action: "Start / stop timer (global)", keys: "⌘⇧T or Ctrl+Shift+T" },
  { action: "Theme cycle (from palette)", keys: "Toggle theme action" },
  { action: "Search entities & run actions", keys: "⌘K, then type" },
];

export default function ShortcutsPage() {
  return (
    <>
      <PageHeader
        title="Keyboard shortcuts"
        description="Tallyhand is built for keyboard-first workflows. Use the command palette to discover pages and records quickly."
      />
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Shortcut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.action} className="border-b last:border-0">
                  <td className="px-4 py-3">{r.action}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {r.keys}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="mt-4 text-sm text-muted-foreground">
        Tip: press{" "}
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
          ⌘K
        </kbd>{" "}
        (or{" "}
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
          Ctrl+K
        </kbd>
        ) anywhere in the app, then choose{" "}
        <span className="font-medium text-foreground">Keyboard shortcuts</span>{" "}
        to return here.{" "}
        <Link href="/dashboard" className="underline underline-offset-4">
          Back to dashboard
        </Link>
      </p>
    </>
  );
}
