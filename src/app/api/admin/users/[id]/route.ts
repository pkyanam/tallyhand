/**
 * /api/admin/users/[id] — change role / disable / enable (PATCH),
 * remove a user (DELETE). Admin-only. Admins cannot remove or disable
 * themselves (prevents lockout).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "../../require-admin";

export const runtime = "nodejs";

const Role = z.enum(["admin", "member", "viewer"]);
const PatchBody = z.object({
  role: Role.optional(),
  disabled: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success || (!parsed.data.role && parsed.data.disabled === undefined)) {
    return NextResponse.json(
      { error: "Provide role and/or disabled" },
      { status: 400 },
    );
  }
  if (id === ctx.userId && parsed.data.disabled) {
    return NextResponse.json({ error: "You cannot disable yourself" }, { status: 400 });
  }
  if (id === ctx.userId && parsed.data.role && parsed.data.role !== "admin") {
    return NextResponse.json({ error: "You cannot demote yourself" }, { status: 400 });
  }
  try {
    if (parsed.data.role) await ctx.directory.setRole(id, parsed.data.role);
    if (parsed.data.disabled !== undefined) {
      await ctx.directory.setDisabled(id, parsed.data.disabled);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = params;
  if (id === ctx.userId) {
    return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  }
  try {
    await ctx.directory.removeUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Remove failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
