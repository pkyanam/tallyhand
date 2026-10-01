import { withApiRequestCache } from "@/lib/auth/request-cache";
import { getServerProvider } from "@/server/provider";
import { requireApiOrSession } from "../_lib/sync-auth";
import { badRequest, conflict, created, notFound, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "../_lib/idempotency";
import { expenseCreateSchema } from "@/server/validation";
import {
  aliasedParam,
  applySort,
  filterDateRange,
  parseDateRange,
  parseSort,
  sortUsage,
} from "../_lib/query";

export const runtime = "nodejs";

const SORT_FIELDS = ["date", "amount", "category", "createdAt"] as const;

async function GETHandler(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const search = new URL(req.url).searchParams;
  const clientId = aliasedParam(search, "clientId", "client_id");
  const projectId = aliasedParam(search, "projectId", "project_id");
  const isBilled = aliasedParam(search, "isBilled", "is_billed");
  const category = search.get("category");

  const range = parseDateRange(req);
  if (range === "invalid") {
    return badRequest("date_from/date_to must be ms epoch or ISO-8601 dates");
  }
  const sort = parseSort(req, SORT_FIELDS);
  if (sort === "invalid") {
    return badRequest(`sort must be one of: ${sortUsage(SORT_FIELDS)}`);
  }

  let expenses = await provider.listExpenses();
  if (clientId) expenses = expenses.filter((e) => e.clientId === clientId);
  if (projectId) expenses = expenses.filter((e) => e.projectId === projectId);
  if (category) expenses = expenses.filter((e) => e.category === category);
  if (isBilled === "true") expenses = expenses.filter((e) => e.isBilled);
  else if (isBilled === "false") expenses = expenses.filter((e) => !e.isBilled);
  expenses = filterDateRange(expenses, (e) => e.date, range);
  if (sort) expenses = applySort(expenses, sort);

  return paginated(expenses, limit, cursor);
}

async function POSTHandler(req: Request) {
  const authErr = await requireApiOrSession(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = expenseCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid expense", parsed.error.issues);
    }
    const provider = getServerProvider();
    // Mirror retry-safety: a retried create must not collide on the id.
    if (parsed.data.id && (await provider.getExpense(parsed.data.id))) {
      return conflict("expense");
    }
    if (parsed.data.projectId) {
      const project = await provider.getProject(parsed.data.projectId);
      if (!project) {
        return notFound(`project "${parsed.data.projectId}"`);
      }
    }
    if (parsed.data.clientId) {
      const client = await provider.getClient(parsed.data.clientId);
      if (!client) {
        return notFound(`client "${parsed.data.clientId}"`);
      }
    }
    const expense = await provider.createExpense(parsed.data);
    return created(expense);
  });
}

export const GET = withApiRequestCache(GETHandler);
export const POST = withApiRequestCache(POSTHandler);
