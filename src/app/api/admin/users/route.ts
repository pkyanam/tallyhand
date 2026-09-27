/**
 * /api/admin/users — list users (GET) and invite a user (POST).
 * Admin-only. Works with whichever auth provider is configured
 * (clerk → Clerk API; builtin → local user table; none → 404).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../require-admin";

export const runtime = "nodejs";

const Role = z.enum(["admin", "member", "viewer"]);
const InviteBody = z.object({ email: z.string().email(), role: Role.default("member") });

export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const users = await ctx.directory.listUsers();
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = InviteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid email and role are required" }, { status: 400 });
  }
  try {
    const user = await ctx.directory.inviteUser(parsed.data.email, parsed.data.role);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invite failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
