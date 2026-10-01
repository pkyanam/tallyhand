import { describe, expect, it } from "vitest";
import { summarizeProjects } from "./project-summary";
import type { Client, Invoice, Project, Task } from "./entities";

const client: Client = { id: "c", name: "Client", archived: false, createdAt: 1, updatedAt: 1 };
const project: Project = { id: "p", clientId: "c", name: "Project", archived: false, createdAt: 1, updatedAt: 1 };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, projectId: "p", name: id, startAt: 1, endAt: 3600001, durationMinutes: 60, tags: [], isBilled: false, createdAt: 1, updatedAt: 1, ...extra });
const draft = { id: "i", status: "draft", lineItems: [{ sourceType: "task", sourceId: "reserved" }] } as Invoice;

describe("project overview", () => {
  it("keeps billed and draft-reserved time out of ready-to-invoice totals", () => {
    const [row] = summarizeProjects([project], [client], [task("ready"), task("reserved"), task("paid", { isBilled: true })], [draft]);
    expect(row).toMatchObject({ trackedMinutes: 180, readyToInvoiceMinutes: 60, reservedMinutes: 60 });
  });
  it("excludes open timers and invalid durations from totals", () => {
    const [row] = summarizeProjects([project], [client], [task("open", { endAt: 0 }), task("bad", { durationMinutes: NaN }), task("negative", { durationMinutes: -10 })], []);
    expect(row.trackedMinutes).toBe(0);
    expect(row.readyToInvoiceMinutes).toBe(0);
  });
  it("treats a linked invoice as reserved even before the billed flag changes", () => {
    expect(summarizeProjects([project], [client], [task("linked", { invoiceId: "i" })], [])[0].readyToInvoiceMinutes).toBe(0);
  });
  it("retains empty and orphan projects and inherits client archival", () => {
    const rows = summarizeProjects([project, { ...project, id: "orphan", clientId: "missing" }], [{ ...client, archived: true }], [], []);
    expect(rows.find((r) => r.project.id === "p")).toMatchObject({ archived: true, trackedMinutes: 0, lastActivityAt: null });
    expect(rows.find((r) => r.project.id === "orphan")?.client).toBeUndefined();
  });
  it("isolates project totals and sorts by recent work", () => {
    const rows = summarizeProjects([project, { ...project, id: "p2" }], [client], [task("other", { projectId: "p2", startAt: 99, durationMinutes: 25 })], []);
    expect(rows.map((r) => [r.project.id, r.trackedMinutes])).toEqual([["p2", 25], ["p", 0]]);
  });
});
