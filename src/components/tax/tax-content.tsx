"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  expenseRepo,
  invoiceRepo,
  mileageRepo,
  settingsRepo,
  taxPaymentRepo,
} from "@/lib/db/repos";
import {
  annualizeProfit,
  estimateAnnualTax,
  nextQuarterDue,
  quarterlyPaymentStatus,
  setAsideStatus,
  DEFAULT_TAX_CONFIG,
  type QuarterlyPaymentStatus,
  type TaxJurisdiction,
} from "@/core/tax";
import { mileageDeduction } from "@/core/mileage";
import { formatCurrency } from "@/lib/utils";

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fromDateInput(s: string): number {
  return new Date(`${s}T12:00:00`).getTime();
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {value}
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}

function QuarterTable({ rows }: { rows: QuarterlyPaymentStatus[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Quarter</th>
            <th className="py-2 pr-4 font-medium">Due</th>
            <th className="py-2 pr-4 text-right font-medium">Estimated due</th>
            <th className="py-2 pr-4 text-right font-medium">Paid</th>
            <th className="py-2 pr-4 text-right font-medium">Remaining</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.quarter.quarter} className="border-b last:border-0">
              <td className="py-2 pr-4 font-medium">{r.quarter.label}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {new Date(r.quarter.dueDate).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {formatCurrency(r.estimatedDue)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {formatCurrency(r.paid)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {formatCurrency(r.remaining)}
              </td>
              <td className="py-2">
                {r.remaining <= 0 ? (
                  <Badge variant="secondary">Paid</Badge>
                ) : r.overdue ? (
                  <Badge variant="destructive">Overdue</Badge>
                ) : (
                  <Badge variant="outline">Upcoming</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaxContent() {
  const invoices = useLiveQuery(() => invoiceRepo.list(), []);
  const expenses = useLiveQuery(() => expenseRepo.list(), []);
  const mileage = useLiveQuery(() => mileageRepo.list(), []);
  const payments = useLiveQuery(() => taxPaymentRepo.list(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);

  const [showForm, setShowForm] = React.useState(false);
  const [formQuarter, setFormQuarter] = React.useState("1");
  const [formJurisdiction, setFormJurisdiction] =
    React.useState<TaxJurisdiction>("federal");
  const [formAmount, setFormAmount] = React.useState("");
  const [formDate, setFormDate] = React.useState(() =>
    toDateInput(Date.now()),
  );
  const [formNote, setFormNote] = React.useState("");

  const now = React.useMemo(() => new Date(), []);
  const taxYear = now.getFullYear();
  const yearStart = React.useMemo(
    () => new Date(taxYear, 0, 1).getTime(),
    [taxYear],
  );

  const data = React.useMemo(() => {
    if (!invoices || !expenses || !mileage || !payments || !settings)
      return null;
    const collected = invoices
      .filter((i) => i.status === "paid" && i.issueDate >= yearStart)
      .reduce((s, i) => s + i.total, 0);
    const expenseTotal = expenses
      .filter((e) => e.date >= yearStart)
      .reduce((s, e) => s + e.amount, 0);
    const mileageTotal = mileage
      .filter((m) => m.date >= yearStart)
      .reduce((s, m) => s + mileageDeduction(m), 0);
    const profitYtd = collected - expenseTotal - mileageTotal;
    const monthsElapsed = now.getMonth() + 1;
    const annualized = annualizeProfit(profitYtd, monthsElapsed);
    const estimate = estimateAnnualTax(annualized, {
      ...DEFAULT_TAX_CONFIG,
      setAsidePercent: settings.tax.setAsidePercent,
    });
    const yearPayments = payments.filter((p) => p.taxYear === taxYear);
    const paidTotal = yearPayments.reduce((s, p) => s + p.amount, 0);
    const setAside = setAsideStatus(estimate.setAsideTarget, paidTotal);
    const federal = quarterlyPaymentStatus(
      taxYear,
      estimate.quarterlyPayment,
      payments,
      "federal",
      now.getTime(),
    );
    const state = quarterlyPaymentStatus(
      taxYear,
      estimate.quarterlyPayment,
      payments,
      "state",
      now.getTime(),
    );
    const nextDue = nextQuarterDue(taxYear, now.getTime());
    return {
      collected,
      expenseTotal,
      mileageTotal,
      profitYtd,
      monthsElapsed,
      annualized,
      estimate,
      setAside,
      federal,
      state,
      nextDue,
      yearPayments,
    };
  }, [invoices, expenses, mileage, payments, settings, yearStart, taxYear, now]);

  const savePayment = async () => {
    const amount = Number.parseFloat(formAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await taxPaymentRepo.create({
      taxYear,
      quarter: Number.parseInt(formQuarter, 10) as 1 | 2 | 3 | 4,
      date: fromDateInput(formDate),
      amount,
      jurisdiction: formJurisdiction,
      note: formNote.trim() || undefined,
    });
    setShowForm(false);
    setFormAmount("");
    setFormNote("");
  };

  const setAsidePct = Math.round(
    (data?.setAside.fundedRatio ?? 0) * 100,
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Cash-basis estimates for {taxYear} using prior-year federal brackets.
        Not tax advice — confirm with a professional.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Profit YTD (${data?.monthsElapsed ?? 0} mo)`}
          value={formatCurrency(data?.profitYtd ?? 0)}
          hint="Collected − expenses − mileage"
        />
        <StatCard
          label="Annualized profit"
          value={formatCurrency(data?.annualized ?? 0)}
          hint="YTD profit scaled to 12 months"
        />
        <StatCard
          label="Estimated annual tax"
          value={formatCurrency(data?.estimate.totalTax ?? 0)}
          hint={
            data
              ? `SE ${formatCurrency(data.estimate.selfEmploymentTax)} + income ${formatCurrency(data.estimate.federalIncomeTax)}`
              : undefined
          }
        />
        <StatCard
          label="Quarterly payment"
          value={formatCurrency(data?.estimate.quarterlyPayment ?? 0)}
          hint={
            data?.nextDue
              ? `Next due ${new Date(data.nextDue.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`
              : "Year complete"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tax set-aside</CardTitle>
            <CardDescription>
              {Math.round((settings?.tax.setAsidePercent ?? 0.3) * 100)}% of
              annualized profit, less estimated payments made.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Reserved so far</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(data?.setAside.paid ?? 0)} of{" "}
                {formatCurrency(data?.setAside.target ?? 0)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${Math.min(100, setAsidePct)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {data && data.setAside.stillToReserve > 0
                ? `${formatCurrency(data.setAside.stillToReserve)} still to reserve.`
                : "Fully reserved."}{" "}
              Adjust the rate in Settings → Tax.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Estimated payments</CardTitle>
              <CardDescription>
                Record what you&apos;ve paid to the IRS / state.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus className="mr-1 h-4 w-4" />
              Record
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {showForm && (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Quarter</Label>
                  <Select value={formQuarter} onValueChange={setFormQuarter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Q1</SelectItem>
                      <SelectItem value="2">Q2</SelectItem>
                      <SelectItem value="3">Q3</SelectItem>
                      <SelectItem value="4">Q4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Jurisdiction</Label>
                  <Select
                    value={formJurisdiction}
                    onValueChange={(v) =>
                      setFormJurisdiction(v as TaxJurisdiction)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="federal">Federal</SelectItem>
                      <SelectItem value="state">State</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Amount ($)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Note (optional)</Label>
                  <Input
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder="e.g. IRS Direct Pay confirmation"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button onClick={savePayment}>Save payment</Button>
                </div>
              </div>
            )}
            {data && data.yearPayments.length > 0 ? (
              <ul className="space-y-2">
                {[...data.yearPayments]
                  .sort((a, b) => b.date - a.date)
                  .map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <Badge variant="outline">
                        {p.jurisdiction === "federal" ? "IRS" : "State"}
                      </Badge>
                      <span className="text-muted-foreground">
                        Q{p.quarter}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(p.amount)}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(p.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      {p.note && (
                        <span className="truncate text-xs text-muted-foreground">
                          {p.note}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7"
                        onClick={() => void taxPaymentRepo.remove(p.id)}
                        aria-label="Delete payment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No payments recorded for {taxYear} yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Federal quarterly status</CardTitle>
          </CardHeader>
          <CardContent>
            {data && <QuarterTable rows={data.federal} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>State quarterly status</CardTitle>
            <CardDescription>
              Uses the same due dates; adjust if your state differs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data && <QuarterTable rows={data.state} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
