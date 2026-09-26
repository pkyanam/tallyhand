import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import {
  makeSqliteProvider,
  tempDbPath,
  type SqliteStorageProvider,
} from "@/server/sqlite-provider";
import type { Invoice } from "@/core/entities";

/**
 * Conformance suite for the StorageProvider interface, exercised against
 * the SQLite implementation. Mirrors the Dexie conformance suite
 * (src/lib/db/storage-provider.test.ts) plus the Track A recurring/
 * retainer methods.
 */
describe("SqliteStorageProvider (StorageProvider conformance)", () => {
  let provider: SqliteStorageProvider;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath("tallyhand-sqlite-test");
    provider = makeSqliteProvider(dbPath);
  });

  afterEach(() => {
    provider.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("identifies itself", () => {
    expect(provider.providerName).toBe("sqlite");
  });

  describe("clients", () => {
    it("creates with defaults, reads back, updates, archives, removes", async () => {
      const created = await provider.createClient({ name: "Acme" });
      expect(created.id.startsWith("cli_")).toBe(true);
      expect(created.archived).toBe(false);
      expect(created.createdAt).toBeGreaterThan(0);

      expect(await provider.getClient(created.id)).toEqual(created);

      const before = created.updatedAt;
      await provider.updateClient(created.id, { name: "Acme Corp" });
      const updated = await provider.getClient(created.id);
      expect(updated?.name).toBe("Acme Corp");
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(before);

      expect(await provider.listClients()).toHaveLength(1);
      await provider.updateClient(created.id, { archived: true });
      expect(await provider.listClients()).toHaveLength(0);
      expect(await provider.listClients(true)).toHaveLength(1);

      await provider.removeClient(created.id);
      expect(await provider.getClient(created.id)).toBeUndefined();
    });

    it("update on missing id is a no-op", async () => {
      await expect(provider.updateClient("cli_missing", { name: "x" })).resolves.toBeUndefined();
    });
  });

  describe("projects", () => {
    it("creates and lists by client", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const other = await provider.createClient({ name: "Beta" });
      await provider.createProject({ clientId: client.id, name: "Site" });
      await provider.createProject({ clientId: other.id, name: "App" });
      expect(await provider.listProjects()).toHaveLength(2);
      const byClient = await provider.listProjectsByClient(client.id);
      expect(byClient).toHaveLength(1);
      expect(byClient[0].name).toBe("Site");
    });
  });

  describe("tasks", () => {
    it("derives durationMinutes and orders newest-first", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const project = await provider.createProject({ clientId: client.id, name: "Site" });
      const t1 = await provider.createTask({
        projectId: project.id,
        name: "early",
        startAt: 1000,
        endAt: 1000 + 30 * 60000,
      });
      expect(t1.durationMinutes).toBe(30);
      expect(t1.isBilled).toBe(false);
      expect(t1.tags).toEqual([]);
      const t2 = await provider.createTask({
        projectId: project.id,
        name: "late",
        startAt: 2000,
        endAt: 2000 + 60 * 60000,
      });
      const listed = await provider.listTasks();
      expect(listed.map((t) => t.id)).toEqual([t2.id, t1.id]);
      expect(await provider.listUnbilledTasks()).toHaveLength(2);
    });

    it("recomputes durationMinutes when startAt/endAt change", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const project = await provider.createProject({ clientId: client.id, name: "Site" });
      const task = await provider.createTask({
        projectId: project.id,
        name: "work",
        startAt: 1000,
        endAt: 1000 + 30 * 60000,
      });
      await provider.updateTask(task.id, { endAt: 1000 + 90 * 60000 });
      const updated = await provider.getTask(task.id);
      expect(updated?.durationMinutes).toBe(90);
    });
  });

  describe("expenses", () => {
    it("creates with defaults and round-trips", async () => {
      const created = await provider.createExpense({
        date: 5000,
        amount: 42.5,
        category: "Travel",
      });
      expect(created.id.startsWith("exp_")).toBe(true);
      expect(created.isBilled).toBe(false);
      const listed = await provider.listExpenses();
      expect(listed).toHaveLength(1);
      await provider.updateExpense(created.id, { amount: 50 });
      expect((await provider.getExpense(created.id))?.amount).toBe(50);
      await provider.removeExpense(created.id);
      expect(await provider.getExpense(created.id)).toBeUndefined();
    });
  });

  describe("invoices", () => {
    it("creates, reads by public token, and removes", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const created = await provider.createInvoice({
        clientId: client.id,
        invoiceNumber: "INV-1",
        issueDate: 1000,
        dueDate: 2000,
        status: "draft",
        lineItems: [],
        subtotal: 0,
        total: 0,
        publicToken: "tok123",
      });
      expect(created.id.startsWith("inv_")).toBe(true);
      expect(await provider.getInvoiceByPublicToken("tok123")).toEqual(created);
      expect(await provider.getInvoiceByPublicToken("")).toBeUndefined();
      expect(await provider.getInvoiceByPublicToken("nope")).toBeUndefined();
      await provider.removeInvoice(created.id);
      expect(await provider.listInvoices()).toHaveLength(0);
    });

    it("assigns sequential invoice numbers atomically", async () => {
      const n1 = await provider.assignNextInvoiceNumber();
      const n2 = await provider.assignNextInvoiceNumber();
      expect(n1).toBe("INV-1001");
      expect(n2).toBe("INV-1002");
    });

    it("markInvoiceSent is idempotent and marks sources billed", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const project = await provider.createProject({ clientId: client.id, name: "Site" });
      const task = await provider.createTask({
        projectId: project.id,
        name: "work",
        startAt: 1000,
        endAt: 1000 + 60000,
      });
      const expense = await provider.createExpense({
        clientId: client.id,
        date: 1000,
        amount: 10,
        category: "Meals",
      });
      const invoice = await provider.createInvoice({
        clientId: client.id,
        invoiceNumber: "INV-9",
        issueDate: 1000,
        dueDate: 2000,
        status: "draft",
        lineItems: [
          { id: "li1", description: "work", quantity: 1, rate: 100, amount: 100, sourceType: "task", sourceId: task.id },
          { id: "li2", description: "meal", quantity: 1, rate: 10, amount: 10, sourceType: "expense", sourceId: expense.id },
        ],
        subtotal: 110,
        total: 110,
      });

      await provider.markInvoiceSent(invoice);
      await provider.markInvoiceSent(invoice); // idempotent

      const sent = await provider.getInvoice(invoice.id);
      expect(sent?.status).toBe("sent");
      const billedTask = await provider.getTask(task.id);
      expect(billedTask?.isBilled).toBe(true);
      expect(billedTask?.invoiceId).toBe(invoice.id);
      const billedExpense = await provider.getExpense(expense.id);
      expect(billedExpense?.isBilled).toBe(true);
      expect(billedExpense?.invoiceId).toBe(invoice.id);
    });

    it("markInvoicePaid flips status; missing id is a no-op", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const invoice: Invoice = await provider.createInvoice({
        clientId: client.id,
        invoiceNumber: "INV-10",
        issueDate: 1000,
        dueDate: 2000,
        status: "sent",
        lineItems: [],
        subtotal: 0,
        total: 0,
      });
      await provider.markInvoicePaid(invoice.id);
      expect((await provider.getInvoice(invoice.id))?.status).toBe("paid");
      await expect(provider.markInvoicePaid("inv_missing")).resolves.toBeUndefined();
    });
  });

  describe("recurring schedules", () => {
    it("creates with defaults and filters by status/client", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const startDate = Date.now() - 86400000;
      const created = await provider.createRecurringSchedule({
        clientId: client.id,
        name: "Monthly",
        mode: "fixed",
        frequency: "monthly",
        interval: 1,
        lineItems: [{ description: "Retainer", quantity: 1, rate: 2000 }],
        startDate,
      });
      expect(created.id.startsWith("rsd_")).toBe(true);
      expect(created.status).toBe("active");
      expect(created.nextRunAt).toBe(startDate);
      expect(created.occurrences).toBe(0);

      expect(await provider.listRecurringSchedules("active")).toHaveLength(1);
      expect(await provider.listRecurringSchedules("paused")).toHaveLength(0);
      expect(await provider.listRecurringSchedulesByClient(client.id)).toHaveLength(1);
      expect(await provider.getRecurringSchedule(created.id)).toEqual(created);

      await provider.updateRecurringSchedule(created.id, { status: "paused" });
      expect((await provider.getRecurringSchedule(created.id))?.status).toBe("paused");

      await provider.removeRecurringSchedule(created.id);
      expect(await provider.getRecurringSchedule(created.id)).toBeUndefined();
    });
  });

  describe("retainers", () => {
    it("creates with defaults and round-trips", async () => {
      const client = await provider.createClient({ name: "Acme" });
      const created = await provider.createRetainer({
        clientId: client.id,
        name: "Q4 block",
        type: "prepaid-hours",
        totalHours: 40,
        amountCents: 600000,
        startDate: Date.now(),
      });
      expect(created.id.startsWith("rtn_")).toBe(true);
      expect(created.status).toBe("active");

      expect(await provider.listRetainers("active")).toHaveLength(1);
      expect(await provider.listRetainersByClient(client.id)).toHaveLength(1);
      await provider.updateRetainer(created.id, { status: "depleted" });
      expect((await provider.getRetainer(created.id))?.status).toBe("depleted");
      await provider.removeRetainer(created.id);
      expect(await provider.listRetainers()).toHaveLength(0);
    });
  });

  describe("settings", () => {
    it("readSettings is undefined until initialized; getSettings bootstraps defaults", async () => {
      expect(await provider.readSettings()).toBeUndefined();
      const settings = await provider.getSettings();
      expect(settings.invoice.numberPrefix).toBe("INV-");
      expect(settings.invoice.nextNumber).toBe(1001);
    });

    it("updateSettings merges nested objects", async () => {
      const updated = await provider.updateSettings({
        business: { name: "Jane Doe Consulting" },
        invoice: { paymentTermsDays: 30 },
      });
      expect(updated.business.name).toBe("Jane Doe Consulting");
      expect(updated.invoice.paymentTermsDays).toBe(30);
      expect(updated.invoice.numberPrefix).toBe("INV-"); // preserved
      const reread = await provider.getSettings();
      expect(reread.business.name).toBe("Jane Doe Consulting");
    });
  });
});
