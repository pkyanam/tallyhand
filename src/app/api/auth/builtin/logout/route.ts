/** POST /api/auth/builtin/logout — clears the builtin session cookie. */
import { NextResponse } from "next/server";
import { parseAuth } from "@/lib/mode";
import { BUILTIN_SESSION_COOKIE } from "@/lib/auth/builtin";

export const runtime = "nodejs";

export async function POST() {
  if (parseAuth() !== "builtin") {
    return NextResponse.json({ error: "Builtin auth is not enabled" }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(BUILTIN_SESSION_COOKIE);
  return res;
}
