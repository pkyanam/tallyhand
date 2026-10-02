import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiOrSession } from "../../../_lib/sync-auth";
import { getServerProvider } from "@/server/provider";
import { notFound } from "@/server/http";
import { invoicePdfResponse } from "@/server/invoice-pdf";
export const runtime = "nodejs";
export const GET = withApiRequestCache(async (req: Request, { params }: { params: { id: string } }) => {
  const denied = await requireApiOrSession(req); if (denied) return denied;
  const provider = getServerProvider();
  const invoice = await provider.getInvoice(params.id); if (!invoice) return notFound("invoice");
  const [settings, client] = await Promise.all([provider.getSettings(), provider.getClient(invoice.clientId)]);
  return invoicePdfResponse(invoice, settings, client);
});
