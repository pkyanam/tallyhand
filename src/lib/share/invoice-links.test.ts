import { describe, it, expect, vi } from "vitest";
import { invoiceLinks, disableInvoiceLinks } from "./invoice-links";
import { resolveShareToken } from "./service";
import type { ShareDeps } from "./service";
import type { ShareLinkRow, ShareLinkCreateInput } from "@/lib/db/hosted-types";
import type { Invoice } from "@/core/entities";
function fixture() {
  const invoice = { id: "fixture", clientId: "client", status: "draft", cloudLinkEnabled: true } as Invoice;
  const links: ShareLinkRow[] = [];
  const owner = {
    getInvoice: async (id: string) => id === invoice.id ? invoice : undefined,
    getClient: async () => ({ id: "client", name: "Example" }), getSettings: async () => ({}),
    listShareLinks: async () => links,
    getShareLinkById: async (id: string) => links.find(l => l.id === id),
    updateInvoice: async (_id: string, patch: Partial<Invoice>) => Object.assign(invoice, patch),
    revokeShareLink: async (id: string) => { links.find(l => l.id === id)!.revokedAt = Date.now(); },
    createShareLink: vi.fn(async (input: ShareLinkCreateInput) => { const link = { ...input, id: `link${links.length}`, userId: "owner", createdAt: Date.now(), revokedAt: null }; links.push(link); return link; }),
  };
  const deps = { ownerProvider: owner, providerForUser: () => owner, shareSecret: "s".repeat(40), baseUrl: "https://example.test" } as unknown as ShareDeps;
  return { invoice, links, owner, deps };
}
describe("live invoice links", () => {
  it("reads without creating and reuses the same link after edits", async () => {
    const f = fixture(); expect((await invoiceLinks(f.deps, f.invoice)).shareUrl).toBeNull();
    const first = await invoiceLinks(f.deps, f.invoice, true);
    f.invoice.notes = "Updated";
    expect(await invoiceLinks(f.deps, f.invoice, true)).toEqual(first);
    expect(f.owner.createShareLink).toHaveBeenCalledTimes(1);
    const resolved = await resolveShareToken(f.deps, first.shareUrl!.split("/").at(-1)!);
    expect(resolved.invoice?.notes).toBe("Updated");
    expect(first.pdfUrl).toBe(`${first.shareUrl}/pdf`);
  });
  it("disables and revokes links, reenable creates a fresh link", async () => {
    const f = fixture(); const first = await invoiceLinks(f.deps, f.invoice, true);
    await disableInvoiceLinks(f.deps, f.invoice.id);
    expect(await invoiceLinks(f.deps, f.invoice, true)).toEqual({ shareUrl: null, pdfUrl: null });
    await expect(resolveShareToken(f.deps, first.shareUrl!.split("/").at(-1)!)).rejects.toThrow();
    f.invoice.cloudLinkEnabled = true;
    expect((await invoiceLinks(f.deps, f.invoice, true)).shareUrl).not.toBe(first.shareUrl);
  });
  it("renews expired links and refuses disabled legacy snapshots", async () => {
    const f = fixture(); await invoiceLinks(f.deps, f.invoice, true); f.links[0].expiresAt = 0;
    await invoiceLinks(f.deps, f.invoice, true); expect(f.links).toHaveLength(2);
    const current = await invoiceLinks(f.deps, f.invoice);
    (f.links[1].target as { snapshot?: unknown }).snapshot = { invoice: { id: "fixture" } }; f.invoice.cloudLinkEnabled = false;
    await expect(resolveShareToken(f.deps, current.shareUrl!.split("/").at(-1)!)).rejects.toThrow("disabled");
  });
});
