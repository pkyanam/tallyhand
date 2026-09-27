/**
 * /admin/users — user management UI (admin-only).
 * Hidden/disabled when TALLY_AUTH=none (single-user local mode).
 */
import { effectiveAuth } from "@/lib/mode";
import { UsersAdmin } from "./users-admin";

export default function AdminUsersPage() {
  if (effectiveAuth() === "none") {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          User management is disabled in single-user local mode (TALLY_AUTH=none). Configure
          TALLY_AUTH=clerk or TALLY_AUTH=builtin to manage users.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Invite users, assign roles, disable or remove accounts.
      </p>
      <UsersAdmin />
    </main>
  );
}
