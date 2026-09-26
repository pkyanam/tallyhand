"use client";

/**
 * User management console: list, invite, role changes, disable/enable,
 * remove. Talks to /api/admin/users (admin-only).
 */
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  UserPlus,
  Loader2,
  ShieldAlert,
  Trash2,
  UserX,
  UserCheck,
} from "lucide-react";

const ROLES = ["admin", "member", "viewer"] as const;

interface DirectoryUser {
  id: string;
  email: string;
  name?: string;
  role: (typeof ROLES)[number];
  disabled: boolean;
  createdAt: number;
}

const InviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(ROLES),
});
type InviteValues = z.infer<typeof InviteSchema>;

export function UsersAdmin() {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(InviteSchema),
    defaultValues: { role: "member" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load users");
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(values: InviteValues) {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Invite failed");
    reset();
    await load();
  }

  async function mutate(id: string, init: RequestInit, label: string) {
    setBusy(id + label);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  const patch = (id: string, body: unknown) =>
    mutate(id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "patch");
  const remove = (id: string) =>
    confirm("Remove this user? They will lose access immediately.") &&
    mutate(id, { method: "DELETE" }, "delete");

  return (
    <div className="mt-6 space-y-8">
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <UserPlus className="h-4 w-4" /> Invite user
        </h2>
        <form
          onSubmit={handleSubmit(invite, (e) =>
            setError(Object.values(e)[0]?.message as string),
          )}
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1.5">
            <label htmlFor="invite-email" className="text-xs font-medium">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              placeholder="teammate@example.com"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              {...register("email")}
            />
            {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="invite-role" className="text-xs font-medium">
              Role
            </label>
            <select
              id="invite-role"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              {...register("role")}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Team</h2>
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {u.name ?? u.email}
                    {u.disabled && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        disabled
                      </span>
                    )}
                  </p>
                  {u.name && <p className="truncate text-xs text-muted-foreground">{u.email}</p>}
                </div>
                <select
                  aria-label={`Role for ${u.email}`}
                  value={u.role}
                  disabled={busy !== null}
                  onChange={(e) => patch(u.id, { role: e.target.value })}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title={u.disabled ? "Enable" : "Disable"}
                  disabled={busy !== null}
                  onClick={() => patch(u.id, { disabled: !u.disabled })}
                  className="rounded-md border p-1.5 hover:bg-muted disabled:opacity-50"
                >
                  {u.disabled ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  title="Remove"
                  disabled={busy !== null}
                  onClick={() => remove(u.id)}
                  className="rounded-md border p-1.5 hover:bg-muted disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </button>
              </li>
            ))}
            {users.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground">No users yet.</li>
            )}
          </ul>
        )}
      </section>

      {error && (
        <p className="flex items-center gap-2 text-sm text-red-600">
          <ShieldAlert className="h-4 w-4" /> {error}
        </p>
      )}
    </div>
  );
}
