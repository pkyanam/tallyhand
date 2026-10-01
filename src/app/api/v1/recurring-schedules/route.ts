import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../_lib/sync-auth";
import { badRequest, conflict, created, ok, notFound, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { recurringScheduleCreateSchema } from "@/server/validation";
import type { RecurringCapableProvider } from "@/server/scheduler";
import type { RecurringStatus } from "@/core/recurring";

import {
  aliasedParam,
  applySort,
  parseSort,
  sortUsage,
} from "../_lib/query";

export const runtime = "nodejs";

function asRecurring(provider: unknown): RecurringCapableProvider {
  return provider as RecurringCapableProvider;
}

const STATUSES: RecurringStatus[] = ["active", "paused", "ended"];
const SORT_FIELDS = ["nextRunAt", "name", "createdAt"] as const;

export async function GET(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = asRecurring(getServerProvider());
  const search = new URL(req.url).searchParams;
  const clientId = aliasedParam(search, "clientId", "client_id");
  const statusParam = search.get("status");
  const status = STATUSES.includes(statusParam as RecurringStatus)
    ? (statusParam as RecurringStatus)
    : undefined;
  const sort = parseSort(req, SORT_FIELDS);
  if (sort === "invalid") {
    return badRequest(`sort must be one of: ${sortUsage(SORT_FIELDS)}`);
  }

  const schedules = clientId
    ? await provider.listRecurringSchedulesByClient(clientId)
    : await provider.listRecurringSchedules(status);
  const filtered = status && clientId ? schedules.filter((s) => s.status === status) : schedules;
  return paginated(sort ? applySort(filtered, sort) : filtered, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const execute = async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = recurringScheduleCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid recurring schedule", parsed.error.issues);
    }
    const provider = asRecurring(getServerProvider());
    // Mirror retry-safety: a retried create must not collide on the id.
    if (parsed.data.id && (await provider.getRecurringSchedule(parsed.data.id))) {
      return conflict("recurring schedule");
    }
    const client = await provider.getClient(parsed.data.clientId);
    if (!client) {
      return notFound(`client "${parsed.data.clientId}"`);
    }
    if (parsed.data.projectId) {
      const project = await provider.getProject(parsed.data.projectId);
      if (!project) {
        return notFound(`project "${parsed.data.projectId}"`);
      }
      if (project.clientId !== parsed.data.clientId) return badRequest("Project belongs to a different client", [{ field: "projectId", code: "invalid_reference", reason: "Choose a project belonging to the selected client" }]);
    }
    if (parsed.data.endDate != null && parsed.data.endDate < parsed.data.startDate) {
      return badRequest("endDate must be >= startDate");
    }
    if (parsed.data.mode === "fixed" && parsed.data.lineItems.length === 0) {
      return badRequest("fixed-mode schedules need at least one line item");
    }
    const warnings = ["Runs create draft invoices only; sending and payment are separate actions.", "A scheduler or explicit run is required; this does not install a background job."];
    if (parsed.data.mode === "unbilled") warnings.push("Unbilled mode currently includes all dates. Draft generation currently reserves source entries; review before running.");
    if (new URL(req.url).searchParams.get("dry_run") === "true") return ok({ dryRun: true, valid: true, schedule: parsed.data, warnings });
    const schedule = await provider.createRecurringSchedule(parsed.data);
    return created({ ...schedule, warnings });
  };
  if (new URL(req.url).searchParams.get("dry_run") === "true") return execute();
  return withIdempotency(req, execute);
}
