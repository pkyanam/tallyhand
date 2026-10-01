import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../_lib/sync-auth";
import { badRequest, conflict, created, notFound, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { projectCreateSchema } from "@/server/validation";
import {
  aliasedParam,
  applySort,
  filterSearch,
  parseSort,
  sortUsage,
} from "../_lib/query";

export const runtime = "nodejs";

const SORT_FIELDS = ["name", "createdAt"] as const;

async function GETHandler(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const search = new URL(req.url).searchParams;
  const clientId = aliasedParam(search, "clientId", "client_id");
  const sort = parseSort(req, SORT_FIELDS);
  if (sort === "invalid") {
    return badRequest(`sort must be one of: ${sortUsage(SORT_FIELDS)}`);
  }
  let projects = clientId
    ? await provider.listProjectsByClient(clientId)
    : await provider.listProjects();
  projects = filterSearch(projects, search.get("search"), [(p) => p.name]);
  if (sort) projects = applySort(projects, sort);
  return paginated(projects, limit, cursor);
}

async function POSTHandler(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = projectCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid project", parsed.error.issues);
    }
    const provider = getServerProvider();
    // Mirror retry-safety: a retried create must not collide on the id.
    if (parsed.data.id && (await provider.getProject(parsed.data.id))) {
      return conflict("project");
    }
    const client = await provider.getClient(parsed.data.clientId);
    if (!client) {
      return notFound(`client "${parsed.data.clientId}"`);
    }
    const project = await provider.createProject(parsed.data);
    return created(project);
  });
}

export const GET = withApiRequestCache(GETHandler);
export const POST = withApiRequestCache(POSTHandler);
