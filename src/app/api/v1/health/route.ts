import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ok } from "@/server/http";

export const runtime = "nodejs";

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Liveness probe. No auth — used by uptime checks and deploy verification. */
export async function GET() {
  return ok({ status: "ok", version: appVersion() });
}
