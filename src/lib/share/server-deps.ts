/**
 * SERVER ONLY — builds ShareDeps from env + the server provider.
 * `ownerProvider` is scoped to the current request's user via the lazy
 * auth resolver; `providerForUser` scopes to an explicit user id (used by
 * share-token resolution to load the LINK OWNER's data).
 */
import { getServerProvider, getServerProviderForUser } from "@/server/provider";
import type { StorageProvider } from "@/core/storage";
import type { HostedStorageProvider } from "@/lib/db/hosted-types";
import { shareSecretFromEnv, type ShareDeps } from "./service";

/**
 * Share links are a hosted feature: they need the Postgres/Convex provider
 * surface. Guard the cast so a misconfigured instance fails with a clear
 * error instead of `provider.createShareLink is not a function`.
 */
function asHosted(p: StorageProvider): HostedStorageProvider {
  if (typeof (p as Partial<HostedStorageProvider>).createShareLink !== "function") {
    throw new Error("Share links require TALLY_STORAGE=postgres or TALLY_STORAGE=convex");
  }
  return p as HostedStorageProvider;
}

export function getShareDeps(): ShareDeps {
  return {
    ownerProvider: asHosted(getServerProvider()),
    providerForUser: (userId: string) => asHosted(getServerProviderForUser(userId)),
    shareSecret: shareSecretFromEnv(),
    baseUrl: process.env.APP_BASE_URL ?? "",
  };
}
