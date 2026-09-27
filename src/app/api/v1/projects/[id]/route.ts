import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import { projectPatchSchema } from "@/server/validation";
import { conflict } from "../../_lib/errors";
import { isDryRun } from "../../_lib/query";
import type { RecurringCapableProvider } from "@/server/scheduler";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const project = await getServerProvider().getProject(params.id);
  if (!project) return notFound("project");
  return ok(project);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const provider = getServerProvider();
    const existing = await provider.getProject(params.id);
    if (!existing) return notFound("project");
    const body: unknown = await req.json().catch(() => null);
    const parsed = projectPatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid project patch", parsed.error.issues);
    }
    if (parsed.data.clientId) {
      const client = await provider.getClient(parsed.data.clientId);
      if (!client) {
        return notFound(`client "${parsed.data.clientId}"`);
      }
    }
    await provider.updateProject(params.id, parsed.data);
    const updated = await provider.getProject(params.id);
    return ok(updated);
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getProject(params.id);
  if (!existing) return notFound("project");
  const taskCount = (await provider.listTasksByProject(params.id)).length;
  const expenseCount = (await provider.listExpenses()).filter(
    (e) => e.projectId === params.id,
  ).length;
  const recurring = provider as unknown as RecurringCapableProvider;
  const scheduleCount = (await recurring.listRecurringSchedules()).filter(
    (s) => s.projectId === params.id,
  ).length;
  if (taskCount > 0 || expenseCount > 0 || scheduleCount > 0) {
    return conflict(
      `Project has ${taskCount} task(s), ${expenseCount} expense(s) and ${scheduleCount} recurring schedule(s) — delete those first, or archive the project instead (PATCH { archived: true })`,
      { id: existing.id, taskCount, expenseCount, scheduleCount },
    );
  }
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      wouldDelete: { entity: "project", id: existing.id, name: existing.name },
    });
  }
  await provider.removeProject(params.id);
  return noContent();
}
