"use client";

/**
 * Settings → Connect: personal API tokens + integration setup docs.
 *
 * Tokens are created/revoked through the session-authed
 * /api/v1/api-tokens endpoints (a raw token is shown exactly once, at
 * creation; only its SHA-256 hash is stored server-side). The docs below
 * use this deployment's own origin as the base URL, so every command and
 * snippet works as pasted — with your token in place of <your-token>.
 */
import * as React from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/app/page-header";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

function CodeBlock({ code, copyLabel }: { code: string; copyLabel: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-[13px] leading-relaxed">
        {code}
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton text={code} label={copyLabel} />
      </div>
    </div>
  );
}

export function ConnectClient() {
  const [tokens, setTokens] = React.useState<ApiToken[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [newToken, setNewToken] = React.useState<{
    token: string;
    name: string;
  } | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [baseUrl, setBaseUrl] = React.useState("https://tallyhand.vercel.app");

  React.useEffect(() => {
    setBaseUrl(window.location.origin);
    void fetch("/api/v1/api-tokens")
      .then(async (res) => {
        if (res.status === 401) {
          setLoadError("signed-out");
          return;
        }
        if (!res.ok) {
          setLoadError(`Request failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { data: ApiToken[] };
        setTokens(body.data);
      })
      .catch(() => setLoadError("Could not reach the server."));
  }, []);

  const createToken = async () => {
    setCreating(true);
    setNewToken(null);
    try {
      const res = await fetch("/api/v1/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = (await res.json()) as {
        data: { id: string; name: string; token: string };
      };
      setNewToken({ token: body.data.token, name: body.data.name });
      setName("");
      const list = await fetch("/api/v1/api-tokens").then((r) => r.json()) as {
        data: ApiToken[];
      };
      setTokens(list.data);
    } catch {
      setLoadError("Could not create the token — try again.");
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (id: string, tokenName: string) => {
    if (!window.confirm(`Revoke the token "${tokenName}"? This can't be undone.`)) {
      return;
    }
    setRevoking(id);
    try {
      const res = await fetch(`/api/v1/api-tokens/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setTokens((prev) => (prev ?? []).filter((t) => t.id !== id));
    } catch {
      setLoadError("Could not revoke the token — try again.");
    } finally {
      setRevoking(null);
    }
  };

  const cliSetup = [
    "# Point the CLI at this deployment",
    `tally config set api-url ${baseUrl}`,
    "",
    "# Store your personal token (shown once, above)",
    "tally config set token <your-token>",
    "",
    "# Verify reachability + auth",
    "tally doctor",
  ].join("\n");

  const cliEnv = [
    "# …or configure via environment instead of the config file:",
    `export TALLYHAND_API_URL=${baseUrl}`,
    "export TALLYHAND_API_TOKEN=<your-token>",
    "# (a single command can also take --token <your-token>)",
  ].join("\n");

  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        tallyhand: {
          type: "http",
          url: `${baseUrl}/api/mcp`,
          headers: { Authorization: "Bearer <your-token>" },
        },
      },
    },
    null,
    2,
  );

  const mcpClaude = [
    "# Claude Code:",
    `claude mcp add --transport http tallyhand ${baseUrl}/api/mcp \\`,
    `  --header "Authorization: Bearer <your-token>"`,
  ].join("\n");

  const restCurl = [
    "# List clients",
    `curl -H "Authorization: Bearer <your-token>" \\`,
    `  ${baseUrl}/api/v1/clients`,
    "",
    "# Start a timer (open task: endAt 0)",
    `curl -X POST -H "Authorization: Bearer <your-token>" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"projectId":"<project-id>","name":"Deep work","startAt":1758330000000,"endAt":0}' \\`,
    `  ${baseUrl}/api/v1/tasks`,
  ].join("\n");

  return (
    <>
      <PageHeader
        title="Connect"
        description="Personal API tokens and setup guides for the CLI, MCP clients, and the REST API."
      />

      <div className="mx-auto grid max-w-3xl gap-6">
        {/* ------------------------------------------------ tokens */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              API tokens
            </CardTitle>
            <CardDescription>
              Long-lived tokens for the CLI, MCP clients, and scripts. Each
              token acts as you — keep them secret. Only the token hash is
              stored on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {loadError === "signed-out" ? (
              <p className="text-sm text-muted-foreground">
                Sign in to manage API tokens.{" "}
                <a href="/login" className="underline underline-offset-4">
                  Go to sign in
                </a>
              </p>
            ) : loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : tokens === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                {newToken && (
                  <div
                    role="alert"
                    className="rounded-lg border-2 border-foreground p-4"
                  >
                    <p className="text-sm font-semibold">
                      Token created — copy it now. It won’t be shown again.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded bg-muted px-3 py-2 font-mono text-sm">
                        {newToken.token}
                      </code>
                      <CopyButton text={newToken.token} label="Copy new token" />
                    </div>
                  </div>
                )}

                {tokens.length === 0 && !newToken ? (
                  <p className="text-sm text-muted-foreground">
                    No tokens yet. Create one to connect the CLI or an AI
                    agent.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {tokens.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{t.name}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {t.prefix}…
                            <span className="ml-2">
                              created {formatDate(t.createdAt)}
                              {t.lastUsedAt
                                ? ` · last used ${formatDate(t.lastUsedAt)}`
                                : " · never used"}
                            </span>
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={revoking === t.id}
                          onClick={() => void revokeToken(t.id, t.name)}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" />
                          {revoking === t.id ? "Revoking…" : "Revoke"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="grid gap-2 border-t pt-4">
                  <Label htmlFor="token-name">New token name</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="token-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. MacBook CLI"
                      maxLength={64}
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      onClick={() => void createToken()}
                      disabled={creating}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      {creating ? "Creating…" : "Create token"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------ CLI */}
        <Card>
          <CardHeader>
            <CardTitle>CLI setup</CardTitle>
            <CardDescription>
              The <code className="font-mono">tally</code> command-line tool
              talks to this deployment over HTTPS with your token.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <CodeBlock code={cliSetup} copyLabel="Copy CLI setup commands" />
            <CodeBlock code={cliEnv} copyLabel="Copy env var setup" />
            <p className="text-xs text-muted-foreground">
              <code className="font-mono">tally config set token</code> warns
              that the token is stored in plaintext at{" "}
              <code className="font-mono">~/.tallyhand/config.json</code> —
              that’s expected; treat the file like a password.
            </p>
          </CardContent>
        </Card>

        {/* ------------------------------------------------ MCP */}
        <Card>
          <CardHeader>
            <CardTitle>MCP client setup</CardTitle>
            <CardDescription>
              Any MCP client that speaks streamable HTTP can use Tallyhand’s
              tools at <code className="font-mono">/api/mcp</code> with your
              token as a <code className="font-mono">Bearer</code> token.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <CodeBlock code={mcpJson} copyLabel="Copy MCP JSON config" />
            <CodeBlock code={mcpClaude} copyLabel="Copy Claude Code command" />
          </CardContent>
        </Card>

        {/* ------------------------------------------------ REST */}
        <Card>
          <CardHeader>
            <CardTitle>REST API</CardTitle>
            <CardDescription>
              The same token authenticates{" "}
              <code className="font-mono">/api/v1</code> as{" "}
              <code className="font-mono">Authorization: Bearer &lt;your-token&gt;</code>
              . Full reference at{" "}
              <code className="font-mono">{baseUrl}/api/v1/openapi.json</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={restCurl} copyLabel="Copy curl examples" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
