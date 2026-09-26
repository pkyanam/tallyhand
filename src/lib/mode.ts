/**
 * Tallyhand deployment configuration — env-driven, no TALLYHAND_MODE.
 *
 * Two orthogonal knobs:
 * - `TALLY_STORAGE=dexie|sqlite|postgres|convex` (default `dexie`):
 *   which StorageProvider the server uses. `dexie` is the browser default;
 *   server-side code (API routes, CLI) falls back to the local `sqlite`
 *   file backend when `dexie` is selected, since IndexedDB doesn't exist
 *   server-side.
 * - `TALLY_AUTH=clerk|builtin|none` (default `none`):
 *   `clerk` (hosted pick), `builtin` (email magic-link for self-hosters),
 *   `none` (single-user local, no auth).
 *
 * "Hosted" is derived, not configured: hosted mode is on when the storage
 * backend is shared (`postgres`/`convex`) or any real auth is configured.
 * Local mode (`sqlite`/`dexie` storage + `auth=none`) behaves exactly as
 * Tallyhand always has: no accounts, no login, single user.
 *
 * Per-user data isolation is enforced whenever `auth != "none"` — every
 * provider query is scoped by the authenticated userId.
 *
 * Pure and dependency-free: reads from an injectable env record so it is
 * trivially testable and safe to import anywhere (it never leaks secret
 * values, only the parsed config).
 */

export type TallyStorage = "dexie" | "sqlite" | "postgres" | "convex";
export type TallyAuth = "clerk" | "builtin" | "none";

export interface TallyConfig {
  storage: TallyStorage;
  auth: TallyAuth;
  /** Derived: true when storage is shared or any real auth is configured. */
  hosted: boolean;
}

const STORAGES: TallyStorage[] = ["dexie", "sqlite", "postgres", "convex"];
const AUTHS: TallyAuth[] = ["clerk", "builtin", "none"];

export function parseStorage(
  env: Record<string, string | undefined> = process.env,
): TallyStorage {
  const raw = (env.TALLY_STORAGE ?? "").trim().toLowerCase();
  return (STORAGES as string[]).includes(raw) ? (raw as TallyStorage) : "dexie";
}

export function parseAuth(
  env: Record<string, string | undefined> = process.env,
): TallyAuth {
  const raw = (env.TALLY_AUTH ?? "").trim().toLowerCase();
  return (AUTHS as string[]).includes(raw) ? (raw as TallyAuth) : "none";
}

/** Derived hosted flag: shared storage or any real auth. */
export function isHosted(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const storage = parseStorage(env);
  const auth = parseAuth(env);
  return storage === "postgres" || storage === "convex" || auth !== "none";
}

export function getConfig(
  env: Record<string, string | undefined> = process.env,
): TallyConfig {
  return { storage: parseStorage(env), auth: parseAuth(env), hosted: isHosted(env) };
}

/**
 * Validate the env contract for the selected storage+auth combination.
 * Returns a list of human-readable problems (empty = valid). Call at
 * startup / in hosted-only code paths and fail fast.
 */
export function validateConfig(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const problems: string[] = [];
  const { storage, auth, hosted } = getConfig(env);

  if (storage === "postgres" && !env.DATABASE_URL) {
    problems.push("TALLY_STORAGE=postgres requires DATABASE_URL");
  }
  if (storage === "convex" && !env.CONVEX_URL) {
    problems.push("TALLY_STORAGE=convex requires CONVEX_URL");
  }
  if (auth === "clerk") {
    if (!env.CLERK_PUBLISHABLE_KEY) problems.push("TALLY_AUTH=clerk requires CLERK_PUBLISHABLE_KEY");
    if (!env.CLERK_SECRET_KEY) problems.push("TALLY_AUTH=clerk requires CLERK_SECRET_KEY");
  }
  if (auth === "builtin") {
    if (storage !== "postgres") {
      problems.push("TALLY_AUTH=builtin requires TALLY_STORAGE=postgres (magic-link users/tokens live in Postgres)");
    }
    if ((env.BUILTIN_AUTH_SECRET ?? "").length < 32) {
      problems.push("TALLY_AUTH=builtin requires BUILTIN_AUTH_SECRET (min 32 chars)");
    }
    if (!env.APP_BASE_URL) {
      problems.push("TALLY_AUTH=builtin requires APP_BASE_URL (to build magic-link URLs)");
    }
  }
  if (hosted && (env.TALLY_SHARE_SECRET ?? "").length < 32) {
    problems.push("hosted mode requires TALLY_SHARE_SECRET (min 32 chars) for signed share links");
  }
  return problems;
}

/** Throw with a clear message when the env contract is violated. */
export function requireValidConfig(
  env: Record<string, string | undefined> = process.env,
): TallyConfig {
  const problems = validateConfig(env);
  if (problems.length > 0) {
    throw new Error(
      `Invalid Tallyhand configuration:\n- ${problems.join("\n- ")}\nSee .env.example.`,
    );
  }
  return getConfig(env);
}
