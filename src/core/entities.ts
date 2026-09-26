export type ID = string;

export interface Timestamped {
  createdAt: number;
  updatedAt: number;
}

export interface Client extends Timestamped {
  id: ID;
  name: string;
  email?: string;
  address?: string;
  defaultRate?: number;
  notes?: string;
  archived: boolean;
}

export interface Project extends Timestamped {
  id: ID;
  clientId: ID;
  name: string;
  rateOverride?: number;
  archived: boolean;
}

export interface Task extends Timestamped {
  id: ID;
  projectId: ID;
  name: string;
  startAt: number;
  endAt: number;
  durationMinutes: number;
  notes?: string;
  tags: string[];
  isBilled: boolean;
  invoiceId?: ID;
}

export interface Expense extends Timestamped {
  id: ID;
  clientId?: ID;
  projectId?: ID;
  date: number;
  amount: number;
  category: string;
  note?: string;
  receiptB64?: string;
  isBilled: boolean;
  invoiceId?: ID;
}

export type InvoiceStatus = "draft" | "sent" | "paid";

export interface InvoiceLineItem {
  id: ID;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  /** Only on expense-sourced lines: percent added on top of `rate` (base cost) when computing `amount`. */
  markupPercent?: number;
  sourceType?: "task" | "expense" | "manual";
  sourceId?: ID;
}

export interface Invoice extends Timestamped {
  id: ID;
  clientId: ID;
  invoiceNumber: string;
  issueDate: number;
  dueDate: number;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  total: number;
  notes?: string;
  publicToken?: string;
}

export interface Settings {
  id: "singleton";
  business: {
    name: string;
    ownerName: string;
    email: string;
    address: string;
    taxId: string;
    paymentInstructions: string;
  };
  invoice: {
    numberPrefix: string;
    nextNumber: number;
    logoB64?: string;
    accentColor: string;
    footerText: string;
    paymentTermsDays: number;
  };
  reckoning: {
    enabled: boolean;
    dayOfWeek: number;
    hourOfDay: number;
    /** When user last completed Weekly Reckoning (auto-open guard). */
    lastCompletedAtMs?: number;
  };
  expenseCategories: string[];
  appearance: {
    theme: "light" | "dark" | "system";
  };
}

export const DEFAULT_SETTINGS: Settings = {
  id: "singleton",
  business: {
    name: "",
    ownerName: "",
    email: "",
    address: "",
    taxId: "",
    paymentInstructions: "",
  },
  invoice: {
    numberPrefix: "INV-",
    nextNumber: 1001,
    accentColor: "#0a0a0a",
    footerText: "Thank you for your business.",
    paymentTermsDays: 14,
  },
  reckoning: {
    enabled: true,
    dayOfWeek: 5,
    hourOfDay: 16,
  },
  expenseCategories: [
    "Software",
    "Hardware",
    "Travel",
    "Meals",
    "Office",
    "Other",
  ],
  appearance: {
    theme: "light",
  },
};
