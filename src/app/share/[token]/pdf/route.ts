import { getShareDeps } from "@/lib/share/server-deps";
import { resolveShareToken } from "@/lib/share/service";
import { invoicePdfResponse } from "@/server/invoice-pdf";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const resolved = await resolveShareToken(getShareDeps(), params.token, "invoice");
    if (!resolved.invoice || !resolved.settings) return new Response("PDF unavailable for legacy snapshot links. Create a live invoice link.", { status: 404 });
    return await invoicePdfResponse(resolved.invoice, resolved.settings, resolved.invoice.client);
  } catch { return new Response("Invoice link unavailable", { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
