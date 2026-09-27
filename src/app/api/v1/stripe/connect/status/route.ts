import { tryResolveSessionUserId } from "@/lib/auth/session";
import { getStripeConnectionMeta } from "@/lib/stripe-connect/store";
export const runtime = "nodejs";
export async function GET() { const userId=await tryResolveSessionUserId(); if(!userId) return Response.json({error:{code:"unauthorized",message:"Not signed in"}},{status:401}); const c=await getStripeConnectionMeta(userId); return Response.json({data:c?{connected:true,accountId:c.accountId,livemode:c.livemode,chargesEnabled:c.chargesEnabled,payoutsEnabled:c.payoutsEnabled}:{connected:false}}); }
