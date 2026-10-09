"use client";

/**
 * Client-side views for the public share portal (/share/[token]).
 * Invoice (with Pay plugin-slot button), timesheet (with Approve hours),
 * estimate (snapshot rendering).
 */
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import type { Client, Invoice, InvoiceLineItem, Task } from "@/core/entities";
import type { EstimateSnapshot, ResolvedShare } from "@/lib/share/service";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US");

interface LineItem {
  description?: string;
  quantity?: number;
  rate?: number;
  amount?: number;
}

function snapshotItems(snap: EstimateSnapshot): LineItem[] {
  if (!Array.isArray(snap.lineItems)) return [];
  return snap.lineItems.map((li) => ({
    description:
      typeof li.description === "string" ? li.description : undefined,
    quantity: typeof li.quantity === "number" ? li.quantity : undefined,
    rate: typeof li.rate === "number" ? li.rate : undefined,
    amount: typeof li.amount === "number" ? li.amount : undefined,
  }));
}

// -- invoice ---------------------------------------------------------------

export function InvoiceShareView({
  token,
  invoice,
  paymentsConfigured,
}: {
  token: string;
  invoice: Invoice & { client: Client | null };
  paymentsConfigured: boolean;
}) {
  const items: InvoiceLineItem[] = Array.isArray(invoice.lineItems)
    ? invoice.lineItems
    : [];
  const invoiceMoney = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: invoice.currency ?? "USD",
    }).format(n);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Invoice {invoice.invoiceNumber}
        </p>
        <h1 className="text-2xl font-semibold">
          {invoiceMoney(invoice.total)}{" "}
          <span className="text-base font-normal text-muted-foreground">
            due {fmtDate(invoice.dueDate)}
          </span>
        </h1>
        {invoice.client && (
          <p className="text-sm text-muted-foreground">
            Billed to {invoice.client.name}
          </p>
        )}
        <p className="text-xs text-muted-foreground capitalize">
          Status: {invoice.status}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Description</th>
            <th className="py-2 pr-2 font-medium text-right">Qty</th>
            <th className="py-2 pr-2 font-medium text-right">Rate</th>
            <th className="py-2 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, i) => (
            <tr key={i} className="border-b">
              <td className="py-2 pr-2">{li.description ?? "—"}</td>
              <td className="py-2 pr-2 text-right">{li.quantity ?? "—"}</td>
              <td className="py-2 pr-2 text-right">
                {li.rate != null ? invoiceMoney(li.rate) : "—"}
              </td>
              <td className="py-2 text-right">
                {li.amount != null ? invoiceMoney(li.amount) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={3} className="py-2 pr-2 text-right">
              Total
            </td>
            <td className="py-2 text-right">{invoiceMoney(invoice.total)}</td>
          </tr>
        </tfoot>
      </table>
      {invoice.notes && (
        <p className="text-sm text-muted-foreground">{invoice.notes}</p>
      )}
      <a
        className="inline-flex rounded border px-4 py-2 text-sm font-medium"
        href={`/share/${encodeURIComponent(token)}/pdf`}
      >
        Download PDF
      </a>
      <PaymentConfirmation token={token} />
      {invoice.status === "sent" && (
        <PayButton token={token} paymentsConfigured={paymentsConfigured} />
      )}
    </div>
  );
}

/**
 * Pay button — payment plugin SLOT. Fires POST /api/share/pay, which
 * delegates to a handler registered via onSharePaymentRequested. The
 * first-party `stripe-payments` plugin registers the Stripe Checkout
 * handler when STRIPE_SECRET_KEY is set; without it the portal shows the
 * "not configured" state below.
 */
function PayButton({
  token,
  paymentsConfigured,
}: {
  token: string;
  paymentsConfigured: boolean;
}) {
  const [state, setState] = useState<
    "idle" | "loading" | "unconfigured" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);

  async function pay() {
    setState("loading");
    setError(null);
    try {
      operationId.current ??= crypto.randomUUID();
      const res = await fetch("/api/share/pay", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": operationId.current },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      // A terminal failed attempt can be replaced by a new user request.
      // Transport failures and uncertain provider state retain retry identity.
      if (res.status === 409 && data.error === "Payment attempt is terminal; use a new operation identity") operationId.current = null;
      if (res.status === 202) {
        setError(
          "This payment request is awaiting confirmation. The sender can check its progress; avoid starting a separate payment.",
        );
        setState("error");
        return;
      }
      if (res.status === 501 || data.handled === false) {
        setState("unconfigured");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Payment failed");
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
      else setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setState("error");
    }
  }

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <button
        type="button"
        onClick={pay}
        disabled={state === "loading"}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {state === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CreditCard className="h-4 w-4" />
        )}
        Pay this invoice
      </button>
      {!paymentsConfigured && state === "idle" && (
        <p className="text-xs text-muted-foreground">
          Online payment isn&apos;t configured for this Tallyhand instance.
          Contact the sender for payment instructions.
        </p>
      )}
      {state === "unconfigured" && (
        <p className="text-xs text-muted-foreground">
          Online payment isn&apos;t configured for this Tallyhand instance.
          Contact the sender for payment instructions.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

type PublicPaymentStatus = {
  receipts: {
    id: string;
    money: { currency: string; minorUnits: number };
    confirmedRefundMinorUnits: number;
    netMinorUnits: number;
  }[];
  attempts: { id: string; state: string }[];
  refunds: {
    id: string;
    money: { currency: string; minorUnits: number };
    state: string;
  }[];
};

function PaymentConfirmation({ token }: { token: string }) {
  const [status, setStatus] = useState<PublicPaymentStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    const returned = new URLSearchParams(window.location.search).has("paid");
    async function check() {
      try {
        const response = await fetch("/api/share/payment-status", {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) throw new Error("Confirmation unavailable");
        const result = (await response.json()) as PublicPaymentStatus;
        setStatus(result);
        setUnavailable(false);
        if (returned && !result.receipts.length && ++checks < 6)
          timer = setTimeout(check, 2000);
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    }
    void check();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [token]);
  const amount = (units: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      units / 100,
    );
  if (unavailable)
    return (
      <p className="text-sm text-muted-foreground">
        Online payment confirmation is unavailable. Contact the sender to check
        payment records.
      </p>
    );
  if (!status) return null;
  if (!status.receipts.length)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {status.attempts.some((item) =>
          ["dispatching", "pending", "unknown"].includes(item.state),
        )
          ? "Payment confirmation is pending. Returning from checkout does not confirm payment."
          : "No online payment receipt is recorded."}
      </p>
    );
  return (
    <section
      aria-label="Payment receipts"
      className="space-y-2 rounded-lg border p-4"
    >
      {status.receipts.map((receipt) => (
        <p key={receipt.id}>
          Stripe collection confirmed:{" "}
          {amount(receipt.money.minorUnits, receipt.money.currency)}.
          {receipt.confirmedRefundMinorUnits > 0 && (
            <>
              {" "}
              Confirmed refund:{" "}
              {amount(
                receipt.confirmedRefundMinorUnits,
                receipt.money.currency,
              )}
              . Net collected:{" "}
              {amount(receipt.netMinorUnits, receipt.money.currency)}.
            </>
          )}
        </p>
      ))}
      {status.refunds
        .filter((refund) => refund.state !== "confirmed")
        .map((refund) => (
          <p key={refund.id}>
            Refund {refund.state}:{" "}
            {amount(refund.money.minorUnits, refund.money.currency)}.
          </p>
        ))}
      <p className="text-xs text-muted-foreground">
        Collection receipts do not confirm funds have reached the sender&apos;s
        bank.
      </p>
    </section>
  );
}

// -- timesheet --------------------------------------------------------------

const ApproveSchema = z.object({
  approverName: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
});
type ApproveValues = z.infer<typeof ApproveSchema>;

export function TimesheetShareView({
  token,
  timesheet,
}: {
  token: string;
  timesheet: NonNullable<ResolvedShare["timesheet"]>;
}) {
  const [approved, setApproved] = useState<boolean>(
    Boolean(timesheet.approved),
  );
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ApproveValues>({ resolver: zodResolver(ApproveSchema) });

  const tasks: Task[] = Array.isArray(timesheet.tasks) ? timesheet.tasks : [];
  const weekLabel = fmtDate(timesheet.weekStartMs);

  async function onApprove(values: ApproveValues) {
    setError(null);
    try {
      const res = await fetch("/api/share/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, ...values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Approval failed");
      setApproved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Timesheet approval</p>
        <h1 className="text-2xl font-semibold">{timesheet.client?.name}</h1>
        <p className="text-sm text-muted-foreground">Week of {weekLabel}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Task</th>
            <th className="py-2 pr-2 font-medium">Date</th>
            <th className="py-2 font-medium text-right">Hours</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2 pr-2">{t.name}</td>
              <td className="py-2 pr-2">{fmtDate(t.startAt)}</td>
              <td className="py-2 text-right">
                {(t.durationMinutes / 60).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={2} className="py-2 pr-2 text-right">
              Total
            </td>
            <td className="py-2 text-right">
              {(timesheet.totals.minutes / 60).toFixed(2)}h ·{" "}
              {usd(timesheet.totals.amount)}
            </td>
          </tr>
        </tfoot>
      </table>

      {approved ? (
        <p className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <CheckCircle2 className="h-5 w-5" /> These hours have been approved.
          Thank you!
        </p>
      ) : (
        <form
          onSubmit={handleSubmit(onApprove)}
          className="rounded-lg border p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold">Approve hours</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="approverName" className="text-xs font-medium">
                Your name
              </label>
              <input
                id="approverName"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Jane Client"
                {...register("approverName")}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="note" className="text-xs font-medium">
                Note (optional)
              </label>
              <input
                id="note"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Looks good"
                {...register("note")}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Approve hours"
            )}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
}

// -- estimate (snapshot) -----------------------------------------------------

export function EstimateShareView({
  estimate,
}: {
  estimate: EstimateSnapshot;
}) {
  const snap = estimate;
  const items: LineItem[] = snapshotItems(snap);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Estimate</p>
        <h1 className="text-2xl font-semibold">
          {snap.title ?? "Project estimate"}
        </h1>
        {snap.clientName && (
          <p className="text-sm text-muted-foreground">
            Prepared for {snap.clientName}
          </p>
        )}
        {snap.validUntil && (
          <p className="text-xs text-muted-foreground">
            Valid until {fmtDate(snap.validUntil)}
          </p>
        )}
      </div>
      {items.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 pr-2 font-medium text-right">Qty</th>
              <th className="py-2 pr-2 font-medium text-right">Rate</th>
              <th className="py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((li, i) => (
              <tr key={i} className="border-b">
                <td className="py-2 pr-2">{li.description ?? "—"}</td>
                <td className="py-2 pr-2 text-right">{li.quantity ?? "—"}</td>
                <td className="py-2 pr-2 text-right">
                  {li.rate != null ? usd(li.rate) : "—"}
                </td>
                <td className="py-2 text-right">
                  {li.amount != null ? usd(li.amount) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          {snap.total != null && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={3} className="py-2 pr-2 text-right">
                  Estimated total
                </td>
                <td className="py-2 text-right">{usd(snap.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {snap.notes && (
        <p className="text-sm text-muted-foreground">{snap.notes}</p>
      )}
    </div>
  );
}
