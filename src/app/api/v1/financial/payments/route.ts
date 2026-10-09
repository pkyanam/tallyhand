import { withApiRequestCache } from "@/lib/auth/request-cache";
import { ok } from "@/server/http";
import { financialContext, financialError, financialPage } from "../_lib";

export const runtime = "nodejs";
export const GET = withApiRequestCache(async (req: Request) => {
  try {
    const page = financialPage(req);
    const context = await financialContext(req, "read");
    if (context instanceof Response) return context;
    return ok(await context.store.listPayments(context.authority.kind === "owner" ? context.workspace : context.scope, page));
  } catch (error) { return financialError(error); }
});
