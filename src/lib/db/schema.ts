import Dexie, { type Table } from "dexie";
import type {
  Client,
  Project,
  Task,
  Expense,
  Invoice,
  Settings,
} from "./types";

import type { RecurringSchedule, Retainer } from "@/core/recurring";
import type { MileageEntry } from "@/core/mileage";
import type { Contract } from "@/core/contracts";
import type { TaxPayment } from "@/core/tax";
import type { RateCard } from "@/core/rate-cards";

export class TallyhandDB extends Dexie {
  clients!: Table<Client, string>;
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  expenses!: Table<Expense, string>;
  invoices!: Table<Invoice, string>;
  settings!: Table<Settings, string>;
  recurringSchedules!: Table<RecurringSchedule, string>;
  retainers!: Table<Retainer, string>;
  mileageEntries!: Table<MileageEntry, string>;
  contracts!: Table<Contract, string>;
  taxPayments!: Table<TaxPayment, string>;
  rateCards!: Table<RateCard, string>;

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
    this.version(2).stores({
      clients: "id, name, archived, updatedAt",
      projects: "id, clientId, name, archived, updatedAt",
      tasks:
        "id, projectId, startAt, endAt, isBilled, invoiceId, updatedAt, *tags",
      expenses:
        "id, clientId, projectId, date, category, isBilled, invoiceId, updatedAt",
      invoices:
        "id, clientId, invoiceNumber, status, issueDate, dueDate, publicToken, updatedAt",
      settings: "id",
    });
    this.version(3).stores({
      clients: "id, name, archived, updatedAt",
      projects: "id, clientId, name, archived, updatedAt",
      tasks:
        "id, projectId, startAt, endAt, isBilled, invoiceId, updatedAt, *tags",
      expenses:
        "id, clientId, projectId, date, category, isBilled, invoiceId, updatedAt",
      invoices:
        "id, clientId, invoiceNumber, status, issueDate, dueDate, publicToken, updatedAt",
      settings: "id",
      recurringSchedules: "id, clientId, status, nextRunAt, updatedAt",
      retainers: "id, clientId, status, updatedAt",
    });
    // v4 adds the dream-track entities (mileage, contracts, tax payments,
    // rate cards). New tables only — existing data is untouched.
    this.version(4).stores({
      clients: "id, name, archived, updatedAt",
      projects: "id, clientId, name, archived, updatedAt",
      tasks:
        "id, projectId, startAt, endAt, isBilled, invoiceId, updatedAt, *tags",
      expenses:
        "id, clientId, projectId, date, category, isBilled, invoiceId, updatedAt",
      invoices:
        "id, clientId, invoiceNumber, status, issueDate, dueDate, publicToken, updatedAt",
      settings: "id",
      recurringSchedules: "id, clientId, status, nextRunAt, updatedAt",
      retainers: "id, clientId, status, updatedAt",
      mileageEntries: "id, clientId, projectId, date, isBilled, updatedAt",
      contracts: "id, clientId, projectId, type, endDate, archived, updatedAt",
      taxPayments: "id, taxYear, quarter, jurisdiction, date, updatedAt",
      rateCards: "id, clientId, projectId, archived, effectiveFrom, updatedAt",
    });
  }
}

let _db: TallyhandDB | null = null;

/** Test helper: call after `await db.delete()` so the next `getDB()` opens a fresh DB. */
export function resetDbSingletonForTests(): void {
  _db = null;
}

export function getDB(): TallyhandDB {
  if (typeof window === "undefined") {
    throw new Error("Dexie DB is only available in the browser.");
  }
  if (!_db) {
    _db = new TallyhandDB();
  }
  return _db;
}
