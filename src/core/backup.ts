import type { Settings } from "@/lib/db/types";
import type {
  Client,
  Contract,
  Expense,
  Invoice,
  MileageEntry,
  Project,
  RateCard,
  RecurringSchedule,
  Retainer,
  Task,
  TaxPayment,
} from "@/lib/db/types";
export const TALLYHAND_BUNDLE_FORMAT = "tallyhand.v1" as const;

export type TallyhandBundleV1 = {
  format: typeof TALLYHAND_BUNDLE_FORMAT;
  exportedAt: string;
  settings: Settings;
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  expenses: Expense[];
  invoices: Invoice[];
  /** Optional: absent in bundles exported before recurring/retainers existed. */
  recurringSchedules?: RecurringSchedule[];
  retainers?: Retainer[];
  /** Optional: absent in bundles exported before Track 3 entities existed. */
  mileageEntries?: MileageEntry[];
  contracts?: Contract[];
  taxPayments?: TaxPayment[];
  rateCards?: RateCard[];
};

