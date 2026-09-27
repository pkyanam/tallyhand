/**
 * POST /api/auth/builtin/request — magic-link request.
 *
 * Body: { "email": "you@example.com" }
 *
 * Public endpoint. Rate-limit note: self-hosters should sit behind their
 * usual reverse-proxy rate limits; the token itself is single-use, 15 min.
 * Never returns the login URL — when no SMTP is configured the link is
 * printed to the server logs (operator forwards it), never to the API
 * caller.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAuth } from "@/lib/mode";
import { requestMagicLink } from "@/lib/auth/builtin";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().min(1) });

export async function POST(req: Request) {
  if (parseAuth() !== "builtin") {
    return NextResponse.json({ error: "Builtin auth is not enabled" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  try {
    const { emailed } = await requestMagicLink(parsed.data.email);
    return NextResponse.json({
      ok: true,
      emailed,
      message: emailed
        ? "Check your inbox for the login link (expires in 15 minutes)."
        : "No SMTP configured — the login link was printed to the server logs.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    const status = /invalid email/i.test(message)
      ? 400
      : /no account|disabled/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
