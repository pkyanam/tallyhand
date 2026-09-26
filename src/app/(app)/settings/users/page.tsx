/**
 * /settings/users — user management inside Settings (admin-only).
 * Reuses the admin user console; hidden/disabled when TALLY_AUTH=none.
 * (The existing /settings page itself is untouched by this track.)
 */
import { parseAuth } from "@/lib/mode";
import { UsersAdmin } from "../../../admin/users/users-admin";

export default function SettingsUsersPage() {
  if (parseAuth() === "none") {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          User management is disabled in single-user local mode
          (TALLY_AUTH=none). Configure TALLY_AUTH=clerk or TALLY_AUTH=builtin
          to manage users.
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
