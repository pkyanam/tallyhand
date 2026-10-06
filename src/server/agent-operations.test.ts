import { describe, expect, it } from "vitest";
import { AGENT_OPERATIONS } from "./agent-operations";
import { OPENAPI_V1 } from "@/app/api/v1/_lib/openapi-document";
describe("agent operation contract", () => {
  it("documents both onboarding operations with the shared settings validator and preview/idempotency contract", () => {
    expect(AGENT_OPERATIONS.find(op => op.path === "/api/v1/onboarding" && op.method === "POST")).toMatchObject({ requiredScope: "tally:write", dryRun: true, idempotency: true });
    expect(OPENAPI_V1.paths["/onboarding"].post.requestBody.content["application/json"].schema.properties.settings).toEqual({ $ref: "#/components/schemas/SettingsPatch" });
    expect(OPENAPI_V1.components.schemas.AgentCapabilities.properties.operations).toBeDefined();
  });
  it("keeps credential sessions, signed provider callbacks and API-token-only operations distinct", () => {
    expect(AGENT_OPERATIONS.find(op => op.path === "/api/v1/api-tokens" && op.method === "POST")).toMatchObject({ authentication: "session" });
    expect(AGENT_OPERATIONS.find(op => op.path === "/api/v1/stripe/webhook")).toMatchObject({ authentication: "provider_signature" });
    expect(AGENT_OPERATIONS.find(op => op.path === "/api/v1/sync/push")).toMatchObject({ authentication: "session_or_api_token" });
    expect(new Set(AGENT_OPERATIONS.map(op => op.operationId)).size).toBe(AGENT_OPERATIONS.length);
  });
});
