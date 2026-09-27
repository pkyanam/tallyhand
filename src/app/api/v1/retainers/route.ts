import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { retainerCreateSchema } from "@/server/validation";
import type { RecurringCapableProvider } from "@/server/scheduler";
import type { RetainerStatus, RetainerType } from "@/core/recurring";
import {
  aliasedParam,
  applySort,
  parseSort,
  sortUsage,
} from "../_lib/query";

export const runtime = "nodejs";

function asRetainers(provider: unknown): RecurringCapableProvider {
  return provider as RecurringCapableProvider;
}

const STATUSES: RetainerStatus[] = ["active", "paused", "depleted", "ended"];
const TYPES: RetainerType[] = ["prepaid-hours", "monthly-fee"];
const SORT_FIELDS = ["startDate", "name", "createdAt"] as const;

export async function GET(req: Request) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = asRetainers(getServerProvider());
  const search = new URL(req.url).searchParams;
  const clientId = aliasedParam(search, "clientId", "client_id");
  const statusParam = search.get("status");
  const status = STATUSES.includes(statusParam as RetainerStatus)
    ? (statusParam as RetainerStatus)
    : undefined;
  const typeParam = search.get("type");
  const type = TYPES.includes(typeParam as RetainerType)
    ? (typeParam as RetainerType)
    : undefined;
  const sort = parseSort(req, SORT_FIELDS);
  if (sort === "invalid") {
    return badRequest(`sort must be one of: ${sortUsage(SORT_FIELDS)}`);
  }

  const retainers = clientId
    ? await provider.listRetainersByClient(clientId)
    : await provider.listRetainers(status);
  let filtered = status && clientId ? retainers.filter((r) => r.status === status) : retainers;
  if (type) filtered = filtered.filter((r) => r.type === type);
  return paginated(sort ? applySort(filtered, sort) : filtered, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = await requireApiToken(req);
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
