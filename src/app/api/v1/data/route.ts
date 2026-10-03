import { requireApiOrSession } from "../_lib/sync-auth";
import { resolveUserId } from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/users";
import { createConvexRequestClient } from "@/lib/db/convex-client";
import { parseStorage } from "@/lib/mode";
import { validateCloudBackup, MAX_BACKUP_BYTES } from "@/core/cloud-backup";
import { withIdempotency } from "../_lib/idempotency";

export const runtime = "nodejs";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
function client() {
  if (parseStorage() !== "convex") throw Object.assign(new Error("Cloud import/reset currently requires Convex storage."), { status: 501 });
  return createConvexRequestClient(process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "");
}
function failure(error: unknown) {
  const e = error as { status?: number; message?: string };
  return reply({ error: { message: e.status ? e.message : "Cloud data operation failed. No partial changes were applied." } }, e.status ?? 503);
}
export async function GET(req: Request) {
  const denied = await requireApiOrSession(req);
  if (denied) return denied;
  try { return reply({ data: await client().query("backup:read", { userId: await resolveUserId() }) }); }
  catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  const denied = await requireApiOrSession(req);
  if (denied) return denied;
  const userId = await resolveUserId();
  if ((await getUserRole(userId)) === "viewer") return reply({ error: { message: "Viewers cannot import or reset data." } }, 403);
  // Read a bounded stream; do not allocate an unbounded upload before checking its size.
  const reader = req.clone().body?.getReader();
  let text = "", bytes = 0;
  const decoder = new TextDecoder();
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BACKUP_BYTES + 8192) { await reader.cancel(); return reply({ error: { message: "Backup exceeds the 4 MiB limit." } }, 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  }
  let body;
  try { body = JSON.parse(text); } catch { return reply({ error: { message: "Invalid JSON." } }, 400); }
  if (!body || !["import", "reset"].includes(body.action) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.confirmation !== (body.action === "import" ? "REPLACE CLOUD DATA" : "RESET CLOUD DATA AND API KEYS"))
    return reply({ error: { message: "Provide an action, current backup revision, and exact confirmation phrase." } }, 400);
  try {
    if (body.action === "reset") {
      const capabilities = await client().query("backup:read", { userId }) as { resetRevokesApiKeys?: boolean };
      if (capabilities.resetRevokesApiKeys !== true)
        return reply({ error: { message: "Reset is temporarily unavailable until the updated Convex backend is deployed. Nothing was reset." } }, 503);
    }
    const bundle = body.action === "import" ? validateCloudBackup(body.bundle) : undefined;
    return await withIdempotency(req, async () => reply({ data: await client().mutation("backup:replace", {
      userId, action: body.action, expectedRevision: body.expectedRevision, confirmation: body.confirmation,
      ...(bundle ? { bundle } : {}),
    }) }));
  } catch (e) {
    if (e instanceof Error && !("status" in e)) return reply({ error: { message: e.message } }, 400);
    return failure(e);
  }
}
