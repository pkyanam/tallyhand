"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  FinancialGrant,
  FinancialAction,
} from "@/core/financial/authority";

type Token = { id: string; name: string };
type Connection = {
  connected: boolean;
  accountId?: string;
  livemode?: boolean;
};
export function amountToMinorUnits(amount: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return units > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(units);
}
function displayAmount(units: number, currency: string): string {
  const cents = BigInt(units);
  return `${currency} ${(cents / 100n).toLocaleString("en-US")}.${String(cents % 100n).padStart(2, "0")}`;
}
async function read<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok)
    throw Object.assign(
      new Error("Could not load payment permissions. Try again."),
      { status: r.status },
    );
  return (await r.json()).data;
}
const labels: Record<FinancialAction, string> = {
  read: "Read payment records",
  collect: "Collect invoice payments",
  reconcile: "Refresh payment status",
};
export function FinancialGrantsCard() {
  const [tokens, setTokens] = React.useState<Token[]>([]),
    [grants, setGrants] = React.useState<FinancialGrant[]>([]),
    [connection, setConnection] = React.useState<Connection | null>(null);
  const [tokenId, setTokenId] = React.useState(""),
    [actions, setActions] = React.useState<FinancialAction[]>([]),
    [currency, setCurrency] = React.useState<"USD" | "EUR">("USD"),
    [amount, setAmount] = React.useState("");
  const [loading, setLoading] = React.useState(true),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [readOnly, setReadOnly] = React.useState(false),
    [notice, setNotice] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, g, c] = await Promise.all([
        read<Token[]>("/api/v1/api-tokens"),
        read<FinancialGrant[]>("/api/v1/financial/grants"),
        read<Connection>("/api/v1/stripe/connect/status"),
      ]);
      setTokens(t);
      setGrants(g);
      setConnection(c);
      setReadOnly(false);
    } catch (e) {
      if ((e as { status?: number }).status === 403) setReadOnly(true);
      else
        setError(
          e instanceof Error
            ? e.message
            : "Could not load payment permissions.",
        );
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  const units = amountToMinorUnits(amount),
    valid =
      !!connection?.connected &&
      !!connection.accountId &&
      tokens.some((t) => t.id === tokenId) &&
      actions.length > 0 &&
      units !== null;
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy || readOnly) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/v1/financial/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principal: { kind: "api-token", tokenId },
          actions,
          accountId: connection!.accountId,
          mode: connection!.livemode ? "live" : "test",
          currency,
          maxMinorUnits: units,
        }),
      });
      if (!r.ok)
        throw new Error(
          "Could not create this permission. Check your connection and try again.",
        );
      const grant = (await r.json()).data as FinancialGrant;
      setGrants((g) => [grant, ...g]);
      setActions([]);
      setAmount("");
      setNotice("Payment permission created. Copy its ID for your agent.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create permission.");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(
        `/api/v1/financial/grants?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!r.ok || (await r.json()).data?.revoked !== true)
        throw new Error(
          "Could not revoke this permission. It may still be active. Try again.",
        );
      setGrants((g) =>
        g.map((x) => (x.id === id ? { ...x, revokedAt: Date.now() } : x)),
      );
      setNotice("Payment permission revoked.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke permission.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent payment permissions</CardTitle>
        <CardDescription>
          Choose which payment actions an existing agent token may perform. Each
          permission applies to your connected Stripe account and its current
          test or live mode.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p>Loading payment permissions…</p>
        ) : readOnly ? (
          <p>You need owner access to manage payment permissions.</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
            {!connection && (
              <Button variant="outline" onClick={() => void load()}>
                Retry payment permissions
              </Button>
            )}
            {connection?.connected && connection.accountId ? (
              <form onSubmit={(e) => void create(e)} className="space-y-4">
                <p className="text-sm">
                  Stripe account {connection.accountId} ·{" "}
                  {connection.livemode ? "Live payments" : "Test payments"}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="financial-token">Agent token</Label>
                  <select
                    id="financial-token"
                    className="w-full rounded-md border p-2"
                    value={tokenId}
                    disabled={busy}
                    onChange={(e) => setTokenId(e.target.value)}
                  >
                    <option value="">Choose a token</option>
                    {tokens.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.id})
                      </option>
                    ))}
                  </select>
                  {tokens.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Create an agent token in Connect before granting payment
                      permissions.
                    </p>
                  )}
                </div>
                <fieldset disabled={busy} className="space-y-2">
                  <legend className="text-sm font-medium">
                    Allowed actions
                  </legend>
                  {(Object.keys(labels) as FinancialAction[]).map((action) => (
                    <label
                      key={action}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={actions.includes(action)}
                        onChange={(e) =>
                          setActions((a) =>
                            e.target.checked
                              ? [...a, action]
                              : a.filter((x) => x !== action),
                          )
                        }
                      />
                      {labels[action]}
                    </label>
                  ))}
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="financial-currency">Currency</Label>
                    <select
                      id="financial-currency"
                      className="w-full rounded-md border p-2"
                      value={currency}
                      disabled={busy}
                      onChange={(e) =>
                        setCurrency(e.target.value as "USD" | "EUR")
                      }
                    >
                      <option>USD</option>
                      <option>EUR</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="financial-limit">
                      Maximum per collection
                    </Label>
                    <Input
                      id="financial-limit"
                      inputMode="decimal"
                      value={amount}
                      disabled={busy}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="100.00"
                    />
                    {amount !== "" && units === null && (
                      <p className="text-sm text-destructive">
                        Enter a nonnegative amount with up to two decimal
                        places.
                      </p>
                    )}
                  </div>
                </div>
                {valid && (
                  <p className="text-sm">
                    Allow {tokens.find((t) => t.id === tokenId)?.name} to{" "}
                    {actions.map((a) => labels[a].toLowerCase()).join(", ")} for{" "}
                    {connection.livemode ? "live" : "test"} payments in{" "}
                    {currency}, up to {displayAmount(units!, currency)} per
                    collection.
                  </p>
                )}
                <Button type="submit" disabled={!valid || busy}>
                  Grant payment permission
                </Button>
              </form>
            ) : (
              connection && (
                <p className="text-sm text-muted-foreground">
                  Connect Stripe to grant payment permissions.
                </p>
              )
            )}
            <ul className="space-y-3">
              {grants.map((g) => (
                <li key={g.id} className="rounded-md border p-3 space-y-2">
                  <p className="text-sm">
                    {g.principal.kind === "api-token"
                      ? (tokens.find(
                          (t) =>
                            t.id ===
                            (g.principal.kind === "api-token"
                              ? g.principal.tokenId
                              : ""),
                        )?.name ?? "Agent token")
                      : "Connected agent"}{" "}
                    · {g.mode === "live" ? "Live" : "Test"} ·{" "}
                    {g.actions.map((a) => labels[a]).join(", ")}
                  </p>
                  <p className="text-sm">
                    {g.accountId} · {g.currency} · Maximum{" "}
                    {displayAmount(g.maxMinorUnits, g.currency)}
                  </p>
                  <code className="break-all text-xs">{g.id}</code>
                  <div className="flex gap-2">
                    {g.revokedAt !== null ? (
                      <span className="text-sm text-muted-foreground">
                        Revoked
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(g.id)
                              .then(() => setNotice("Permission ID copied."))
                              .catch(() =>
                                setError(
                                  "Could not copy. Select the permission ID above.",
                                ),
                              )
                          }
                        >
                          Copy permission ID
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void revoke(g.id)}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
