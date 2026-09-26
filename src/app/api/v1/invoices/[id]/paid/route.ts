import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { notFound, ok } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";

export const runtime = "nodejs";

/** Mark an invoice paid. Idempotent — safe to retry. */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = getServerProvider();
    const invoice = await provider.getInvoice(params.id);
    if (!invoice) return notFound("invoice");
    await provider.markInvoicePaid(params.id);
    const updated = await provider.getInvoice(params.id);
    return ok(updated);
  });
}
