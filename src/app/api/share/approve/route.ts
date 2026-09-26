/**
 * POST /api/share/approve — PUBLIC timesheet approval.
 * Body: { token, approverName?, note? }
 * One approval per link+week (409 on repeat); expired/revoked links rejected.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getShareDeps } from "@/lib/share/server-deps";
import { approveTimesheet } from "@/lib/share/service";

const Body = z.object({
  token: z.string().min(1),
  approverName: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A share token is required" }, { status: 400 });
  }
  try {
    const deps = getShareDeps();
    const approval = await approveTimesheet(deps, parsed.data.token, {
      approverName: parsed.data.approverName,
      note: parsed.data.note,
    });
    return NextResponse.json({ approval }, { status: 201 });
  } catch (err) {
    const maybeStatus =
      err instanceof Error
        ? (err as { status?: unknown }).status
        : undefined;
    const status = typeof maybeStatus === "number" ? maybeStatus : 500;
    const message = err instanceof Error ? err.message : "Approval failed";
    return NextResponse.json({ error: message }, { status });
  }
}
