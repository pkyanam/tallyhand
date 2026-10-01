/** Server-only transport. The bridge credential is never sent to browsers. */
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ConvexClientLike } from "./convex-provider";

export function createConvexRequestClient(
  url: string,
  secretSource: () => string | undefined = () => process.env.TALLY_CONVEX_SERVER_SECRET,
): ConvexClientLike {
  if (!url) throw new Error("Convex deployment URL is required");
  const invoke = async (kind: "query" | "mutation", path: string, args: Record<string, unknown>) => {
    const serverSecret = secretSource();
    if (!serverSecret || serverSecret.length < 32) {
      throw new Error("Configure TALLY_CONVEX_SERVER_SECRET on both the app and Convex deployment");
    }
    const http = new ConvexHttpClient(url);
    try {
      if (kind === "query") {
        return await http.query(makeFunctionReference<"query">(path), { ...args, serverSecret });
      }
      return await http.mutation(makeFunctionReference<"mutation">(path), { ...args, serverSecret });
    } catch (cause) {
      // Convex validation errors can echo arguments. Never propagate their
      // raw text (which may contain the bridge credential) to an API client.
      const code = (cause as { data?: { code?: unknown } })?.data?.code;
      const safeErrors: Record<string, { status: number; message: string }> = {
        BACKUP_CHANGED: { status: 409, message: "Cloud data changed after your backup. Export a new backup and try again." },
        BACKUP_TOO_LARGE: { status: 413, message: "Workspace exceeds the atomic backup limit (4,000 stored documents / 4 MiB). Nothing was changed." },
        UNAUTHENTICATED: { status: 401, message: "Sign in required" },
        FORBIDDEN: { status: 403, message: "Access denied" },
        NOT_FOUND: { status: 404, message: "Record not found" },
        CONFLICT: { status: 409, message: "Record already exists or conflicts with existing data" },
        BAD_REQUEST: { status: 400, message: "Invalid record data" },
      };
      const safe = typeof code === "string" ? safeErrors[code] : undefined;
      throw Object.assign(new Error(safe?.message ?? "Cloud storage request failed"), { status: safe?.status ?? 503 });
    }
  };
  return {
    query: (path, args) => invoke("query", path, args),
    mutation: (path, args) => invoke("mutation", path, args),
  };
}
