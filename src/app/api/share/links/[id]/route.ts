/**
 * DELETE /api/share/links/[id] — revoke the caller's own share link.
 * The provider is owner-scoped, so a caller can never revoke another
 * user's links.
 */
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/session";
import { getShareDeps } from "@/lib/share/server-deps";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await resolveUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = params;
  try {
    const deps = getShareDeps();
    await deps.ownerProvider.revokeShareLink(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revoke share link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
