/**
 * TallyhandClient — thin typed wrapper around the Tallyhand REST API v1.
 *
 * Conventions (must stay in sync with track B's server):
 * - Base URL is normalized to always end in /api/v1.
 * - Auth: `Authorization: Bearer <token>` on every route except
 *   GET /health and GET /openapi.json.
 * - Envelope: success -> { data, meta? }, error -> { error: { code, message } }.
 * - Pagination: ?limit (default 50, max 200) & cursor (opaque). Pass
 *   { all: true } to auto-follow cursors until null.
 * - POST/PATCH/PUT requests always carry an Idempotency-Key header (safe for
 *   agents that retry).
 * - Money: the API uses dollars for `amount`/`rate`/line-item fields (matches
 *   the Tallyhand domain); fields literally named `*Cents` (retainer
 *   amountCents) are integer cents.
 * - Times: ms epoch everywhere.
 * - Open timer convention: a task whose `endAt` is missing or 0 is a running
 *   timer. `timer start` creates such a task; `timer stop` patches endAt.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* config resolution: flags > env > ~/.tallyhand/config.json          */
/* ------------------------------------------------------------------ */

export const CONFIG_PATH = join(homedir(), ".tallyhand", "config.json");

export interface FileConfig {
  apiUrl?: string;
  token?: string;
}

export function readFileConfig(path = CONFIG_PATH): FileConfig {
  try {
    if (!existsSync(path)) return {};
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      apiUrl: typeof raw.apiUrl === "string" ? raw.apiUrl : undefined,
      token: typeof raw.token === "string" ? raw.token : undefined,
    };
  } catch {
    return {};
  }
}

export function writeFileConfig(patch: FileConfig, path = CONFIG_PATH): void {
  const cur = readFileConfig(path);
  mkdirSync(join(homedir(), ".tallyhand"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ ...cur, ...patch }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

export interface ResolvedConfig {
  baseUrl: string;
  token?: string;
}

export function resolveConfig(flags: {
  apiUrl?: string;
  token?: string;
}): ResolvedConfig {
  const file = readFileConfig();
  const apiUrl =
    flags.apiUrl ??
    process.env.TALLYHAND_API_URL ??
    file.apiUrl ??
    "http://localhost:3000";
  const token =
    flags.token ?? process.env.TALLYHAND_API_TOKEN ?? file.token ?? undefined;
  return { baseUrl: apiUrl, token };
}

/* ------------------------------------------------------------------ */
/* client                                                             */
/* ------------------------------------------------------------------ */

export interface RequestOpts {
  all?: boolean; // auto-follow pagination
  [key: string]: unknown;
}

function normalizeBaseUrl(raw: string): string {
  const stripped = raw.trim().replace(/\/+$/, "");
  return /\/api\/v1$/.test(stripped) ? stripped : `${stripped}/api/v1`;
}

export class TallyhandClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly timing: boolean;

  constructor(opts: { baseUrl: string; token?: string; timing?: boolean }) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.token = opts.token;
    this.timing = opts.timing ?? false;
  }

  get hasToken(): boolean {
    return !!this.token;
  }

  private dryRunQuery(opts?: { dryRun?: boolean }): Record<string, string> | undefined {
    return opts?.dryRun ? { dry_run: "true" } : undefined;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<any> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.append(k, String(v));
        }
      }
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "tallyhand-cli/0.1.0",
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (method === "POST" || method === "PATCH" || method === "PUT") {
      headers["Idempotency-Key"] = randomUUID();
    }

    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ApiError(
        0,
        "connection_failed",
        `Could not reach ${url.origin} — is the Tallyhand server running? (${msg})`,
      );
    }

    const text = await res.text();
    if (this.timing) console.error(JSON.stringify({ timing: { method, path, status: res.status,
      roundTripMs: Math.round(performance.now() - started), serverTiming: res.headers.get("server-timing") } }));
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const code =
        json && typeof json === "object" && json.error?.code
          ? String(json.error.code)
          : `http_${res.status}`;
      const message =
        json && typeof json === "object" && json.error?.message
          ? String(json.error.message)
          : text || res.statusText || `HTTP ${res.status}`;
      throw new ApiError(res.status, code, message);
    }
    if (json && typeof json === "object" && "data" in json) return json.data;
    return json;
  }

  /** Follow cursor pagination until exhausted. Returns the concatenated items. */
  private async listAll(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<any[]> {
    const items: any[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const url = new URL(this.baseUrl + path);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null && v !== "")
            url.searchParams.append(k, String(v));
        }
      }
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const headers: Record<string, string> = {
        "User-Agent": "tallyhand-cli/0.1.0",
      };
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
      const started = performance.now();
      let res: Response;
      try {
        res = await fetch(url, { headers });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ApiError(
          0,
          "connection_failed",
          `Could not reach ${url.origin} — is the Tallyhand server running? (${msg})`,
        );
      }
      const json = (await res.json().catch(() => null)) as any;
      if (this.timing) console.error(JSON.stringify({ timing: { method: "GET", path, status: res.status,
        roundTripMs: Math.round(performance.now() - started), serverTiming: res.headers.get("server-timing") } }));
      if (!res.ok) {
        throw new ApiError(
          res.status,
          json?.error?.code ?? `http_${res.status}`,
          json?.error?.message ?? res.statusText,
        );
      }
      const page = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];
      items.push(...page);
      const next = json?.meta?.nextCursor ?? null;
      if (!next) break;
      cursor = next;
    }
    return items;
  }

  private list(
    path: string,
    params?: RequestOpts,
  ): Promise<any> {
    const { all, ...query } = params ?? {};
    if (all) return this.listAll(path, query as Record<string, any>);
    return this.request("GET", path, undefined, query as Record<string, any>);
  }

  /* -- meta ---------------------------------------------------------- */
  health(): Promise<any> {
    return this.request("GET", "/health");
  }

  /* -- clients -------------------------------------------------------- */
  listClients(params?: RequestOpts): Promise<any> {
    return this.list("/clients", params);
  }
  createClient(input: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/clients", input);
  }
  getClient(id: string): Promise<any> {
    return this.request("GET", `/clients/${id}`);
  }
  updateClient(id: string, patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/clients/${id}`, patch);
  }
  deleteClient(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("DELETE", `/clients/${id}`, undefined, this.dryRunQuery(opts));
  }

  /* -- projects -------------------------------------------------------- */
  listProjects(params?: RequestOpts): Promise<any> {
    return this.list("/projects", params);
  }
  createProject(input: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/projects", input);
  }
  getProject(id: string): Promise<any> {
    return this.request("GET", `/projects/${id}`);
  }
  updateProject(id: string, patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/projects/${id}`, patch);
  }
  deleteProject(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("DELETE", `/projects/${id}`, undefined, this.dryRunQuery(opts));
  }

  /* -- tasks ----------------------------------------------------------- */
  listTasks(params?: RequestOpts): Promise<any> {
    return this.list("/tasks", params);
  }
  createTask(input: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/tasks", input);
  }
  getTask(id: string): Promise<any> {
    return this.request("GET", `/tasks/${id}`);
  }
  updateTask(id: string, patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/tasks/${id}`, patch);
  }
  deleteTask(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("DELETE", `/tasks/${id}`, undefined, this.dryRunQuery(opts));
  }
  bulkCreateTasks(items: Record<string, unknown>[]): Promise<any> {
    return this.request("POST", "/tasks/bulk", { items });
  }

  /* -- expenses -------------------------------------------------------- */
  listExpenses(params?: RequestOpts): Promise<any> {
    return this.list("/expenses", params);
  }
  createExpense(input: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/expenses", input);
  }
  getExpense(id: string): Promise<any> {
    return this.request("GET", `/expenses/${id}`);
  }
  updateExpense(id: string, patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/expenses/${id}`, patch);
  }
  deleteExpense(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("DELETE", `/expenses/${id}`, undefined, this.dryRunQuery(opts));
  }
  bulkCreateExpenses(items: Record<string, unknown>[]): Promise<any> {
    return this.request("POST", "/expenses/bulk", { items });
  }

  /* -- invoices -------------------------------------------------------- */
  listInvoices(params?: RequestOpts): Promise<any> {
    return this.list("/invoices", params);
  }
  createInvoice(input: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/invoices", input);
  }
  getInvoice(id: string): Promise<any> {
    return this.request("GET", `/invoices/${id}`);
  }
  updateInvoice(id: string, patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/invoices/${id}`, patch);
  }
  deleteInvoice(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("DELETE", `/invoices/${id}`, undefined, this.dryRunQuery(opts));
  }
  sendInvoice(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("POST", `/invoices/${id}/send`, undefined, this.dryRunQuery(opts));
  }
  markInvoicePaid(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("POST", `/invoices/${id}/paid`, undefined, this.dryRunQuery(opts));
  }

  /* -- recurring schedules --------------------------------------------- */
  listSchedules(params?: RequestOpts): Promise<any> {
    return this.list("/recurring-schedules", params);
  }
  createSchedule(input: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/recurring-schedules", input);
  }
  getSchedule(id: string): Promise<any> {
    return this.request("GET", `/recurring-schedules/${id}`);
  }
  updateSchedule(id: string, patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/recurring-schedules/${id}`, patch);
  }
  deleteSchedule(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("DELETE", `/recurring-schedules/${id}`, undefined, this.dryRunQuery(opts));
  }
  runSchedule(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("POST", `/recurring-schedules/${id}/run`, undefined, this.dryRunQuery(opts));
  }
  runScheduler(opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("POST", "/scheduler/run", undefined, this.dryRunQuery(opts));
  }

  /* -- retainers -------------------------------------------------------- */
  listRetainers(params?: RequestOpts): Promise<any> {
    return this.list("/retainers", params);
  }
  createRetainer(input: Record<string, unknown>): Promise<any> {
    return this.request("POST", "/retainers", input);
  }
  getRetainer(id: string): Promise<any> {
    return this.request("GET", `/retainers/${id}`);
  }
  updateRetainer(id: string, patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", `/retainers/${id}`, patch);
  }
  deleteRetainer(id: string, opts?: { dryRun?: boolean }): Promise<any> {
    return this.request("DELETE", `/retainers/${id}`, undefined, this.dryRunQuery(opts));
  }

  /** Atomic, owner-scoped cloud backup and restore (Convex). */
  backup(): Promise<{ bundle: Record<string, unknown>; revision: number }> {
    return this.request("GET", "/data");
  }
  replaceData(input: { action: "import" | "reset"; expectedRevision: number; confirmation: string; bundle?: unknown }): Promise<any> {
    return this.request("POST", "/data", input);
  }

  /* -- settings --------------------------------------------------------- */
  getSettings(): Promise<any> {
    return this.request("GET", "/settings");
  }
  updateSettings(patch: Record<string, unknown>): Promise<any> {
    return this.request("PATCH", "/settings", patch);
  }
}
