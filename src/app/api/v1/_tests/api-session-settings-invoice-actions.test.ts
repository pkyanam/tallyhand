import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, readJson, setupApiEnv, teardownApiEnv } from "./helpers";
import { GET as settingsGet, PATCH as settingsPatch } from "../settings/route";
import { POST as sendInvoice } from "../invoices/[id]/send/route";
import { POST as paidInvoice } from "../invoices/[id]/paid/route";
import { getServerProvider } from "@/server/provider";

const mockSession = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...orig, tryResolveSessionUserId: async () => mockSession.userId };
});

describe("Clerk session settings and invoice actions", () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = setupApiEnv();
    mockSession.userId = "user-session";
  });
  afterEach(() => {
    mockSession.userId = null;
    teardownApiEnv(dbPath);
  });

  it("settings GET works without the CSRF header", async () => {
    const response = await settingsGet(makeRequest("/api/v1/settings", {}, false));
    expect(response.status).toBe(200);
  });

  it("settings PATCH requires CSRF and works with a session and header", async () => {
    const patch = { business: { name: "Test Studio" } };
    const rejected = await settingsPatch(makeRequest("/api/v1/settings", {
      method: "PATCH", body: JSON.stringify(patch),
    }, false));
    expect(rejected.status).toBe(400);
    const response = await settingsPatch(makeRequest("/api/v1/settings", {
      method: "PATCH", headers: { "x-tallyhand-sync": "1" }, body: JSON.stringify(patch),
    }, false));
    expect(response.status).toBe(200);
  });

  it.each([
    ["send", sendInvoice],
    ["paid", paidInvoice],
  ] as const)("invoice %s requires CSRF and works with a session and header", async (action, handler) => {
    const provider = getServerProvider();
    const client = await provider.createClient({ name: "Session client", defaultRate: 100 });
    const now = Date.now();
    const invoice = await provider.createInvoice({
      clientId: client.id, invoiceNumber: `TEST-${action}`, issueDate: now,
      dueDate: now + 86400000, status: action === "paid" ? "sent" : "draft",
      lineItems: [], subtotal: 0, total: 0, publicToken: `token-${action}`,
    });
    const path = `/api/v1/invoices/${invoice.id}/${action}`;
    const rejected = await handler(makeRequest(path, { method: "POST", body: "{}" }, false), { params: { id: invoice.id } });
    expect(rejected.status).toBe(400);
    const response = await handler(makeRequest(path, {
      method: "POST", headers: { "x-tallyhand-sync": "1" }, body: "{}",
    }, false), { params: { id: invoice.id } });
    expect(response.status).toBe(200);
    expect((await readJson(response)).status).toBe(200);
  });
});
