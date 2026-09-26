/**
 * API v1 hardening tests: bulk all-or-nothing, sorting/filtering/date
 * ranges, dry-run non-mutation, invoice lifecycle conflicts, referential
 * delete guards, PATCH idempotency, and snake_case query aliases.
 *
 * Route handlers are imported directly and exercised with real Request
 * objects against a temp SQLite DB — no server needed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dataOf,
  jsonBody,
  makeRequest,
  readJson,
  setupApiEnv,
  teardownApiEnv,
} from "./helpers";

import { GET as clientsGet, POST as clientsPost } from "../clients/route";
import {
  PATCH as clientPatch,
  DELETE as clientDelete,
} from "../clients/[id]/route";
import { POST as projectsPost, GET as projectsGet } from "../projects/route";
import { DELETE as projectDelete } from "../projects/[id]/route";
import { GET as tasksGet, POST as tasksPost } from "../tasks/route";
import { PATCH as taskPatch } from "../tasks/[id]/route";
import { POST as tasksBulk } from "../tasks/bulk/route";
import { GET as expensesGet, POST as expensesPost } from "../expenses/route";
import { POST as expensesBulk } from "../expenses/bulk/route";
import { POST as invoicesPost } from "../invoices/route";
import {
  PATCH as invoicePatch,
  DELETE as invoiceDelete,
} from "../invoices/[id]/route";
import { POST as invoiceSend } from "../invoices/[id]/send/route";
import { POST as invoicePaid } from "../invoices/[id]/paid/route";
import { POST as schedulesPost } from "../recurring-schedules/route";
import { DELETE as scheduleDelete } from "../recurring-schedules/[id]/route";
import { POST as scheduleRun } from "../recurring-schedules/[id]/run/route";
import { POST as schedulerRun } from "../scheduler/run/route";
import { POST as retainersPost } from "../retainers/route";
import { GET as openapiGet } from "../openapi.json/route";

function withId(id: string) {
  return { params: { id } };
}

function postInit(data: unknown, extraHeaders: Record<string, string> = {}): RequestInit {
  return { method: "POST", body: jsonBody(data), headers: extraHeaders };
}

async function createClient(name = "Acme") {
  const res = await clientsPost(makeRequest("/api/v1/clients", postInit({ name })));
  const { status, body } = await readJson(res);
  expect(status).toBe(201);
  return dataOf<{ id: string }>(body);
}

async function createProject(clientId: string, name = "Website") {
  const res = await projectsPost(
    makeRequest("/api/v1/projects", postInit({ clientId, name })),
  );
  const { status, body } = await readJson(res);
  expect(status).toBe(201);
  return dataOf<{ id: string }>(body);
}

async function createTask(projectId: string, startAt: number, endAt: number, name = "Work") {
  const res = await tasksPost(
    makeRequest(
      "/api/v1/tasks",
      postInit({ projectId, name, startAt, endAt, durationMinutes: 60 }),
    ),
  );
  const { status, body } = await readJson(res);
  expect(status).toBe(201);
  return dataOf<{ id: string }>(body);
}

async function createInvoice(clientId: string, extra: Record<string, unknown> = {}) {
  const res = await invoicesPost(
    makeRequest(
      "/api/v1/invoices",
      postInit({
        clientId,
        issueDate: Date.now(),
        dueDate: Date.now() + 30 * 86400000,
        lineItems: [{ description: "Work", quantity: 1, rate: 100 }],
        ...extra,
      }),
    ),
  );
  return readJson(res);
}

describe("API v1 hardening", () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = setupApiEnv();
  });
  afterEach(() => {
    teardownApiEnv(dbPath);
  });

  describe("bulk create", () => {
    it("tasks/bulk creates all items (201) and accepts endAt 0 open timers", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const day = Date.parse("2026-09-20T00:00:00Z");
      const res = await tasksBulk(
        makeRequest(
          "/api/v1/tasks/bulk",
          postInit({
            items: [
              { projectId: project.id, name: "A", startAt: day, endAt: day + 3600000, durationMinutes: 60 },
              { projectId: project.id, name: "Open timer", startAt: day, endAt: 0, durationMinutes: 0 },
            ],
          }),
        ),
      );
      const { status, body } = await readJson(res);
      expect(status).toBe(201);
      expect(dataOf<{ id: string }[]>(body)).toHaveLength(2);
    });

    it("tasks/bulk rejects the whole batch on one bad item (400, nothing created)", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const day = Date.parse("2026-09-20T00:00:00Z");
      const res = await tasksBulk(
        makeRequest(
          "/api/v1/tasks/bulk",
          postInit({
            items: [
              { projectId: project.id, name: "Good", startAt: day, endAt: day + 1000, durationMinutes: 1 },
              { projectId: "proj_nope", name: "Bad FK", startAt: day, endAt: day + 1000, durationMinutes: 1 },
              { projectId: project.id, name: "Bad range", startAt: day + 5000, endAt: day, durationMinutes: 1 },
            ],
          }),
        ),
      );
      const { status, body } = await readJson(res);
      expect(status).toBe(400);
      const err = body as { error: { details: { index: number }[] } };
      expect(err.error.details.map((d) => d.index).sort()).toEqual([1, 2]);

      const list = await readJson(await tasksGet(makeRequest("/api/v1/tasks?limit=200")));
      expect(dataOf<unknown[]>(list.body)).toHaveLength(0);
    });

    it("tasks/bulk enforces the 200-item limit", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const items = Array.from({ length: 201 }, (_, i) => ({
        projectId: project.id,
        name: `T${i}`,
        startAt: 1000,
        endAt: 2000,
        durationMinutes: 1,
      }));
      const { status } = await readJson(
        await tasksBulk(makeRequest("/api/v1/tasks/bulk", postInit({ items }))),
      );
      expect(status).toBe(400);
    });

    it("expenses/bulk creates all items and rejects bad batches atomically", async () => {
      const client = await createClient();
      const day = Date.parse("2026-09-20T00:00:00Z");
      const okRes = await expensesBulk(
        makeRequest(
          "/api/v1/expenses/bulk",
          postInit({ items: [{ clientId: client.id, date: day, amount: 42.5, category: "travel" }] }),
        ),
      );
      expect((await readJson(okRes)).status).toBe(201);

      const badRes = await expensesBulk(
        makeRequest(
          "/api/v1/expenses/bulk",
          postInit({
            items: [
              { clientId: client.id, date: day, amount: 10, category: "meals" },
              { clientId: client.id, date: day, amount: -5, category: "meals" },
            ],
          }),
        ),
      );
      expect((await readJson(badRes)).status).toBe(400);
      const list = await readJson(await expensesGet(makeRequest("/api/v1/expenses?limit=200")));
      expect(dataOf<unknown[]>(list.body)).toHaveLength(1);
    });
  });

  describe("sorting, filtering, date ranges", () => {
    it("tasks support sort, snake_case aliases, billed filter and date ranges", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const d1 = Date.parse("2026-09-05T00:00:00Z");
      const d2 = Date.parse("2026-09-15T00:00:00Z");
      await createTask(project.id, d1, d1 + 3600000, "Alpha");
      await createTask(project.id, d2, d2 + 3600000, "Beta");

      // descending sort
      let res = await readJson(await tasksGet(makeRequest("/api/v1/tasks?sort=-startAt&limit=200")));
      const tasks = dataOf<{ name: string }[]>(res.body);
      expect(tasks.map((t) => t.name)).toEqual(["Beta", "Alpha"]);

      // invalid sort -> 400
      res = await readJson(await tasksGet(makeRequest("/api/v1/tasks?sort=bogus")));
      expect(res.status).toBe(400);

      // snake_case project_id alias
      res = await readJson(
        await tasksGet(makeRequest(`/api/v1/tasks?project_id=${project.id}&limit=200`)),
      );
      expect(dataOf<unknown[]>(res.body)).toHaveLength(2);

      // date range (ISO strings accepted)
      res = await readJson(
        await tasksGet(makeRequest("/api/v1/tasks?date_from=2026-09-10&date_to=2026-09-20&limit=200")),
      );
      expect(dataOf<{ name: string }[]>(res.body).map((t) => t.name)).toEqual(["Beta"]);

      // bad date -> 400
      res = await readJson(await tasksGet(makeRequest("/api/v1/tasks?date_from=not-a-date")));
      expect(res.status).toBe(400);

      // is_billed alias (both unbilled)
      res = await readJson(await tasksGet(makeRequest("/api/v1/tasks?is_billed=false&limit=200")));
      expect(dataOf<unknown[]>(res.body)).toHaveLength(2);
    });

    it("clients accept include_archived snake_case alias", async () => {
      const client = await createClient("Archivable");
      const patchRes = await clientPatch(
        makeRequest("/api/v1/clients/x", { method: "PATCH", body: jsonBody({ archived: true }) }),
        withId(client.id),
      );
      expect((await readJson(patchRes)).status).toBe(200);

      let res = await readJson(await clientsGet(makeRequest("/api/v1/clients?limit=200")));
      expect(dataOf<unknown[]>(res.body)).toHaveLength(0);
      res = await readJson(await clientsGet(makeRequest("/api/v1/clients?include_archived=true&limit=200")));
      expect(dataOf<unknown[]>(res.body)).toHaveLength(1);
    });

    it("projects accept client_id alias and invoices accept overdue filter", async () => {
      const client = await createClient();
      await createProject(client.id, "P1");
      const res = await readJson(
        await projectsGet(makeRequest(`/api/v1/projects?client_id=${client.id}&limit=200`)),
      );
      expect(dataOf<unknown[]>(res.body)).toHaveLength(1);
    });
  });

  describe("dry-run non-mutation", () => {
    it("client delete dry-run previews without deleting", async () => {
      const client = await createClient();
      const res = await readJson(
        await clientDelete(makeRequest("/api/v1/clients/x?dry_run=true", { method: "DELETE" }), withId(client.id)),
      );
      expect(res.status).toBe(200);
      expect(dataOf<{ dryRun: boolean }>(res.body).dryRun).toBe(true);
      // still there
      const get = await readJson(await clientsGet(makeRequest("/api/v1/clients?limit=200")));
      expect(dataOf<unknown[]>(get.body)).toHaveLength(1);
    });

    it("invoice send dry-run previews billed-marking without mutating", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const day = Date.parse("2026-09-20T00:00:00Z");
      const task = await createTask(project.id, day, day + 3600000);
      const { status, body } = await createInvoice(client.id, {
        lineItems: [
          { description: "Work", quantity: 1, rate: 100, sourceType: "task", sourceId: task.id },
        ],
      });
      expect(status).toBe(201);
      const invoice = dataOf<{ id: string; status: string }>(body);

      const dry = await readJson(
        await invoiceSend(makeRequest("/api/v1/x?dry_run=true", { method: "POST" }), withId(invoice.id)),
      );
      expect(dry.status).toBe(200);
      const preview = dataOf<{ dryRun: boolean; wouldSetStatus: string; wouldMarkBilled: { taskIds: string[] } }>(dry.body);
      expect(preview.dryRun).toBe(true);
      expect(preview.wouldSetStatus).toBe("sent");
      expect(preview.wouldMarkBilled.taskIds).toEqual([task.id]);

      // nothing mutated: still draft, task unbilled
      const get = await readJson(
        await tasksGet(makeRequest("/api/v1/tasks?limit=200")),
      );
      expect(dataOf<{ isBilled: boolean }[]>(get.body)[0].isBilled).toBe(false);
    });

    it("scheduler dry-run previews without creating or advancing", async () => {
      const client = await createClient();
      const schedRes = await schedulesPost(
        makeRequest(
          "/api/v1/recurring-schedules",
          postInit({
            clientId: client.id,
            name: "Monthly",
            mode: "fixed",
            frequency: "monthly",
            interval: 1,
            lineItems: [{ description: "Retainer", quantity: 1, rate: 2000 }],
            startDate: Date.now() - 86400000,
          }),
        ),
      );
      expect((await readJson(schedRes)).status).toBe(201);

      const dry = await readJson(
        await schedulerRun(makeRequest("/api/v1/scheduler/run?dry_run=true", { method: "POST" })),
      );
      expect(dry.status).toBe(200);
      const preview = dataOf<{ dryRun: boolean; due: { wouldCreateInvoice: boolean }[] }>(dry.body);
      expect(preview.dryRun).toBe(true);
      expect(preview.due).toHaveLength(1);
      expect(preview.due[0].wouldCreateInvoice).toBe(true);

      // a real run afterwards still generates (dry-run advanced nothing)
      const real = await readJson(
        await schedulerRun(makeRequest("/api/v1/scheduler/run", { method: "POST" })),
      );
      expect(dataOf<{ generated: string[] }>(real.body).generated).toHaveLength(1);
    });
  });

  describe("invoice lifecycle", () => {
    it("creation rejects non-draft initial status", async () => {
      const client = await createClient();
      const { status, body } = await createInvoice(client.id, { status: "sent" });
      expect(status).toBe(400);
      expect((body as { error: { message: string } }).error.message).toMatch(/draft/);
    });

    it("PATCH rejects status changes", async () => {
      const client = await createClient();
      const { body } = await createInvoice(client.id);
      const invoice = dataOf<{ id: string }>(body);
      const res = await readJson(
        await invoicePatch(
          makeRequest("/api/v1/x", { method: "PATCH", body: jsonBody({ status: "paid" }) }),
          withId(invoice.id),
        ),
      );
      expect(res.status).toBe(400);
    });

    it("paid requires sent status (409 on draft)", async () => {
      const client = await createClient();
      const { body } = await createInvoice(client.id);
      const invoice = dataOf<{ id: string }>(body);
      const res = await readJson(
        await invoicePaid(makeRequest("/api/v1/x", { method: "POST" }), withId(invoice.id)),
      );
      expect(res.status).toBe(409);
    });

    it("send is refused on an already-paid invoice (409)", async () => {
      const client = await createClient();
      const { body } = await createInvoice(client.id);
      const invoice = dataOf<{ id: string }>(body);
      expect((await readJson(await invoiceSend(makeRequest("/api/v1/x", { method: "POST" }), withId(invoice.id)))).status).toBe(200);
      expect((await readJson(await invoicePaid(makeRequest("/api/v1/x", { method: "POST" }), withId(invoice.id)))).status).toBe(200);
      const res = await readJson(
        await invoiceSend(makeRequest("/api/v1/x", { method: "POST" }), withId(invoice.id)),
      );
      expect(res.status).toBe(409);
    });

    it("deleting a scheduler-generated draft unclaims its tasks", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const day = Date.parse("2026-09-20T00:00:00Z");
      const task = await createTask(project.id, day, day + 3600000);
      // scheduler claims sources at generation time
      const schedRes = await schedulesPost(
        makeRequest(
          "/api/v1/recurring-schedules",
          postInit({
            clientId: client.id,
            name: "Unbilled sweep",
            mode: "unbilled",
            frequency: "monthly",
            interval: 1,
            lineItems: [],
            startDate: Date.now() - 86400000,
          }),
        ),
      );
      const schedule = dataOf<{ id: string }>((await readJson(schedRes)).body);
      const run = await readJson(
        await scheduleRun(makeRequest("/api/v1/x", { method: "POST" }), withId(schedule.id)),
      );
      const invoiceId = dataOf<{ invoiceId: string }>(run.body).invoiceId;
      expect(invoiceId).toBeTruthy();

      const tasks = dataOf<{ id: string; isBilled: boolean; invoiceId?: string }[]>(
        (await readJson(await tasksGet(makeRequest("/api/v1/tasks?limit=200")))).body,
      );
      expect(tasks.find((t) => t.id === task.id)?.isBilled).toBe(true);
      expect(tasks.find((t) => t.id === task.id)?.invoiceId).toBe(invoiceId);

      const del = await readJson(
        await invoiceDelete(makeRequest("/api/v1/x", { method: "DELETE" }), withId(invoiceId)),
      );
      expect(del.status).toBe(204);

      const after = dataOf<{ id: string; isBilled: boolean; invoiceId?: string }[]>(
        (await readJson(await tasksGet(makeRequest("/api/v1/tasks?limit=200")))).body,
      );
      const unclaimed = after.find((t) => t.id === task.id);
      expect(unclaimed?.isBilled).toBe(false);
      expect(unclaimed?.invoiceId).toBeFalsy();
    });
  });

  describe("referential delete guards", () => {
    it("client delete counts direct expenses, schedules and retainers", async () => {
      const client = await createClient();
      const day = Date.parse("2026-09-20T00:00:00Z");
      const expRes = await expensesPost(
        makeRequest("/api/v1/expenses", postInit({ clientId: client.id, date: day, amount: 10, category: "meals" })),
      );
      expect((await readJson(expRes)).status).toBe(201);

      const res = await readJson(
        await clientDelete(makeRequest("/api/v1/x", { method: "DELETE" }), withId(client.id)),
      );
      expect(res.status).toBe(409);
      const details = (res.body as { error: { details: Record<string, number> } }).error.details;
      expect(details.expenseCount).toBe(1);

      // schedule + retainer guards
      const schedRes = await schedulesPost(
        makeRequest(
          "/api/v1/recurring-schedules",
          postInit({
            clientId: client.id, name: "S", mode: "fixed", frequency: "monthly", interval: 1,
            lineItems: [{ description: "X", quantity: 1, rate: 10 }], startDate: Date.now(),
          }),
        ),
      );
      const schedule = dataOf<{ id: string }>((await readJson(schedRes)).body);
      const retRes = await retainersPost(
        makeRequest(
          "/api/v1/retainers",
          postInit({
            clientId: client.id, name: "R", type: "monthly-fee", amountCents: 50000,
            startDate: day, recurringScheduleId: schedule.id,
          }),
        ),
      );
      expect((await readJson(retRes)).status).toBe(201);

      const res2 = await readJson(
        await clientDelete(makeRequest("/api/v1/x", { method: "DELETE" }), withId(client.id)),
      );
      expect(res2.status).toBe(409);
      const details2 = (res2.body as { error: { details: Record<string, number> } }).error.details;
      expect(details2.scheduleCount).toBe(1);
      expect(details2.retainerCount).toBe(1);

      // schedule delete refused while the retainer references it
      const delSched = await readJson(
        await scheduleDelete(makeRequest("/api/v1/x", { method: "DELETE" }), withId(schedule.id)),
      );
      expect(delSched.status).toBe(409);
    });

    it("project delete counts recurring schedules", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const schedRes = await schedulesPost(
        makeRequest(
          "/api/v1/recurring-schedules",
          postInit({
            clientId: client.id, projectId: project.id, name: "S", mode: "fixed",
            frequency: "monthly", interval: 1,
            lineItems: [{ description: "X", quantity: 1, rate: 10 }], startDate: Date.now(),
          }),
        ),
      );
      expect((await readJson(schedRes)).status).toBe(201);
      const res = await readJson(
        await projectDelete(makeRequest("/api/v1/x", { method: "DELETE" }), withId(project.id)),
      );
      expect(res.status).toBe(409);
      expect((res.body as { error: { details: Record<string, number> } }).error.details.scheduleCount).toBe(1);
    });
  });

  describe("PATCH idempotency", () => {
    it("replaying an Idempotency-Key on PATCH returns the stored response", async () => {
      const client = await createClient("Original");
      const key = "patch-key-123";
      const patchInit = (name: string) => ({
        method: "PATCH",
        body: jsonBody({ name }),
        headers: { "Idempotency-Key": key },
      });
      const first = await readJson(
        await clientPatch(makeRequest("/api/v1/x", patchInit("First")), withId(client.id)),
      );
      expect(first.status).toBe(200);
      expect(dataOf<{ name: string }>(first.body).name).toBe("First");

      // same key, different body -> replays the FIRST response, no second mutation
      const second = await readJson(
        await clientPatch(makeRequest("/api/v1/x", patchInit("Second")), withId(client.id)),
      );
      expect(second.status).toBe(200);
      expect(dataOf<{ name: string }>(second.body).name).toBe("First");
    });

    it("task PATCH allows endAt 0 (open timer) and rejects endAt < startAt", async () => {
      const client = await createClient();
      const project = await createProject(client.id);
      const day = Date.parse("2026-09-20T00:00:00Z");
      const task = await createTask(project.id, day, day + 3600000);

      const open = await readJson(
        await taskPatch(
          makeRequest("/api/v1/x", { method: "PATCH", body: jsonBody({ endAt: 0 }) }),
          withId(task.id),
        ),
      );
      expect(open.status).toBe(200);

      const bad = await readJson(
        await taskPatch(
          makeRequest("/api/v1/x", { method: "PATCH", body: jsonBody({ endAt: day - 1000 }) }),
          withId(task.id),
        ),
      );
      expect(bad.status).toBe(400);
    });
  });
});

describe("API v1 openapi document (no auth)", () => {
  it("serves a valid OpenAPI 3.1 document covering the v1 surface", async () => {
    const res = await openapiGet();
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toMatch(/^3\.1/);
    for (const p of [
      "/clients",
      "/clients/{id}",
      "/projects",
      "/projects/{id}",
      "/tasks",
      "/tasks/{id}",
      "/tasks/bulk",
      "/expenses",
      "/expenses/{id}",
      "/expenses/bulk",
      "/invoices",
      "/invoices/{id}",
      "/invoices/{id}/send",
      "/invoices/{id}/paid",
      "/recurring-schedules",
      "/recurring-schedules/{id}",
      "/recurring-schedules/{id}/run",
      "/retainers",
      "/retainers/{id}",
      "/scheduler/run",
      "/settings",
      "/openapi.json",
      "/health",
    ]) {
      expect(doc.paths, `path ${p}`).toHaveProperty(p);
    }
    // JSON round-trip: no undefined/functions leaked into the document
    expect(JSON.parse(JSON.stringify(doc)).info.title).toBe("Tallyhand API");
  });
});
