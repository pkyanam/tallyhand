"use client";

import * as React from "react";
import { useLiveQuery } from "@/lib/data/use-live-query";
import { useTheme } from "next-themes";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ImageUp,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { TallyAuth } from "@/lib/mode";
import { PageHeader } from "@/components/app/page-header";

// Code-split: the @clerk/nextjs client bundle only loads for this card, and
// only when the deployment actually runs TALLY_AUTH=clerk.
const ClerkAccountCard = dynamic(
  () => import("./clerk-account-card").then((m) => m.ClerkAccountCard),
  { ssr: false },
);
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { dataModeCopy } from "@/components/app/data-mode-copy";
import {
  exportBundleExpensesCsv,
  exportBundleJsonString,
  exportBundleMarkdown,
  exportBundleTasksCsv,
  exportLedgerJsonString,
  importTallyhandBundleV1,
  resetAllLocalData,
} from "@/lib/app-bundle";
import { readCloudBackup, replaceCloudData } from "@/lib/cloud-backup-client";
import { validateCloudBackup, MAX_BACKUP_BYTES, BACKUP_TABLES } from "@/core/cloud-backup";
import { parseAndValidateBundle } from "@/lib/v1-import";
import { settingsRepo } from "@/lib/db/repos";
import { downloadText } from "@/lib/ledger-export";
import { formatInvoiceNumber } from "@/lib/invoice-helpers";
import { CURRENCIES } from "@/core/currencies";
import type { Settings, TaxRegion } from "@/lib/db/types";
import { DunningCard, StripeCard, StripeConnectCard, TaxCard } from "@/components/settings/dunning-tax-cards";

const MAX_LOGO_BYTES = 500 * 1024;

const DOW_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function SettingsContent({ authMode }: { authMode?: TallyAuth }) {
  const settings = useLiveQuery(() => settingsRepo.read(), []);
  const { dataMode, showNotice } = useAppChrome();
  const modeCopy = dataModeCopy(dataMode);
  const { setTheme } = useTheme();
  const [newCategory, setNewCategory] = React.useState("");
  const [dataBusy, setDataBusy] = React.useState(false);
  const dataLock = React.useRef(false);
  const importRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void settingsRepo.get().catch(() => { /* Live query surfaces the retry notice. */ });
  }, []);

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" />
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </>
    );
  }

  const updateBusiness = async (patch: Partial<Settings["business"]>) => {
    await settingsRepo.update({
      business: { ...settings.business, ...patch },
    });
  };

  const updateInvoice = async (patch: Partial<Settings["invoice"]>) => {
    await settingsRepo.update({
      invoice: { ...settings.invoice, ...patch },
    });
  };

  const updateReckoning = async (patch: Partial<Settings["reckoning"]>) => {
    await settingsRepo.update({
      reckoning: { ...settings.reckoning, ...patch },
    });
  };

  const updateAppearance = async (patch: Partial<Settings["appearance"]>) => {
    const next = { ...settings.appearance, ...patch };
    await settingsRepo.update({ appearance: next });
    setTheme(next.theme === "dark" ? "dark" : "light");
  };

  const moveCategory = async (index: number, dir: -1 | 1) => {
    const list = [...settings.expenseCategories];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const t = list[index];
    list[index] = list[j];
    list[j] = t;
    await settingsRepo.update({ expenseCategories: list });
  };

  const removeCategory = async (index: number) => {
    const list = settings.expenseCategories.filter((_, i) => i !== index);
    if (list.length === 0) {
      showNotice("Keep at least one category.");
      return;
    }
    await settingsRepo.update({ expenseCategories: list });
  };

  const addCategory = async () => {
    const v = newCategory.trim();
    if (!v) return;
    if (settings.expenseCategories.includes(v)) {
      showNotice("That category already exists.");
      return;
    }
    await settingsRepo.update({
      expenseCategories: [...settings.expenseCategories, v],
    });
    setNewCategory("");
  };

  const handleImport = async (file: File | null) => {
    if (!file || dataLock.current) return;
    dataLock.current = true; setDataBusy(true);
    try {
      if (dataMode === "cloud" && file.size > MAX_BACKUP_BYTES) throw new Error("Cloud import supports backups up to 4 MiB. Nothing was changed.");
      const { bundle, migratedFields } = parseAndValidateBundle(JSON.parse(await file.text()));
      if (dataMode === "cloud") {
        validateCloudBackup(bundle);
        const count = BACKUP_TABLES.reduce((n, key) => n + (bundle[key]?.length ?? 0), 0);
        const current = await readCloudBackup();
        const confirmation = window.prompt(`Import ${count} records into YOUR cloud account? This replaces its existing business data and settings and revokes existing shared links and approvals. Your sign-in and API keys remain. Your offline app is untouched. A backup of current cloud data will download first. Type REPLACE CLOUD DATA to continue.`);
        if (confirmation !== "REPLACE CLOUD DATA") return;
        downloadText(`tallyhand-before-import-${Date.now()}.json`, JSON.stringify(current.bundle, null, 2), "application/json");
        if (!window.confirm("Confirm your downloaded cloud backup is saved before replacing data. Cancel if the download was blocked.")) return;
        await replaceCloudData("import", current.revision, confirmation, bundle);
      } else {
        if (!window.confirm("Replace this browser's data with this backup? Export your current data first if you need to keep it.")) return;
        await importTallyhandBundleV1(bundle);
      }
      showNotice(`Import complete${migratedFields ? ` (${migratedFields} legacy fields defaulted)` : ""} — reloading.`);
      window.location.reload();
    } catch (e) { showNotice(e instanceof Error ? e.message : "Import failed."); }
    finally { dataLock.current = false; setDataBusy(false); if (importRef.current) importRef.current.value = ""; }
  };

  const handleReset = async () => {
    if (dataLock.current) return;
    dataLock.current = true; setDataBusy(true);
    try {
      if (dataMode === "cloud") {
        const current = await readCloudBackup();
        const confirmation = window.prompt("Delete YOUR cloud business data and reset settings? This revokes shared links and approvals, but keeps your sign-in and API keys. Your offline app is untouched. A backup will download first. Type RESET CLOUD DATA to continue.");
        if (confirmation !== "RESET CLOUD DATA") return;
        downloadText(`tallyhand-before-reset-${Date.now()}.json`, JSON.stringify(current.bundle, null, 2), "application/json");
        if (!window.confirm("Confirm your downloaded cloud backup is saved before deleting data. Cancel if the download was blocked.")) return;
        await replaceCloudData("reset", current.revision, confirmation);
      } else {
        if (!window.confirm(modeCopy.resetConfirmation)) return;
        if (window.prompt("This cannot be undone. Type RESET LOCAL DATA to confirm.") !== "RESET LOCAL DATA") return;
        await resetAllLocalData();
      }
      showNotice("Database cleared — reloading."); window.location.reload();
    } catch (e) { showNotice(e instanceof Error ? e.message : "Reset failed."); }
    finally { dataLock.current = false; setDataBusy(false); }
  };

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      showNotice(
        modeCopy.logoSizeWarning((file.size / 1024).toFixed(0)),
      );
    }
    const dataUrl = await readFileAsDataUrl(file);
    await updateInvoice({ logoB64: dataUrl });
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business, invoicing, Weekly Reckoning schedule, categories, appearance, and backups."
      />

      <div className="space-y-6">
        {authMode === "clerk" && <ClerkAccountCard />}
        {authMode === "builtin" && (
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>
                Signed in with email magic link. Manage the tokens your CLI,
                MCP clients, and scripts use to talk to Tallyhand.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/settings/connect">API tokens &amp; integrations</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
            <CardDescription>
              Appears at the top of every invoice you generate.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FieldInput
              label="Business name"
              defaultValue={settings.business.name}
              onCommit={(v) => updateBusiness({ name: v })}
              placeholder="Acme Design Studio"
            />
            <FieldInput
              label="Owner / contact name"
              defaultValue={settings.business.ownerName}
              onCommit={(v) => updateBusiness({ ownerName: v })}
              placeholder="Your name"
            />
            <FieldInput
              label="Email"
              type="email"
              defaultValue={settings.business.email}
              onCommit={(v) => updateBusiness({ email: v })}
              placeholder="billing@your-domain.com"
            />
            <FieldInput
              label="Tax ID"
              defaultValue={settings.business.taxId}
              onCommit={(v) => updateBusiness({ taxId: v })}
              placeholder="EIN / ABN / VAT"
            />
            <FieldTextarea
              label="Address"
              className="sm:col-span-2"
              rows={3}
              defaultValue={settings.business.address}
              onCommit={(v) => updateBusiness({ address: v })}
              placeholder="Street, city, postal code"
            />
            <FieldTextarea
              label="Payment instructions"
              className="sm:col-span-2"
              rows={4}
              defaultValue={settings.business.paymentInstructions}
              onCommit={(v) => updateBusiness({ paymentInstructions: v })}
              placeholder="ACH, wire, check, Stripe link, etc."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              Numbering, appearance, payment terms, and localization defaults.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-[200px_120px_1fr]">
              <FieldInput
                label="Number prefix"
                defaultValue={settings.invoice.numberPrefix}
                onCommit={(v) => updateInvoice({ numberPrefix: v })}
                placeholder="INV-"
              />
              <div className="grid gap-1.5">
                <Label>Next number</Label>
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 font-mono text-sm tabular-nums text-muted-foreground">
                  {settings.invoice.nextNumber}
                </div>
                <p className="text-xs text-muted-foreground">
                  Auto-bumps on save.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>Preview</Label>
                <div className="flex h-9 items-center rounded-md border border-dashed border-input px-3 font-mono text-sm tabular-nums">
                  {formatInvoiceNumber(
                    settings.invoice.numberPrefix,
                    settings.invoice.nextNumber,
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[160px_200px]">
              <FieldNumber
                label="Payment terms (days)"
                defaultValue={settings.invoice.paymentTermsDays}
                onCommit={(n) =>
                  updateInvoice({ paymentTermsDays: Math.max(0, n) })
                }
                placeholder="14"
              />
              <div className="grid gap-1.5">
                <Label htmlFor="accent-color">Accent color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="accent-color"
                    type="color"
                    className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
                    defaultValue={settings.invoice.accentColor}
                    onChange={(e) =>
                      updateInvoice({ accentColor: e.target.value })
                    }
                  />
                  <Input
                    className="h-9 flex-1 font-mono text-xs"
                    defaultValue={settings.invoice.accentColor}
                    key={`color-${settings.invoice.accentColor}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== settings.invoice.accentColor)
                        updateInvoice({ accentColor: v });
                    }}
                  />
                </div>
              </div>
            </div>

            <FieldTextarea
              label="Footer text"
              rows={2}
              defaultValue={settings.invoice.footerText}
              onCommit={(v) => updateInvoice({ footerText: v })}
              placeholder="Thank you for your business."
            />

            <div className="grid gap-1.5">
              <Label>Logo</Label>
              <div className="flex items-center gap-3">
                {settings.invoice.logoB64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={settings.invoice.logoB64}
                    alt="Current logo"
                    className="h-12 w-auto rounded-md border bg-background p-1"
                  />
                ) : (
                  <div className="flex h-12 w-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                    No logo
                  </div>
                )}
                <div className="flex gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                    <ImageUp className="h-4 w-4" />
                    Upload
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml"
                      className="hidden"
                      onChange={(e) =>
                        handleLogoFile(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  {settings.invoice.logoB64 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateInvoice({ logoB64: undefined })}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {modeCopy.logoStorage}
              </p>
            </div>

            <div className="grid gap-4 border-t pt-5">
              <p className="text-sm font-medium">Localization defaults</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Default currency</Label>
                  <Select
                    value={settings.invoice.defaultCurrency}
                    onValueChange={(v) =>
                      void updateInvoice({ defaultCurrency: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Default tax region</Label>
                  <SegmentedControl<TaxRegion>
                    ariaLabel="Default tax region"
                    options={[
                      { value: "US", label: "US" },
                      { value: "EU", label: "EU" },
                    ]}
                    value={settings.invoice.defaultTaxRegion}
                    onChange={(v) =>
                      void updateInvoice({ defaultTaxRegion: v })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Default tax rate (%)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    defaultValue={String(settings.invoice.defaultTaxRate)}
                    key={`def-tax-rate-${settings.invoice.defaultTaxRate}`}
                    onBlur={(e) => {
                      const n = Number.parseFloat(e.target.value);
                      if (
                        !Number.isFinite(n) ||
                        n === settings.invoice.defaultTaxRate
                      )
                        return;
                      void updateInvoice({
                        defaultTaxRate: Math.min(100, Math.max(0, n)),
                      });
                    }}
                    placeholder="0"
                  />
                  <p className="text-xs text-muted-foreground">
                    Stamped onto new line items.
                  </p>
                </div>
                <FieldInput
                  label="Tax ID label"
                  defaultValue={settings.invoice.taxIdLabel}
                  onCommit={(v) => void updateInvoice({ taxIdLabel: v })}
                  placeholder="Tax ID"
                />
                <FieldInput
                  label="Default payment method"
                  defaultValue={settings.invoice.defaultPaymentMethod}
                  onCommit={(v) =>
                    void updateInvoice({ defaultPaymentMethod: v })
                  }
                  placeholder="Bank transfer"
                />
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Checkbox
                    id="amount-in-words-default"
                    checked={settings.invoice.amountInWordsDefault}
                    onCheckedChange={(c) =>
                      void updateInvoice({ amountInWordsDefault: c === true })
                    }
                  />
                  <Label
                    htmlFor="amount-in-words-default"
                    className="font-normal"
                  >
                    Print amount in words on new invoices
                  </Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <DunningCard settings={settings} />

        <Card>
          <CardHeader>
            <CardTitle>Weekly Reckoning</CardTitle>
            <CardDescription>
              Full-screen review of the week — opened from ⌘K or automatically
              after your chosen day and time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="reckoning-enabled"
                checked={settings.reckoning.enabled}
                onCheckedChange={(c) =>
                  void updateReckoning({ enabled: c === true })
                }
              />
              <Label htmlFor="reckoning-enabled" className="font-normal">
                Enable scheduled reckoning
              </Label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Day</Label>
                <Select
                  value={String(settings.reckoning.dayOfWeek)}
                  onValueChange={(v) =>
                    void updateReckoning({ dayOfWeek: Number.parseInt(v, 10) })
                  }
                  disabled={!settings.reckoning.enabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Weekday" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOW_OPTIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FieldNumber
                label="Hour (0–23, local)"
                defaultValue={settings.reckoning.hourOfDay}
                disabled={!settings.reckoning.enabled}
                onCommit={(n) =>
                  void updateReckoning({
                    hourOfDay: Math.min(23, Math.max(0, n)),
                  })
                }
                placeholder="16"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              When you finish a session in Reckoning, use &quot;Mark reckoning
              complete&quot; so auto-open waits until the next week.
            </p>
          </CardContent>
        </Card>

        <TaxCard settings={settings} />

        <StripeCard settings={settings} />
        <StripeConnectCard />

        <Card>
          <CardHeader>
            <CardTitle>Expense categories</CardTitle>
            <CardDescription>
              Used in expense forms and the ledger. Reorder with the arrows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2">
              {settings.expenseCategories.map((cat, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                >
                  <span className="flex-1 text-sm">{cat}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => void moveCategory(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Move down"
                    disabled={i === settings.expenseCategories.length - 1}
                    onClick={() => void moveCategory(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive"
                    aria-label="Remove"
                    onClick={() => void removeCategory(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Input
                className="max-w-xs"
                placeholder="New category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addCategory();
                }}
              />
              <Button type="button" variant="secondary" onClick={() => void addCategory()}>
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Matches the top bar theme control and command palette.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-w-xs space-y-2">
            <Label>Theme</Label>
            <Select
              value={settings.appearance.theme === "dark" ? "dark" : "light"}
              onValueChange={(v) =>
                void updateAppearance({
                  theme: v as Settings["appearance"]["theme"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
            <CardDescription>
              Full backups use the <code className="text-xs">tallyhand.v1</code>{" "}
              JSON bundle (business settings and records). Ledger JSON matches the
              Stage 2 export shape.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void (dataMode === "cloud" ? readCloudBackup().then(({ bundle }) => JSON.stringify(bundle, null, 2)) : exportBundleJsonString()).then((s) =>
                    downloadText(
                      `tallyhand-backup-${new Date().toISOString().slice(0, 10)}.json`,
                      s,
                      "application/json",
                    ),
                  ).catch((e) => showNotice(e instanceof Error ? e.message : "Export failed."))
                }
              >
                <Download className="mr-1 h-4 w-4" />
                Export bundle (JSON)
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void exportLedgerJsonString().then((s) =>
                    downloadText(
                      `tallyhand-ledger-${new Date().toISOString().slice(0, 10)}.json`,
                      s,
                      "application/json",
                    ),
                  )
                }
              >
                <Download className="mr-1 h-4 w-4" />
                Ledger JSON
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void exportBundleTasksCsv().then((s) =>
                    downloadText("tallyhand-tasks.csv", s, "text/csv"),
                  )
                }
              >
                Tasks CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void exportBundleExpensesCsv().then((s) =>
                    downloadText("tallyhand-expenses.csv", s, "text/csv"),
                  )
                }
              >
                Expenses CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void exportBundleMarkdown().then((s) =>
                    downloadText("tallyhand-ledger.md", s, "text/markdown"),
                  )
                }
              >
                Ledger Markdown
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3" aria-busy={dataBusy}>
              <input ref={importRef} type="file" accept="application/json,.json" className="hidden" disabled={dataBusy} onChange={(e) => void handleImport(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="secondary" disabled={dataBusy} onClick={() => importRef.current?.click()}>
                <Upload className="mr-1 h-4 w-4" />Import bundle (JSON)
              </Button>
              <Button type="button" variant="destructive" disabled={dataBusy} onClick={() => void handleReset()}>Reset data…</Button>
              {dataBusy && <span role="status">Working… Do not close this page.</span>}
            </div>
            {dataMode === "cloud" && <p className="text-sm text-muted-foreground">Import replaces your cloud business data and settings after confirmation. A backup downloads first. Only your account is affected; your offline app stays untouched. Shared links and approvals are revoked. Atomic imports support up to 2,000 records and 4 MiB.</p>}
          </CardContent>
        </Card>

      </div>
    </>
  );
}

function FieldInput({
  label,
  defaultValue,
  onCommit,
  placeholder,
  type,
}: {
  label: string;
  defaultValue: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        defaultValue={defaultValue}
        key={`${label}-${defaultValue}`}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== defaultValue) onCommit(v);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

function FieldTextarea({
  label,
  defaultValue,
  onCommit,
  placeholder,
  rows,
  className,
}: {
  label: string;
  defaultValue: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      <Textarea
        rows={rows}
        defaultValue={defaultValue}
        key={`${label}-${defaultValue}`}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== defaultValue) onCommit(v);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

/** Minimal two-or-more-option segmented control (black-and-white). */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex w-fit rounded-md border border-input p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={
            option.value === value
              ? "rounded-[4px] bg-foreground px-3 py-1.5 text-sm text-background"
              : "rounded-[4px] px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FieldNumber({
  label,
  defaultValue,
  onCommit,
  placeholder,
  disabled,
}: {
  label: string;
  defaultValue: number;
  onCommit: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        disabled={disabled}
        defaultValue={String(defaultValue)}
        key={`${label}-${defaultValue}`}
        onBlur={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n !== defaultValue) onCommit(n);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
