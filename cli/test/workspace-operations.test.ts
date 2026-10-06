import { describe, it, expect, vi } from "vitest";
import { requestOperation } from "../src/workspace-operations.js";
import type { Api } from "../src/commands.js";
const operation = { operationId: "update_client", method: "PATCH", path: "/api/v1/clients/{id}", requiredScope: "tally:write", allowedNow: true, supportedByBackend: true, dryRun: false };
const backend = (changes = {}) => ({ hasToken: true, capabilities: async () => ({ operations: [{ ...operation, ...changes }] }), requestWorkspaceOperation: vi.fn(async () => ({ ok: true })) }) as unknown as Api;
describe("capability operation requests", () => {
  it("resolves the advertised path and passes the idempotency key", async () => {
    const api = backend();
    await requestOperation(api, { operationId: "update_client", params: { id: "c1" }, body: { name: "Studio" }, idempotencyKey: "update-1" }, "tally:write");
    expect(api.requestWorkspaceOperation).toHaveBeenCalledWith({ method: "PATCH", path: "/api/v1/clients/c1", body: { name: "Studio" }, query: undefined, idempotencyKey: "update-1", dryRun: undefined });
  });
  it("allows advertised read previews while rejecting actual manage operations", async () => {
    const api = backend({ operationId: "run_dunning", method: "POST", path: "/api/v1/dunning/run", requiredScope: "tally:manage", allowedNow: false, dryRun: true, dryRunRequiredScope: "tally:read", dryRunAllowedNow: true });
    await requestOperation(api, { operationId: "run_dunning", dryRun: true }, "tally:read");
    expect(api.requestWorkspaceOperation).toHaveBeenCalledOnce();
    await expect(requestOperation(api, { operationId: "run_dunning", dryRun: false }, "tally:read")).rejects.toThrow("tally:manage");
    await expect(requestOperation(api, { operationId: "run_dunning" }, "tally:manage")).rejects.toThrow();
    expect(api.requestWorkspaceOperation).toHaveBeenCalledOnce();
    const unavailable = backend({ dryRun: true, dryRunRequiredScope: "tally:read", dryRunAllowedNow: false });
    await expect(requestOperation(unavailable, { operationId: "update_client", params: { id: "c1" }, dryRun: true }, "tally:read")).rejects.toThrow();
    expect(unavailable.requestWorkspaceOperation).not.toHaveBeenCalled();
  });
  it("rejects wrong scopes, unsupported capabilities, and invalid parameters without requests", async () => {
    for (const [changes, input, scope] of [
      [{}, { params: { id: "c1" } }, "tally:read"],
      [{ allowedNow: false }, { params: { id: "c1" } }, "tally:write"],
      [{}, { params: { id: "../auth" } }, "tally:write"],
      [{}, { params: { id: "c1" }, dryRun: true }, "tally:write"],
      [{ requiredScope: "session" }, { params: { id: "c1" } }, "tally:manage"],
    ] as const) {
      const api = backend(changes);
      await expect(requestOperation(api, { operationId: "update_client", ...input }, scope)).rejects.toThrow();
      expect(api.requestWorkspaceOperation).not.toHaveBeenCalled();
    }
  });
});
