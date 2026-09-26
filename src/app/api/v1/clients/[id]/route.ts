import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, noContent, notFound, ok } from "@/server/http";
import { clientPatchSchema } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const client = await getServerProvider().getClient(params.id);
  if (!client) return notFound("client");
  return ok(client);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getClient(params.id);
  if (!existing) return notFound("client");
  const body: unknown = await req.json().catch(() => null);
  const parsed = clientPatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid client patch", parsed.error.issues);
  }
  await provider.updateClient(params.id, parsed.data);
  const updated = await provider.getClient(params.id);
  return ok(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const provider = getServerProvider();
  const existing = await provider.getClient(params.id);
  if (!existing) return notFound("client");
  await provider.removeClient(params.id);
  return noContent();
}
