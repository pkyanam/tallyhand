import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { buildAuthorizeUrl, exchangeCodeForToken, getConnectAccount, resolveCheckoutStripeKey, saveConnectConnection } from "./stripe-connect";
import { __resetStripeConnectionCaches } from "@/lib/stripe-connect/store";
const f=vi.fn();
beforeEach(()=>{vi.stubGlobal("fetch",f);f.mockReset();process.env.TALLY_ENCRYPTION_KEY="ab".repeat(32);process.env.STRIPE_CONNECT_CLIENT_ID="ca_test";process.env.STRIPE_SECRET_KEY="sk_test_platform";process.env.TALLY_STORAGE="sqlite";process.env.TALLY_AUTH="none";process.env.TALLYHAND_DB_PATH=join(mkdtempSync(join(tmpdir(),"stripe-oauth-")),"db.sqlite");process.env.TALLYHAND_APP_URL="https://app.test";});
afterEach(()=>{vi.unstubAllGlobals();__resetStripeConnectionCaches();try{rmSync(process.env.TALLYHAND_DB_PATH!.replace(/\/db.sqlite$/, ""),{recursive:true,force:true});}catch{}});
const ok=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
describe("Stripe Connect",()=>{
it("builds authorize URL with required OAuth fields",()=>{const u=new URL(buildAuthorizeUrl("user-1"));expect(u.origin+u.pathname).toBe("https://connect.stripe.com/oauth/authorize");expect(u.searchParams.get("client_id")).toBe("ca_test");expect(u.searchParams.get("scope")).toBe("read_write");expect(u.searchParams.get("response_type")).toBe("code");expect(u.searchParams.get("state")).toBeTruthy();expect(u.searchParams.get("redirect_uri")).toBe("https://app.test/api/v1/stripe/connect/callback");});
it("sends Basic auth and parses token response",async()=>{f.mockResolvedValueOnce(ok({stripe_user_id:"acct_1",livemode:false,stripe_publishable_key:"pk_test",scope:"read_write",token_type:"bearer"}));const t=await exchangeCodeForToken("code");expect(f.mock.calls[0][1].headers.authorization).toBe(`Basic ${Buffer.from("sk_test_platform:").toString("base64")}`);expect(t).toEqual({accountId:"acct_1",livemode:false,publishableKey:"pk_test",scope:"read_write",credentialSource:"platform"});});
it("persists modern platform credential only after connected account verification",async()=>{
 f.mockResolvedValueOnce(ok({stripe_user_id:"acct_1",livemode:false,scope:"read_write",token_type:"bearer"}));
 const result=await exchangeCodeForToken("code");f.mockResolvedValueOnce(ok({id:"acct_1",charges_enabled:true}));
 await saveConnectConnection("user",result);
 expect(f.mock.calls[1][1].headers).toEqual({authorization:"Bearer sk_test_platform","Stripe-Account":"acct_1"});
 process.env.STRIPE_SECRET_KEY="sk_test_rotated";
 expect(await resolveCheckoutStripeKey("user")).toMatchObject({secretKey:"sk_test_platform",stripeAccount:"acct_1",source:"connected"});
});
it.each([{scope:"read_only"},{livemode:true},{stripe_user_id:""},{token_type:"other"}])("rejects OAuth authority/account/mode mismatch %j",async(patch)=>{
 f.mockResolvedValueOnce(ok({stripe_user_id:"acct_1",livemode:false,scope:"read_write",token_type:"bearer",...patch}));
 await expect(exchangeCodeForToken("code")).rejects.toThrow();
});
it("maps HTTP failures and Stripe error messages",async()=>{f.mockResolvedValueOnce(new Response(JSON.stringify({error:{message:"bad grant",code:"invalid_grant"}}),{status:400}));await expect(exchangeCodeForToken("x")).rejects.toMatchObject({name:"StripeError",message:"bad grant",status:400});});
it("parses OAuth string error responses",async()=>{f.mockResolvedValueOnce(new Response(JSON.stringify({error:"invalid_grant",error_description:"Code expired"}),{status:400}));await expect(exchangeCodeForToken("x")).rejects.toMatchObject({message:"Code expired",status:400});});
it("fetches connected account",async()=>{f.mockResolvedValueOnce(ok({id:"acct_1",charges_enabled:true,payouts_enabled:true}));expect(await getConnectAccount("token")).toMatchObject({id:"acct_1",charges_enabled:true});expect(f.mock.calls[0][0]).toBe("https://api.stripe.com/v1/account");});
it("refuses account mismatch without storing",async()=>{f.mockResolvedValueOnce(ok({id:"acct_other"}));await expect(saveConnectConnection("user",{accessToken:"sk_test_token",accountId:"acct_1",livemode:false,publishableKey:""})).rejects.toThrow(/does not match/);const {getStripeConnectionMeta}=await import("@/lib/stripe-connect/store");expect(await getStripeConnectionMeta("user")).toBeNull();});
it("resolves connected key ahead of platform",async()=>{f.mockResolvedValueOnce(ok({id:"acct_1",charges_enabled:true,payouts_enabled:true}));await saveConnectConnection("user",{accessToken:"sk_test_connected",accountId:"acct_1",livemode:false,publishableKey:""});expect(await resolveCheckoutStripeKey("user")).toMatchObject({secretKey:"sk_test_connected",stripeAccount:"acct_1",source:"connected"});});
it("propagates crypto failure instead of falling back",async()=>{f.mockResolvedValueOnce(ok({id:"acct_1"}));await saveConnectConnection("user",{accessToken:"sk_test_token",accountId:"acct_1",livemode:false,publishableKey:""});delete process.env.TALLY_ENCRYPTION_KEY;await expect(resolveCheckoutStripeKey("user")).rejects.toThrow(/TALLY_ENCRYPTION_KEY/);});
it("preserves explicit self-host platform key when no connection exists",async()=>expect(await resolveCheckoutStripeKey("none")).toMatchObject({secretKey:"sk_test_platform",source:"platform",stripeAccount:null}));
it("rejects hosted fallback",async()=>{process.env.TALLY_AUTH="clerk";await expect(resolveCheckoutStripeKey("none")).rejects.toMatchObject({code:"CONNECTION_UNAVAILABLE"});});
it("rejects disabled charges and mismatched account/mode",async()=>{f.mockResolvedValueOnce(ok({id:"acct_1",charges_enabled:false}));await saveConnectConnection("user",{accessToken:"sk_test_connected",accountId:"acct_1",livemode:false,publishableKey:""});await expect(resolveCheckoutStripeKey("user")).rejects.toMatchObject({code:"CHARGES_DISABLED"});await expect(resolveCheckoutStripeKey("user",process.env,{accountId:"acct_other",livemode:false})).rejects.toMatchObject({code:"ACCOUNT_MISMATCH"});await expect(resolveCheckoutStripeKey("user",process.env,{accountId:"acct_1",livemode:true})).rejects.toMatchObject({code:"MODE_MISMATCH"});});
it("rejects credential mode mismatch before account network request",async()=>{await expect(saveConnectConnection("user",{accessToken:"sk_live_connected",accountId:"acct_1",livemode:false,publishableKey:""})).rejects.toMatchObject({code:"MODE_MISMATCH"});expect(f).not.toHaveBeenCalled();});
it("bounds network calls and maps unavailable responses",async()=>{f.mockRejectedValueOnce(new Error("network"));await expect(exchangeCodeForToken("x")).rejects.toMatchObject({status:503});expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);});
it("errors when neither key source is configured",async()=>{delete process.env.STRIPE_SECRET_KEY;await expect(resolveCheckoutStripeKey()).rejects.toThrow(/not configured/);});
});
