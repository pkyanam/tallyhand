/**
 * GET /api/share/resolve/[token] — PUBLIC share-token resolution.
 * The signed token is the capability: verifies HMAC, expiry, type,
 * revocation, then returns the shared payload.
 */
import { NextResponse } from "next/server";
import { getShareDeps } from "@/lib/share/server-deps";
import { resolveShareToken } from "@/lib/share/service";

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
) {
  const { token } = params;
  try {
    const deps = getShareDeps();
    const resolved = await resolveShareToken(deps, token);
    return NextResponse.json(resolved);
  } catch (err) {
    const maybeStatus =
      err instanceof Error ? (err as { status?: unknown }).status : undefined;
    const status = typeof maybeStatus === "number" ? maybeStatus : 500;
    const message = err instanceof Error ? err.message : "Failed to resolve share link";
    return NextResponse.json({ error: message }, { status });
  }
}
