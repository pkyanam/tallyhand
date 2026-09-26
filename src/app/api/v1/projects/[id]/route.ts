import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { projectPatchSchema } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const project = await getServerProvider().getProject(params.id);
  if (!project) return notFound("project");
  return ok(project);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
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
      return badRequest(`clientId "${parsed.data.clientId}" does not exist`);
    }
  }
  await provider.updateProject(params.id, parsed.data);
  const updated = await provider.getProject(params.id);
  return ok(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getProject(params.id);
  if (!existing) return notFound("project");
  await provider.removeProject(params.id);
  return noContent();
}
