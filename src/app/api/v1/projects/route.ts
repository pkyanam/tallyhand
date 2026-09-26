import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { projectCreateSchema } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const provider = getServerProvider();
  const clientId = new URL(req.url).searchParams.get("clientId");
  const projects = clientId
    ? await provider.listProjectsByClient(clientId)
    : await provider.listProjects();
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
