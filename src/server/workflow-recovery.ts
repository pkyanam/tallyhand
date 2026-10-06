import { parseStorage } from "@/lib/mode";
import { tryResolveUserId } from "@/lib/auth/session";
import { createConvexRequestClient } from "@/lib/db/convex-client";

export const recoveryError = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status });

export async function recoveryContext() {
  const owner = await tryResolveUserId().catch(() => null);
  if (!owner) return recoveryError("UNAUTHORIZED", "Workspace authentication required", 401);
  if (parseStorage() !== "convex") return recoveryError("RECOVERY_UNAVAILABLE", "Workspace revision and durable receipt lookup require Convex storage", 501);
  return { owner, client: createConvexRequestClient(process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "") };
}
