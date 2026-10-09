"use client";

import { useEffect, useState } from "react";
import {
  netConfirmedMoney,
  type InvoiceTimeline,
  type Money,
} from "@/core/financial";

const amount = (value: Money) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
  }).format(value.minorUnits / 100);

function manualAmount(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(total);
  } catch {
    return `${total} ${currency}`;
  }
}

export function FinancialTimeline({ invoiceId, invoiceStatus }: { invoiceId: string; invoiceStatus?: "draft" | "sent" | "paid" }) {
  const [timeline, setTimeline] = useState<InvoiceTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setTimeline(null);
    setError(null);
    fetch(
      `/api/v1/financial/invoices/${encodeURIComponent(invoiceId)}?limit=50`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ?? "Financial history unavailable",
          );
        return body.data as InvoiceTimeline;
      })
      .then(setTimeline)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Financial history unavailable",
          );
      });
    return () => controller.abort();
  }, [invoiceId, invoiceStatus]);
  return (
    <section
      aria-label="Financial history"
      className="space-y-3 rounded-lg border p-4"
    >
      <h3 className="font-medium">Financial history</h3>
      <p className="text-sm text-muted-foreground">
        Stripe collection records are not your bank balance. Manual payment
        evidence is recorded separately.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !timeline ? (
        <p role="status">Loading financial history…</p>
      ) : (
        <>
          {timeline.manualAssertion && <p className="text-sm">
            Manually marked paid: {manualAmount(timeline.manualAssertion.total, timeline.manualAssertion.currency)} · recorded by {timeline.manualAssertion.actorId}. This is a user assertion, not provider confirmation or bank proof.
          </p>}
          {(timeline.invoiceStatus ?? invoiceStatus) === "paid" && !timeline.manualAssertion && !timeline.payments.length && !timeline.manualEvidence.length && <p className="text-sm">
            Legacy paid status: payment provenance is unknown. No provider confirmation or attributed manual assertion is recorded.
          </p>}
          {!timeline.attempts.length &&
            !timeline.payments.length &&
            !timeline.refunds.length &&
            !timeline.manualEvidence.length && !timeline.manualAssertion && (timeline.invoiceStatus ?? invoiceStatus) !== "paid" && (
              <p className="text-sm">No financial records yet.</p>
            )}
          <ul className="space-y-2 text-sm">
            {timeline.attempts.map((item) => (
              <li key={`attempt-${item.id}`}>
                Collection attempt: {item.state} · {amount(item.invoice.money)}
              </li>
            ))}
            {timeline.payments.map((item) => (
              <li key={`payment-${item.id}`}>
                Stripe collection confirmed: {amount(item.money)} · Net after
                confirmed refunds:{" "}
                {amount(
                  netConfirmedMoney(
                    item.money,
                    timeline.refunds
                      .filter(
                        (refund) =>
                          refund.paymentId === item.id &&
                          refund.state === "confirmed",
                      )
                      .map((refund) => refund.money),
                  ),
                )}
              </li>
            ))}
            {timeline.refunds.map((item) => (
              <li key={`refund-${item.id}`}>
                Refund {item.state}: {amount(item.money)}
                {item.state !== "confirmed" &&
                  " · not deducted as a confirmed refund"}
              </li>
            ))}
            {timeline.manualEvidence.map((item) => (
              <li key={`manual-${item.id}`}>
                Manual payment evidence: {amount(item.money)} · {item.note}
              </li>
            ))}
          </ul>
          {timeline.audit.nextCursor && (
            <p className="text-sm text-muted-foreground">
              More audit records are available through the financial API.
            </p>
          )}
        </>
      )}
    </section>
  );
}
