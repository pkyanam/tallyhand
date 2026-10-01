import { it, expect, vi, afterEach } from "vitest";
import { TallyhandClient } from "../src/client.js";
afterEach(() => vi.unstubAllGlobals());
it("preserves page metadata for bounded extension reads", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "fixture" }], meta: { nextCursor: "next", total: 2 } })));
  const api = new TallyhandClient({ baseUrl: "https://fixture.example", token: "synthetic" });
  expect(await api.extensionList("mileage", { limit: 1 })).toEqual({ data: [{ id: "fixture" }], meta: { nextCursor: "next", total: 2 } });
});
it("defaults extension deletion and reminders to preview", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async url => { requests.push(String(url)); return Response.json({ data: { dryRun: true } }); }));
  const api = new TallyhandClient({ baseUrl: "https://fixture.example", token: "synthetic" });
  await api.extensionDelete("contracts", "fixture"); await api.dunning();
  expect(requests.every(url => new URL(url).searchParams.get("dry_run") === "true")).toBe(true);
});
