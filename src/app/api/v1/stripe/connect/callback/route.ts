import { verifyState } from "@/lib/crypto/connect-crypto";
import { exchangeCodeForToken, saveConnectConnection, getConnectConfig } from "@/server/stripe-connect";
export const runtime = "nodejs";
function destination(base:string,q:string) { return Response.redirect(`${base}/settings?${q}`,302); }
export async function GET(req:Request) { const url=new URL(req.url); const c=getConnectConfig(); const app=c?.appUrl ?? ""; if(url.searchParams.has("error")) return destination(app,"stripe=cancelled"); const state=url.searchParams.get("state"),code=url.searchParams.get("code"); try { if(!state||!code) throw Object.assign(new Error("invalid"),{status:400}); const userId=verifyState(state); const token=await exchangeCodeForToken(code); await saveConnectConnection(userId,token); return destination(app,"stripe=connected"); } catch(e) { const status=(e as {status?:number})?.status; return destination(app,`stripe=error&reason=${status ?? 400}`); } }
