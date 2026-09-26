import { getServerProvider } from "@/server/provider";
import { requireApiToken } from "@/server/auth";
import { badRequest, created, paginated, parsePagination } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { clientCreateSchema } from "@/server/validation";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  const { limit, cursor } = parsePagination(req);
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "true";
  const clients = await getServerProvider().listClients(includeArchived);
  return paginated(clients, limit, cursor);
}

export async function POST(req: Request) {
  const authErr = requireApiToken(req);
  if (authErr) return authErr;
  return withIdempotency(req, async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = clientCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid client", parsed.error.issues);
    }
    const client = await getServerProvider().createClient(parsed.data);
    return created(client);
  });
}
