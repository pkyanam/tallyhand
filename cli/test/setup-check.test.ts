import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { checkSetup } from "../src/setup-check.js";

afterEach(() => vi.unstubAllGlobals());
function setup(archiveOrigin = "https://tallyhand.xyz") {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = "/plugins/tallyhand-9.8.7.zip";
  const bodies: Record<string, unknown> = {
    "/docs": "Install or update the CLI", "/setup.sh": "#!/usr/bin/env bash", "/installer/setup.sh": "#!/usr/bin/env bash", "/llms.txt": "# Tallyhand",
    "/.well-known/tally-cli.json": { client_id: "https://tallyhand.xyz/.well-known/tally-cli.json" },
    "/.well-known/oauth-protected-resource/api/mcp": { resource: "https://tallyhand.xyz/api/mcp", authorization_servers: ["https://clerk.tallyhand.xyz"] },
    "/.well-known/oauth-authorization-server": { client_id_metadata_document_supported: true, code_challenge_methods_supported: ["S256"], scopes_supported: ["tally:read", "tally:write", "tally:manage"] },
    "/plugins/catalog.json": { packages: [{ name: "tallyhand", archive: archiveOrigin + path, sha256 }] },
    [path]: bytes, [path + ".sha256"]: sha256 + "  tallyhand-9.8.7.zip\n",
  };
  const fetcher = vi.fn(async (url: string) => {
    const value = bodies[new URL(url).pathname];
    return new Response(value === undefined ? "Not found" : Buffer.isBuffer(value) || typeof value === "string" ? value : JSON.stringify(value), { status: value === undefined ? 404 : 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, bodies, path };
}
it("verifies the current catalog archive rather than a hardcoded release", async () => {
  const { fetcher, path } = setup();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await checkSetup("https://tallyhand.xyz/api/v1");
    expect(fetcher.mock.calls.some(([url]) => url === "https://tallyhand.xyz" + path)).toBe(true);
  } finally { log.mockRestore(); }
});
it("rejects catalog archives outside the configured origin", async () => {
  const { fetcher } = setup("https://other.example");
  await expect(checkSetup("https://tallyhand.xyz")).rejects.toThrow("Invalid plugin archive URL");
  expect(fetcher.mock.calls.some(([url]) => url.startsWith("https://other.example"))).toBe(false);
});
it("rejects a checksum that disagrees with the current catalog", async () => {
  const { bodies, path } = setup();
  bodies[path + ".sha256"] = "0".repeat(64);
  await expect(checkSetup("https://tallyhand.xyz")).rejects.toThrow("integrity");
});
