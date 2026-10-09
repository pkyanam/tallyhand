import { withApiRequestCache } from "@/lib/auth/request-cache";
import { ok } from "@/server/http";
import { recoverFinancialWork } from "@/server/financial-recovery";
import { financialContext, financialError, financialPage } from "../_lib";
import { drainFinancialNotifications } from "@/server/financial-notifications";

export const runtime = "nodejs";
export const POST = withApiRequestCache(async (req: Request) => {
  try {
    const page = financialPage(req);
    const query = new URL(req.url).searchParams;
    const paymentCursor = query.get("payment_cursor") ?? undefined;
    const rawProviderCursors = query.get("provider_cursors");
    let providerCursors: Record<string, string> | undefined;
    if (paymentCursor && paymentCursor.length > 2048)
      throw Object.assign(new Error("Invalid payment cursor"), { status: 400 });
    if (rawProviderCursors) {
      if (rawProviderCursors.length > 16384)
        throw Object.assign(new Error("Provider cursors too large"), {
          status: 400,
        });
      try {
        const parsed: unknown = JSON.parse(rawProviderCursors);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          Object.values(parsed).some(
            (value) => typeof value !== "string" || value.length > 2048,
          )
        )
          throw new Error();
        providerCursors = parsed as Record<string, string>;
      } catch {
        throw Object.assign(new Error("Invalid provider cursors"), {
          status: 400,
        });
      }
    }
    const context = await financialContext(req, "reconcile");
    if (context instanceof Response) return context;
    const deadline = Date.now() + 45_000;
    const recovered = await recoverFinancialWork(
      context.store,
      context.scope,
      page.limit,
      { workCursor: page.cursor, paymentCursor, providerCursors, deadline },
    );
    await drainFinancialNotifications(
      context.store,
      context.workspace,
      deadline,
    );
    return ok(recovered);
  } catch (error) {
    return financialError(error);
  }
});
