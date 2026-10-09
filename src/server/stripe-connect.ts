/** SERVER ONLY — Stripe Connect OAuth and connected-key resolution. */
import { isHosted } from "@/lib/mode";
import { encryptSecret, signState } from "@/lib/crypto/connect-crypto";
import { StripeError } from "@/plugins/stripe/stripe-client";
import { getStripeConfig, stripeKeyMode, type StripeKeyMode } from "./stripe-config";
import { saveStripeConnection, getStripeConnectionMeta, getStripeConnectionSecret, deleteStripeConnection, type StripeConnectionMeta } from "@/lib/stripe-connect/store";
export class StripeConnectionError extends Error {
  constructor(public readonly code: "CONNECTION_UNAVAILABLE" | "ACCOUNT_MISMATCH" | "MODE_MISMATCH" | "CHARGES_DISABLED", message: string) { super(message); this.name = "StripeConnectionError"; }
}
async function connectFetch(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(10000) }); }
  catch { throw new StripeError("Stripe connection request unavailable; check account status and restart Connect authorization; do not reuse an OAuth code", 503); }
}
export function getConnectConfig(env: Record<string,string|undefined> = process.env) { const clientId=env.STRIPE_CONNECT_CLIENT_ID; if (!clientId) return null; const vercel=env.VERCEL_URL ? `https://${env.VERCEL_URL.replace(/^https?:\/\//,"")}` : ""; const appUrl=(env.TALLYHAND_APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? vercel ?? "").replace(/\/+$/,""); return {clientId,appUrl}; }
export function buildAuthorizeUrl(userId: string, env?: Record<string,string|undefined>): string { const c=getConnectConfig(env); if (!c) throw new Error("Stripe Connect is not configured"); const u=new URL("https://connect.stripe.com/oauth/authorize"); u.searchParams.set("response_type","code");u.searchParams.set("client_id",c.clientId);u.searchParams.set("scope","read_write");u.searchParams.set("state",signState(userId));u.searchParams.set("redirect_uri",`${c.appUrl}/api/v1/stripe/connect/callback`);return u.toString(); }
export interface ConnectTokenResult { accessToken?: string; accountId: string; livemode: boolean; publishableKey: string; scope?: "read_write"; credentialSource?: "platform" | "oauth" }
type StripeBody = { scope?: unknown; token_type?: unknown; access_token?: unknown; stripe_user_id?: unknown; livemode?: unknown; stripe_publishable_key?: unknown; id?: unknown; charges_enabled?: unknown; payouts_enabled?: unknown; error_description?: unknown; error?: string | { message?: string; code?: string } };
async function stripeResponse(res: Response): Promise<StripeBody> {
  const body=await res.json().catch(()=>null) as StripeBody | null;
  if(!res.ok) {
    const error = typeof body?.error === "object" ? body.error : undefined;
    const message = error?.message ?? (typeof body?.error_description === "string" ? body.error_description : `Stripe API error (HTTP ${res.status})`);
    throw new StripeError(message,res.status,error?.code ?? (typeof body?.error === "string" ? body.error : undefined));
  }
  return body ?? {};
}
export async function exchangeCodeForToken(code: string, env?: Record<string,string|undefined>): Promise<ConnectTokenResult> {
  const c=getConnectConfig(env), platform=getStripeConfig(env);
  if(!c || !platform) throw new Error("Stripe Connect is not configured");
  if(platform.mode === "unknown") throw new StripeConnectionError("MODE_MISMATCH", "Stripe platform key mode is unknown");
  // Stripe OAuth codes are single-use and not idempotent: never retry this call.
  const res=await connectFetch("https://connect.stripe.com/oauth/token",{method:"POST",headers:{authorization:`Basic ${Buffer.from(`${platform.secretKey}:`).toString("base64")}`,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code}).toString()});
  const b=await stripeResponse(res);
  if(typeof b.stripe_user_id!=="string" || !/^acct_[A-Za-z0-9]+$/.test(b.stripe_user_id) || typeof b.livemode!=="boolean" || b.scope!=="read_write" || b.token_type!=="bearer") throw new StripeError("Stripe returned an invalid Connect authorization response",502);
  if((platform.mode === "live") !== b.livemode) throw new StripeConnectionError("MODE_MISMATCH", "OAuth connection mode does not match platform key");
  // Modern OAuth omits access_token. Bind the platform credential to the account
  // granted by this successful exchange, never to the unconnected platform.
  return {accountId:b.stripe_user_id,livemode:b.livemode,publishableKey:typeof b.stripe_publishable_key === "string" ? b.stripe_publishable_key : "",scope:"read_write",credentialSource:"platform"};
}
export async function getConnectAccount(secretKey: string, accountId?: string): Promise<{id:string;charges_enabled?:boolean;payouts_enabled?:boolean}> {
  const headers: Record<string,string> = {authorization:`Bearer ${secretKey}`};
  if(accountId) headers["Stripe-Account"] = accountId;
  const res=await connectFetch("https://api.stripe.com/v1/account",{headers});
  const b=await stripeResponse(res);
  if(typeof b.id!=="string") throw new StripeError("Stripe returned an invalid account",502);
  return {id:b.id,charges_enabled:typeof b.charges_enabled==="boolean"?b.charges_enabled:undefined,payouts_enabled:typeof b.payouts_enabled==="boolean"?b.payouts_enabled:undefined};
}
export async function saveConnectConnection(userId:string, tokenResult:ConnectTokenResult, env?:Record<string,string|undefined>):Promise<StripeConnectionMeta> {
  const modern = tokenResult.credentialSource === "platform";
  if(modern && tokenResult.scope !== "read_write") throw new StripeError("Stripe connection requires read_write authorization",400);
  const secretKey = modern ? getStripeConfig(env)?.secretKey : tokenResult.accessToken;
  if(!secretKey) throw new StripeConnectionError("CONNECTION_UNAVAILABLE", "Stripe connection credential is unavailable");
  const mode=stripeKeyMode(secretKey);
  if(mode === "unknown" || (mode === "live") !== tokenResult.livemode) throw new StripeConnectionError("MODE_MISMATCH", "Stripe credential mode does not match OAuth connection");
  const a=await getConnectAccount(secretKey, modern ? tokenResult.accountId : undefined);
  if(a.id!==tokenResult.accountId) throw new StripeError("Connected Stripe account does not match OAuth response",400);
  // This encrypted snapshot stays account-bound. After platform key rotation,
  // reconnect each account to replace its snapshot; do not silently substitute
  // an unrelated configured platform key. Existing OAuth-token records work.
  return saveStripeConnection(userId,{accountId:a.id,livemode:tokenResult.livemode,chargesEnabled:typeof a.charges_enabled==="boolean"?a.charges_enabled:null,payoutsEnabled:typeof a.payouts_enabled==="boolean"?a.payouts_enabled:null,secretEnvelope:encryptSecret(secretKey)});
}
export async function disconnectStripeAccount(userId:string,env?:Record<string,string|undefined>):Promise<void> { const c=getConnectConfig(env), meta=await getStripeConnectionMeta(userId); try { if(c && meta) { const res=await connectFetch("https://connect.stripe.com/oauth/deauthorize",{method:"POST",headers:{authorization:`Bearer ${getStripeConfig(env)?.secretKey ?? ""}`,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:c.clientId,stripe_user_id:meta.accountId}).toString()}); if(!res.ok) throw new Error(`HTTP ${res.status}`); } } catch { console.warn("[stripe connect] account deauthorization failed; local connection removed"); } finally { await deleteStripeConnection(userId); } }
export async function resolveCheckoutStripeKey(userId?:string,env:Record<string,string|undefined> = process.env, expected?: { accountId: string; livemode: boolean }):Promise<{secretKey:string;stripeAccount:string|null;mode:StripeKeyMode;source:"connected"|"platform"}> {
  if(userId) {
    const m=await getStripeConnectionMeta(userId);
    if(m) {
      if (expected && m.accountId !== expected.accountId) throw new StripeConnectionError("ACCOUNT_MISMATCH", "Connected Stripe account does not match payment account");
      if (expected && m.livemode !== expected.livemode) throw new StripeConnectionError("MODE_MISMATCH", "Connected Stripe mode does not match payment mode");
      const secretKey=await getStripeConnectionSecret(userId, m);
      if(!secretKey) throw new StripeConnectionError("CONNECTION_UNAVAILABLE", "Stripe Connect credential is missing or revoked");
      const mode = stripeKeyMode(secretKey), configured = getStripeConfig(env)?.mode;
      if (mode === "unknown" || (mode === "live") !== m.livemode || (configured && configured !== "unknown" && configured !== mode)) throw new StripeConnectionError("MODE_MISMATCH", "Stripe credential and connection configuration modes disagree");
      if (m.chargesEnabled !== true) throw new StripeConnectionError("CHARGES_DISABLED", "Connected Stripe account is not enabled for charges");
      return {secretKey,stripeAccount:m.accountId,mode,source:"connected"};
    }
  }
  if (isHosted(env) || expected) throw new StripeConnectionError("CONNECTION_UNAVAILABLE", "Connect a Stripe account before accepting online payments");
  const c=getStripeConfig(env);
  if(!c) throw new StripeConnectionError("CONNECTION_UNAVAILABLE", "Stripe is not configured — set STRIPE_SECRET_KEY in the environment.");
  if(c.mode === "unknown") throw new StripeConnectionError("MODE_MISMATCH", "Stripe platform key mode is unknown");
  return {secretKey:c.secretKey,stripeAccount:null,mode:c.mode,source:"platform"};
}
