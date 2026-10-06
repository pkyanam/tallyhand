import { afterEach, describe, expect, it, vi } from "vitest";
import AgentIdPage from "./page";
vi.mock("@/lib/mode",()=>({effectiveAuth:()=>"clerk"}));
vi.mock("./agentid-entry",()=>({AgentIdEntry:()=>null}));
afterEach(()=>vi.unstubAllEnvs());
describe("AgentID entry destination",()=>{
  it("defaults a fresh sign-in to the cloud dashboard",async()=>{vi.stubEnv("AGENTID_CLIENT_ID","configured");const page=await AgentIdPage({searchParams:Promise.resolve({})});expect(page.props.next).toBe("/dashboard");});
  it("preserves a safe CLI OAuth continuation",async()=>{vi.stubEnv("AGENTID_CLIENT_ID","configured");const next="/login/oauth/continue?authorization_url=canonical";const page=await AgentIdPage({searchParams:Promise.resolve({next})});expect(page.props.next).toBe(next);});
  it("does not allow an external destination",async()=>{vi.stubEnv("AGENTID_CLIENT_ID","configured");const page=await AgentIdPage({searchParams:Promise.resolve({next:"https://evil.test"})});expect(page.props.next).toBe("/");});
});
