import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { retainerCreateSchema } from "@/server/validation";
import type { RecurringCapableProvider } from "@/server/scheduler";
import type { RetainerStatus } from "@/core/recurring";

export const runtime = "nodejs";

function asRetainers(provider: unknown): RecurringCapableProvider {
  return provider as RecurringCapableProvider;
}

const STATUSES: RetainerStatus[] = ["active", "paused", "depleted", "ended"];

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = asRetainers(getServerProvider());
  const search = new URL(req.url).searchParams;
  const clientId = search.get("clientId");
  const statusParam = search.get("status");
  const status = STATUSES.includes(statusParam as RetainerStatus)
    ? (statusParam as RetainerStatus)
    : undefined;

  const retainers = clientId
    ? await provider.listRetainersByClient(clientId)
    : await provider.listRetainers(status);
  const filtered = status && clientId ? retainers.filter((r) => r.status === status) : retainers;
  return paginated(filtered, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = retainerCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid retainer", parsed.error.issues);
    }
    const provider = asRetainers(getServerProvider());
    const client = await provider.getClient(parsed.data.clientId);
    if (!client) {
      return badRequest(`clientId "${parsed.data.clientId}" does not exist`);
    }
    if (parsed.data.endDate != null && parsed.data.endDate < parsed.data.startDate) {
      return badRequest("endDate must be >= startDate");
    }
    if (parsed.data.type === "prepaid-hours" && parsed.data.totalHours == null) {
      return badRequest("prepaid-hours retainers need totalHours");
    }
    const retainer = await provider.createRetainer(parsed.data);
    return created(retainer);
  });
}
