/**
 * Shared admin guard for /api/admin/**.
 *
 * - TALLY_AUTH=none → 404 (no user management in single-user mode).
 * - Not signed in  → 401.
 * - Signed in but not admin → 403.
 */
import { NextResponse } from "next/server";
import { parseAuth } from "@/lib/mode";
import { getUserDirectory, type UserDirectory } from "@/lib/auth/users";
import { resolveUserId } from "@/lib/auth/session";

export interface AdminContext {
  directory: UserDirectory;
  userId: string;
}

export async function requireAdmin(): Promise<AdminContext | NextResponse> {
  if (parseAuth() === "none") {
    return NextResponse.json(
      { error: "User management is disabled when TALLY_AUTH=none" },
      { status: 404 },
    );
  }
  let userId: string;
  try {
    userId = await resolveUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const directory = getUserDirectory();
  const me = await directory.getUser(userId);
  if (!me) {
    return NextResponse.json({ error: "Unknown user" }, { status: 403 });
  }
  if (me.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  return { directory, userId };
}
