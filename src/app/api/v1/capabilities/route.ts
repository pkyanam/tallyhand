import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiToken } from "@/server/auth";
import { getServerProvider } from "@/server/provider";
import { ok } from "@/server/http";
import { AGENT_CONTROLS } from "@/server/agent-controls";
import { AGENT_OPERATIONS } from "@/server/agent-operations";
import { isOAuthToken, verifyTallyOAuth } from "@/lib/auth/oauth";
import { resolveUserId } from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/users";
import { isEncryptedSyncStore } from "@/lib/db/sync-store";
import { effectiveAuth, getConfig } from "@/lib/mode";
export const runtime = "nodejs";
async function GETHandler(req: Request) {
  const denied = await requireApiToken(req); if (denied) return denied;
  const p = getServerProvider();
  const token = (req.headers.get("authorization") ?? "").trim().replace(/^Bearer /, "");
  const oauth = token !== process.env.TALLYHAND_API_TOKEN && isOAuthToken(token) ? await verifyTallyOAuth(token) : null;
  const scopes = oauth ? oauth.scopes : ["tally:read", "tally:write", "tally:manage"];
  const role = effectiveAuth() === "none" ? "single_user" : await getUserRole(await resolveUserId());
  const config = getConfig();
  const extensions = { mileage: typeof p.listMileageEntries === "function", contracts: typeof p.listContracts === "function", taxPayments: typeof p.listTaxPayments === "function", rateCards: typeof p.listRateCards === "function", shareLinks: "createShareLink" in p };
  const operations = AGENT_OPERATIONS.map(operation => {
    const scope = operation.requiredScope;
    const workspace = operation.authentication === "workspace" && typeof scope === "string" && scope.startsWith("tally:");
    const read = operation.method === "GET" || operation.method === "HEAD";
    const feature = operation.path.match(/^\/api\/v1\/(mileage|contracts|tax-payments|rate-cards|share-links)(?:\/|$)/)?.[1];
    const extensionSupported = !feature || ({ mileage: extensions.mileage, contracts: extensions.contracts, "tax-payments": extensions.taxPayments, "rate-cards": extensions.rateCards, "share-links": extensions.shareLinks } as Record<string, boolean>)[feature];
    const supported = extensionSupported && (!/^\/api\/v1\/(data|changes|requests)(?:\/|$)/.test(operation.path) || config.storage === "convex") && (!/^\/api\/v1\/sync\/(pull|push)$/.test(operation.path) || isEncryptedSyncStore(p));
    const apiTokenOperation = ["api_token", "session_or_api_token"].includes(operation.authentication);
    const publicOperation = operation.authentication === "public";
    const authorized = publicOperation || (apiTokenOperation && !oauth) || (workspace && scopes.includes(scope));
    const allowedNow = supported && authorized && (read || role !== "viewer");
    return { ...operation, dryRunAllowedNow: operation.dryRun && supported && operation.dryRunRequiredScope !== null && scopes.includes(operation.dryRunRequiredScope), supportedByBackend: supported, allowedNow, authorizationReason: !supported ? "Operation is not supported by the current storage backend" : publicOperation ? "Public operation" : apiTokenOperation ? (oauth ? "Shared or personal API token required; OAuth excluded" : !read && role === "viewer" ? "Viewer role is read-only" : "API token accepted; provider configuration and operation validation still apply") : !workspace ? "Separate session, administrative, public, or provider authentication; this bearer grant does not authorize it" : !scopes.includes(scope) ? "Missing OAuth scope" : !read && role === "viewer" ? "Viewer role is read-only" : "Caller has the workspace scope and role; operation-specific validation still applies" };
  });
  return ok({ workspaceApi: true, extensions, paymentExecution: false, secureControls: AGENT_CONTROLS,
    surfaces: { rest: "/api/v1", openapi: "/api/v1/openapi.json", mcp: "/api/mcp", onboarding: "/api/v1/onboarding", controls: "/api/v1/controls", capabilities: "/api/v1/capabilities" },
    caller: { authentication: oauth ? "oauth" : "api_token", scopes, role, canWriteWorkspace: role !== "viewer" && scopes.includes("tally:write"), canManageWorkspace: role !== "viewer" && scopes.includes("tally:manage") },
    backend: { storage: config.storage === "dexie" ? "sqlite" : config.storage, browserLocalDataAccessible: false, paymentExecution: false, extensions }, operations,
    note: "Capabilities do not grant authorization. Browser controls can be operated by an authorized agent; device and external consent require the appropriate interaction. Session-dependent routes are not authorized by this bearer token. Each API enforces permissions and validates inputs." });
}
export const GET = withApiRequestCache(GETHandler);
