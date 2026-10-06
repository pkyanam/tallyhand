import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { NextURL } from "next/dist/server/web/next-url";
const state=vi.hoisted(()=>({enabled:true,issuer:"https://clerk.test",origin:"https://tally.test"}));
vi.mock("@/lib/auth/oauth",()=>({oauthConfig:()=>state}));
function request() { const url=new URL(`${state.issuer}/oauth/authorize`);for(const [key,value] of Object.entries({client_id:`${state.origin}/.well-known/tally-cli.json`,redirect_uri:"http://127.0.0.1:43819/callback",response_type:"code",resource:`${state.origin}/api/mcp`,scope:"tally:read tally:write tally:manage offline_access",state:"s".repeat(43),code_challenge:"c".repeat(43),code_challenge_method:"S256"}))url.searchParams.set(key,value);return url; }
function continuation(url:URL) { const req=new URL(`${state.origin}/login/oauth/continue`);req.searchParams.set("authorization_url",url.toString());return new Request(req); }
beforeEach(()=>{state.enabled=true;state.issuer="https://clerk.test";});afterEach(()=>vi.unstubAllGlobals());
describe("OAuth continuation HTTP handler",()=>{
 it("redirects canonical CLI authorization without a runtime discovery dependency",async()=>{const fetcher=vi.fn(()=>{throw new Error("network unavailable");});vi.stubGlobal("fetch",fetcher);const url=request();const response=await GET(continuation(url));expect(response.status).toBe(302);expect(response.headers.get("location")).toBe(url.toString());expect(response.headers.get("cache-control")).toBe("no-store");expect(fetcher).not.toHaveBeenCalled();});
 it.each(["client_id","redirect_uri","resource","scope","state","code_challenge"])("rejects invalid %s",async key=>{const url=request();url.searchParams.set(key,"unsafe");const response=await GET(continuation(url));expect(response.status).toBe(400);const body=await response.json();expect(body.code).toBe(key === "scope" ? "scope" : key === "state" ? "state_format" : key === "code_challenge" ? "pkce_challenge" : `parameter_${key}`);expect(JSON.stringify(body)).not.toContain("unsafe");});
 it("rejects foreign issuer and alternate authorization endpoints",async()=>{for(const change of [(u:URL)=>{u.hostname="evil.test";},(u:URL)=>{u.pathname="/redirect";}]){const url=request();change(url);expect((await GET(continuation(url))).status).toBe(400);}});
 it("reports request shape and URL parse errors without returning private URL values",async()=>{
   const missing=await GET(new Request(`${state.origin}/login/oauth/continue`));expect((await missing.json()).code).toBe("continuation_parameter_count");
   const url=new URL(`${state.origin}/login/oauth/continue`);url.searchParams.set("authorization_url","secret-invalid-url");const body=await(await GET(new Request(url))).json();expect(body.code).toBe("url_parse");expect(JSON.stringify(body)).not.toContain("secret");
 });
 it("survives actual NextURL normalization using opaque transport and repairs the exact legacy callback",async()=>{
   const canonical=request();
   const legacy=new NextURL(continuation(canonical).url);
   expect(new URL(legacy.searchParams.get("authorization_url")!).searchParams.get("redirect_uri")).toBe("http://localhost:43819/callback");
   const oldResponse=await GET(new Request(legacy.toString()));expect(oldResponse.status).toBe(302);expect(new URL(oldResponse.headers.get("location")!).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43819/callback");
   const opaque=new URL(`${state.origin}/login/oauth/continue`);opaque.searchParams.set("authorization_url_b64",Buffer.from(canonical.toString()).toString("base64url"));
   const normalized=new NextURL(opaque.toString());const response=await GET(new Request(normalized.toString()));expect(response.status).toBe(302);expect(response.headers.get("location")).toBe(canonical.toString());
 });
 it("limits legacy repair to the exact registered callback and keeps opaque URLs strict",async()=>{
   for(const redirect of ["http://localhost:43820/callback","http://localhost:43819/other","https://localhost:43819/callback","http://localhost:43819/callback/"]){const url=request();url.searchParams.set("redirect_uri",redirect);expect((await GET(continuation(url))).status).toBe(400);}
   const url=request();url.searchParams.set("redirect_uri","http://localhost:43819/callback");const opaque=new URL(`${state.origin}/login/oauth/continue`);opaque.searchParams.set("authorization_url_b64",Buffer.from(url.toString()).toString("base64url"));expect((await GET(new Request(opaque))).status).toBe(400);
   opaque.searchParams.set("authorization_url_b64","not=base64");expect((await(await GET(new Request(opaque))).json()).code).toBe("continuation_encoding");
   opaque.searchParams.set("authorization_url",request().toString());expect((await(await GET(new Request(opaque))).json()).code).toBe("continuation_parameter_count");
 });
 it("reports disabled OAuth as unavailable",async()=>{state.enabled=false;expect((await GET(continuation(request()))).status).toBe(503);});
});
