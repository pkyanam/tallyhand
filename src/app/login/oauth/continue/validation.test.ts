import { describe, it, expect } from "vitest";
import { safeLocalNext, validateOAuthContinuation } from "./validation";
const origin = "https://tally.test", issuer = "https://clerk.test", endpoint = `${issuer}/oauth/authorize`;
function request() { const url = new URL(endpoint); for (const [key,value] of Object.entries({ client_id: `${origin}/.well-known/tally-cli.json`, redirect_uri: "http://127.0.0.1:43819/callback", response_type: "code", resource: `${origin}/api/mcp`, code_challenge_method: "S256", code_challenge: "a".repeat(43), state: "s".repeat(43), scope: "tally:read tally:write tally:manage offline_access" })) url.searchParams.set(key,value); return url; }
describe("OAuth continuation", () => {
  it("allows only canonical resource-bound CLI authorization", () => expect(validateOAuthContinuation(request().toString(), origin, issuer, endpoint)).toBe(request().toString()));
  it.each(["client_id", "redirect_uri", "resource", "response_type", "code_challenge_method", "scope", "state", "code_challenge"])("rejects changed %s", key => { const url=request(); url.searchParams.set(key,"unsafe"); expect(() => validateOAuthContinuation(url.toString(),origin,issuer,endpoint)).toThrow(); });
  it("rejects arbitrary redirects, endpoint paths, credentials and duplicate parameters", () => {
    for (const mutate of [(u: URL)=> {u.hostname="evil.test";}, (u: URL)=>{u.pathname="/redirect";},(u: URL)=>{u.username="secret";},(u: URL)=>{u.searchParams.append("state","extra");},(u: URL)=>{u.searchParams.set("next","https://evil.test");}]) { const url=request(); mutate(url); expect(()=>validateOAuthContinuation(url.toString(),origin,issuer,endpoint)).toThrow(); }
    expect(()=>validateOAuthContinuation(request().toString(),origin,issuer,"https://evil.test/oauth/authorize")).toThrow();
  });
  it("preserves local next and rejects external and encoded browser redirects", () => {
    for (const next of ["https://evil.test","//evil.test","/%2fevil.test","/\\evil.test","/%5cevil.test","/foo%0d%0aLocation:evil"]) expect(safeLocalNext(next)).toBe("/");
    expect(safeLocalNext("/login/oauth/continue?authorization_url=abc")).toBe("/login/oauth/continue?authorization_url=abc");
  });
});
