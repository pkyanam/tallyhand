import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { clientCreateSchema } from "@/server/validation";
import {
  aliasedParam,
  applySort,
  filterSearch,
  parseSort,
  sortUsage,
  triBool,
} from "../_lib/query";

export const runtime = "nodejs";

const SORT_FIELDS = ["name", "createdAt"] as const;

export async function GET(req: Request) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const search = new URL(req.url).searchParams;
  const sort = parseSort(req, SORT_FIELDS);
  if (sort === "invalid") {
    return badRequest(`sort must be one of: ${sortUsage(SORT_FIELDS)}`);
  }
  const includeArchived = triBool(aliasedParam(search, "includeArchived", "include_archived")) === true;
  let clients = await getServerProvider().listClients(includeArchived);
  clients = filterSearch(clients, search.get("search"), [
    (c) => c.name,
    (c) => c.email,
  ]);
  if (sort) clients = applySort(clients, sort);
  return paginated(clients, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = clientCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid client", parsed.error.issues);
    }
    const client = await getServerProvider().createClient(parsed.data);
    return created(client);
  });
}
