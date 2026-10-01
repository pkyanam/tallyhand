import { withApiRequestCache } from "@/lib/auth/request-cache";
import { requireApiToken } from "@/server/auth";
import { getServerProvider } from "@/server/provider";
import { ok } from "@/server/http";
import { AGENT_CONTROLS } from "@/server/agent-controls";
export const runtime = "nodejs";
async function GETHandler(req: Request) {
  const denied = await requireApiToken(req); if (denied) return denied;
  const p = getServerProvider();
  return ok({ workspaceApi: true, extensions: { mileage: typeof p.listMileageEntries === "function", contracts: typeof p.listContracts === "function", taxPayments: typeof p.listTaxPayments === "function", rateCards: typeof p.listRateCards === "function", shareLinks: "createShareLink" in p }, paymentExecution: false, secureControls: AGENT_CONTROLS, note: "Capabilities do not grant authorization. Some controls require browser consent or administrative roles; each API enforces permissions." });
}

export const GET = withApiRequestCache(GETHandler);
