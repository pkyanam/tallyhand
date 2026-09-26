/**
 * API v1 shared query helpers (route-private: `_lib` is not a route).
 *
 * Agents drive lists with three orthogonal params:
 * - pagination: `?limit=` + `?cursor=` (see @/server/http)
 * - filtering: entity-specific params + `?date_from=` / `?date_to=`
 * - sorting: `?sort=<field>` or `?sort=-<field>` for descending
 *
 * Convention for new routes: use parseSort / parseDateRange / isDryRun here
 * instead of hand-rolling query parsing. Error shape stays
 * `{ error: { code, message, details? } }`.
 */

export type SortSpec = { field: string; desc: boolean };

/**
 * Parse `?sort=`. Prefix `-` flips direction. Returns null when absent,
 * the string "invalid" when the field is not in `allowed` (so the route can
 * 400 with the allowed list).
 */
export function parseSort(
  req: Request,
  allowed: readonly string[],
): SortSpec | null | "invalid" {
  const raw = new URL(req.url).searchParams.get("sort");
  if (!raw) return null;
  const desc = raw.startsWith("-");
  const field = desc ? raw.slice(1) : raw;
  if (!field || !allowed.includes(field)) return "invalid";
  return { field, desc };
}

/** In-memory sort for list results. Numbers compare numerically, else localeCompare. */
export function applySort<T>(items: T[], sort: SortSpec): T[] {
  const dir = sort.desc ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sort.field];
    const bv = (b as Record<string, unknown>)[sort.field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

/** `?sort=` usage line for 400 messages, e.g. "sort=name|-name". */
export function sortUsage(allowed: readonly string[]): string {
  return allowed.map((f) => `${f}|-${f}`).join(", ");
}

/* ------------------------------------------------------------------ */
/* date range                                                          */
/* ------------------------------------------------------------------ */

export type DateRange = { from?: number; to?: number };

/**
 * Parse `?date_from=` / `?date_to=`. Accepts ms epoch or any ISO-8601-ish
 * string the server coerces (same as body dates). Returns "invalid" when a
 * provided value doesn't parse.
 */
export function parseDateRange(req: Request): DateRange | "invalid" {
  const params = new URL(req.url).searchParams;
  const parseOne = (raw: string | null): number | undefined | "invalid" => {
    if (raw == null || raw === "") return undefined;
    if (/^\d+$/.test(raw.trim())) return Number(raw);
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? "invalid" : ms;
  };
  const from = parseOne(params.get("date_from"));
  const to = parseOne(params.get("date_to"));
  if (from === "invalid" || to === "invalid") return "invalid";
  return {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

/** Filter items by an ms-epoch accessor against a parsed DateRange. */
export function filterDateRange<T>(
  items: T[],
  getMs: (item: T) => number,
  range: DateRange,
): T[] {
  return items.filter((item) => {
    const ms = getMs(item);
    if (range.from !== undefined && ms < range.from) return false;
    if (range.to !== undefined && ms > range.to) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* dry run                                                             */
/* ------------------------------------------------------------------ */

/**
 * `?dry_run=true` (alias `?dry-run=true`) on dangerous ops — deletes,
 * invoice send/paid, scheduler runs — returns what WOULD happen without
 * mutating. Every dry-run response is 200 `{ data: { dryRun: true, ... } }`.
 */
export function isDryRun(req: Request): boolean {
  const params = new URL(req.url).searchParams;
  return params.get("dry_run") === "true" || params.get("dry-run") === "true";
}

/* ------------------------------------------------------------------ */
/* misc                                                                */
/* ------------------------------------------------------------------ */

/** Case-insensitive substring search across a list of string accessors. */
export function filterSearch<T>(
  items: T[],
  query: string | null,
  accessors: Array<(item: T) => string | undefined>,
): T[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter((item) =>
    accessors.some((get) => (get(item) ?? "").toLowerCase().includes(q)),
  );
}

/* ------------------------------------------------------------------ */
/* param aliases                                                       */
/* ------------------------------------------------------------------ */

/**
 * Read a query param by its camelCase name with a snake_case alias
 * (camelCase wins when both are present). Agents habitually write
 * `client_id`, `is_billed`, etc.; both spellings are accepted everywhere.
 */
export function aliasedParam(
  search: URLSearchParams,
  camel: string,
  snake: string,
): string | null {
  return search.get(camel) ?? search.get(snake);
}

/** Tri-state boolean param: "true" → true, "false" → false, else null. */
export function triBool(raw: string | null): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}
