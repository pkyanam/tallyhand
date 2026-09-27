/**
 * User management abstraction (`/api/admin/users`, admin UI).
 *
 * Works with whichever auth provider is configured:
 * - `clerk`   → Clerk Backend API (invitations, publicMetadata.role,
 *   ban/unban, delete). The FIRST admin is designated in the Clerk
 *   dashboard (Users → Public metadata → { "role": "admin" }).
 * - `builtin` → the local `builtin_users` Postgres table. The first user
 *   to sign in via magic link automatically becomes admin (bootstrap).
 * - `none`    → no directory exists; the admin UI/API are disabled (404).
 *
 * Roles: admin (manage users + everything), member (full app access),
 * viewer (read-only; enforced by `readOnlyIfViewer` in
 * `src/lib/auth/read-only.ts`, applied to the request provider).
 *
 * SERVER ONLY — dynamic requires keep provider SDKs out of the static graph.
 */
import { effectiveAuth, type TallyAuth } from "@/lib/mode";
import {
  deleteBuiltinUser,
  getBuiltinUserById,
  listBuiltinUsers,
  updateBuiltinUser,
  type BuiltinUserRow,
} from "./builtin";

export type UserRole = "admin" | "member" | "viewer";

export interface DirectoryUser {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
  disabled: boolean;
  createdAt: number;
}

export interface UserDirectory {
  readonly kind: Exclude<TallyAuth, "none">;
  listUsers(): Promise<DirectoryUser[]>;
  getUser(id: string): Promise<DirectoryUser | null>;
  inviteUser(email: string, role: UserRole): Promise<DirectoryUser>;
  setRole(id: string, role: UserRole): Promise<void>;
  setDisabled(id: string, disabled: boolean): Promise<void>;
  removeUser(id: string): Promise<void>;
}

function normalizeRole(raw: unknown): UserRole {
  return raw === "admin" || raw === "viewer" ? raw : "member";
}

// -- clerk -------------------------------------------------------------------

// Minimal structural view of the Clerk Backend API objects we touch.
// The Clerk SDK is dynamically required (hosted-only), so we type just the
// fields we read instead of depending on the SDK's types.
interface ClerkEmailAddress {
  id: string;
  emailAddress: string;
}

interface ClerkUserLike {
  id: string;
  emailAddresses?: ClerkEmailAddress[];
  primaryEmailAddressId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  publicMetadata?: { role?: unknown };
  banned?: boolean;
  createdAt?: number;
}

interface ClerkInvitationLike {
  id: string;
  emailAddress?: string;
}

type ClerkClient = {
  users: {
    getUserList: (args?: Record<string, unknown>) => Promise<{ data: ClerkUserLike[] }>;
    getUser: (id: string) => Promise<ClerkUserLike>;
    updateUser: (id: string, params: Record<string, unknown>) => Promise<unknown>;
    banUser: (id: string) => Promise<unknown>;
    unbanUser: (id: string) => Promise<unknown>;
    deleteUser: (id: string) => Promise<unknown>;
  };
  invitations: {
    createInvitation: (params: Record<string, unknown>) => Promise<ClerkInvitationLike>;
  };
};

async function clerkClient(): Promise<ClerkClient> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@clerk/nextjs/server") as Record<string, unknown>;
  const raw = mod.clerkClient as unknown;
  const client = typeof raw === "function" ? await (raw as () => Promise<unknown>)() : raw;
  return client as ClerkClient;
}

function clerkToDirectoryUser(u: ClerkUserLike): DirectoryUser {
  const email =
    u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
    u.emailAddresses?.[0]?.emailAddress ??
    "";
  return {
    id: u.id as string,
    email,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || undefined,
    role: normalizeRole(u.publicMetadata?.role),
    disabled: Boolean(u.banned),
    createdAt: typeof u.createdAt === "number" ? u.createdAt : Date.now(),
  };
}

class ClerkUserDirectory implements UserDirectory {
  readonly kind = "clerk" as const;

  async listUsers(): Promise<DirectoryUser[]> {
    const cc = await clerkClient();
    const { data } = await cc.users.getUserList({ limit: 100 });
    return data.map(clerkToDirectoryUser);
  }

  async getUser(id: string): Promise<DirectoryUser | null> {
    try {
      const cc = await clerkClient();
      return clerkToDirectoryUser(await cc.users.getUser(id));
    } catch {
      return null;
    }
  }

  async inviteUser(email: string, role: UserRole): Promise<DirectoryUser> {
    const cc = await clerkClient();
    const invitation = await cc.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { role },
      // Clerk applies publicMetadata to the user on sign-up acceptance.
    });
    return {
      id: `invitation:${invitation.id}`,
      email,
      role,
      disabled: false,
      createdAt: Date.now(),
    };
  }

  async setRole(id: string, role: UserRole): Promise<void> {
    const cc = await clerkClient();
    const existing = await cc.users.getUser(id);
    await cc.users.updateUser(id, {
      publicMetadata: { ...(existing.publicMetadata ?? {}), role },
    });
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    const cc = await clerkClient();
    if (disabled) await cc.users.banUser(id);
    else await cc.users.unbanUser(id);
  }

  async removeUser(id: string): Promise<void> {
    const cc = await clerkClient();
    await cc.users.deleteUser(id);
  }
}

// -- builtin -------------------------------------------------------------------

function builtinToDirectoryUser(row: BuiltinUserRow): DirectoryUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    role: row.role,
    disabled: row.disabled,
    createdAt: row.createdAt,
  };
}

class BuiltinUserDirectory implements UserDirectory {
  readonly kind = "builtin" as const;

  async listUsers(): Promise<DirectoryUser[]> {
    return (await listBuiltinUsers()).map(builtinToDirectoryUser);
  }

  async getUser(id: string): Promise<DirectoryUser | null> {
    const row = await getBuiltinUserById(id);
    return row ? builtinToDirectoryUser(row) : null;
  }

  async inviteUser(email: string, role: UserRole): Promise<DirectoryUser> {
    // Builtin has no email-invite primitive: create the user row directly
    // with the role pre-assigned. The invitee signs in via magic link
    // (POST /api/auth/builtin/request) whenever they're ready.
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error("Invalid email address");
    }
    const { getBuiltinUserByEmail } = await import("./builtin");
    const existing = await getBuiltinUserByEmail(normalized);
    if (existing) {
      await updateBuiltinUser(existing.id, { role });
      const updated = (await getBuiltinUserById(existing.id)) as BuiltinUserRow;
      return builtinToDirectoryUser(updated);
    }
    const { newId } = await import("@/core/id");
    const now = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query(
        `INSERT INTO builtin_users (id, email, name, role, disabled, created_at, updated_at)
         VALUES ($1, $2, NULL, $3, FALSE, $4, $4) RETURNING *`,
        [newId("usr"), normalized, role, now],
      );
      const row = rows[0];
      return {
        id: row.id as string,
        email: row.email as string,
        role,
        disabled: false,
        createdAt: Number(row.created_at),
      };
    } finally {
      await pool.end();
    }
  }

  async setRole(id: string, role: UserRole): Promise<void> {
    await updateBuiltinUser(id, { role });
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await updateBuiltinUser(id, { disabled });
  }

  async removeUser(id: string): Promise<void> {
    await deleteBuiltinUser(id);
  }
}

// -- role lookup (viewer enforcement) ----------------------------------------

const roleCache = new Map<string, { role: UserRole; expiresAt: number }>();
const ROLE_CACHE_TTL_MS = 60_000;

/**
 * Resolve a user's role for the configured auth mode. Results are cached
 * briefly (60s) to avoid a directory round-trip on every write attempt.
 *
 * Unknown users default to `member`. Lookup failures fail CLOSED (`viewer`):
 * reads keep working, but writes are denied until the directory recovers.
 */
export async function getUserRole(userId: string): Promise<UserRole> {
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;
  let role: UserRole;
  try {
    const user = await getUserDirectory().getUser(userId);
    role = user?.role ?? "member";
  } catch {
    role = "viewer";
  }
  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return role;
}

/**
 * The user directory for the configured auth provider.
 * Throws when TALLY_AUTH=none (no user management in single-user mode).
 */
export function getUserDirectory(): UserDirectory {
  const auth = effectiveAuth();
  if (auth === "clerk") return new ClerkUserDirectory();
  if (auth === "builtin") return new BuiltinUserDirectory();
  throw new Error("User management is disabled when TALLY_AUTH=none");
}
