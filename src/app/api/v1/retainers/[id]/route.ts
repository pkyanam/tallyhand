import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { retainerPatchSchema } from "@/server/validation";
import type { RecurringCapableProvider } from "@/server/scheduler";

export const runtime = "nodejs";

function asRetainers(provider: unknown): RecurringCapableProvider {
  return provider as RecurringCapableProvider;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const retainer = await asRetainers(getServerProvider()).getRetainer(params.id);
  if (!retainer) return notFound("retainer");
  return ok(retainer);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = asRetainers(getServerProvider());
  const existing = await provider.getRetainer(params.id);
  if (!existing) return notFound("retainer");
  const body: unknown = await req.json().catch(() => null);
  const parsed = retainerPatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid retainer patch", parsed.error.issues);
  }
  await provider.updateRetainer(params.id, parsed.data);
  const updated = await provider.getRetainer(params.id);
  return ok(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = asRetainers(getServerProvider());
  const existing = await provider.getRetainer(params.id);
  if (!existing) return notFound("retainer");
  await provider.removeRetainer(params.id);
  return noContent();
}
