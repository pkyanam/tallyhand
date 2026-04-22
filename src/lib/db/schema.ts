import Dexie, { type Table } from "dexie";
import type {
  Client,
  Project,
  Task,
  Expense,
  Invoice,
  Settings,
} from "./types";

export class TallyhandDB extends Dexie {
  clients!: Table<Client, string>;
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  expenses!: Table<Expense, string>;
  invoices!: Table<Invoice, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super("tallyhand");
    this.version(1).stores({
      clients: "id, name, archived, updatedAt",
      projects: "id, clientId, name, archived, updatedAt",
      tasks:
        "id, projectId, startAt, endAt, isBilled, invoiceId, updatedAt, *tags",
      expenses:
        "id, clientId, projectId, date, category, isBilled, invoiceId, updatedAt",
      invoices:
        "id, clientId, invoiceNumber, status, issueDate, dueDate, updatedAt",
      settings: "id",
    });
  }
}

let _db: TallyhandDB | null = null;

export function getDB(): TallyhandDB {
  if (typeof window === "undefined") {
    throw new Error("Dexie DB is only available in the browser.");
  }
  if (!_db) {
    _db = new TallyhandDB();
  }
  return _db;
}
