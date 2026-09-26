import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
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

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
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

export async function POST(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = projectCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid project", parsed.error.issues);
    }
    const provider = getServerProvider();
    const client = await provider.getClient(parsed.data.clientId);
    if (!client) {
      return badRequest(`clientId "${parsed.data.clientId}" does not exist`);
    }
    const project = await provider.createProject(parsed.data);
    return created(project);
  });
}
