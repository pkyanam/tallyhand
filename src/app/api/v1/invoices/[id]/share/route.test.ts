/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../../../../../convex/schema";
import { ConvexStorageProvider } from "@/lib/db/convex-provider";
import { getShareDeps } from "@/lib/share/server-deps";
import { resolveShareToken, type ShareDeps } from "@/lib/share/service";
vi.mock("../../../_lib/sync-auth", () => ({ requireApiOrSession: vi.fn(async () => null) }));
vi.mock("../../../_lib/idempotency", () => ({ withIdempotency: (_req: Request, fn: () => Promise<Response>) => fn() }));
vi.mock("@/lib/share/server-deps", () => ({ getShareDeps: vi.fn() }));
import { POST } from "./route";
const modules = import.meta.glob("../../../../../../../convex/**/*.{ts,js}");
let deps: ShareDeps;
let invoiceId: string;
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  const serverSecret = "test-convex-server-secret-123456789012345";
  vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", serverSecret);
  const owner = convexTest(schema, modules).withIdentity({ subject: "owner" });
  const provider = new ConvexStorageProvider({
    query: (path, args) => owner.query(makeFunctionReference<"query">(path), { ...args, serverSecret }),
    mutation: (path, args) => owner.mutation(makeFunctionReference<"mutation">(path), { ...args, serverSecret }),
  }, "owner");
  const invoice = await provider.createInvoice({ clientId: "client", invoiceNumber: "1", issueDate: 1, dueDate: 2, status: "draft", lineItems: [], subtotal: 0, total: 0 });
  invoiceId = invoice.id;
  deps = { ownerProvider: provider, providerForUser: () => provider, shareSecret: "test-share-secret-12345678901234567890", baseUrl: "https://example.test" };
  vi.mocked(getShareDeps).mockReturnValue(deps);
});
async function share(enabled: boolean) {
  return POST(new Request(`https://example.test/api/v1/invoices/${invoiceId}/share`, { method: "POST", headers: { "content-type": "application/json", "x-tallyhand-sync": "1" }, body: JSON.stringify({ enabled }) }), { params: { id: invoiceId } });
}
describe("cloud invoice sharing API with Convex", () => {
  it("generates public invoice/PDF links, disables them and re-enables with a fresh link", async () => {
    const first = await (await share(true)).json();
    expect(first.data.shareUrl).toMatch(/^https:\/\/example.test\/share\//);
    expect(first.data.pdfUrl).toBe(`${first.data.shareUrl}/pdf`);
    expect((await share(false)).status).toBe(200);
    const renewed = await (await share(true)).json();
    expect(renewed.data.shareUrl).not.toBe(first.data.shareUrl);
    expect(renewed.data.cloudLinkEnabled).toBe(true);
    await expect(resolveShareToken(deps, first.data.shareUrl.split("/").at(-1))).rejects.toThrow();
    expect((await resolveShareToken(deps, renewed.data.shareUrl.split("/").at(-1))).invoice?.id).toBe(invoiceId);
  });
  it("returns a safe JSON error when hosted storage fails, rather than a browser parse error", async () => {
    vi.mocked(getShareDeps).mockImplementationOnce(() => { throw new Error("private storage details"); });
    const response = await share(true);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "sharing_unavailable", message: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain("private storage details");
  });
});
