import { requireSessionUserId } from "@/lib/auth/session";
import { disconnectStripeAccount } from "@/server/stripe-connect";
export const runtime = "nodejs";
export async function DELETE(req:Request) { try { const userId=await requireSessionUserId(); if(req.headers.get("x-tallyhand-sync")!=="1") return Response.json({error:{code:"bad_request",message:"Missing required header: x-tallyhand-sync: 1"}},{status:400}); await disconnectStripeAccount(userId); return Response.json({data:{disconnected:true}}); } catch(e) { const status=(e as {status?:number})?.status??401; return Response.json({error:{code:"unauthorized",message:"Not signed in"}},{status}); } }
