/** Server-only financial backend selection. Owner identity never comes from a
 * mutable global provider, so public capabilities and jobs retain their scope. */
import type { FinancialStore } from "@/core/financial/store";
import { effectiveAuth, parseStorage } from "@/lib/mode";

export async function getFinancialStore(
  userId: string,
): Promise<FinancialStore> {
  if (!userId)
    throw Object.assign(new Error("Financial owner required"), { status: 403 });
  const storage = parseStorage();
  if (storage === "convex") {
    const [{ createConvexFinancialStore }, { createConvexRequestClient }] =
      await Promise.all([
        import("@/lib/financial/convex-store"),
        import("@/lib/db/convex-client"),
      ]);
    return createConvexFinancialStore(
      createConvexRequestClient(
        process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
      ),
      userId,
    );
  }
  if (storage === "postgres" || storage === "neon") {
    const { createPostgresFinancialStore } =
      await import("@/lib/financial/postgres-store");
    if (!process.env.DATABASE_URL)
      throw Object.assign(new Error("Financial database unavailable"), {
        status: 503,
      });
    return createPostgresFinancialStore(process.env.DATABASE_URL, {
      userId,
      workspaceId: userId,
    });
  }
  // The legacy SQLite invoice table is single-owner. A hosted auth setting
  // does not turn that table into an isolated multi-tenant financial backend.
  if (effectiveAuth() !== "none" || userId !== "local") {
    throw Object.assign(
      new Error(
        "Online financial operations require an owner-isolated hosted backend",
      ),
      { status: 503 },
    );
  }
  const [{ makeSqliteFinancialStore }, { resolveDbPath }] = await Promise.all([
    import("@/lib/financial/sqlite-store"),
    import("@/server/sqlite-provider"),
  ]);
  return makeSqliteFinancialStore(resolveDbPath(), {
    userId,
    workspaceId: userId,
  });
}
