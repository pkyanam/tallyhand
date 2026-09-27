/**
 * Tallyhand deployment configuration — env-driven, no TALLYHAND_MODE.
 *
 * Two orthogonal knobs:
 * - `TALLY_STORAGE=dexie|sqlite|postgres|neon|convex` (default `dexie`):
 *   which StorageProvider the server uses. `dexie` is the browser default;
 *   server-side code (API routes, CLI) falls back to the local `sqlite`
 *   file backend when `dexie` is selected, since IndexedDB doesn't exist
 *   server-side. `neon` is Postgres over Neon's serverless HTTP driver
 *   (no long-lived connections — safe for scale-to-zero serverless
 *   deployments); `postgres` keeps the node-pg Pool for self-hosted Docker.
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
 * "Hosted" is derived, not configured: hosted mode is on when the storage
 * backend is shared (`postgres`/`neon`/`convex`) or any real auth is
 * configured.
 *
 * Pure and dependency-free: reads from an injectable env record so it is
 * trivially testable and safe to import anywhere (it never leaks secret
 * values, only the parsed config).
 */

export type TallyStorage = "dexie" | "sqlite" | "postgres" | "neon" | "convex";
export type TallyAuth = "clerk" | "builtin" | "none";

export interface TallyConfig {
  storage: TallyStorage;
  auth: TallyAuth;
  /** Derived: true when storage is shared or any real auth is configured. */
  hosted: boolean;
}

const STORAGES: TallyStorage[] = ["dexie", "sqlite", "postgres", "neon", "convex"];
const AUTHS: TallyAuth[] = ["clerk", "builtin", "none"];

/**
 * True when the URL points at a Neon database. Used to auto-select the
 * serverless HTTP driver when no explicit storage is configured but a Neon
 * DATABASE_URL is present — a plain pg Pool is unreliable on scale-to-zero
 * serverless hosts (Vercel), where the HTTP driver is the correct pick.
 * An explicit TALLY_STORAGE/TALLY_DB always wins over auto-detection.
 */
export function isNeonDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

export function parseStorage(
  env: Record<string, string | undefined> = process.env,
): TallyStorage {
  const explicit = (env.TALLY_STORAGE ?? "").trim().toLowerCase();
  if (explicit) {
    // An explicit (even invalid) TALLY_STORAGE wins: invalid falls back to
    // the local default rather than silently routing at a cloud database.
    return (STORAGES as string[]).includes(explicit)
      ? (explicit as TallyStorage)
      : "dexie";
  }
  const alias = (env.TALLY_DB ?? "").trim().toLowerCase();
  if (alias) {
    return (STORAGES as string[]).includes(alias)
      ? (alias as TallyStorage)
      : "dexie";
  }
  // Auto-detect: no explicit selection, but a Neon DATABASE_URL is present —
  // pick the serverless HTTP driver (Vercel-safe), not the node-pg Pool.
  if (isNeonDatabaseUrl(env.DATABASE_URL)) return "neon";
  return "dexie";
}

export function parseAuth(
  env: Record<string, string | undefined> = process.env,
): TallyAuth {
  const raw = (env.TALLY_AUTH ?? "").trim().toLowerCase();
  return (AUTHS as string[]).includes(raw) ? (raw as TallyAuth) : "none";
}

/**
 * The Clerk publishable key, from either the runtime server env var
 * (preferred: rotatable without a rebuild) or the conventional
 * NEXT_PUBLIC_* name (accepted as an alias for operators who already
 * set it in their hosting dashboard).
 */
export function clerkPublishableKey(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    (env.CLERK_PUBLISHABLE_KEY ?? "").trim() ||
    (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").trim()
  );
}

/** True when both Clerk keys are present (enough to run Clerk auth). */
export function hasClerkKeys(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    clerkPublishableKey(env).length > 0 &&
    (env.CLERK_SECRET_KEY ?? "").trim().length > 0
  );
}

/**
 * The auth mode actually enforced at runtime.
 *
 * Same as parseAuth(), except: when TALLY_AUTH is absent entirely but both
 * Clerk keys are present, the deployment auto-detects `clerk` — pasting
 * the two keys into the hosting dashboard is enough, no TALLY_AUTH edit
 * needed. An explicit TALLY_AUTH (including `none`, even with Clerk keys
 * present) always wins, so single-user local mode keeps today's behavior
 * byte-for-byte.
 *
 * Use this (not parseAuth) for every auth-mode decision: middleware,
 * session resolution, user directory, and UI gating.
 */
export function effectiveAuth(
  env: Record<string, string | undefined> = process.env,
): TallyAuth {
  const explicit = parseAuth(env);
  // An explicit knob always wins (explicit "none" keeps single-user local
  // behavior byte-for-byte, even when Clerk keys happen to be set). Clerk is
  // auto-detected only when TALLY_AUTH is absent entirely — the default
  // Vercel deploy path.
  if (explicit !== "none" || env.TALLY_AUTH !== undefined) return explicit;
  return hasClerkKeys(env) ? "clerk" : "none";
}

/** Derived hosted flag: shared storage or any real auth. */
export function isHosted(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const storage = parseStorage(env);
  const auth = parseAuth(env);
  return (
    storage === "postgres" ||
    storage === "neon" ||
    storage === "convex" ||
    auth !== "none"
  );
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
  if (storage === "neon" && !env.DATABASE_URL) {
    problems.push("TALLY_STORAGE=neon requires DATABASE_URL (a Neon connection string)");
  }
  if (storage === "convex" && !env.CONVEX_URL) {
    problems.push("TALLY_STORAGE=convex requires CONVEX_URL");
  }
  if (auth === "clerk") {
    if (!clerkPublishableKey(env))
      problems.push(
        "TALLY_AUTH=clerk requires CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)",
      );
    if (!env.CLERK_SECRET_KEY) problems.push("TALLY_AUTH=clerk requires CLERK_SECRET_KEY");
  }
  if (auth === "builtin") {
    if (storage !== "postgres" && storage !== "neon") {
      problems.push("TALLY_AUTH=builtin requires TALLY_STORAGE=postgres or neon (magic-link users/tokens live in Postgres)");
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
