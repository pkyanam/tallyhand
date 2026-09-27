/**
 * SERVER ONLY — never import from client components.
 *
 * Compatibility entry point for the original POST-only server wrapper.
 * Implementation delegates to the API wrapper, which now selects local or
 * cloud persistence by mode and fails open on every storage error.
 *
 * TTL note: keys conceptually live 24h; there is no cleanup job in v1.
 */
export { withIdempotency } from "@/app/api/v1/_lib/idempotency";
