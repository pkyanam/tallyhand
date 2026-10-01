import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../_lib/sync-auth";
import { badRequest, ok, json } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { settingsPatchSchema } from "@/server/validation";

export const runtime = "nodejs";

/** Read the singleton settings (business profile, invoice prefs, …). */
export async function GET(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  try {
    const settings = await getServerProvider().getSettings();
    const response = ok(settings);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return json({ error: { code: "settings_unavailable", message: "Could not load settings. Please try again." } },
      status && status >= 400 && status <= 599 ? status : 503);
  }
}

/** Partially update settings. Nested objects merge key-wise. */
export async function PATCH(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = settingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid settings patch", parsed.error.issues);
    }
    const updated = await getServerProvider().updateSettings(parsed.data);
    return ok(updated);
  });
}
