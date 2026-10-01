import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiToken } from "@/server/auth";
import { ok, badRequest } from "@/server/http";
import { AGENT_CONTROLS } from "@/server/agent-controls";
import { oauthConfig } from "@/lib/auth/oauth";
export const runtime = "nodejs";
async function GETHandler(req: Request) {
  const denied = await requireApiToken(req); if (denied) return denied;
  const key = new URL(req.url).searchParams.get("control");
  if (!key || !Object.hasOwn(AGENT_CONTROLS, key)) return badRequest("Unknown control", { controls: Object.keys(AGENT_CONTROLS) });
  const control = AGENT_CONTROLS[key as keyof typeof AGENT_CONTROLS];
  return ok({ control: key, url: new URL(control.path, oauthConfig().origin).href, instructions: control.reason, requiresUserInteraction: true });
}

export const GET = withApiRequestCache(GETHandler);
