import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const state=vi.hoisted(()=>({enabled:true,issuer:"https://clerk.test",origin:"https://tally.test"}));
vi.mock("@/lib/auth/oauth",()=>({oauthConfig:()=>state}));
function request() { const url=new URL(`${state.issuer}/oauth/authorize`);for(const [key,value] of Object.entries({client_id:`${state.origin}/.well-known/tally-cli.json`,redirect_uri:"http://127.0.0.1:43819/callback",response_type:"code",resource:`${state.origin}/api/mcp`,scope:"tally:read tally:write tally:manage offline_access",state:"s".repeat(43),code_challenge:"c".repeat(43),code_challenge_method:"S256"}))url.searchParams.set(key,value);return url; }
function continuation(url:URL) { const req=new URL(`${state.origin}/login/oauth/continue`);req.searchParams.set("authorization_url",url.toString());return new Request(req); }
beforeEach(()=>{state.enabled=true;state.issuer="https://clerk.test";});afterEach(()=>vi.unstubAllGlobals());
describe("OAuth continuation HTTP handler",()=>{
 it("redirects canonical CLI authorization without a runtime discovery dependency",async()=>{const fetcher=vi.fn(()=>{throw new Error("network unavailable");});vi.stubGlobal("fetch",fetcher);const url=request();const response=await GET(continuation(url));expect(response.status).toBe(302);expect(response.headers.get("location")).toBe(url.toString());expect(response.headers.get("cache-control")).toBe("no-store");expect(fetcher).not.toHaveBeenCalled();});
 it.each(["client_id","redirect_uri","resource","scope","state","code_challenge"])("rejects invalid %s",async key=>{const url=request();url.searchParams.set(key,"unsafe");expect((await GET(continuation(url))).status).toBe(400);});
 it("rejects foreign issuer and alternate authorization endpoints",async()=>{for(const change of [(u:URL)=>{u.hostname="evil.test";},(u:URL)=>{u.pathname="/redirect";}]){const url=request();change(url);expect((await GET(continuation(url))).status).toBe(400);}});
 it("reports disabled OAuth as unavailable",async()=>{state.enabled=false;expect((await GET(continuation(request()))).status).toBe(503);});
});
