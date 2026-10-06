import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { oauthLogin, createPkce, validState, oauthOrigin, oauthAccessToken, authStatus, logout } from "../src/oauth-login.js";
import { writeFileConfig, readFileConfig, TallyhandClient } from "../src/client.js";
const path = () => join(mkdtempSync(join(tmpdir(), "tally-oauth-")), "config.json");
const grant = { origin: "https://tally.test", resource: "https://tally.test/api/mcp", issuer: "https://clerk.test", clientId: "https://tally.test/.well-known/tally-cli.json", tokenEndpoint: "https://clerk.test/token", accessToken: "old-secret", refreshToken: "refresh-secret", expiresAt: 1, scope: "tally:read" };
describe("OAuth credentials", () => {
  it("uses fresh S256 PKCE and constant-time state validation", () => {
    const a = createPkce(), b = createPkce();
    expect(a.verifier.length).toBe(43);
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
    expect(a.state).not.toBe(b.state); expect(validState(a.state, a.state)).toBe(true);
    expect(validState(null, a.state)).toBe(false); expect(validState("wrong", a.state)).toBe(false);
  });
  it("rejects wrong loopback state before exchanging the correct PKCE code", async () => {
    const configPath = path(); let authorization: URL | undefined;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth-protected-resource")) return Response.json({ resource: grant.resource, authorization_servers: [grant.issuer] });
      if (url.includes("oauth-authorization-server")) return Response.json({ issuer: grant.issuer, authorization_endpoint: `${grant.issuer}/authorize`, token_endpoint: grant.tokenEndpoint, code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true, scopes_supported: ["tally:read", "offline_access"] });
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code")).toBe("approved-code"); expect(body.get("resource")).toBe(grant.resource);
      expect(authorization!.searchParams.get("scope")).toContain("offline_access");
      expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(authorization!.searchParams.get("code_challenge"));
      return Response.json({ access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600, token_type: "Bearer" });
    }) as unknown as typeof fetch;
    let callbackCheck: Promise<void> | undefined;
    const result = await oauthLogin({ baseUrl: grant.origin, noOpen: true, agentid: true, configPath, fetcher, timeoutMs: 5000, onAuthorization(workflow) {
      const browser = new URL(workflow.authorizationUrl);
      expect(browser.pathname).toBe("/login/agentid");
      const continuation = new URL(browser.searchParams.get("next")!, grant.origin);
      expect(continuation.pathname).toBe("/login/oauth/continue");
      authorization = new URL(continuation.searchParams.get("authorization_url")!);
      expect(authorization.searchParams.has("login_hint")).toBe(false);
      callbackCheck = (async () => {
        const callback = new URL(workflow.redirectUri); callback.searchParams.set("state", "wrong"); callback.searchParams.set("code", "approved-code");
        expect((await fetch(callback)).status).toBe(400);
        callback.searchParams.set("state", authorization!.searchParams.get("state")!);
        expect((await fetch(callback)).status).toBe(200);
      })();
    } });
    await callbackCheck; expect(result.status).toBe("authenticated"); expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("requires safe origins", () => {
    for (const url of ["http://remote.test", "https://user:secret@tally.test", "https://tally.test?token=secret"]) expect(() => oauthOrigin(url)).toThrow();
    expect(oauthOrigin("http://127.0.0.1:3000/api/v1")).toBe("http://127.0.0.1:3000");
  });
  it("refreshes once, rotates credentials and keeps storage private", async () => {
    const configPath = path(); writeFileConfig({ oauth: grant }, configPath);
    const fetcher = vi.fn(async (_url, init) => { expect(String(init?.body)).toContain("resource=https%3A%2F%2Ftally.test%2Fapi%2Fmcp"); return Response.json({ access_token: "new-secret", refresh_token: "rotated-secret", expires_in: 3600, token_type: "Bearer" }); }) as unknown as typeof fetch;
    expect(await Promise.all([oauthAccessToken(grant.origin, false, configPath, fetcher), oauthAccessToken(grant.origin, false, configPath, fetcher)])).toEqual(["new-secret", "new-secret"]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(readFileConfig(configPath).oauth?.refreshToken).toBe("rotated-secret");
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(authStatus(grant.origin, configPath))).not.toContain("secret");
  });
  it("does not resurrect a session when logout completes during refresh", async () => {
    const configPath=path(); writeFileConfig({oauth:grant},configPath);
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve=>{finish=resolve;})) as unknown as typeof fetch;
    const refresh=oauthAccessToken(grant.origin,false,configPath,fetcher);
    await logout(grant.origin,configPath);
    finish(Response.json({access_token:"new-secret",refresh_token:"rotated-secret",expires_in:3600,token_type:"Bearer"}));
    await expect(refresh).rejects.toThrow("credentials changed");expect(readFileConfig(configPath).oauth).toBeUndefined();
  });
  it("never refreshes for another origin or leaked endpoint", async () => {
    const configPath = path(), fetcher = vi.fn() as unknown as typeof fetch;
    writeFileConfig({ oauth: grant }, configPath);
    await expect(oauthAccessToken("https://other.test", false, configPath, fetcher)).rejects.toThrow("No OAuth credentials");
    writeFileConfig({ oauth: { ...grant, tokenEndpoint: "https://evil.test/token" } }, configPath);
    await expect(oauthAccessToken(grant.origin, false, configPath, fetcher)).rejects.toThrow("unsafe"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not echo token endpoint failures and clears local credentials on failed revocation", async () => {
    const configPath = path(); writeFileConfig({ oauth: { ...grant, revocationEndpoint: "https://clerk.test/revoke" } }, configPath);
    const fetcher = vi.fn(async () => { throw new Error("refresh-secret"); }) as unknown as typeof fetch;
    await expect(oauthAccessToken(grant.origin, false, configPath, fetcher)).rejects.toThrow("OAuth request failed");
    expect(await logout(grant.origin, configPath, fetcher)).toMatchObject({ revocationFailed: true });
    expect(readFileSync(configPath, "utf8")).not.toContain("secret");
  });
  it("restricts workspace operations and preserves caller idempotency", async () => {
    const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json({ data: { ok: true } }));
    const client = new TallyhandClient({ baseUrl: grant.origin, token: "access-secret", fetcher: fetcher as typeof fetch });
    for (const unsafe of ["https://evil.test/clients", "//evil.test/clients", "/clients/../settings", "/clients/%2e%2e/settings", "/clients/%252e%252e/settings", "/api-keys", "/clients?next=secret"]) expect(() => client.requestWorkspaceOperation({ method: "GET", path: unsafe })).toThrow();
    await client.requestWorkspaceOperation({ method: "POST", path: "/api/v1/clients", body: { name: "Example" }, idempotencyKey: "stable-key" });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Idempotency-Key")).toBe("stable-key");
  });
  it("retries an unauthorized REST request only once with the same idempotency key", async () => {
    const provider = vi.fn(async (force?: boolean) => force ? "new" : "old");
    const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json({ error: { code: "unauthorized", message: "expired" } }, { status: 401 }));
    const client = new TallyhandClient({ baseUrl: grant.origin, tokenProvider: provider, fetcher: fetcher as typeof fetch });
    await expect(client.createClient({ name: "example" })).rejects.toThrow("expired");
    expect(fetcher).toHaveBeenCalledTimes(2); expect(provider.mock.calls).toEqual([[], [true]]);
    const first = new Headers(fetcher.mock.calls[0]?.[1]?.headers), second = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(first.get("Idempotency-Key")).toBe(second.get("Idempotency-Key"));
  });
});
