import { describe, it, expect, vi } from "vitest";
import { getOnboarding, setupWorkspace, parseSetupPatch } from "../src/onboarding.js";
import type { Api } from "../src/commands.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { inspectMcpCatalog } from "../src/mcp-catalog.js";
const api = (methods: Partial<Api> = {}) => ({ hasToken: true, ...methods }) as Api;
describe("workspace setup", () => {
  it("passes intent and preview settings to the backend", async () => {
    const onboarding = vi.fn(async () => ({ ready: false }));
    const configureOnboarding = vi.fn(async () => ({ valid: true }));
    const backend = api({ onboarding, configureOnboarding });
    await getOnboarding(backend, "invoicing");
    expect(onboarding).toHaveBeenCalledWith("invoicing");
    await setupWorkspace(backend, { settings: { business: { name: "Studio" } } });
    expect(configureOnboarding).toHaveBeenCalledWith({ settings: { business: { name: "Studio" } }, intent: "time_tracking", dryRun: true });
    await setupWorkspace(backend, { settings: {}, dryRun: false });
    expect(configureOnboarding).toHaveBeenLastCalledWith({ settings: {}, intent: "time_tracking", dryRun: false });
  });
  it("rejects invalid fields before making requests", async () => {
    const configureOnboarding = vi.fn();
    await expect(setupWorkspace(api({ configureOnboarding }), { settings: { admin: true }, dryRun: false })).rejects.toThrow();
    await expect(getOnboarding(api(), "admin")).rejects.toThrow();
    expect(configureOnboarding).not.toHaveBeenCalled();
    expect(() => parseSetupPatch("[]")).toThrow();
    expect(() => parseSetupPatch("bad")).toThrow("valid JSON");
  });
  it("reports unsupported adapters and unauthenticated setup honestly", async () => {
    await expect(getOnboarding(api())).rejects.toThrow("unavailable");
    await expect(setupWorkspace(api(), { settings: {} })).rejects.toThrow("unavailable");
    await expect(getOnboarding(api({ hasToken: false }))).rejects.toThrow("token");
  });
  it("exposes setup resources and prompt discovery", async () => {
    const server = createMcpServer(api({ getClient: async () => ({}), getProject: async () => ({}), getTask: async () => ({}), getExpense: async () => ({}), getInvoice: async () => ({}), onboarding: async () => ({ ready: false, nextSteps: [] }) }));
    const client = new Client({ name: "setup-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st); await client.connect(ct);
      expect((await client.listResources()).resources.map(item => item.uri)).toContain("tally://workspace/onboarding");
      expect((await client.listPrompts()).prompts.map(item => item.name)).toContain("setup_workspace");
      const response = await client.readResource({ uri: "tally://workspace/onboarding" });
      expect(JSON.parse((response.contents[0] as { text: string }).text)).toEqual({ ready: false, nextSteps: [] });
    } finally { await client.close(); await server.close(); }
  });
  it("publishes read/write scope and annotation contracts", async () => {
    const { tools } = await inspectMcpCatalog();
    const read = tools.find(tool => tool.name === "get_onboarding")!;
    const write = tools.find(tool => tool.name === "setup_workspace")!;
    expect(read.annotations?.readOnlyHint).toBe(true);
    expect(write.annotations?.readOnlyHint).toBe(false);
    expect(write.securitySchemes).toEqual([{ type: "oauth2", scopes: ["tally:read", "tally:write"] }]);
  });
});
