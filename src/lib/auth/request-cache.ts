/** Deduplicate credential checks only within one request; never cache grants across users/requests. */
import { AsyncLocalStorage } from "node:async_hooks";
const requestCache = new AsyncLocalStorage<Map<string, Promise<unknown>>>();
export function withRequestAuthCache<T>(fn: () => Promise<T>): Promise<T> {
  return requestCache.run(new Map(), fn);
}
export function memoRequestAuth<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cache = requestCache.getStore();
  if (!cache) return fn();
  const existing = cache.get(key); if (existing) return existing as Promise<T>;
  const pending = fn(); cache.set(key, pending); return pending;
}

/** Boundary wrapper for REST handlers; nested MCP dispatch retains its request cache. */
export function withApiRequestCache<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return (...args: Args): Promise<Response> => requestCache.getStore()
    ? handler(...args)
    : withRequestAuthCache(() => handler(...args));
}
