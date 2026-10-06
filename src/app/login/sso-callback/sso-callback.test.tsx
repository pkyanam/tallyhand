// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SsoCallback } from "./sso-callback";
const callback=vi.hoisted(()=>vi.fn());
vi.mock("@clerk/nextjs",()=>({AuthenticateWithRedirectCallback:(props:unknown)=>{callback(props);return null;}}));
afterEach(()=>{cleanup();callback.mockClear();});
describe("Clerk OAuth callback continuation",()=>{
  it("preserves safe next through signup transfer and MFA completion",()=>{
    const next="/login/oauth/continue?authorization_url=canonical";render(<SsoCallback next={next}/>);
    expect(callback.mock.calls[0][0]).toMatchObject({signInForceRedirectUrl:next,signUpForceRedirectUrl:next,continueSignUpUrl:`/login?mode=sign-up&next=${encodeURIComponent(next)}`,secondFactorUrl:`/login/factor-two?next=${encodeURIComponent(next)}`});
  });
  it("keeps Clerk saved destinations when no explicit next was supplied",()=>{
    render(<SsoCallback/>);expect(callback.mock.calls[0][0].signInForceRedirectUrl).toBeUndefined();expect(callback.mock.calls[0][0].signUpForceRedirectUrl).toBeUndefined();
  });
});
