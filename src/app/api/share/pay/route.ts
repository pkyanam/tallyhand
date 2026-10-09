/**
 * POST /api/share/pay — PUBLIC payment-request entry point (plugin slot).
 *
 * Body: { token }. Requires a stable Idempotency-Key for the logical request.
 *
 * Resolves the share token, then delegates to the payment handler registered via
 * `onSharePaymentRequested`. With no handler registered (the default),
 * it returns 501 so the portal can show the "payments not configured" state.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getShareDeps } from "@/lib/share/server-deps";
import { resolveShareToken } from "@/lib/share/service";
import {
  hasSharePaymentHandler,
  requestSharePayment,
} from "@/lib/share/payment-slot";

export const runtime = "nodejs";

const Body = z.object({ token: z.string().min(1) });

export async function POST(req: Request) {
  const operationId = req.headers.get("Idempotency-Key");
  if (!operationId || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
    return NextResponse.json({ error: "A stable Idempotency-Key is required" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A share token is required" },
      { status: 400 },
    );
  }
  if (!hasSharePaymentHandler()) {
    return NextResponse.json(
      { error: "Payments are not configured for this Tallyhand instance." },
      { status: 501 },
    );
  }
  try {
    const deps = getShareDeps();
    const resolved = await resolveShareToken(
      deps,
      parsed.data.token,
      "invoice",
    );
    const invoice = resolved.invoice as {
      id: string;
      invoiceNumber: string;
      total: number;
      currency?: string;
      client?: { email?: string };
    };
    const result = await requestSharePayment({
      shareToken: parsed.data.token,
      ownerId: resolved.link.userId,
      shareLinkId: resolved.link.id,
      operationId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amountCents: Math.round(invoice.total * 100),
      currency: invoice.currency ?? "USD",
      customerEmail: invoice.client?.email,
    });
    return NextResponse.json(result);
  } catch (err) {
    const maybeStatus =
      err instanceof Error ? (err as { status?: unknown }).status : undefined;
    const status = typeof maybeStatus === "number" ? maybeStatus : 500;
    const message =
      err instanceof Error ? err.message : "Payment request failed";
    return NextResponse.json({ error: message }, { status });
  }
}
