/**
 * API v1 route smoke tests: import route handlers directly and exercise
 * them with real Request objects. Covers auth (401/503), clients CRUD +
 * pagination, the invoice send→paid lifecycle, idempotency replay, and the
 * recurring scheduler (force-run + scheduler/run).
 *
 * Each step is split into two statements (call handler, then parse) to keep
 * the expressions shallow and readable.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dataOf,
  jsonBody,
  makeRequest,
  readJson,
  setupApiEnv,
  teardownApiEnv,
  TEST_TOKEN,
} from "./helpers";

import { GET as healthGet } from "../health/route";
import { GET as clientsGet, POST as clientsPost } from "../clients/route";
import {
  GET as clientGet,
  PATCH as clientPatch,
  DELETE as clientDelete,
} from "../clients/[id]/route";
import { POST as projectsPost } from "../projects/route";
import { POST as tasksPost } from "../tasks/route";
import { GET as taskGet } from "../tasks/[id]/route";
import { POST as invoicesPost } from "../invoices/route";
import { POST as invoiceSend } from "../invoices/[id]/send/route";
import { POST as invoicePaid } from "../invoices/[id]/paid/route";
import { POST as schedulesPost } from "../recurring-schedules/route";
import { POST as scheduleRun } from "../recurring-schedules/[id]/run/route";
import { POST as schedulerRun } from "../scheduler/run/route";

function withId(id: string) {
  return { params: { id } };
}

function postInit(data: unknown, extraHeaders: Record<string, string> = {}): RequestInit {
  return { method: "POST", body: jsonBody(data), headers: extraHeaders };
}

describe("API v1 routes", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = setupApiEnv();
  });

  afterEach(() => {
    teardownApiEnv(dbPath);
    process.env.TALLYHAND_API_TOKEN = TEST_TOKEN;
  });

  describe("auth", () => {
    it("health needs no auth", async () => {
      const { status, body } = await readJson(await healthGet());
      expect(status).toBe(200);
      expect(dataOf<{ status: string }>(body).status).toBe("ok");
    });

    it("returns 401 without a token", async () => {
      const res = await clientsGet(makeRequest("/api/v1/clients", {}, false));
      const { status, body } = await readJson(res);
      expect(status).toBe(401);
      expect((body as { error: { code: string } }).error.code).toBe("unauthorized");
    });

    it("returns 401 with a wrong token", async () => {
      const req = makeRequest("/api/v1/clients");
      req.headers.set("authorization", "Bearer wrong");
      const { status } = await readJson(await clientsGet(req));
      expect(status).toBe(401);
    });

    it("returns 503 when TALLYHAND_API_TOKEN is unset", async () => {
      delete process.env.TALLYHAND_API_TOKEN;
      const res = await clientsGet(makeRequest("/api/v1/clients", {}, false));
      const { status, body } = await readJson(res);
      expect(status).toBe(503);
      expect((body as { error: { code: string } }).error.code).toBe("api_disabled");
    });
  });

  describe("clients CRUD + pagination", () => {
    it("creates, reads, patches, lists with meta, deletes", async () => {
      const createRes = await clientsPost(
        makeRequest("/api/v1/clients", postInit({ name: "Acme", defaultRate: 150 })),
      );
      const created = await readJson(createRes);
      expect(created.status).toBe(201);
      const client = dataOf<{ id: string; name: string }>(created.body);
      expect(client.id.startsWith("cli_")).toBe(true);

      const getRes = await readJson(await clientGet(makeRequest("/api/v1/clients/x"), withId(client.id)));
      expect(getRes.status).toBe(200);

      const missing = await readJson(await clientGet(makeRequest("/api/v1/clients/nope"), withId("cli_nope")));
      expect(missing.status).toBe(404);

      const patchRes = await clientPatch(
        makeRequest("/api/v1/clients/x", { method: "PATCH", body: jsonBody({ name: "Acme Corp" }) }),
        withId(client.id),
      );
      const patched = await readJson(patchRes);
      expect(patched.status).toBe(200);
      expect(dataOf<{ name: string }>(patched.body).name).toBe("Acme Corp");

      const listRes = await clientsGet(makeRequest("/api/v1/clients?limit=10"));
      const listed = await readJson(listRes);
      expect(listed.status).toBe(200);
      const page = listed.body as {
        data: unknown[];
        meta: { limit: number; nextCursor: null; total: number };
      };
      expect(page.data).toHaveLength(1);
      expect(page.meta.total).toBe(1);
      expect(page.meta.nextCursor).toBeNull();

      const badCreate = await clientsPost(makeRequest("/api/v1/clients", postInit({})));
      expect((await readJson(badCreate)).status).toBe(400);

      const delRes = await clientDelete(
        makeRequest("/api/v1/clients/x", { method: "DELETE" }),
        withId(client.id),
      );
      expect(delRes.status).toBe(204);
      const after = await readJson(await clientGet(makeRequest("/api/v1/clients/x"), withId(client.id)));
      expect(after.status).toBe(404);
    });

    it("replays the stored response for a repeated Idempotency-Key", async () => {
      const headers = { "Idempotency-Key": "key-1" };
      const first = await readJson(
        await clientsPost(makeRequest("/api/v1/clients", postInit({ name: "Idem" }, headers))),
      );
      const second = await readJson(
        await clientsPost(makeRequest("/api/v1/clients", postInit({ name: "Idem" }, headers))),
      );
      expect(dataOf<{ id: string }>(second.body).id).toBe(dataOf<{ id: string }>(first.body).id);
      const list = await readJson(await clientsGet(makeRequest("/api/v1/clients")));
      expect((list.body as { data: unknown[] }).data).toHaveLength(1);
    });
  });

  describe("invoice lifecycle", () => {
    it("create → send → paid, with tasks marked billed on send", async () => {
      const clientRes = await clientsPost(makeRequest("/api/v1/clients", postInit({ name: "Acme" })));
      const client = dataOf<{ id: string }>((await readJson(clientRes)).body);

      const projectRes = await projectsPost(
        makeRequest("/api/v1/projects", postInit({ clientId: client.id, name: "Site" })),
      );
      const project = dataOf<{ id: string }>((await readJson(projectRes)).body);

      const taskRes = await tasksPost(
        makeRequest(
          "/api/v1/tasks",
          postInit({ projectId: project.id, name: "work", startAt: 1000, endAt: 3700000 }),
        ),
      );
      const task = dataOf<{ id: string }>((await readJson(taskRes)).body);

      const invoiceRes = await invoicesPost(
        makeRequest(
          "/api/v1/invoices",
          postInit({
            clientId: client.id,
            issueDate: 1000,
            dueDate: 2000,
            lineItems: [
              { description: "work", quantity: 1, rate: 100, sourceType: "task", sourceId: task.id },
            ],
          }),
        ),
      );
      const invoice = dataOf<{ id: string; invoiceNumber: string; status: string; total: number }>(
        (await readJson(invoiceRes)).body,
      );
      expect(invoice.invoiceNumber).toBe("INV-1001");
      expect(invoice.status).toBe("draft");
      expect(invoice.total).toBe(100);

      const sendRes = await invoiceSend(makeRequest("/api/v1/x", { method: "POST" }), withId(invoice.id));
      const sent = dataOf<{ status: string }>((await readJson(sendRes)).body);
      expect(sent.status).toBe("sent");

      const taskRes2 = await taskGet(makeRequest("/api/v1/x"), withId(task.id));
      const billedTask = dataOf<{ isBilled: boolean; invoiceId: string }>((await readJson(taskRes2)).body);
      expect(billedTask.isBilled).toBe(true);
      expect(billedTask.invoiceId).toBe(invoice.id);

      // idempotent re-send
      const resend = await readJson(
        await invoiceSend(makeRequest("/api/v1/x", { method: "POST" }), withId(invoice.id)),
      );
      expect(resend.status).toBe(200);

      const paidRes = await invoicePaid(makeRequest("/api/v1/x", { method: "POST" }), withId(invoice.id));
      const paid = dataOf<{ status: string }>((await readJson(paidRes)).body);
      expect(paid.status).toBe("paid");

      const missing = await readJson(
        await invoiceSend(makeRequest("/api/v1/x", { method: "POST" }), withId("inv_nope")),
      );
      expect(missing.status).toBe(404);
    });
  });

  describe("scheduler", () => {
    it("scheduler/run generates a draft for a due fixed schedule and advances it", async () => {
      const clientRes = await clientsPost(makeRequest("/api/v1/clients", postInit({ name: "Acme" })));
      const client = dataOf<{ id: string }>((await readJson(clientRes)).body);

      const scheduleRes = await schedulesPost(
        makeRequest(
          "/api/v1/recurring-schedules",
          postInit({
            clientId: client.id,
            name: "Monthly",
            mode: "fixed",
            frequency: "monthly",
            interval: 1,
            lineItems: [{ description: "Retainer", quantity: 1, rate: 2000 }],
            startDate: Date.now() - 86400000, // due yesterday
          }),
        ),
      );
      expect((await readJson(scheduleRes)).status).toBe(201);

      const runRes = await schedulerRun(makeRequest("/api/v1/scheduler/run", { method: "POST" }));
      const run = dataOf<{
        generated: string[];
        results: { invoiceId: string | null; nextRunAt: number; occurrences: number }[];
      }>((await readJson(runRes)).body);
      expect(run.generated).toHaveLength(1);
      expect(run.results[0].invoiceId).toBe(run.generated[0]);
      expect(run.results[0].occurrences).toBe(1);
      expect(run.results[0].nextRunAt).toBeGreaterThan(Date.now());

      // second run: nothing due anymore
      const rerunRes = await schedulerRun(makeRequest("/api/v1/scheduler/run", { method: "POST" }));
      const rerun = dataOf<{ generated: string[] }>((await readJson(rerunRes)).body);
      expect(rerun.generated).toHaveLength(0);
    });

    it("recurring-schedules/[id]/run force-runs a non-due schedule", async () => {
      const clientRes = await clientsPost(makeRequest("/api/v1/clients", postInit({ name: "Acme" })));
      const client = dataOf<{ id: string }>((await readJson(clientRes)).body);

      const scheduleRes = await schedulesPost(
        makeRequest(
          "/api/v1/recurring-schedules",
          postInit({
            clientId: client.id,
            name: "Future",
            mode: "fixed",
            frequency: "monthly",
            interval: 1,
            lineItems: [{ description: "Retainer", quantity: 1, rate: 500 }],
            startDate: Date.now() + 30 * 86400000, // not due
          }),
        ),
      );
      const schedule = dataOf<{ id: string }>((await readJson(scheduleRes)).body);

      const resultRes = await scheduleRun(makeRequest("/api/v1/x", { method: "POST" }), withId(schedule.id));
      const result = dataOf<{ invoiceId: string | null }>((await readJson(resultRes)).body);
      expect(result.invoiceId).not.toBeNull();

      const missing = await readJson(
        await scheduleRun(makeRequest("/api/v1/x", { method: "POST" }), withId("rsc_nope")),
      );
      expect(missing.status).toBe(404);
    });
  });
});
