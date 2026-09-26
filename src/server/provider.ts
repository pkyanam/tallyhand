/**
 * SERVER ONLY — never import from client components.
 *
 * Server-side provider singleton for the REST API v1 routes, CLI, and MCP
 * server. Today only "sqlite" is supported (local file, zero deps via
 * node:sqlite). The hosted deployment will add "postgres" here behind the
 * same StorageProvider interface.
 */
import { SqliteStorageProvider, makeSqliteProvider } from "./sqlite-provider";
import type { StorageProvider } from "@/core/storage";

let singleton: StorageProvider | null = null;

export function getServerProvider(): StorageProvider {
  const kind = process.env.TALLYHAND_PROVIDER ?? "sqlite";
  if (kind !== "sqlite") {
    // TODO: add "postgres" for the hosted deployment (Phase 4) — implement
    // the StorageProvider interface on Drizzle/Postgres and select it here.
    throw new Error(
      `Unsupported TALLYHAND_PROVIDER="${kind}". Only "sqlite" is supported today.`,
    );
  }
  if (!singleton) {
    singleton = makeSqliteProvider();
  }
  return singleton;
}

/** Test helper: drop the cached singleton so the next getServerProvider() rebuilds. */
export function resetServerProviderForTests(): void {
  if (singleton instanceof SqliteStorageProvider) {
    try {
      singleton.close();
    } catch {
      /* ignore */
    }
  }
  singleton = null;
}
