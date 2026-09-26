"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge } from "@/components/ui/badge";
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
import { clientRepo, invoiceRepo, settingsRepo } from "@/lib/db/repos";
import { computeDunningActions } from "@/core/dunning";
import type { Settings } from "@/lib/db/types";
import { formatCurrency } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* dunning                                                             */
/* ------------------------------------------------------------------ */

export function DunningCard({ settings }: { settings: Settings }) {
  const dunning = settings.dunning;
  const invoices = useLiveQuery(() => invoiceRepo.list(), []);
  const clients = useLiveQuery(() => clientRepo.list(true), []);

  const updateDunning = (patch: Partial<Settings["dunning"]>) =>
    settingsRepo.update({ dunning: patch });
  const updateLateFee = (patch: Partial<Settings["dunning"]["lateFee"]>) =>
    settingsRepo.update({ dunning: { lateFee: patch } });

  const preview = React.useMemo(() => {
    if (!invoices || !clients || !dunning.enabled) return null;
    const actions = computeDunningActions(
      invoices.filter((i) => i.status === "sent"),
      new Map(clients.map((c) => [c.id, { id: c.id, name: c.name }])),
      dunning,
      Date.now(),
    );
    const overdueIds = new Set([
      ...actions.reminders.map((r) => r.invoiceId),
      ...actions.lateFees.map((f) => f.invoiceId),
      ...actions.newlyOverdue.map((i) => i.id),
    ]);
    return { actions, overdueIds };
  }, [invoices, clients, dunning]);

  const commitReminderDays = (raw: string) => {
    const days = raw
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0);
    const unique = Array.from(new Set(days)).sort((a, b) => a - b);
    if (unique.length > 0) void updateDunning({ reminderDays: unique });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dunning &amp; late fees</CardTitle>
        <CardDescription>
          Automatic reminders for overdue invoices. Runs from{" "}
          <code className="text-xs">POST /api/v1/dunning/run</code> (call it
          from cron) — or preview below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-2">
          <Checkbox
            id="dunning-enabled"
            checked={dunning.enabled}
            onCheckedChange={(c) => void updateDunning({ enabled: c === true })}
          />
          <Label htmlFor="dunning-enabled" className="font-normal">
            Enable dunning
          </Label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Reminder schedule (days overdue)</Label>
            <Input
              defaultValue={dunning.reminderDays.join(", ")}
              key={`days-${dunning.reminderDays.join(",")}`}
              onBlur={(e) => commitReminderDays(e.target.value)}
              placeholder="7, 14, 30"
              disabled={!dunning.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. One reminder per day listed, per invoice.
            </p>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Checkbox
              id="dunning-tone"
              checked={dunning.escalatingTone}
              onCheckedChange={(c) =>
                void updateDunning({ escalatingTone: c === true })
              }
              disabled={!dunning.enabled}
            />
            <Label htmlFor="dunning-tone" className="font-normal">
              Escalating tone (friendly → firm → final notice)
            </Label>
          </div>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="latefee-enabled"
              checked={dunning.lateFee.enabled}
              onCheckedChange={(c) =>
                void updateLateFee({ enabled: c === true })
              }
              disabled={!dunning.enabled}
            />
            <Label htmlFor="latefee-enabled" className="font-medium">
              Apply late fees
            </Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select
                value={dunning.lateFee.type}
                onValueChange={(v) =>
                  void updateLateFee({ type: v as "flat" | "percent" })
                }
                disabled={!dunning.enabled || !dunning.lateFee.enabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent of balance</SelectItem>
                  <SelectItem value="flat">Flat amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>
                {dunning.lateFee.type === "flat" ? "Amount ($)" : "Rate (%)"}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                defaultValue={String(dunning.lateFee.amount)}
                key={`fee-${dunning.lateFee.type}-${dunning.lateFee.amount}`}
                onBlur={(e) => {
                  const n = Number.parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0)
                    void updateLateFee({ amount: n });
                }}
                disabled={!dunning.enabled || !dunning.lateFee.enabled}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Grace period (days)</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={String(dunning.lateFee.graceDays)}
                key={`grace-${dunning.lateFee.graceDays}`}
                onBlur={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n) && n >= 0)
                    void updateLateFee({ graceDays: n });
                }}
                disabled={!dunning.enabled || !dunning.lateFee.enabled}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Re-apply</Label>
              <Select
                value={dunning.lateFee.recurring}
                onValueChange={(v) =>
                  void updateLateFee({ recurring: v as "once" | "monthly" })
                }
                disabled={!dunning.enabled || !dunning.lateFee.enabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Once</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5 max-w-xs">
            <Label>Maximum total fees per invoice ($) — blank for none</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              defaultValue={dunning.lateFee.maxTotal ?? ""}
              key={`maxtotal-${dunning.lateFee.maxTotal ?? "none"}`}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  void updateLateFee({ maxTotal: undefined });
                  return;
                }
                const n = Number.parseFloat(raw);
                if (Number.isFinite(n) && n >= 0)
                  void updateLateFee({ maxTotal: n });
              }}
              placeholder="No cap"
              disabled={!dunning.enabled || !dunning.lateFee.enabled}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Fees are added as invoice line items and recorded per invoice, so
            re-runs never double-apply.
          </p>
        </div>

        {preview && preview.overdueIds.size > 0 ? (
          <div className="space-y-2">
            <Label>Overdue now</Label>
            <ul className="space-y-2">
              {Array.from(preview.overdueIds).map((id) => {
                const invoice = invoices?.find((i) => i.id === id);
                if (!invoice) return null;
                const reminders = preview.actions.reminders.filter(
                  (r) => r.invoiceId === id,
                );
                const fee = preview.actions.lateFees.find(
                  (f) => f.invoiceId === id,
                );
                return (
                  <li
                    key={id}
                    className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="font-mono">{invoice.invoiceNumber}</span>
                    <span className="text-muted-foreground">
                      {formatCurrency(invoice.total)}
                    </span>
                    {reminders.length > 0 && (
                      <Badge variant="secondary">
                        {reminders.length} reminder
                        {reminders.length === 1 ? "" : "s"} due
                      </Badge>
                    )}
                    {fee && (
                      <Badge variant="secondary">
                        {formatCurrency(fee.amount)} fee due
                      </Badge>
                    )}
                    {(invoice.reminderLog?.length ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {invoice.reminderLog?.length} sent before
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              This is a live preview — nothing is sent until a dunning run
              executes.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {dunning.enabled
              ? "No overdue invoices right now."
              : "Dunning is disabled."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* stripe payments (first-party plugin settings)                       */
/* ------------------------------------------------------------------ */

const STRIPE_PLUGIN_KEY = "stripe-payments";

export function StripeCard({ settings }: { settings: Settings }) {
  const values = settings.pluginSettings?.[STRIPE_PLUGIN_KEY] ?? {};
  const enabled = values.enabled !== false;
  const descriptor = typeof values.statementDescriptor === "string" ? values.statementDescriptor : "";

  const update = (patch: Record<string, string | number | boolean>) =>
    settingsRepo.update({
      pluginSettings: {
        ...settings.pluginSettings,
        [STRIPE_PLUGIN_KEY]: { ...values, ...patch },
      },
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stripe payments</CardTitle>
        <CardDescription>
          Online payments for the client portal. Secrets stay in the
          environment — never in settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="stripe-enabled"
            checked={enabled}
            onCheckedChange={(c) => void update({ enabled: c === true })}
          />
          <Label htmlFor="stripe-enabled" className="font-normal">
            Accept online payments
          </Label>
        </div>
        <div className="grid gap-1.5 max-w-xs">
          <Label>Statement descriptor (max 22 chars)</Label>
          <Input
            defaultValue={descriptor}
            key={`stripe-desc-${descriptor}`}
            maxLength={22}
            placeholder="e.g. TALLYHAND*SERVICES"
            onBlur={(e) => void update({ statementDescriptor: e.target.value.trim() })}
          />
          <p className="text-xs text-muted-foreground">
            Text on the payer&apos;s card statement.
          </p>
        </div>
        <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-1">
          <p>
            Set <code>STRIPE_SECRET_KEY</code> and{" "}
            <code>STRIPE_WEBHOOK_SECRET</code> in the server environment, then
            restart. Point Stripe webhooks at{" "}
            <code>/api/v1/stripe/webhook</code>.
          </p>
          <p>
            Without a key the plugin stays inert and the portal Pay button
            shows “payments not configured”.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* tax                                                                 */
/* ------------------------------------------------------------------ */

export function TaxCard({ settings }: { settings: Settings }) {
  const percent = Math.round(settings.tax.setAsidePercent * 100);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax</CardTitle>
        <CardDescription>
          Sole-proprietor estimates on the Tax page use this reserve rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-xs space-y-2">
        <Label>Set-aside rate (% of profit)</Label>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          defaultValue={String(percent)}
          key={`setaside-${percent}`}
          onBlur={(e) => {
            const n = Number.parseFloat(e.target.value);
            if (Number.isFinite(n) && n >= 0 && n <= 100) {
              void settingsRepo.update({ tax: { setAsidePercent: n / 100 } });
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          Suggested reserve for income + self-employment tax, e.g. 30.
        </p>
      </CardContent>
    </Card>
  );
}
