import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { taskPatchSchema } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const task = await getServerProvider().getTask(params.id);
  if (!task) return notFound("task");
  return ok(task);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getTask(params.id);
  if (!existing) return notFound("task");
  const body: unknown = await req.json().catch(() => null);
  const parsed = taskPatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid task patch", parsed.error.issues);
  }
  if (parsed.data.projectId) {
    const project = await provider.getProject(parsed.data.projectId);
    if (!project) {
      return badRequest(`projectId "${parsed.data.projectId}" does not exist`);
    }
  }
  const startAt = parsed.data.startAt ?? existing.startAt;
  const endAt = parsed.data.endAt ?? existing.endAt;
  if (endAt < startAt) {
    return badRequest("endAt must be >= startAt");
  }
  await provider.updateTask(params.id, parsed.data);
  const updated = await provider.getTask(params.id);
  return ok(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getTask(params.id);
  if (!existing) return notFound("task");
  await provider.removeTask(params.id);
  return noContent();
}
