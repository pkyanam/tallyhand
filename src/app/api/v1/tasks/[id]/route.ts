import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { withIdempotency } from "../../_lib/idempotency";
import { taskPatchSchema } from "@/server/validation";
import { conflict } from "../../_lib/errors";
import { isDryRun } from "../../_lib/query";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  const task = await getServerProvider().getTask(params.id);
  if (!task) return notFound("task");
  return ok(task);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
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
        return notFound(`project "${parsed.data.projectId}"`);
      }
    }
    const startAt = parsed.data.startAt ?? existing.startAt;
    const endAt = parsed.data.endAt ?? existing.endAt;
    if (endAt !== 0 && endAt < startAt) {
      return badRequest("endAt must be >= startAt (or 0 for an open timer)");
    }
    await provider.updateTask(params.id, parsed.data);
    const updated = await provider.getTask(params.id);
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
  const existing = await provider.getTask(params.id);
  if (!existing) return notFound("task");
  if (existing.isBilled) {
    return conflict(
      "This task is billed on an invoice — deleting it would corrupt invoice lineage. Delete the invoice first if it is still a draft.",
      { id: existing.id, invoiceId: existing.invoiceId },
    );
  }
  if (isDryRun(req)) {
    return ok({
      dryRun: true,
      wouldDelete: {
        entity: "task",
        id: existing.id,
        name: existing.name,
        durationMinutes: existing.durationMinutes,
      },
    });
  }
  await provider.removeTask(params.id);
  return noContent();
}
