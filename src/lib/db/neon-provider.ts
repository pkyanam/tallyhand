/**
 * NeonStorageProvider — hosted-mode StorageProvider backed by Neon Postgres
 * over the serverless HTTP driver (@neondatabase/serverless +
 * drizzle-orm/neon-http).
 *
 * SERVER ONLY — never import from client components. Loaded lazily by
 * `src/server/provider.ts` via require() so the package stays out of the
 * local/vitest/edge bundles.
 *
 * Reuses ALL of PostgresStorageProvider's logic (same schema, same
 * per-user isolation, same EncryptedSyncStore vault): the only difference
 * is the transport — stateless HTTPS queries instead of a long-lived pg
 * Pool, which is what makes it safe for scale-to-zero serverless hosts
 * (Vercel) where idle TCP connections are killed.
 *
 * Selected with `TALLY_STORAGE=neon` (or the `TALLY_DB=neon` alias), or
 * auto-selected when DATABASE_URL points at *.neon.tech (see
 * `src/lib/mode.ts`). The plain node-pg path (`TALLY_STORAGE=postgres`)
 * stays for self-hosted Docker.
 *
 * HONEST CAVEAT — no interactive transactions: neon-http's `db.transaction`
 * throws ("No transactions support in neon-http driver"). The two
 * transactional workflows (`assignNextInvoiceNumber`, `markInvoiceSent`)
 * run through a passthrough shim, i.e. the same statements in the same
 * order but WITHOUT atomicity/isolation. In practice:
 * - `assignNextInvoiceNumber` keeps its `SELECT ... FOR UPDATE` text but the
 *   lock is a no-op outside a transaction, so two concurrent requests can
 *   theoretically mint the same invoice number. The invoices table carries
 *   a unique (user_id, invoice_number) index, so the loser fails loudly on
 *   insert instead of silently duplicating — retry the request.
 * - `markInvoiceSent`'s multi-row update is best-effort; a crash mid-way can
 *   leave some line items unmarked. The operation is idempotent — re-running
 *   it converges.
 */

/**
 * Rewrite a `-pooler` hostname to the direct compute endpoint. Neon's SQL-
 * over-HTTP driver speaks to the endpoint itself; the `-pooler` host is the
 * stateful pooler proxy meant for `pg` clients. Both resolve to the same
 * database — this just picks the endpoint the HTTP driver expects.
 */
export function normalizeNeonConnectionString(url: string): string {
  try {
    const u = new URL(url);
    // Only rewrite neon.tech hostnames; anything else is passed through so a
    // self-hosted host that happens to contain "-pooler" is never mangled.
    if (/\.neon\.tech$/i.test(u.hostname) && u.hostname.includes("-pooler")) {
      u.hostname = u.hostname.replace(/-pooler/i, "");
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Build a drizzle db over the Neon serverless HTTP driver. Heavy imports
 * are require()d so this module never lands in bundles that don't need it.
 */
export function createNeonDb(connectionString: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { neon } = require("@neondatabase/serverless") as typeof import(
    "@neondatabase/serverless"
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/neon-http") as typeof import(
    "drizzle-orm/neon-http"
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const schema = require("@/lib/db/postgres-schema") as typeof import(
    "@/lib/db/postgres-schema"
  );
  const client = neon(normalizeNeonConnectionString(connectionString));
  return drizzle(client, { schema });
}

// ---------------------------------------------------------------------------
// Transaction shim
// ---------------------------------------------------------------------------

import type { DbLike } from "./postgres-provider";
import type { UserIdSource } from "./hosted-types";

/**
 * DbLike wrapper that runs `transaction(fn)` callbacks WITHOUT a real
 * transaction: neon-http throws on interactive transactions, so the
 * callback runs directly against the same db. Same statements, same order,
 * no atomicity (see the module caveat above).
 */
class PassthroughTransactionDb implements DbLike {
  constructor(private readonly inner: DbLike) {}
  select(...args: unknown[]): unknown {
    return this.inner.select(...args);
  }
  insert(table: unknown): unknown {
    return this.inner.insert(table);
  }
  update(table: unknown): unknown {
    return this.inner.update(table);
  }
  delete(table: unknown): unknown {
    return this.inner.delete(table);
  }
  transaction<T>(fn: (tx: DbLike) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

import { PostgresStorageProvider, type ConditionOps } from "./postgres-provider";

/**
 * Same logic, same schema, same isolation as PostgresStorageProvider —
 * only the transport differs (stateless HTTPS). Inherits the
 * EncryptedSyncStore vault implementation unchanged.
 */
export class NeonStorageProvider extends PostgresStorageProvider {
  override readonly providerName: string = "neon";

  /**
   * Production factory: dynamic-imports drizzle-orm's condition builders
   * once (kept out of the static import graph, same as the pg path).
   */
  static async create(
    db: DbLike,
    userId: UserIdSource,
  ): Promise<NeonStorageProvider> {
    const { eq, and, or, desc, gt } = (await import("drizzle-orm")) as unknown as {
      eq: ConditionOps["eq"];
      and: ConditionOps["and"];
      or: ConditionOps["or"];
      desc: ConditionOps["desc"];
      gt: ConditionOps["gt"];
    };
    return new NeonStorageProvider(db, userId, { eq, and, or, desc, gt });
  }

  constructor(db: DbLike, userIdSource: UserIdSource, ops: ConditionOps) {
    // Wrap BEFORE super(): every query — including the transactional
    // workflows — goes through the passthrough shim.
    super(new PassthroughTransactionDb(db), userIdSource, ops);
  }
}
