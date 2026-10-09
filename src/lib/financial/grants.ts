import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseStorage } from "@/lib/mode";
import { resolveDbPath } from "@/server/sqlite-provider";
import { money } from "@/core/financial/money";

import { type FinancialGrant } from "@/core/financial/authority";
export { assertFinancialGrant } from "@/core/financial/authority";
export type {
  FinancialAction,
  FinancialPrincipal,
  FinancialGrant,
  FinancialGrantProof,
} from "@/core/financial/authority";
const schema = `CREATE TABLE IF NOT EXISTS financial_grants (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,data TEXT NOT NULL,revoked_at BIGINT); CREATE INDEX IF NOT EXISTS financial_grants_owner ON financial_grants(user_id,workspace_id);`;
async function run(
  kind: "create" | "get" | "list" | "revoke",
  args: { userId: string; id?: string; grant?: FinancialGrant },
): Promise<unknown> {
  const storage = parseStorage();
  if (storage === "convex") {
    const { createConvexRequestClient } =
      await import("@/lib/db/convex-client");
    const c = createConvexRequestClient(
      process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
    );
    const result = await (kind === "get" || kind === "list"
      ? c.query(`financialGrants:${kind}`, args)
      : c.mutation(`financialGrants:${kind}`, args));
    if (kind === "list" && Array.isArray(result) && result.length > 100)
      throw Object.assign(
        new Error("Too many financial grants; revoke grants before listing"),
        { status: 413 },
      );
    return result;
  }
  if (storage === "postgres" || storage === "neon") {
    if (!process.env.DATABASE_URL)
      throw new Error("Financial grant database unavailable");
    const pool = (storage === "neon"
      ? await (async () => {
          const { Pool, neonConfig } = await import("@neondatabase/serverless");
          const { default: WebSocket } = await import("ws");
          neonConfig.webSocketConstructor = WebSocket;
          return new Pool({ connectionString: process.env.DATABASE_URL });
        })()
      : new (await import("pg")).Pool({
          connectionString: process.env.DATABASE_URL,
        })) as unknown as {
      query: (
        sql: string,
        params?: unknown[],
      ) => Promise<{
        rows: { data: string; revoked_at: number | null }[];
        rowCount: number | null;
      }>;
      end: () => Promise<void>;
    };
    try {
      await pool.query(schema);
      if (kind === "create") {
        const g = args.grant!;
        await pool.query(
          "INSERT INTO financial_grants VALUES($1,$2,$3,$4,NULL)",
          [g.id, g.userId, g.workspaceId, JSON.stringify(g)],
        );
        return g;
      }
      if (kind === "revoke")
        return (
          (
            await pool.query(
              "UPDATE financial_grants SET revoked_at=$1 WHERE id=$2 AND user_id=$3",
              [Date.now(), args.id, args.userId],
            )
          ).rowCount! > 0
        );
      const rows = (
        await pool.query(
          kind === "get"
            ? "SELECT data,revoked_at FROM financial_grants WHERE id=$1 AND user_id=$2"
            : "SELECT data,revoked_at FROM financial_grants WHERE user_id=$1 ORDER BY id LIMIT 101",
          kind === "get" ? [args.id, args.userId] : [args.userId],
        )
      ).rows;
      if (kind === "list" && rows.length > 100)
        throw Object.assign(
          new Error("Too many financial grants; revoke grants before listing"),
          { status: 413 },
        );
      const mapped = rows.map((r) => ({
        ...JSON.parse(r.data),
        revokedAt: r.revoked_at == null ? null : Number(r.revoked_at),
      }));
      return kind === "get" ? (mapped[0] ?? null) : mapped;
    } finally {
      await pool.end();
    }
  }
  const db = new DatabaseSync(resolveDbPath());
  try {
    db.exec(schema);
    if (kind === "create") {
      const g = args.grant!;
      db.prepare("INSERT INTO financial_grants VALUES(?,?,?,?,NULL)").run(
        g.id,
        g.userId,
        g.workspaceId,
        JSON.stringify(g),
      );
      return g;
    }
    if (kind === "revoke")
      return (
        Number(
          db
            .prepare(
              "UPDATE financial_grants SET revoked_at=? WHERE id=? AND user_id=?",
            )
            .run(Date.now(), args.id!, args.userId).changes,
        ) > 0
      );
    const rows = (
      kind === "get"
        ? [
            db
              .prepare(
                "SELECT data,revoked_at FROM financial_grants WHERE id=? AND user_id=?",
              )
              .get(args.id!, args.userId),
          ].filter(Boolean)
        : db
            .prepare(
              "SELECT data,revoked_at FROM financial_grants WHERE user_id=? ORDER BY id LIMIT 101",
            )
            .all(args.userId)
    ) as { data: string; revoked_at: number | null }[];
    if (kind === "list" && rows.length > 100)
      throw Object.assign(
        new Error("Too many financial grants; revoke grants before listing"),
        { status: 413 },
      );
    const mapped = rows.map((r) => ({
      ...JSON.parse(r.data),
      revokedAt: r.revoked_at,
    }));
    return kind === "get" ? (mapped[0] ?? null) : mapped;
  } finally {
    db.close();
  }
}
export async function createFinancialGrant(
  input: Omit<FinancialGrant, "id" | "createdAt" | "revokedAt">,
): Promise<FinancialGrant> {
  money(input.maxMinorUnits, input.currency);
  if (
    !input.userId ||
    input.workspaceId !== input.userId ||
    !input.accountId ||
    !["test", "live"].includes(input.mode) ||
    !input.actions.length ||
    input.actions.some((a) => !["collect", "read", "reconcile"].includes(a)) ||
    (input.principal.kind === "api-token"
      ? !input.principal.tokenId
      : input.principal.kind !== "oauth" ||
        input.principal.userId !== input.userId ||
        !input.principal.clientId)
  )
    throw new Error("Invalid financial grant");
  const grant = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
    revokedAt: null,
  };
  return (await run("create", {
    userId: input.userId,
    grant,
  })) as FinancialGrant;
}
export async function getFinancialGrant(userId: string, id: string) {
  return (await run("get", { userId, id })) as FinancialGrant | null;
}
export async function listFinancialGrants(userId: string) {
  return (await run("list", { userId })) as FinancialGrant[];
}
export async function revokeFinancialGrant(userId: string, id: string) {
  return (await run("revoke", { userId, id })) as boolean;
}
