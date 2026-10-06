/** Shared CLI/MCP setup validation. Unsupported adapters fail explicitly. */
import { z } from "zod";
import type { Api } from "./commands.js";
import { needAuth } from "./commands.js";
import { settingsPatchSchema } from "./settings-schema.js";
export const setupIntentSchema = z.enum(["time_tracking", "invoicing"]);
export const workspaceSetupSchema = z.object({ settings: z.record(z.string(), z.unknown()).describe("Settings patch validated with the update_settings schema; inspect update_settings for supported fields"), intent: setupIntentSchema.default("time_tracking"), dryRun: z.boolean().default(true) }).strict();
export function parseSetupPatch(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("--patch must be a valid JSON settings object"); }
  return settingsPatchSchema.parse(value);
}
export async function getOnboarding(api: Api, intent: unknown = "time_tracking") {
  const parsed = setupIntentSchema.parse(intent);
  needAuth(api);
  if (!api.onboarding) throw new Error("Onboarding is unavailable on this backend. Update the server or use settings show and settings set.");
  return api.onboarding(parsed);
}
export async function setupWorkspace(api: Api, input: unknown) {
  const parsed = workspaceSetupSchema.parse(input);
  parsed.settings = settingsPatchSchema.parse(parsed.settings);
  needAuth(api);
  if (!api.configureOnboarding) throw new Error("Workspace setup is unavailable on this backend. Update the server or use settings set --dry-run.");
  return api.configureOnboarding(parsed);
}
