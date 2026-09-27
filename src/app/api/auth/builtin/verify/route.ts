/**
 * GET /api/auth/builtin/verify?token=… — magic-link callback.
 *
 * Validates the single-use token, sets the `tally_session` cookie
 * (HMAC-signed, 30 days), and redirects to `?next=` or `/`.
 */
import { NextResponse } from "next/server";
import { parseAuth } from "@/lib/mode";
import {
  BUILTIN_SESSION_COOKIE,
  consumeMagicToken,
  signBuiltinSession,
} from "@/lib/auth/builtin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (parseAuth() !== "builtin") {
    return NextResponse.json({ error: "Builtin auth is not enabled" }, { status: 404 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const user = await consumeMagicToken(token);
  if (!user) {
    return NextResponse.json(
      { error: "This login link is invalid or expired. Request a new one at /login." },
      { status: 400 },
    );
  }
  const next = url.searchParams.get("next") ?? "/";
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", url.origin));
  res.cookies.set(BUILTIN_SESSION_COOKIE, signBuiltinSession(user.id, process.env.BUILTIN_AUTH_SECRET ?? ""), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
