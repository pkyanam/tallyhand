/**
 * /api/share/links — authenticated share-link management (hosted).
 * POST: create a signed share link for the caller's own data.
 * GET:  list the caller's share links.
 */
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/session";
import { getShareDeps } from "@/lib/share/server-deps";
import { createShareLink, CreateShareSchema } from "@/lib/share/service";

export async function GET() {
  try {
    await resolveUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const deps = getShareDeps();
    const links = await deps.ownerProvider.listShareLinks();
    return NextResponse.json({ links });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list share links";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await resolveUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid share request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const deps = getShareDeps();
    const created = await createShareLink(deps, parsed.data);
    return NextResponse.json(
      { link: created.link, token: created.token, url: created.url },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create share link";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
