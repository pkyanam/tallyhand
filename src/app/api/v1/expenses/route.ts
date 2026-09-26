import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { expenseCreateSchema } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const search = new URL(req.url).searchParams;
  const clientId = search.get("clientId");
  const projectId = search.get("projectId");
  const isBilled = search.get("isBilled");
  const category = search.get("category");

  let expenses = await provider.listExpenses();
  if (clientId) expenses = expenses.filter((e) => e.clientId === clientId);
  if (projectId) expenses = expenses.filter((e) => e.projectId === projectId);
  if (category) expenses = expenses.filter((e) => e.category === category);
  if (isBilled === "true") expenses = expenses.filter((e) => e.isBilled);
  else if (isBilled === "false") expenses = expenses.filter((e) => !e.isBilled);

  return paginated(expenses, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = expenseCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid expense", parsed.error.issues);
    }
    const provider = getServerProvider();
    if (parsed.data.projectId) {
      const project = await provider.getProject(parsed.data.projectId);
      if (!project) {
        return badRequest(`projectId "${parsed.data.projectId}" does not exist`);
      }
    }
    if (parsed.data.clientId) {
      const client = await provider.getClient(parsed.data.clientId);
      if (!client) {
        return badRequest(`clientId "${parsed.data.clientId}" does not exist`);
      }
    }
    const expense = await provider.createExpense(parsed.data);
    return created(expense);
  });
}
