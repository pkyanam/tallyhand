/** Newer workspace routes, with request schemas derived from their validators. */
import { z } from "zod";
import { mileageCreateSchema, contractCreateSchema, taxPaymentCreateSchema, rateCardCreateSchema } from "@/server/validation";
import { AGENT_CONTROLS } from "@/server/agent-controls";
import { MAX_BULK_ITEMS } from "./bulk";

const parameter = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const query = (name: string, schema: object = { type: "string" }) => ({ name, in: "query", schema });
const jsonBody = (schema: object, required = true) => ({ required, content: { "application/json": { schema } } });
const replies = (status = "200", description = "Success envelope: { data }") => ({
  [status]: { description },
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { description: "Missing or invalid credentials" },
  "403": { description: "Insufficient scope or workspace role" },
  "501": { description: "The configured storage provider does not support this operation" },
});
function extensionPaths(path: string, schema: z.ZodObject, filters: string[]) {
  // Input mode preserves the wire format before date/coercion transforms.
  const create = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const patch = z.toJSONSchema(schema.partial(), { io: "input", unrepresentable: "any" });
  return {
    [`/${path}`]: {
      get: { summary: `List ${path}`, parameters: [parameter("Limit"), parameter("Cursor"), parameter("Search"), parameter("DateFrom"), parameter("DateTo"), query("sort"), ...filters.map(name => query(name))], responses: replies("200", "Paginated envelope: { data, meta: { limit, nextCursor, total } }") },
      post: { summary: `Create a ${path} record`, parameters: [parameter("IdempotencyKey")], requestBody: jsonBody(create), responses: replies("201") },
    },
    [`/${path}/{id}`]: {
      parameters: [parameter("Id")],
      get: { summary: `Read a ${path} record`, responses: { ...replies(), "404": { description: "Record not found" } } },
      patch: { summary: `Update a ${path} record`, parameters: [parameter("IdempotencyKey")], requestBody: jsonBody(patch), responses: replies() },
      delete: { summary: `Delete a ${path} record`, parameters: [parameter("DryRun")], responses: { ...replies("204", "Deleted; no response body"), "200": { description: "Dry-run preview; nothing deleted" } } },
    },
    [`/${path}/bulk`]: {
      post: { summary: `Bulk create ${path}`, description: "Validate every item before creating any. Bookkeeping only; does not transfer money, file taxes or sign contracts.", parameters: [parameter("IdempotencyKey")], requestBody: jsonBody({ oneOf: [
        { type: "object", required: ["items"], properties: { items: { type: "array", minItems: 1, maxItems: MAX_BULK_ITEMS, items: create } } },
        { type: "array", minItems: 1, maxItems: MAX_BULK_ITEMS, items: create },
      ] }), responses: replies("201") },
    },
  };
}

export const WORKSPACE_PATHS = {
  ...extensionPaths("mileage", mileageCreateSchema, ["clientId", "projectId", "isBilled"]),
  ...extensionPaths("contracts", contractCreateSchema, ["clientId", "type", "status", "archived"]),
  ...extensionPaths("tax-payments", taxPaymentCreateSchema, ["taxYear", "quarter", "jurisdiction"]),
  ...extensionPaths("rate-cards", rateCardCreateSchema, ["clientId", "projectId", "archived"]),
  "/profile": { get: { summary: "Identify the authenticated workspace", responses: replies("200", "{ data: { id, name } }") } },
  "/capabilities": { get: { summary: "Discover provider capabilities and secure browser controls", description: "Capabilities do not grant authorization. Payment execution is not supported.", responses: replies() } },
  "/controls": { get: { summary: "Get a secure browser control link", parameters: [{ ...query("control", { type: "string", enum: Object.keys(AGENT_CONTROLS) }), required: true }], responses: replies("200", "{ data: { control, url, instructions, requiresUserInteraction: true } }") } },
  "/data": {
    get: { summary: "Export an atomic cloud workspace backup", description: "Convex only. Returns the bundle and revision; credentials are never exported.", responses: replies("200", "{ data: { bundle, revision, resetRevokesApiKeys } }") },
    post: { summary: "Replace or reset cloud workspace data", description: "Requires explicit user approval and a saved backup at the current revision. Import replaces rather than merges. Reset revokes sharing links and all personal API keys atomically; import preserves API keys. Convex only; 4 MiB backup / 4,000 document limits. A backend lacking atomic key revocation rejects reset with 503.", parameters: [parameter("IdempotencyKey")], requestBody: jsonBody({ oneOf: [
      { type: "object", required: ["action", "expectedRevision", "confirmation", "bundle"], properties: { action: { const: "import" }, expectedRevision: { type: "integer", minimum: 0 }, confirmation: { const: "REPLACE CLOUD DATA" }, bundle: { type: "object", description: "A validated Tallyhand bundle from GET /data" } } },
      { type: "object", required: ["action", "expectedRevision", "confirmation"], properties: { action: { const: "reset" }, expectedRevision: { type: "integer", minimum: 0 }, confirmation: { const: "RESET CLOUD DATA AND API KEYS" } } },
    ] }), responses: { ...replies(), "409": { description: "Workspace changed after backup" }, "413": { description: "Backup exceeds size limit" }, "503": { description: "Cloud backend unavailable or atomic reset contract not deployed" } } },
  },
  "/dunning/run": { post: { summary: "Preview or run overdue reminder and late-fee actions", description: "Use dry_run=true to preview without changes. Actual runs require explicit user approval. OAuth previews must use the query parameter to request only tally:read.", parameters: [parameter("DryRun"), parameter("IdempotencyKey")], requestBody: jsonBody({ type: "object", properties: { dryRun: { type: "boolean" }, invoiceIds: { type: "array", items: { type: "string" } } } }, false), responses: replies() } },
  "/share-links": {
    get: { summary: "List owned public share links", responses: replies() },
    post: { summary: "Create a public invoice, timesheet or estimate link", description: "Obtain sharing approval first. Invoice shares reference a persisted invoice; arbitrary invoice snapshots are rejected.", parameters: [parameter("IdempotencyKey")], requestBody: jsonBody({ oneOf: [
      shareInput("invoice", { type: "object", required: ["invoiceId"], properties: { invoiceId: { type: "string", minLength: 1 } } }),
      shareInput("timesheet", { type: "object", required: ["clientId", "weekStartMs"], properties: { clientId: { type: "string", minLength: 1 }, weekStartMs: { type: "integer" } } }),
      shareInput("estimate", { type: "object", required: ["snapshot"], properties: { snapshot: { type: "object" } } }),
    ] }), responses: replies("201", "{ data: { id, url, pdfUrl, expiresAt, type } }") },
  },
  "/share-links/{id}": { delete: { summary: "Revoke an owned share link", parameters: [parameter("Id")], responses: replies("200", "{ data: { revoked: true, id } }") } },
  "/share-links/{id}/approvals": { get: { summary: "List approvals for an owned timesheet link", parameters: [parameter("Id")], responses: replies() } },
};
function shareInput(type: string, target: object) {
  return { type: "object", required: ["type", "target", "confirmPublicSharing"], properties: {
    type: { const: type }, target, confirmPublicSharing: { const: true }, expiresInDays: { type: "integer", minimum: 1, maximum: 365, default: 30 },
  } };
}
