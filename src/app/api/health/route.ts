/**
 * GET /api/health — liveness probe for Docker / reverse proxies.
 * Also validates the env contract in hosted mode so a misconfigured
 * container fails the healthcheck loudly instead of serving 500s.
 */
import { NextResponse } from "next/server";
import { getConfig, validateConfig } from "@/lib/mode";

export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const problems = config.hosted ? validateConfig() : [];
  if (problems.length > 0) {
    return NextResponse.json({ ok: false, problems }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    storage: config.storage,
    auth: config.auth,
    hosted: config.hosted,
  });
}
