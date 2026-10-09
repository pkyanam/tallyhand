/** Capability-resolved operations share REST permissions and validation. */
import { z } from "zod";
import { needAuth, type Api } from "./commands.js";
export const operationInputSchema = z.object({
  operationId: z.string().min(1), params: z.record(z.string(), z.string()).default({}),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(), dryRun: z.boolean().optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
}).strict();
export type WorkspaceScope = "tally:read" | "tally:write" | "tally:manage";
export const financialOperationSchema = z.object({
  action: z.enum(["timeline", "payments", "reconcile", "checkout"]),
  invoiceId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  grant: z.string().min(1),
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  cancelUrl: z.string().url().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(2048).optional(),
  paymentCursor: z.string().max(2048).optional(),
  providerCursors: z.record(z.string(), z.string().max(2048)).optional(),
}).strict().refine(input => !["timeline", "checkout"].includes(input.action) || !!input.invoiceId, {
  message: "This action requires invoiceId", path: ["invoiceId"],
}).refine(input => input.action !== "checkout" || !!input.operationId, {
  message: "Checkout requires a stable operationId", path: ["operationId"],
});

export async function requestFinancialOperation(api: Api, input: unknown) {
  const args = financialOperationSchema.parse(input);
  needAuth(api);
  if (!api.requestFinancialOperation) throw new Error("Financial operations are unavailable on this backend");
  return api.requestFinancialOperation(args);
}
export async function requestOperation(api: Api, input: unknown, scope: WorkspaceScope) {
  const args = operationInputSchema.parse(input); needAuth(api);
  if (!api.capabilities || !api.requestWorkspaceOperation) throw new Error("Workspace operation requests are unavailable on this backend");
  const capabilities = await api.capabilities();
  const operation = capabilities.operations?.find((item: any) => item.operationId === args.operationId);
  if (!operation) throw new Error("Unknown operationId; inspect capabilities.operations");
  const requiredScope = args.dryRun === true ? operation.dryRunRequiredScope ?? operation.requiredScope : operation.requiredScope;
  const allowedNow = args.dryRun === true ? operation.dryRunAllowedNow ?? operation.allowedNow : operation.allowedNow;
  if (requiredScope !== scope) throw new Error(`Use the operation tool matching its required scope: ${requiredScope}`);
  if (allowedNow === false || operation.supportedByBackend === false) throw new Error(operation.authorizationReason ?? "Operation is unavailable for this caller");
  let path = String(operation.path).replace(/\{([^}]+)\}/g, (_match, name) => {
    const value = args.params[name];
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Missing or invalid path parameter: ${name}`);
    return encodeURIComponent(value);
  });
  if (!path.startsWith("/api/v1/")) throw new Error("Unsupported operation destination");
  if (args.dryRun !== undefined && !operation.dryRun) throw new Error("This operation does not support dry-run; no request was sent");
  return api.requestWorkspaceOperation({ method: operation.method, path, body: args.body, query: args.query, dryRun: args.dryRun, idempotencyKey: args.idempotencyKey });
}
