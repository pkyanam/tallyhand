/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../convex/schema";
import { api } from "../../../convex/_generated/api";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
afterEach(() => vi.unstubAllEnvs());

describe("native Convex workspace", () => {
  it("keeps duplicate sync creates from introducing ambiguous record IDs", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "owner", role: "member" });
    const client = { userId: "owner", id: "client", name: "Original" };
    await t.mutation(api.tally.clientsCreate, client);
    await expect(t.mutation(api.tally.clientsCreate, { ...client, name: "Retry" })).rejects.toThrow();
    expect(await t.query(api.tally.clientsList, { userId: "owner" })).toHaveLength(1);
    expect(await t.query(api.tally.clientsGet, { userId: "owner", id: "client" })).toMatchObject({ name: "Original" });
    expect(await t.query(api.workspace.revision, { userId: "owner" })).toBe(1);
  });
  it("persists work and publishes one revision per successful mutation", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "owner-a", role: "member" });
    expect(await t.query(api.workspace.revision, { userId: "owner-a" })).toBe(0);
    await t.mutation(api.tally.clientsCreate, { userId: "owner-a", id: "client-a", name: "Test client" });
    await t.mutation(api.tally.projectsCreate, { userId: "owner-a", id: "project-a", clientId: "client-a", name: "Test project" });
    expect(await t.query(api.workspace.revision, { userId: "owner-a" })).toBe(2);
    const projects = await t.query(api.tally.projectsList, { userId: "owner-a" });
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Test project");
  });
  it("keeps independently authenticated workspaces separate", async () => {
    const base = convexTest(schema, modules);
    const a = base.withIdentity({ subject: "owner-a", role: "member" });
    const b = base.withIdentity({ subject: "owner-b", role: "member" });
    await a.mutation(api.tally.clientsCreate, { userId: "owner-a", id: "same-id", name: "A" });
    await b.mutation(api.tally.clientsCreate, { userId: "owner-b", id: "same-id", name: "B" });
    expect((await a.query(api.tally.clientsList, { userId: "owner-a" })).map((x: { name: string }) => x.name)).toEqual(["A"]);
    expect((await b.query(api.tally.clientsList, { userId: "owner-b" })).map((x: { name: string }) => x.name)).toEqual(["B"]);
  });
  it("supports the authenticated server bridge without requiring a browser session", async () => {
    const serverSecret = "test-fixture-only-server-bridge-secret-123456";
    vi.stubEnv("TALLY_CONVEX_SERVER_SECRET", serverSecret);
    const t = convexTest(schema, modules);
    await t.mutation(api.tally.clientsCreate, { userId: "server-owner", serverSecret, id: "c", name: "Server client" });
    const rows = await t.query(api.tally.clientsList, { userId: "server-owner", serverSecret });
    expect(rows[0].name).toBe("Server client");
    expect(rows[0]).not.toHaveProperty("serverSecret");
  });
  it("preserves imported timestamps and recomputes edited task duration atomically", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "owner", role: "member" });
    const task = { userId: "owner", id: "task", projectId: "project", name: "Design", startAt: 1000000, endAt: 4600000, durationMinutes: 60, tags: [], createdAt: 100, updatedAt: 200 };
    expect(await t.mutation(api.tally.tasksCreate, task)).toMatchObject({ createdAt: 100, updatedAt: 200 });
    await t.mutation(api.tally.tasksUpdate, { userId: "owner", id: "task", patch: { endAt: 6400000 } });
    expect(await t.query(api.tally.tasksGet, { userId: "owner", id: "task" })).toMatchObject({ durationMinutes: 90 });
  });

});
