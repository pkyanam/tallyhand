import { z } from "zod";
import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../_lib/sync-auth";
import { withIdempotency } from "../_lib/idempotency";
import { settingsPatchSchema } from "@/server/validation";
import { badRequest, ok, json } from "@/server/http";
import { ONBOARDING_INTENTS, onboardingReadiness } from "@/server/agent-onboarding";

export const runtime = "nodejs";
const intentSchema = z.enum(ONBOARDING_INTENTS);
const configureSchema = z.object({ settings: settingsPatchSchema, intent: intentSchema.optional(), dryRun: z.boolean().optional() }).strict();
async function GETHandler(req: Request) {
  const denied = await requireApiOrSession(req); if (denied) return denied;
  const parsed = intentSchema.safeParse(new URL(req.url).searchParams.get("intent") ?? "time_tracking");
  if (!parsed.success) return badRequest("Unknown onboarding intent", parsed.error.issues);
  return ok(onboardingReadiness(await getServerProvider().getSettings(), parsed.data));
}
async function POSTHandler(req: Request) {
  const denied = await requireApiOrSession(req); if (denied) return denied;
  const parsed = configureSchema.safeParse(await req.clone().json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid onboarding configuration", parsed.error.issues);
  if (parsed.data.dryRun || new URL(req.url).searchParams.get("dry_run") === "true") return ok({ dryRun: true, valid: true, patch: parsed.data.settings, warnings: [] });
  return withIdempotency(req, async () => {
    try {
      const settings = await getServerProvider().updateSettings(parsed.data.settings);
      return ok({ ...onboardingReadiness(settings, parsed.data.intent), settings });
    } catch (error) {
      const status = (error as { status?: number }).status;
      return json({ error: { code: status === 403 ? "forbidden" : "settings_unavailable", message: status === 403 ? "Viewers have read-only access" : "Could not update settings. Please try again." } }, status === 403 ? 403 : 503);
    }
  });
}
export const GET = withApiRequestCache(GETHandler);
export const POST = withApiRequestCache(POSTHandler);
