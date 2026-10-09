import { requireSessionUserId } from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/users";
import { listApiTokens } from "@/lib/auth/api-tokens";
import {
  createFinancialGrant,
  listFinancialGrants,
  revokeFinancialGrant,
} from "@/lib/financial/grants";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z
  .object({
    workspaceId: z.string().optional(),
    principal: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("api-token"), tokenId: z.string().min(1) })
        .strict(),
      z
        .object({
          kind: z.literal("oauth"),
          userId: z.string().min(1),
          clientId: z.string().min(1),
        })
        .strict(),
    ]),
    actions: z.array(z.enum(["collect", "read", "reconcile"])).min(1),
    accountId: z.string().min(1),
    mode: z.enum(["test", "live"]),
    currency: z.enum(["USD", "EUR"]),
    maxMinorUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
async function owner() {
  const id = await requireSessionUserId();
  if ((await getUserRole(id)) === "viewer")
    throw Object.assign(new Error("Access denied"), { status: 403 });
  return id;
}
async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 503;
    return Response.json(
      {
        error: {
          code:
            status === 403
              ? "forbidden"
              : status === 401
                ? "unauthorized"
                : "financial_authority_unavailable",
          message:
            status === 503
              ? "Financial authority unavailable"
              : "Access denied",
        },
      },
      { status },
    );
  }
}
export async function GET() {
  return handle(async () =>
    Response.json({ data: await listFinancialGrants(await owner()) }),
  );
}
export async function POST(req: Request) {
  return handle(async () => {
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      return Response.json(
        { error: { code: "forbidden", message: "Origin mismatch" } },
        { status: 403 },
      );
    const userId = await owner();
    const parsed = input.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return Response.json(
        { error: { code: "bad_request", message: "Invalid financial grant" } },
        { status: 400 },
      );
    const data = parsed.data;
    const principal = data.principal;
    if (
      (data.workspaceId !== undefined && data.workspaceId !== userId) ||
      (data.principal.kind === "oauth" && data.principal.userId !== userId) ||
      (data.principal.kind === "api-token" &&
        !(await listApiTokens(userId)).some(
          (t) =>
            t.id === (principal.kind === "api-token" ? principal.tokenId : ""),
        ))
    )
      return Response.json(
        {
          error: {
            code: "forbidden",
            message: "Principal or workspace is not owned by this session",
          },
        },
        { status: 403 },
      );
    return Response.json(
      {
        data: await createFinancialGrant({
          ...data,
          userId,
          workspaceId: userId,
        }),
      },
      { status: 201 },
    );
  });
}
export async function DELETE(req: Request) {
  return handle(async () => {
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== new URL(req.url).origin
    )
      return Response.json(
        { error: { code: "forbidden", message: "Origin mismatch" } },
        { status: 403 },
      );
    const userId = await owner();
    const id = new URL(req.url).searchParams.get("id");
    if (!id)
      return Response.json(
        { error: { code: "bad_request", message: "Grant id required" } },
        { status: 400 },
      );
    return Response.json({
      data: { revoked: await revokeFinancialGrant(userId, id) },
    });
  });
}
