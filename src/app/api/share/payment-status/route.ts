import { z } from "zod";
import { resolveShareToken } from "@/lib/share/service";
import { getShareDeps } from "@/lib/share/server-deps";
import { getFinancialStore } from "@/server/financial-store";

export const runtime = "nodejs";
const Body = z.object({ token: z.string().min(1).max(4096) }).strict();

/** A customer capability exposes only its invoice's collection and receipts. */
export async function POST(req: Request) {
  const input = Body.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "A share token is required" },
      { status: 400 },
    );
  try {
    const resolved = await resolveShareToken(
      getShareDeps(),
      input.data.token,
      "invoice",
    );
    if (!resolved.invoice)
      throw Object.assign(new Error("Invoice unavailable"), { status: 404 });
    const workspace = {
      userId: resolved.link.userId,
      workspaceId: resolved.link.userId,
    };
    const timeline = await (
      await getFinancialStore(workspace.userId)
    ).getInvoiceTimeline(workspace, resolved.invoice.id, { limit: 1 });
    const receipts = timeline.payments.map((payment) => {
      const refunded = timeline.refunds
        .filter(
          (refund) =>
            refund.paymentId === payment.id && refund.state === "confirmed",
        )
        .reduce((sum, refund) => sum + refund.money.minorUnits, 0);
      return {
        id: payment.id,
        money: payment.money,
        confirmedAt: payment.confirmedAt,
        confirmedRefundMinorUnits: refunded,
        netMinorUnits: payment.money.minorUnits - refunded,
      };
    });
    return Response.json(
      {
        invoiceId: resolved.invoice.id,
        receipts,
        attempts: timeline.attempts.map((attempt) => ({
          id: attempt.id,
          state: attempt.state,
        })),
        refunds: timeline.refunds.map((refund) => ({
          id: refund.id,
          money: refund.money,
          state: refund.state,
        })),
        bankConfirmation: "unverified",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = (error as { status?: number })?.status;
    return Response.json(
      {
        error: [403, 404, 410].includes(status ?? 0)
          ? "Payment status unavailable for this link"
          : "Payment confirmation is currently unavailable",
      },
      { status: [403, 404, 410].includes(status ?? 0) ? status : 503 },
    );
  }
}
