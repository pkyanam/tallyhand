/** Derive operation discovery from the actual API contract; never maintain a second business inventory. */
import { OPENAPI_V1 } from "@/app/api/v1/_lib/openapi-document";
import { requiredRestScope } from "@/lib/auth/oauth";

const methods = ["get", "post", "put", "patch", "delete", "head"] as const;
export const AGENT_OPERATIONS = Object.entries(OPENAPI_V1.paths).flatMap(([path, item]) =>
  methods.filter(method => method in item).map(method => {
    const operation = (item as Record<string, { summary?: string; security?: unknown[]; "x-authentication"?: string }>)[method];
    const publicOperation = operation.security?.length === 0;
    const concretePath = path.replace(/\{[^}]+\}/g, "example");
    const dryRun = JSON.stringify(operation).includes("DryRun");
    return {
      operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      method: method.toUpperCase(),
      path: `/api/v1${path}`,
      summary: operation.summary ?? `${method.toUpperCase()} ${path}`,
      authentication: operation["x-authentication"] ?? (publicOperation ? "public" : "workspace"),
      requiredScope: publicOperation ? "public" : requiredRestScope(new Request(`https://tallyhand.invalid/api/v1${path.replace(/\{[^}]+\}/g, "example")}`, { method: method.toUpperCase() })) ?? "session",
      dryRun,
      dryRunRequiredScope: dryRun ? requiredRestScope(new Request(`https://tallyhand.invalid/api/v1${concretePath}?dry_run=true`, { method: method.toUpperCase() })) : null,
      idempotency: JSON.stringify(operation).includes("IdempotencyKey"),
    };
  }),
);
