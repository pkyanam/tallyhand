import { requireSessionUserId } from "@/lib/auth/session";
import { getConnectConfig, buildAuthorizeUrl } from "@/server/stripe-connect";
export const runtime = "nodejs";
export async function GET() { try { const userId=await requireSessionUserId(); if(!getConnectConfig()) return Response.json({error:{code:"stripe_unavailable",message:"Stripe Connect is not configured"}},{status:503}); return Response.redirect(buildAuthorizeUrl(userId),302); } catch(e) { const status=(e as {status?:number})?.status??401; return Response.json({error:{code:"unauthorized",message:"Not signed in"}},{status}); } }
