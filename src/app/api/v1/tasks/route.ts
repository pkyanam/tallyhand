import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../_lib/sync-auth";
import { badRequest, conflict, created, notFound, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { taskCreateSchema } from "@/server/validation";
import {
  aliasedParam,
  applySort,
  filterDateRange,
  parseDateRange,
  parseSort,
  sortUsage,
} from "../_lib/query";

export const runtime = "nodejs";

const SORT_FIELDS = ["startAt", "endAt", "durationMinutes", "name", "createdAt"] as const;

async function GETHandler(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const search = new URL(req.url).searchParams;
  const projectId = aliasedParam(search, "projectId", "project_id");
  const clientId = aliasedParam(search, "clientId", "client_id");
  const isBilled = aliasedParam(search, "isBilled", "is_billed");

  const range = parseDateRange(req);
  if (range === "invalid") {
    return badRequest("date_from/date_to must be ms epoch or ISO-8601 dates");
  }
  const sort = parseSort(req, SORT_FIELDS);
  if (sort === "invalid") {
    return badRequest(`sort must be one of: ${sortUsage(SORT_FIELDS)}`);
  }

  let tasks = projectId
    ? await provider.listTasksByProject(projectId)
    : await provider.listTasks();

  if (clientId) {
    const projects = await provider.listProjectsByClient(clientId);
    const ids = new Set(projects.map((p) => p.id));
    tasks = tasks.filter((t) => ids.has(t.projectId));
  }
  if (isBilled === "true") tasks = tasks.filter((t) => t.isBilled);
  else if (isBilled === "false") tasks = tasks.filter((t) => !t.isBilled);
  tasks = filterDateRange(tasks, (t) => t.startAt, range);
  if (sort) tasks = applySort(tasks, sort);

  return paginated(tasks, limit, cursor);
}

async function POSTHandler(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = taskCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid task", parsed.error.issues);
    }
    const provider = getServerProvider();
    // Mirror retry-safety: a retried create must not collide on the id.
    if (parsed.data.id && (await provider.getTask(parsed.data.id))) {
      return conflict("task");
    }
    const project = await provider.getProject(parsed.data.projectId);
    if (!project) {
      return notFound(`project "${parsed.data.projectId}"`);
    }
    if (parsed.data.endAt !== 0 && parsed.data.endAt < parsed.data.startAt) {
      return badRequest("endAt must be >= startAt (or 0 for an open timer)");
    }
    const task = await provider.createTask(parsed.data);
    return created(task);
  });
}

export const GET = withApiRequestCache(GETHandler);
export const POST = withApiRequestCache(POSTHandler);
