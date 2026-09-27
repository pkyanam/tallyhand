/**
 * SERVER ONLY — never import from client components.
 *
 * Generic CRUD route handlers for the Track 3 extension entities (mileage
 * entries, contracts, tax payments, rate cards). Every handler follows the
 * docs/API.md conventions exactly:
 *
 * - `{ data }` success envelopes via @/server/http
 * - `{ error: { code, message, details? } }` failures
 * - Bearer <redacted> auth on every handler
 * - pagination (`?page=&per_page=`), filtering (entity params +
 *   `?date_from=`/`?date_to=` + `?search=`), sorting (`?sort=[-]field`)
 * - `Idempotency-Key` on POST/PATCH via withIdempotency
 * - `?dry_run=true` on DELETE
 * - bulk create validates EVERYTHING before creating ANYTHING
 *
 * Each entity wires a thin config (schemas, store keys, sort fields,
 * filters) and gets list/create/[id]/bulk routes. The store keys are
 * resolved through extStore, so providers that predate an entity answer
 * 501 `not_supported` instead of crashing.
 */

import type { z } from "zod";
import type { StorageProvider } from "@/core/storage";
import { getServerProvider } from "./provider";
import { requireApiOrSession } from "@/app/api/v1/_lib/sync-auth";
import {
  badRequest,
  conflict as duplicateIdConflict,
  created,
  noContent,
  notFound,
  ok,
  paginated,
  parsePagination,
} from "./http";
import { withIdempotency } from "@/app/api/v1/_lib/idempotency";
import { MAX_BULK_ITEMS, findDuplicateIds, validateBulk } from "@/app/api/v1/_lib/bulk";
import {
  applySort,
  filterDateRange,
  filterSearch,
  isDryRun,
  parseDateRange,
  parseSort,
  sortUsage,
} from "@/app/api/v1/_lib/query";
import { conflict } from "@/app/api/v1/_lib/errors";
import { extStore } from "./extension-stores";

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

/**
 * Store keys are plain `keyof StorageProvider` — the per-entity config in
 * ./track3-crud wires each entity to its methods explicitly, and the
 * factory casts once at each resolution point (documented below).
 */
export interface ExtensionCrudConfig<
  TItem extends { id: string },
  TCreate,
  TPatch,
> {
  /** Singular lowercase name for messages, e.g. "mileage entry". */
  entityName: string;
  createSchema: z.ZodType<TCreate>;
  patchSchema: z.ZodType<TPatch>;
  store: {
    list: keyof StorageProvider;
    get: keyof StorageProvider;
    create: keyof StorageProvider;
    update: keyof StorageProvider;
    remove: keyof StorageProvider;
  };
  /** Fields allowed in `?sort=`. */
  sortFields: readonly string[];
  /** Default sort, e.g. "-date". */
  defaultSort: string;
  /** ms-epoch field used for `?date_from=` / `?date_to=`. */
  dateField: keyof TItem & string;
  /** Accessors for `?search=`; omitted when the entity has no search. */
  searchAccessors?: Array<(item: TItem) => string | undefined>;
  /** Extra query-param filters; runs before search + date range. */
  filter?: (items: TItem[], params: URLSearchParams) => TItem[];
  /** Cross-entity reference checks on create; returns the missing reference or null. */
  validateCreateRefs?: (
    data: TCreate,
    provider: StorageProvider,
  ) => Promise<{ resource: "client" | "project"; id: string } | null>;
  /** Cross-entity reference checks on patch; returns the missing reference or null. */
  validatePatchRefs?: (
    data: TPatch,
    provider: StorageProvider,
  ) => Promise<{ resource: "client" | "project"; id: string } | null>;
  /** Refuse DELETE with 409; returns { message, details? } or null to allow. */
  deleteGuard?: (item: TItem) => { message: string; details?: unknown } | null;
  /** Extra context merged into the dry-run delete payload. */
  describeForDelete?: (item: TItem) => Record<string, unknown>;
}

export interface ExtensionCrudHandlers {
  list: (req: Request) => Promise<Response>;
  create: (req: Request) => Promise<Response>;
  bulkCreate: (req: Request) => Promise<Response>;
  get: (req: Request, ctx: { params: { id: string } }) => Promise<Response>;
  patch: (req: Request, ctx: { params: { id: string } }) => Promise<Response>;
  remove: (req: Request, ctx: { params: { id: string } }) => Promise<Response>;
}

/* ------------------------------------------------------------------ */
/* factory                                                             */
/* ------------------------------------------------------------------ */

export function defineExtensionCrud<
  TItem extends { id: string },
  TCreate,
  TPatch,
>(config: ExtensionCrudConfig<TItem, TCreate, TPatch>): ExtensionCrudHandlers {
  const invalidSort = () =>
    badRequest(`Invalid sort field. Use ${sortUsage(config.sortFields)}`, {
      allowed: config.sortFields,
    });

  /**
   * Resolve an extension-store method or return the 501 response.
   * The `as unknown as` casts are centralized here: the per-entity config
   * in ./track3-crud is responsible for wiring each key to the right
   * entity, so a wrong key surfaces as soon as the route is exercised.
   */
  function resolveStore<T extends (...args: never[]) => unknown>(
    provider: StorageProvider,
    key: keyof StorageProvider,
  ): { fn: T } | { response: Response } {
    const resolved = extStore(provider, key);
    if ("response" in resolved) return resolved;
    return { fn: resolved.fn as unknown as T };
  }

  async function list(req: Request): Promise<Response> {
    const authErr = await requireApiOrSession(req);
    if (authErr) return authErr;
    const provider = getServerProvider();
    const store = resolveStore<() => Promise<TItem[]>>(
      provider,
      config.store.list,
    );
    if ("response" in store) return store.response;

    const params = new URL(req.url).searchParams;
    let items = await store.fn();

    if (config.filter) items = config.filter(items, params);

    if (config.searchAccessors) {
      items = filterSearch(items, params.get("search"), config.searchAccessors);
    }

    const range = parseDateRange(req);
    if (range === "invalid") {
      return badRequest("Invalid date_from/date_to — use ms epoch or ISO-8601");
    }
    items = filterDateRange(
      items,
      (item) => (item[config.dateField] as number) ?? 0,
      range,
    );

    const parsedSort = parseSort(req, config.sortFields);
    if (parsedSort === "invalid") return invalidSort();
    const desc = config.defaultSort.startsWith("-");
    const defaultField = desc ? config.defaultSort.slice(1) : config.defaultSort;
    const sorted = parsedSort
      ? applySort(items, parsedSort)
      : applySort(items, { field: defaultField, desc });
    const { limit, cursor } = parsePagination(req);
    return paginated(sorted, limit, cursor);
  }

  async function create(req: Request): Promise<Response> {
    const authErr = await requireApiOrSession(req);
    if (authErr) return authErr;
    return withIdempotency(req, async () => {
      const provider = getServerProvider();
      const body: unknown = await req.json().catch(() => null);
      const parsed = config.createSchema.safeParse(body);
      if (!parsed.success) {
        return badRequest(`Invalid ${config.entityName}`, parsed.error.issues);
      }
      // Mirror retry-safety: a retried create must not collide on the id.
      const data = parsed.data as TCreate & { id?: string };
      if (data.id) {
        const getStore = resolveStore<
          (id: string) => Promise<TItem | undefined>
        >(provider, config.store.get);
        if (!("response" in getStore)) {
          const existing = await getStore.fn(data.id);
          if (existing) return duplicateIdConflict(config.entityName);
        }
      }
      if (config.validateCreateRefs) {
        const refErr = await config.validateCreateRefs(parsed.data, provider);
        if (refErr) return notFound(`${refErr.resource} "${refErr.id}"`);
      }
      const store = resolveStore<(input: TCreate) => Promise<TItem>>(
        provider,
        config.store.create,
      );
      if ("response" in store) return store.response;
      const item = await store.fn(parsed.data);
      return created(item);
    });
  }

  async function bulkCreate(req: Request): Promise<Response> {
    const authErr = await requireApiOrSession(req);
    if (authErr) return authErr;
    return withIdempotency(req, async () => {
      const body: unknown = await req.json().catch(() => null);
      const raw: unknown = Array.isArray(body)
        ? body
        : (body as { items?: unknown } | null)?.items;
      if (!Array.isArray(raw)) {
        return badRequest("Body must be { items: [...] } or a bare JSON array");
      }
      if (raw.length === 0) {
        return badRequest("items must not be empty");
      }
      if (raw.length > MAX_BULK_ITEMS) {
        return badRequest(`items is limited to ${MAX_BULK_ITEMS} per batch`);
      }

      const validated = validateBulk(config.createSchema, raw);
      if (!validated.ok) {
        return badRequest(
          `Invalid ${config.entityName} items`,
          validated.errors,
        );
      }

      const provider = getServerProvider();
      // Mirror retry-safety: detect duplicate ids up front, before any
      // write, honoring the validate-first contract.
      const getStore = resolveStore<(id: string) => Promise<TItem | undefined>>(
        provider,
        config.store.get,
      );
      if (!("response" in getStore)) {
        const dupes = await findDuplicateIds(
          validated.items as Array<TCreate & { id?: string }>,
          async (id) => (await getStore.fn(id)) !== undefined,
        );
        if (dupes.existing.length > 0) {
          return conflict(
            `${config.entityName} id already exists`,
            dupes.existing,
          );
        }
        if (dupes.inBatch.length > 0) {
          return badRequest(
            `Duplicate ${config.entityName} ids in batch`,
            dupes.inBatch,
          );
        }
      }
      if (config.validateCreateRefs) {
        const errors: { index: number; issues: unknown }[] = [];
        for (let i = 0; i < validated.items.length; i++) {
          const refErr = await config.validateCreateRefs(
            validated.items[i],
            provider,
          );
          if (refErr) errors.push({ index: i, issues: [{ message: `${refErr.resource} "${refErr.id}" not found` }] });
        }
        if (errors.length > 0) {
          return badRequest(`Invalid ${config.entityName} items`, errors);
        }
      }

      const store = resolveStore<(input: TCreate) => Promise<TItem>>(
        provider,
        config.store.create,
      );
      if ("response" in store) return store.response;
      const items: TItem[] = [];
      for (const item of validated.items) {
        items.push(await store.fn(item));
      }
      return created(items);
    });
  }

  async function get(
    req: Request,
    { params }: { params: { id: string } },
  ): Promise<Response> {
    const authErr = await requireApiOrSession(req);
    if (authErr) return authErr;
    const provider = getServerProvider();
    const store = resolveStore<(id: string) => Promise<TItem | undefined>>(
      provider,
      config.store.get,
    );
    if ("response" in store) return store.response;
    const item = await store.fn(params.id);
    if (!item) return notFound(config.entityName);
    return ok(item);
  }

  async function patch(
    req: Request,
    { params }: { params: { id: string } },
  ): Promise<Response> {
    const authErr = await requireApiOrSession(req);
    if (authErr) return authErr;
    return withIdempotency(req, async () => {
      const provider = getServerProvider();
      const getStore = resolveStore<(id: string) => Promise<TItem | undefined>>(
        provider,
        config.store.get,
      );
      if ("response" in getStore) return getStore.response;
      const existing = await getStore.fn(params.id);
      if (!existing) return notFound(config.entityName);

      const body: unknown = await req.json().catch(() => null);
      const parsed = config.patchSchema.safeParse(body);
      if (!parsed.success) {
        return badRequest(
          `Invalid ${config.entityName} patch`,
          parsed.error.issues,
        );
      }
      if (config.validatePatchRefs) {
        const refErr = await config.validatePatchRefs(parsed.data, provider);
        if (refErr) return notFound(`${refErr.resource} "${refErr.id}"`);
      }
      const updateStore = resolveStore<(id: string, patch: TPatch) => Promise<void>>(
        provider,
        config.store.update,
      );
      if ("response" in updateStore) return updateStore.response;
      await updateStore.fn(params.id, parsed.data);
      const updated = await getStore.fn(params.id);
      return ok(updated);
    });
  }

  async function remove(
    req: Request,
    { params }: { params: { id: string } },
  ): Promise<Response> {
    const authErr = await requireApiOrSession(req);
    if (authErr) return authErr;
    const provider = getServerProvider();
    const getStore = resolveStore<(id: string) => Promise<TItem | undefined>>(
      provider,
      config.store.get,
    );
    if ("response" in getStore) return getStore.response;
    const existing = await getStore.fn(params.id);
    if (!existing) return notFound(config.entityName);

    if (config.deleteGuard) {
      const guard = config.deleteGuard(existing);
      if (guard) return conflict(guard.message, guard.details);
    }

    if (isDryRun(req)) {
      return ok({
        dryRun: true,
        wouldDelete: {
          entity: config.entityName,
          id: existing.id,
          ...(config.describeForDelete
            ? config.describeForDelete(existing)
            : {}),
        },
      });
    }

    const removeStore = resolveStore<(id: string) => Promise<void>>(
      provider,
      config.store.remove,
    );
    if ("response" in removeStore) return removeStore.response;
    await removeStore.fn(params.id);
    return noContent();
  }

  return { list, create, bulkCreate, get, patch, remove };
}