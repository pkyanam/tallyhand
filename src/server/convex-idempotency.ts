import { createHash, randomUUID } from "node:crypto";
import { tryResolveUserId } from "@/lib/auth/session";
import { createConvexRequestClient } from "@/lib/db/convex-client";

type Claim = { state: "claimed" | "pending" | "conflict" } |
  { state: "complete"; status: number; body: string; contentType?: string };

const errorResponse = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status });

/** Fail closed: uncertainty must never silently repeat a financial write. */
export async function withConvexIdempotency(req: Request, key: string, handler: () => Promise<Response>): Promise<Response> {
  let owner: string | null;
  try { owner = await tryResolveUserId(); } catch { owner = null; }
  if (!owner) return errorResponse("UNAUTHORIZED", "Sign in required", 401);
  if (key.length > 256) return errorResponse("BAD_REQUEST", "Idempotency-Key must not exceed 256 characters", 400);
  const url = new URL(req.url);
  const scopedKey = createHash("sha256").update(JSON.stringify([owner, key])).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify([req.method, url.pathname, url.search, await req.clone().text()])).digest("hex");
  const claimId = randomUUID();
  let client: ReturnType<typeof createConvexRequestClient>;
  let claim: Claim;
  try {
    client = createConvexRequestClient(process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "");
    claim = await client.mutation("idempotency:claim", { key: scopedKey, fingerprint, claimId }) as Claim; }
  catch { return errorResponse("IDEMPOTENCY_UNAVAILABLE", "Request protection unavailable; no operation was started", 503); }
  if (claim.state === "conflict") return errorResponse("IDEMPOTENCY_CONFLICT", "This key was used for a different request", 409);
  if (claim.state === "pending") return errorResponse("IDEMPOTENCY_PENDING", "This operation is pending or needs reconciliation; inspect its outcome before submitting a new key", 409);
  if (claim.state === "complete") return new Response(claim.body || null, { status: claim.status,
    headers: { "content-type": claim.contentType ?? "application/json", "Idempotency-Replayed": "true" } });
  const response = await handler();
  const body = await response.clone().text();
  try {
    await client.mutation("idempotency:complete", { key: scopedKey, claimId, status: response.status,
      body, contentType: response.headers.get("content-type") ?? "application/json" });
  } catch {
    return errorResponse("IDEMPOTENCY_UNCERTAIN", "The operation may have completed, but its receipt could not be saved; inspect its outcome before retrying", 503);
  }
  return response;
}
