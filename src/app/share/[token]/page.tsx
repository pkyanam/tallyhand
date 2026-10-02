/**
 * /share/[token] — public client portal (no login required).
 * The signed token is the capability. Renders invoice / timesheet /
 * estimate views; the timesheet view includes the "Approve hours" action
 * and the invoice view includes the Pay button (payment plugin slot stub).
 */
import { getShareDeps } from "@/lib/share/server-deps";
import { resolveShareToken } from "@/lib/share/service";
import { hasSharePaymentHandler } from "@/lib/share/payment-slot";
import { EstimateShareView, InvoiceShareView, TimesheetShareView } from "./share-views";

export const dynamic = "force-dynamic";

function ShareError({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </main>
  );
}

export default async function SharePage({ params }: { params: { token: string } }) {
  const { token } = params;
  let resolved;
  try {
    resolved = await resolveShareToken(getShareDeps(), token);
  } catch (err) {
    const maybeStatus =
      err instanceof Error ? (err as { status?: unknown }).status : undefined;
    const status = typeof maybeStatus === "number" ? maybeStatus : 500;
    const message = err instanceof Error ? err.message : "Could not load this shared page.";
    return (
      <ShareError
        title={status === 410 ? "This link has expired" : "Link unavailable"}
        detail={message}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <span className="font-semibold">Tallyhand</span>
          <span className="text-xs text-muted-foreground">Shared securely</span>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-6 py-8">
        {resolved.invoice != null && (
          <InvoiceShareView
            token={token}
            invoice={resolved.invoice}
            paymentsConfigured={hasSharePaymentHandler()}
          />
        )}
        {resolved.timesheet != null && (
          <TimesheetShareView token={token} timesheet={resolved.timesheet} />
        )}
        {resolved.estimate != null && <EstimateShareView estimate={resolved.estimate} />}
      </div>
    </main>
  );
}
