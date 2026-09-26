import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { taskCreateSchema } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const search = new URL(req.url).searchParams;
  const projectId = search.get("projectId");
  const clientId = search.get("clientId");
  const isBilled = search.get("isBilled");

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

  return paginated(tasks, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = taskCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid task", parsed.error.issues);
    }
    const provider = getServerProvider();
    const project = await provider.getProject(parsed.data.projectId);
    if (!project) {
      return badRequest(`projectId "${parsed.data.projectId}" does not exist`);
    }
    if (parsed.data.endAt < parsed.data.startAt) {
      return badRequest("endAt must be >= startAt");
    }
    const task = await provider.createTask(parsed.data);
    return created(task);
  });
}
