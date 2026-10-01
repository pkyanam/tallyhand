/** Calls the same API handlers without a second public HTTP request. */
import { oauthConfig } from "@/lib/auth/oauth";
type Handler = (request: Request, context: { params: { id: string } }) => Promise<Response> | Response;
type Route = Record<string, unknown>;
const routes: Array<{ pattern: RegExp; load: () => Promise<Route>; hasId: boolean }> = [
  { pattern: /^\/api\/v1\/expenses\/bulk$/, load: () => import("@/app/api/v1/expenses/bulk/route"), hasId: false },
  { pattern: /^\/api\/v1\/tasks\/bulk$/, load: () => import("@/app/api/v1/tasks/bulk/route"), hasId: false },
  { pattern: /^\/api\/v1\/dunning\/run$/, load: () => import("@/app/api/v1/dunning/run/route"), hasId: false },
  { pattern: /^\/api\/v1\/data$/, load: () => import("@/app/api/v1/data/route"), hasId: false },
  { pattern: /^\/api\/v1\/recurring-schedules$/, load: () => import("@/app/api/v1/recurring-schedules/route"), hasId: false },
  { pattern: /^\/api\/v1\/recurring-schedules\/([^\/]+)$/, load: () => import("@/app/api/v1/recurring-schedules/[id]/route"), hasId: true },
  { pattern: /^\/api\/v1\/recurring-schedules\/([^\/]+)\/run$/, load: () => import("@/app/api/v1/recurring-schedules/[id]/run/route"), hasId: true },
  { pattern: /^\/api\/v1\/expenses$/, load: () => import("@/app/api/v1/expenses/route"), hasId: false },
  { pattern: /^\/api\/v1\/expenses\/([^\/]+)$/, load: () => import("@/app/api/v1/expenses/[id]/route"), hasId: true },
  { pattern: /^\/api\/v1\/retainers$/, load: () => import("@/app/api/v1/retainers/route"), hasId: false },
  { pattern: /^\/api\/v1\/retainers\/([^\/]+)$/, load: () => import("@/app/api/v1/retainers/[id]/route"), hasId: true },
  { pattern: /^\/api\/v1\/tasks$/, load: () => import("@/app/api/v1/tasks/route"), hasId: false },
  { pattern: /^\/api\/v1\/tasks\/([^\/]+)$/, load: () => import("@/app/api/v1/tasks/[id]/route"), hasId: true },
  { pattern: /^\/api\/v1\/invoices$/, load: () => import("@/app/api/v1/invoices/route"), hasId: false },
  { pattern: /^\/api\/v1\/invoices\/([^\/]+)$/, load: () => import("@/app/api/v1/invoices/[id]/route"), hasId: true },
  { pattern: /^\/api\/v1\/invoices\/([^\/]+)\/paid$/, load: () => import("@/app/api/v1/invoices/[id]/paid/route"), hasId: true },
  { pattern: /^\/api\/v1\/invoices\/([^\/]+)\/send$/, load: () => import("@/app/api/v1/invoices/[id]/send/route"), hasId: true },
  { pattern: /^\/api\/v1\/clients$/, load: () => import("@/app/api/v1/clients/route"), hasId: false },
  { pattern: /^\/api\/v1\/clients\/([^\/]+)$/, load: () => import("@/app/api/v1/clients/[id]/route"), hasId: true },
  { pattern: /^\/api\/v1\/projects$/, load: () => import("@/app/api/v1/projects/route"), hasId: false },
  { pattern: /^\/api\/v1\/projects\/([^\/]+)$/, load: () => import("@/app/api/v1/projects/[id]/route"), hasId: true },
  { pattern: /^\/api\/v1\/settings$/, load: () => import("@/app/api/v1/settings/route"), hasId: false },
  { pattern: /^\/api\/v1\/scheduler\/run$/, load: () => import("@/app/api/v1/scheduler/run/route"), hasId: false },
  { pattern: /^\/api\/v1\/health$/, load: () => import("@/app/api/v1/health/route"), hasId: false },
 ];
export const dispatchWorkspaceApi: typeof fetch = async (input, init) => {
  const request = new Request(input instanceof Request ? input : String(input), init);
  request.signal.throwIfAborted();
  const url = new URL(request.url);
  if (url.origin !== oauthConfig().origin) throw new Error("Internal API destination is not allowed");
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname); if (!match) continue;
    const routeModule = await route.load();
    const handler = routeModule[request.method];
    if (typeof handler !== "function") return new Response(null, { status: 405 });
    return (handler as Handler)(request, { params: { id: route.hasId ? decodeURIComponent(match[1]) : "" } });
  }
  return Response.json({ error: { code: "not_found", message: "Unsupported workspace API route" } }, { status: 404 });
};
