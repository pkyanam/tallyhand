/** Compact, typed tools over the same account-scoped API used by the CLI. */
import { McpServer, type ServerContext, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiError } from "./client.js";
import type { Api } from "./commands.js";
import { extensionModels, extensionEntityNames } from "./extension-models.js";
import { toolAuthPolicy, toolAuthError, type McpAuthOptions } from "./mcp-auth.js";
const result = (data: unknown): CallToolResult => ({ structuredContent: { data }, content: [{ type: "text", text: JSON.stringify(data) }] });
export function registerExtendedTools(server: McpServer, api: Api, options: McpAuthOptions) {
  function register(name: string, description: string, shape: z.ZodRawShape, scope: string, run: (args: any) => Promise<unknown>, openWorld = false) {
    const read = scope === "tally:read";
    server.registerTool(name, { description, inputSchema: z.object(shape), outputSchema: z.object({ data: z.unknown() }), ...toolAuthPolicy(options, scope), annotations: { readOnlyHint: read, destructiveHint: !read, idempotentHint: read, openWorldHint: openWorld } }, async (args: any, ctx: ServerContext) => {
      const denied = toolAuthError(options, scope, ctx); if (denied) return denied;
      ctx.mcpReq.signal.throwIfAborted();
      try { return result(await run(args)); }
      catch (e) { return { ...result({ error: { code: e instanceof ApiError ? e.code : "operation_failed", message: e instanceof Error ? e.message : "Operation failed", ...(e instanceof ApiError && e.details !== undefined ? { details: e.details } : {}) } }), isError: true }; }
    });
  }
  const id = z.string().min(1);
  for (const entity of extensionEntityNames) {
    const m = extensionModels[entity];
    register(`list_${m.plural}`, `${m.description}. Bounded page; use cursor for the next page.`, { limit: z.number().int().min(1).max(200).default(50), cursor: z.string().optional(), clientId: id.optional(), projectId: id.optional(), includeArchived: z.boolean().optional() }, "tally:read", args => api.extensionList!(entity, args));
    register(`get_${m.singular}`, `Read one ${m.singular}.`, { id }, "tally:read", args => api.extensionGet!(entity, args.id));
    register(`create_${m.singular}`, m.description, { input: m.schema }, "tally:write", args => api.extensionCreate!(entity, args.input));
    register(`update_${m.singular}`, `Patch an existing ${m.singular}; omitted fields remain unchanged.`, { id, patch: m.schema.partial() }, "tally:write", args => api.extensionUpdate!(entity, args.id, args.patch));
    register(`delete_${m.singular}`, `Preview deletion by default. Obtain explicit approval before dryRun=false.`, { id, dryRun: z.boolean().default(true) }, "tally:manage", args => api.extensionDelete!(entity, args.id, args.dryRun));
    register(`bulk_create_${m.plural}`, `Create up to 200 ${m.plural}. Validate the whole batch before submitting.`, { items: z.array(m.schema).min(1).max(200) }, "tally:write", args => api.extensionBulk!(entity, args.items));
  }
  register("get_workspace_capabilities", "Discover supported storage features and browser-owned controls before using them.", {}, "tally:read", () => api.capabilities!());
  register("get_control_link", "Get the secure app URL for account, credential, admin, payment, PDF, offline-data, installation or notification controls. Does not change settings or grant access.", { control: z.enum(["account", "api_keys", "users", "payments", "invoice_pdf", "offline_data", "install_pwa", "notifications"]) }, "tally:read", a => api.controlLink!(a.control));
  register("list_share_links", "List existing share records. Public links reveal their target to anyone holding the link.", {}, "tally:read", () => api.listShares!());
  register("create_share_link", "Publish an invoice, timesheet or estimate as a public capability link ONLY after explicit approval of target and audience. Return the URL only to the requesting user.", { type: z.enum(["invoice", "timesheet", "estimate"]), target: z.object({ invoiceId: id.optional(), clientId: id.optional(), weekStartMs: z.number().int().optional(), snapshot: z.record(z.string(), z.unknown()).optional() }).strict(), expiresInDays: z.number().int().min(1).max(365).default(30), confirmPublicSharing: z.literal(true) }, "tally:manage", a => api.createShare!(a), true);
  register("revoke_share_link", "Revoke a public share link after approval; existing recipients lose access.", { id }, "tally:manage", a => api.revokeShare!(a.id), true);
  register("get_share_approvals", "Read approvals for an owned timesheet share.", { id }, "tally:read", a => api.shareApprovals!(a.id));
  register("preview_overdue_reminders", "Preview overdue reminders without sending messages or changing invoices.", { invoiceIds: z.array(id).optional() }, "tally:read", a => api.dunning!({ ...a, dryRun: true }));
  register("run_overdue_reminders", "Run overdue reminders after explicit approval of recipients and messages; may apply configured late fees. Preview first.", { invoiceIds: z.array(id).min(1), confirmed: z.literal(true) }, "tally:manage", a => api.dunning!({ invoiceIds: a.invoiceIds, dryRun: false }), true);
  const profilePolicy = toolAuthPolicy(options, "tally:read");
  server.registerTool("get_profile", { description: "Read the stable identity of the authenticated Tallyhand account.", inputSchema: z.object({}), outputSchema: z.object({ id: z.string(), name: z.string().optional(), email: z.string().optional() }), ...profilePolicy, _meta: { ...profilePolicy._meta, "openai/profile": true }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (_, ctx) => {
    const denied = toolAuthError(options, "tally:read", ctx); if (denied) return denied;
    const profile = await api.profile!();
    return { structuredContent: profile, content: [{ type: "text", text: JSON.stringify(profile) }] };
  });
}
