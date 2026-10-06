import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationDiscovery, mcpServerCard } from "./integration-discovery";
import { GET as canonicalSpec } from "@/app/openapi.json/route";
import { GET as existingSpec } from "@/app/api/v1/openapi.json/route";
import { GET as catalog } from "@/app/.well-known/api-catalog/route";

afterEach(() => vi.unstubAllEnvs());
describe("public integration discovery", () => {
  it("uses the configured origin and declares both real auth alternatives", () => {
    vi.stubEnv("APP_BASE_URL", "https://tallyhand.xyz");
    vi.stubEnv("TALLY_MCP_OAUTH_ENABLED", "true");
    vi.stubEnv("TALLY_OAUTH_ISSUER", "https://clerk.tallyhand.xyz");
    const doc = integrationDiscovery();
    expect(doc.version).toBe(3);
    expect(doc.surfaces.map(s => s.type)).toEqual(["http", "mcp", "cli"]);
    for (const surface of doc.surfaces) {
      expect(surface.basis.source).toBe("https://tallyhand.xyz/.well-known/integrations.json");
      for (const entry of surface.auth.entries) {
        expect(entry.basis).toEqual(surface.basis);
        for (const use of entry.use) expect(doc.credentials).toHaveProperty(use.id);
      }
    }
    expect(doc.surfaces[1].auth.entries).toHaveLength(2);
    expect(doc.surfaces[2]).not.toHaveProperty("packages");
    expect(mcpServerCard().authentication).toEqual({ type: "oauth2", authorization_server: "https://clerk.tallyhand.xyz" });
  });
  it("does not advertise disabled OAuth or hardcode production on self-hosts", () => {
    vi.stubEnv("APP_BASE_URL", "https://billing.example.com");
    vi.stubEnv("TALLY_MCP_OAUTH_ENABLED", "false");
    const doc = integrationDiscovery();
    expect(doc.credentials).not.toHaveProperty("tallyhand_oauth");
    expect(doc.surfaces[0].url).toBe("https://billing.example.com/api/v1");
    expect(doc.surfaces[1].auth.entries).toHaveLength(1);
    expect(mcpServerCard().authentication).toEqual({ type: "bearer" });
  });
  it("keeps both spec URLs identical and publishes an RFC 9727 linkset", async () => {
    const spec = await canonicalSpec();
    expect(await spec.json()).toEqual(await (await existingSpec()).json());
    expect(spec.headers.get("cache-control")).toContain("public");
    const response = catalog();
    expect(response.headers.get("content-type")).toContain("application/linkset+json");
    const body = await response.json();
    expect(body.linkset[0].item).toHaveLength(2);
  });
});
