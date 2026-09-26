import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, ok } from "@/server/http";
import { settingsPatchSchema } from "@/server/validation";

export const runtime = "nodejs";

/** Read the singleton settings (business profile, invoice prefs, …). */
export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const settings = await getServerProvider().getSettings();
  return ok(settings);
}

/** Partially update settings. Nested objects merge key-wise. */
export async function PATCH(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const body: unknown = await req.json().catch(() => null);
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid settings patch", parsed.error.issues);
  }
  const updated = await getServerProvider().updateSettings(parsed.data);
  return ok(updated);
}
