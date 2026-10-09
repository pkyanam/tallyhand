import { withApiRequestCache } from "@/lib/auth/request-cache";
import { ok, notFound } from "@/server/http";
import { getServerProviderForUser } from "@/server/provider";
import { financialContext, financialError, financialPage } from "../../_lib";

export const runtime = "nodejs";
export const GET = withApiRequestCache(async (req: Request, { params }: { params: { id: string } }) => {
  try {
    const page = financialPage(req);
    const context = await financialContext(req, "read");
    if (context instanceof Response) return context;
    const invoice = await getServerProviderForUser(context.workspace.userId).getInvoice(params.id);
    if (!invoice) return notFound("invoice");
    const timeline = await context.store.getInvoiceTimeline(context.workspace, params.id, page);
    if (context.authority.kind === "owner") return ok({ ...timeline, invoiceStatus: invoice.status, manualAssertion: invoice.manualPaymentAssertion });
    const matches = (scope: typeof context.scope) => scope.accountId === context.scope.accountId && scope.mode === context.scope.mode;
    const attempts = timeline.attempts.filter(item => matches(item.scope));
    const payments = timeline.payments.filter(item => matches(item.scope));
    const refunds = timeline.refunds.filter(item => matches(item.scope));
    const paymentIds = new Set(payments.map(item => item.id));
    const recordIds = new Set([...attempts, ...payments, ...refunds].map(item => item.id));
    return ok({
      attempts, payments, refunds,
      allocations: timeline.allocations.filter(item => paymentIds.has(item.paymentId)),
      manualEvidence: [],
      audit: { ...timeline.audit, items: timeline.audit.items.filter(item =>
        [item.detail.attemptId, item.detail.paymentId, item.detail.refundId].some(id => typeof id === "string" && recordIds.has(id))),
      },
    });
  } catch (error) { return financialError(error); }
});
