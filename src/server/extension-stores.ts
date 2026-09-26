/**
 * SERVER ONLY — never import from client components.
 *
 * Resolves the optional extension-store methods (mileage entries,
 * contracts, tax payments, rate cards) from a StorageProvider.
 *
 * These entities were added to the StorageProvider interface as OPTIONAL
 * methods, so older providers (Postgres, Convex) don't have them. Routes
 * must not crash with `fn is not a function`; instead they answer 501
 * `{ error: { code: "not_supported", ... } }`.
 */

import type { StorageProvider } from "@/core/storage";
import { json } from "./http";

export type ExtStoreResult<K extends keyof StorageProvider> =
  | { fn: NonNullable<StorageProvider[K]> }
  | { response: Response };

/**
 * Resolve and bind an optional extension-store method. Check the result
 * with `"response" in result` and return the 501 when unsupported.
 */
export function extStore<K extends keyof StorageProvider>(
  provider: StorageProvider,
  key: K,
): ExtStoreResult<K> {
  const fn: unknown = provider[key];
  if (typeof fn !== "function") {
    return {
      response: json(
        {
          error: {
            code: "not_supported",
            message: `"${String(key)}" is not supported by the "${provider.providerName}" storage provider.`,
          },
        },
        501,
      ),
    };
  }
  return {
    fn: fn.bind(provider) as NonNullable<StorageProvider[K]>,
  };
}
