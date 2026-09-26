// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, resetDbSingletonForTests } from "@/lib/db/schema";
import { DexieStorageProvider } from "@/lib/db/dexie-provider";
import type { StorageProvider } from "@/core/storage";
import type { Invoice } from "@/core/entities";

/**
 * Conformance suite for the StorageProvider interface, exercised against
 * the Dexie implementation. Any future provider (sync server, hosted
 * Postgres) must satisfy these same contracts.
 */
describe("DexieStorageProvider (StorageProvider conformance)", () => {
  let provider: StorageProvider;

  beforeEach(async () => {
    const db = getDB();
    await db.delete();
    resetDbSingletonForTests();
    provider = new DexieStorageProvider();
  });

  it("identifies itself", () => {
    expect(provider.providerName).toBe("dexie");
  });

  describe("clients", () => {
    it("creates with defaults, reads back, updates, archives, removes", async () => {
      const created = await provider.createClient({ name: "Acme" });
      expect(created.id).toMatch(/^cli_/);
      expect(created.archived).toBe(false);
      expect(created.createdAt).toBeGreaterThan(0);
      expect(created.updatedAt).toBe(created.createdAt);

      const fetched = await provider.getClient(created.id);
      expect(fetched?.name).toBe("Acme");

      await provider.updateClient(created.id, { name: "Acme Inc" });
      const updated = await provider.getClient(created.id);
      expect(updated?.name).toBe("Acme Inc");
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

      await provider.updateClient(created.id, { archived: true });
      expect(await provider.listClients()).toHaveLength(0);
      expect(await provider.listClients(true)).toHaveLength(1);

      await provider.removeClient(created.id);
      expect(await provider.getClient(created.id)).toBeUndefined();
    });
  });

  describe("projects", () => {
    it("CRUD + listByClient", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const other = await provider.createClient({ name: "Other" });
      const project = await provider.createProject({
        clientId: client.id,
        name: "Website",
      });
      expect(project.id).toMatch(/^prj_/);
      expect(project.archived).toBe(false);

      await provider.createProject({ clientId: other.id, name: "App" });

      expect(await provider.listProjectsByClient(client.id)).toHaveLength(1);
      expect(await provider.listProjects()).toHaveLength(2);
      expect(await provider.getProject(project.id)).toMatchObject({
        name: "Website",
      });

      await provider.updateProject(project.id, { name: "Website v2" });
      expect(await provider.getProject(project.id)).toMatchObject({
        name: "Website v2",
      });

      await provider.removeProject(project.id);
      expect(await provider.getProject(project.id)).toBeUndefined();
    });
  });

  describe("tasks", () => {
    it("computes durationMinutes on create, lists newest-first", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const project = await provider.createProject({
        clientId: client.id,
        name: "Website",
      });
      const startAt = new Date(2026, 0, 5, 9, 0).getTime();
      const t1 = await provider.createTask({
        projectId: project.id,
        name: "Older",
        startAt,
        endAt: startAt + 30 * 60000,
      });
      const t2 = await provider.createTask({
        projectId: project.id,
        name: "Newer",
        startAt: startAt + 3600000,
        endAt: startAt + 3600000 + 90 * 60000,
      });
      expect(t1.id).toMatch(/^tsk_/);
      expect(t1.durationMinutes).toBe(30);
      expect(t1.isBilled).toBe(false);
      expect(t1.tags).toEqual([]);

      const list = await provider.listTasks();
      expect(list.map((t) => t.id)).toEqual([t2.id, t1.id]);
      expect(
        await provider.listTasksByProject(project.id),
      ).toHaveLength(2);
    });

    it("recomputes durationMinutes when start/end change", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const project = await provider.createProject({
        clientId: client.id,
        name: "Website",
      });
      const startAt = new Date(2026, 0, 5, 9, 0).getTime();
      const task = await provider.createTask({
        projectId: project.id,
        name: "Work",
        startAt,
        endAt: startAt + 60 * 60000,
      });
      await provider.updateTask(task.id, { endAt: startAt + 150 * 60000 });
      const updated = await provider.getTask(task.id);
      expect(updated?.durationMinutes).toBe(150);

      // Name-only update leaves duration alone.
      await provider.updateTask(task.id, { name: "Renamed" });
      expect((await provider.getTask(task.id))?.durationMinutes).toBe(150);
    });

    it("listUnbilled + remove", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const project = await provider.createProject({
        clientId: client.id,
        name: "Website",
      });
      const mk = (name: string, billed: boolean) =>
        provider.createTask({
          projectId: project.id,
          name,
          startAt: Date.now() - 3600000,
          endAt: Date.now(),
          isBilled: billed,
        });
      const a = await mk("a", false);
      await mk("b", true);
      expect(
        (await provider.listUnbilledTasks()).map((t) => t.id),
      ).toEqual([a.id]);
      await provider.removeTask(a.id);
      expect(await provider.listUnbilledTasks()).toHaveLength(0);
    });
  });

  describe("expenses", () => {
    it("CRUD with defaults", async () => {
      const expense = await provider.createExpense({
        amount: 42.5,
        category: "Software",
        date: Date.now(),
      });
      expect(expense.id).toMatch(/^exp_/);
      expect(expense.isBilled).toBe(false);
      expect((await provider.listExpenses()).map((e) => e.id)).toEqual([
        expense.id,
      ]);

      await provider.updateExpense(expense.id, { amount: 50 });
      expect((await provider.getExpense(expense.id))?.amount).toBe(50);

      await provider.removeExpense(expense.id);
      expect(await provider.getExpense(expense.id)).toBeUndefined();
    });
  });

  describe("invoices", () => {
    it("CRUD + getByPublicToken", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const invoice = await provider.createInvoice({
        clientId: client.id,
        invoiceNumber: "INV-1001",
        issueDate: Date.now(),
        dueDate: Date.now(),
        status: "draft",
        lineItems: [],
        subtotal: 0,
        total: 0,
        publicToken: "tok_abc123",
      });
      expect(invoice.id).toMatch(/^inv_/);
      expect(await provider.getInvoiceByPublicToken("tok_abc123")).toMatchObject(
        { id: invoice.id },
      );
      expect(
        await provider.getInvoiceByPublicToken("nope"),
      ).toBeUndefined();
      expect(await provider.getInvoiceByPublicToken("")).toBeUndefined();

      const list = await provider.listInvoices();
      expect(list.map((i) => i.id)).toEqual([invoice.id]);

      await provider.updateInvoice(invoice.id, { status: "sent" });
      expect((await provider.getInvoice(invoice.id))?.status).toBe("sent");

      await provider.removeInvoice(invoice.id);
      expect(await provider.getInvoice(invoice.id)).toBeUndefined();
    });
  });

  describe("settings", () => {
    it("read → undefined; get → defaults; update merges", async () => {
      expect(await provider.readSettings()).toBeUndefined();

      const initial = await provider.getSettings();
      expect(initial.id).toBe("singleton");
      expect(initial.invoice.numberPrefix).toBe("INV-");
      expect(initial.invoice.nextNumber).toBe(1001);

      const next = await provider.updateSettings({
        business: { ...initial.business, name: "My Biz" },
      });
      expect(next.business.name).toBe("My Biz");
      expect(next.invoice.numberPrefix).toBe("INV-");

      expect((await provider.readSettings())?.business.name).toBe("My Biz");
    });
  });

  describe("transactional workflows", () => {
    it("assignNextInvoiceNumber hands out sequential numbers", async () => {
      expect(await provider.assignNextInvoiceNumber()).toBe("INV-1001");
      expect(await provider.assignNextInvoiceNumber()).toBe("INV-1002");
      expect((await provider.getSettings()).invoice.nextNumber).toBe(1003);
    });

    it("markInvoiceSent flips invoice + referenced rows atomically", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const project = await provider.createProject({
        clientId: client.id,
        name: "Website",
      });
      const task = await provider.createTask({
        projectId: project.id,
        name: "Work",
        startAt: Date.now() - 3600000,
        endAt: Date.now(),
      });
      const expense = await provider.createExpense({
        amount: 10,
        category: "Meals",
        date: Date.now(),
        clientId: client.id,
      });
      const invoice: Invoice = await provider.createInvoice({
        clientId: client.id,
        invoiceNumber: "INV-1001",
        issueDate: Date.now(),
        dueDate: Date.now(),
        status: "draft",
        lineItems: [
          {
            id: "li_1",
            description: "Work",
            quantity: 1,
            rate: 100,
            amount: 100,
            sourceType: "task",
            sourceId: task.id,
          },
          {
            id: "li_2",
            description: "Meals",
            quantity: 1,
            rate: 10,
            amount: 10,
            sourceType: "expense",
            sourceId: expense.id,
          },
        ],
        subtotal: 110,
        total: 110,
      });

      await provider.markInvoiceSent(invoice);

      expect((await provider.getInvoice(invoice.id))?.status).toBe("sent");
      const sentTask = await provider.getTask(task.id);
      expect(sentTask?.isBilled).toBe(true);
      expect(sentTask?.invoiceId).toBe(invoice.id);
      const sentExpense = await provider.getExpense(expense.id);
      expect(sentExpense?.isBilled).toBe(true);
      expect(sentExpense?.invoiceId).toBe(invoice.id);

      // Idempotent: re-running re-asserts the same fields.
      await provider.markInvoiceSent(invoice);
      expect((await provider.getInvoice(invoice.id))?.status).toBe("sent");
    });

    it("markInvoicePaid flips status only", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const invoice = await provider.createInvoice({
        clientId: client.id,
        invoiceNumber: "INV-1001",
        issueDate: Date.now(),
        dueDate: Date.now(),
        status: "sent",
        lineItems: [],
        subtotal: 0,
        total: 0,
      });
      await provider.markInvoicePaid(invoice.id);
      expect((await provider.getInvoice(invoice.id))?.status).toBe("paid");
    });
  });
});
