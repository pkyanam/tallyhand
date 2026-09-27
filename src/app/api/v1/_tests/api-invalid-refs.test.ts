import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBody, makeRequest, readJson, setupApiEnv, teardownApiEnv, dataOf } from "./helpers";
import { POST as clientsPost } from "../clients/route";
import { POST as tasksPost } from "../tasks/route";
import { PATCH as taskPatch, GET as taskGet } from "../tasks/[id]/route";
import { POST as projectsPost } from "../projects/route";
import { PATCH as projectPatch } from "../projects/[id]/route";
import { POST as invoicesPost } from "../invoices/route";
import { PATCH as invoicePatch } from "../invoices/[id]/route";
import { POST as expensesPost } from "../expenses/route";
import { PATCH as expensePatch } from "../expenses/[id]/route";
import { POST as schedulesPost } from "../recurring-schedules/route";
import { PATCH as schedulePatch } from "../recurring-schedules/[id]/route";
import { POST as retainersPost } from "../retainers/route";
import { PATCH as retainerPatch } from "../retainers/[id]/route";
import { POST as mileagePost } from "../mileage/route";
import { PATCH as mileagePatch } from "../mileage/[id]/route";
import { POST as contractsPost } from "../contracts/route";
import { POST as rateCardsPost } from "../rate-cards/route";
import { PATCH as rateCardPatch } from "../rate-cards/[id]/route";

const missing = "missing_ref_123";
const ctx = (id: string) => ({ params: { id } });
const post = (path: string, body: unknown) => makeRequest(path, { method: "POST", body: jsonBody(body) });
const patch = (path: string, body: unknown) => makeRequest(path, { method: "PATCH", body: jsonBody(body) });

async function mkClient(): Promise<string> {
  const res = await clientsPost(post("/api/v1/clients", { name: "Ref Test Client" }));
  const { status, body } = await readJson(res);
  expect(status).toBe(201);
  return dataOf<{ id: string }>(body).id;
}

async function expectMissingRef(res: Response, id: string) {
  const { status, body } = await readJson(res);
  expect(status).toBe(404);
  expect((body as { error: { code: string } }).error.code).toBe("not_found");
  expect((body as { error: { message: string } }).error.message).toContain(id);
}

async function create(path: string, handler: (req: Request) => Promise<Response>, body: unknown): Promise<string> {
  const { status, body: responseBody } = await readJson(await handler(post(path, body)));
  expect(status).toBe(201);
  return dataOf<{ id: string }>(responseBody).id;
}

describe("API v1 invalid references", () => {
  let dbPath: string;
  beforeEach(() => { dbPath = setupApiEnv(); });
  afterEach(() => { teardownApiEnv(dbPath); });

  it("returns 404 for missing task and project references", async () => {
    const clientId = await mkClient();
    const projectId = await create("/api/v1/projects", projectsPost, { clientId, name: "P" });
    const taskId = await create("/api/v1/tasks", tasksPost, { projectId, name: "Work", startAt: 1000, endAt: 2000 });
    await expectMissingRef(await tasksPost(post("/api/v1/tasks", { projectId: missing, name: "Work", startAt: 1000, endAt: 2000 })), missing);
    await expectMissingRef(await taskPatch(patch(`/api/v1/tasks/${taskId}`, { projectId: missing }), ctx(taskId)), missing);
    await expectMissingRef(await projectsPost(post("/api/v1/projects", { clientId: missing, name: "P" })), missing);
    await expectMissingRef(await projectPatch(patch(`/api/v1/projects/${projectId}`, { clientId: missing }), ctx(projectId)), missing);
  });

  it("returns 404 for missing invoice and expense references", async () => {
    const clientId = await mkClient();
    const invoiceBody = { clientId, issueDate: 1000, dueDate: 2000, lineItems: [{ description: "Work", quantity: 1, rate: 10 }] };
    const invoiceId = await create("/api/v1/invoices", invoicesPost, invoiceBody);
    const expenseBody = { date: 1000, amount: 10, category: "travel" };
    const expenseId = await create("/api/v1/expenses", expensesPost, expenseBody);
    await expectMissingRef(await invoicesPost(post("/api/v1/invoices", { ...invoiceBody, clientId: missing })), missing);
    await expectMissingRef(await invoicePatch(patch(`/api/v1/invoices/${invoiceId}`, { clientId: missing }), ctx(invoiceId)), missing);
    await expectMissingRef(await expensesPost(post("/api/v1/expenses", { ...expenseBody, projectId: missing })), missing);
    await expectMissingRef(await expensesPost(post("/api/v1/expenses", { ...expenseBody, clientId: missing })), missing);
    await expectMissingRef(await expensePatch(patch(`/api/v1/expenses/${expenseId}`, { clientId: missing }), ctx(expenseId)), missing);
    await expectMissingRef(await expensePatch(patch(`/api/v1/expenses/${expenseId}`, { projectId: missing }), ctx(expenseId)), missing);
  });

  it("returns 404 for missing recurring schedule and retainer references", async () => {
    const clientId = await mkClient();
    const scheduleBody = { clientId, name: "Monthly", mode: "fixed", frequency: "monthly", interval: 1, lineItems: [{ description: "Work", quantity: 1, rate: 10 }], startDate: 1000 };
    const scheduleId = await create("/api/v1/recurring-schedules", schedulesPost, scheduleBody);
    const retainerBody = { clientId, name: "Support", type: "monthly-fee", amountCents: 5000, startDate: 1000 };
    const retainerId = await create("/api/v1/retainers", retainersPost, retainerBody);
    await expectMissingRef(await schedulesPost(post("/api/v1/recurring-schedules", { ...scheduleBody, clientId: missing })), missing);
    await expectMissingRef(await schedulesPost(post("/api/v1/recurring-schedules", { ...scheduleBody, projectId: missing })), missing);
    await expectMissingRef(await schedulePatch(patch(`/api/v1/recurring-schedules/${scheduleId}`, { clientId: missing }), ctx(scheduleId)), missing);
    await expectMissingRef(await schedulePatch(patch(`/api/v1/recurring-schedules/${scheduleId}`, { projectId: missing }), ctx(scheduleId)), missing);
    await expectMissingRef(await retainersPost(post("/api/v1/retainers", { ...retainerBody, clientId: missing })), missing);
    await expectMissingRef(await retainersPost(post("/api/v1/retainers", { ...retainerBody, recurringScheduleId: missing })), missing);
    await expectMissingRef(await retainerPatch(patch(`/api/v1/retainers/${retainerId}`, { clientId: missing }), ctx(retainerId)), missing);
    await expectMissingRef(await retainerPatch(patch(`/api/v1/retainers/${retainerId}`, { recurringScheduleId: missing }), ctx(retainerId)), missing);
  });

  it("returns 404 for missing extension entity references", async () => {
    const clientId = await mkClient();
    await expectMissingRef(await mileagePost(post("/api/v1/mileage", { date: 1000, miles: 1, purpose: "Trip", clientId: missing })), missing);
    await expectMissingRef(await contractsPost(post("/api/v1/contracts", { clientId, projectId: missing, type: "sow", title: "Agreement", startDate: 1000 })), missing);
    await expectMissingRef(await rateCardsPost(post("/api/v1/rate-cards", { clientId: missing, name: "RC", defaultRate: 100, effectiveFrom: 1000 })), missing);
    const rateCardId = await create("/api/v1/rate-cards", rateCardsPost, { clientId, name: "RC", defaultRate: 100, effectiveFrom: 1000 });
    await expectMissingRef(await rateCardPatch(patch(`/api/v1/rate-cards/${rateCardId}`, { clientId: missing }), ctx(rateCardId)), missing);
    const mileageId = await create("/api/v1/mileage", mileagePost, { date: 1000, miles: 1, purpose: "Trip", clientId });
    await expectMissingRef(await mileagePatch(patch(`/api/v1/mileage/${mileageId}`, { projectId: missing }), ctx(mileageId)), missing);
  });

  it("keeps schema errors as 400 and missing entities as 404", async () => {
    const invalid = [
      await retainersPost(post("/api/v1/retainers", { clientId: "x", name: "R", type: "bogus", amountCents: 1, startDate: 1000 })),
      await schedulesPost(post("/api/v1/recurring-schedules", { clientId: "x", name: "S", mode: "fixed", frequency: "bogus", interval: 1, lineItems: [{ description: "Work", quantity: 1, rate: 10 }], startDate: 1000 })),
      await expensesPost(post("/api/v1/expenses", { date: 1000, amount: -1, category: "travel" })),
      await tasksPost(post("/api/v1/tasks", { projectId: "x", name: "W", startAt: "not-a-date", endAt: 2000 })),
    ];
    for (const res of invalid) expect(res.status).toBe(400);
    const { status } = await readJson(await taskGet(makeRequest(`/api/v1/tasks/${missing}`), ctx(missing)));
    expect(status).toBe(404);
  });
});
