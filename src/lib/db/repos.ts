import { getDB } from "./schema";
import { newId, now } from "./id";
import {
  DEFAULT_SETTINGS,
  type Client,
  type Project,
  type Task,
  type Expense,
  type Invoice,
  type Settings,
} from "./types";

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export const clientRepo = {
  async list(includeArchived = false): Promise<Client[]> {
    const all = await getDB().clients.orderBy("name").toArray();
    return includeArchived ? all : all.filter((c) => !c.archived);
  },
  async get(id: string) {
    return getDB().clients.get(id);
  },
  async create(
    input: Optional<Client, "id" | "archived" | "createdAt" | "updatedAt">,
  ): Promise<Client> {
    const ts = now();
    const client: Client = {
      id: input.id ?? newId("cli"),
      archived: input.archived ?? false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Client;
    await getDB().clients.add(client);
    return client;
  },
  async update(id: string, patch: Partial<Client>) {
    await getDB().clients.update(id, { ...patch, updatedAt: now() });
  },
  async archive(id: string) {
    return this.update(id, { archived: true });
  },
  async remove(id: string) {
    await getDB().clients.delete(id);
  },
};

export const projectRepo = {
  async listByClient(clientId: string): Promise<Project[]> {
    return getDB().projects.where("clientId").equals(clientId).toArray();
  },
  async list(): Promise<Project[]> {
    return getDB().projects.toArray();
  },
  async get(id: string) {
    return getDB().projects.get(id);
  },
  async create(
    input: Optional<Project, "id" | "archived" | "createdAt" | "updatedAt">,
  ): Promise<Project> {
    const ts = now();
    const project: Project = {
      id: input.id ?? newId("prj"),
      archived: input.archived ?? false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Project;
    await getDB().projects.add(project);
    return project;
  },
  async update(id: string, patch: Partial<Project>) {
    await getDB().projects.update(id, { ...patch, updatedAt: now() });
  },
  async remove(id: string) {
    await getDB().projects.delete(id);
  },
};

export const taskRepo = {
  async list(): Promise<Task[]> {
    return getDB().tasks.orderBy("startAt").reverse().toArray();
  },
  async get(id: string) {
    return getDB().tasks.get(id);
  },
  async listByProject(projectId: string) {
    return getDB().tasks.where("projectId").equals(projectId).toArray();
  },
  async listUnbilled() {
    return getDB().tasks.filter((t) => !t.isBilled).toArray();
  },
  async create(
    input: Optional<
      Task,
      "id" | "isBilled" | "tags" | "createdAt" | "updatedAt" | "durationMinutes"
    >,
  ): Promise<Task> {
    const ts = now();
    const durationMinutes =
      input.durationMinutes ??
      Math.max(0, Math.round((input.endAt - input.startAt) / 60000));
    const task: Task = {
      id: input.id ?? newId("tsk"),
      isBilled: input.isBilled ?? false,
      tags: input.tags ?? [],
      durationMinutes,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Task;
    await getDB().tasks.add(task);
    return task;
  },
  async update(id: string, patch: Partial<Task>) {
    const next: Partial<Task> = { ...patch, updatedAt: now() };
    if (patch.startAt != null || patch.endAt != null) {
      const existing = await getDB().tasks.get(id);
      if (existing) {
        const startAt = patch.startAt ?? existing.startAt;
        const endAt = patch.endAt ?? existing.endAt;
        next.durationMinutes = Math.max(
          0,
          Math.round((endAt - startAt) / 60000),
        );
      }
    }
    await getDB().tasks.update(id, next);
  },
  async remove(id: string) {
    await getDB().tasks.delete(id);
  },
};

export const expenseRepo = {
  async list(): Promise<Expense[]> {
    return getDB().expenses.orderBy("date").reverse().toArray();
  },
  async get(id: string) {
    return getDB().expenses.get(id);
  },
  async create(
    input: Optional<Expense, "id" | "isBilled" | "createdAt" | "updatedAt">,
  ): Promise<Expense> {
    const ts = now();
    const expense: Expense = {
      id: input.id ?? newId("exp"),
      isBilled: input.isBilled ?? false,
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Expense;
    await getDB().expenses.add(expense);
    return expense;
  },
  async update(id: string, patch: Partial<Expense>) {
    await getDB().expenses.update(id, { ...patch, updatedAt: now() });
  },
  async remove(id: string) {
    await getDB().expenses.delete(id);
  },
};

export const invoiceRepo = {
  async list(): Promise<Invoice[]> {
    return getDB().invoices.orderBy("issueDate").reverse().toArray();
  },
  async get(id: string) {
    return getDB().invoices.get(id);
  },
  async create(
    input: Optional<Invoice, "id" | "createdAt" | "updatedAt">,
  ): Promise<Invoice> {
    const ts = now();
    const invoice: Invoice = {
      id: input.id ?? newId("inv"),
      createdAt: ts,
      updatedAt: ts,
      ...input,
    } as Invoice;
    await getDB().invoices.add(invoice);
    return invoice;
  },
  async update(id: string, patch: Partial<Invoice>) {
    await getDB().invoices.update(id, { ...patch, updatedAt: now() });
  },
  async remove(id: string) {
    await getDB().invoices.delete(id);
  },
};

export const settingsRepo = {
  // Pure read — safe inside useLiveQuery. Returns undefined if the singleton
  // row has not been written yet.
  async read(): Promise<Settings | undefined> {
    return getDB().settings.get("singleton");
  },
  // Read-or-initialize. Writes the default row if missing. Do NOT call this
  // inside a Dexie liveQuery callback (Dexie forbids writes from querier
  // functions and will silently loop). Call from effects or event handlers.
  async get(): Promise<Settings> {
    const existing = await getDB().settings.get("singleton");
    if (existing) return existing;
    await getDB().settings.put(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  },
  async update(patch: Partial<Settings>) {
    const current = await this.get();
    const next: Settings = { ...current, ...patch, id: "singleton" };
    await getDB().settings.put(next);
    return next;
  },
};
