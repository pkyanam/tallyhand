import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";
const state=vi.hoisted(()=>({auth:"clerk",redirect:vi.fn()}));
vi.mock("@/lib/mode",()=>({effectiveAuth:()=>state.auth}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{state.redirect(url);throw new Error("NEXT_REDIRECT");}}));
vi.mock("../clerk-login",()=>({ClerkLogin:()=>null}));
vi.mock("../builtin-login-form",()=>({BuiltinLoginForm:()=>null}));
beforeEach(()=>{state.auth="clerk";state.redirect.mockClear();vi.stubEnv("AGENTID_CLIENT_ID","configured");});
afterEach(()=>vi.unstubAllEnvs());
const hint={iss:"https://auth.agentid.com",login_hint:"agent@example.test"};
describe("AgentID catalog login entry",()=>{
  it("starts provider authentication for the exact trusted issuer and defaults to dashboard",async()=>{await expect(LoginPage({searchParams:Promise.resolve(hint)})).rejects.toThrow("NEXT_REDIRECT");expect(state.redirect).toHaveBeenCalledWith("/login/agentid?next=%2Fdashboard");expect(state.redirect.mock.calls[0][0]).not.toContain("agent@example");});
  it("preserves safe CLI next",async()=>{const next="/login/oauth/continue?authorization_url=canonical";await expect(LoginPage({searchParams:Promise.resolve({...hint,next})})).rejects.toThrow("NEXT_REDIRECT");expect(state.redirect).toHaveBeenCalledWith(`/login/agentid?next=${encodeURIComponent(next)}`);});
  it.each(["https://evil.test","https://auth.agentid.com.evil.test","http://auth.agentid.com","https://auth.agentid.com/"])("does not start AgentID for %s",async iss=>{await LoginPage({searchParams:Promise.resolve({...hint,iss})});expect(state.redirect).not.toHaveBeenCalled();});
  it.each([undefined,"","   "])("requires a nonempty hint",async login_hint=>{await LoginPage({searchParams:Promise.resolve({...hint,login_hint})});expect(state.redirect).not.toHaveBeenCalled();});
  it("leaves callback/MFA subroutes with Clerk",async()=>{await LoginPage({searchParams:Promise.resolve(hint),params:Promise.resolve({rest:["factor-one"]})});expect(state.redirect).not.toHaveBeenCalled();});
  it("does not auto-start without configured Clerk AgentID",async()=>{vi.stubEnv("AGENTID_CLIENT_ID","");await LoginPage({searchParams:Promise.resolve(hint)});expect(state.redirect).not.toHaveBeenCalled();state.auth="builtin";vi.stubEnv("AGENTID_CLIENT_ID","configured");await LoginPage({searchParams:Promise.resolve(hint)});expect(state.redirect).not.toHaveBeenCalled();});
  it("sanitizes an external next before provider entry",async()=>{await expect(LoginPage({searchParams:Promise.resolve({...hint,next:"https://evil.test"})})).rejects.toThrow("NEXT_REDIRECT");expect(state.redirect).toHaveBeenCalledWith("/login/agentid?next=%2F");});
});
