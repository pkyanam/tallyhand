/**
 * SERVER ONLY — never import from client components.
 *
 * Track 3 extension-entity CRUD wiring: mileage entries, contracts, tax
 * payments, rate cards. Each export is a full set of API v1 handlers built
 * by defineExtensionCrud (see ./extension-crud for the shared conventions).
 */

import { aliasedParam } from "@/app/api/v1/_lib/query";
import type { StorageProvider } from "@/core/storage";
import type { Contract } from "@/core/contracts";
import { contractStatus } from "@/core/contracts";
import type { MileageEntry } from "@/core/mileage";
import type { RateCard } from "@/core/rate-cards";
import type { TaxPayment } from "@/core/tax";
import { defineExtensionCrud } from "./extension-crud";
import {
  contractCreateSchema,
  contractPatchSchema,
  type ContractCreate,
  type ContractPatch,
  mileageCreateSchema,
  mileagePatchSchema,
  type MileageCreate,
  type MileagePatch,
  rateCardCreateSchema,
  rateCardPatchSchema,
  type RateCardCreate,
  type RateCardPatch,
  taxPaymentCreateSchema,
  taxPaymentPatchSchema,
  type TaxPaymentCreate,
  type TaxPaymentPatch,
} from "./validation";
import { mileageDeduction } from "@/core/mileage";

async function validateClientProjectRefs(
  data: { clientId?: string | null; projectId?: string | null },
  provider: StorageProvider,
): Promise<string | null> {
  if (data.clientId) {
    const client = await provider.getClient(data.clientId);
    if (!client) return `clientId "${data.clientId}" does not exist`;
  }
  if (data.projectId) {
    const project = await provider.getProject(data.projectId);
    if (!project) return `projectId "${data.projectId}" does not exist`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* mileage                                                             */
/* ------------------------------------------------------------------ */

export const mileageCrud = defineExtensionCrud<
  MileageEntry,
  MileageCreate,
  MileagePatch
>({
  entityName: "mileage entry",
  createSchema: mileageCreateSchema,
  patchSchema: mileagePatchSchema,
  store: {
    list: "listMileageEntries",
    get: "getMileageEntry",
    create: "createMileageEntry",
    update: "updateMileageEntry",
    remove: "removeMileageEntry",
  },
  sortFields: ["date", "miles", "rate", "createdAt"],
  defaultSort: "-date",
  dateField: "date",
  searchAccessors: [
    (m) => m.purpose,
    (m) => m.origin,
    (m) => m.destination,
    (m) => m.vehicleNote,
  ],
  filter: (items, params) => {
    const clientId = aliasedParam(params, "clientId", "client_id");
    const projectId = aliasedParam(params, "projectId", "project_id");
    const isBilled = aliasedParam(params, "isBilled", "is_billed");
    if (clientId) items = items.filter((m) => m.clientId === clientId);
    if (projectId) items = items.filter((m) => m.projectId === projectId);
    if (isBilled === "true") items = items.filter((m) => m.isBilled);
    else if (isBilled === "false") items = items.filter((m) => !m.isBilled);
    return items;
  },
  validateCreateRefs: validateClientProjectRefs,
  validatePatchRefs: validateClientProjectRefs,
  describeForDelete: (m) => ({
    date: m.date,
    miles: m.miles,
    purpose: m.purpose,
    deduction: mileageDeduction(m),
  }),
});

/* ------------------------------------------------------------------ */
/* contracts                                                           */
/* ------------------------------------------------------------------ */

export const contractCrud = defineExtensionCrud<
  Contract,
  ContractCreate,
  ContractPatch
>({
  entityName: "contract",
  createSchema: contractCreateSchema,
  patchSchema: contractPatchSchema,
  store: {
    list: "listContracts",
    get: "getContract",
    create: "createContract",
    update: "updateContract",
    remove: "removeContract",
  },
  sortFields: ["startDate", "endDate", "title", "createdAt"],
  defaultSort: "-startDate",
  dateField: "startDate",
  searchAccessors: [(c) => c.title, (c) => c.notes, (c) => c.fileName],
  filter: (items, params) => {
    const now = Date.now();
    const clientId = aliasedParam(params, "clientId", "client_id");
    const type = params.get("type");
    const status = params.get("status");
    const archived = params.get("archived");
    if (clientId) items = items.filter((c) => c.clientId === clientId);
    if (type) items = items.filter((c) => c.type === type);
    if (status)
      items = items.filter((c) => contractStatus(c, now).status === status);
    if (archived === "true") items = items.filter((c) => c.archived);
    else if (archived === "false") items = items.filter((c) => !c.archived);
    return items;
  },
  validateCreateRefs: validateClientProjectRefs,
  validatePatchRefs: validateClientProjectRefs,
  describeForDelete: (c) => ({ title: c.title, type: c.type }),
});

/* ------------------------------------------------------------------ */
/* tax payments                                                        */
/* ------------------------------------------------------------------ */

export const taxPaymentCrud = defineExtensionCrud<
  TaxPayment,
  TaxPaymentCreate,
  TaxPaymentPatch
>({
  entityName: "tax payment",
  createSchema: taxPaymentCreateSchema,
  patchSchema: taxPaymentPatchSchema,
  store: {
    list: "listTaxPayments",
    get: "getTaxPayment",
    create: "createTaxPayment",
    update: "updateTaxPayment",
    remove: "removeTaxPayment",
  },
  sortFields: ["date", "amount", "taxYear", "createdAt"],
  defaultSort: "-date",
  dateField: "date",
  searchAccessors: [(p) => p.note, (p) => p.method],
  filter: (items, params) => {
    const taxYear = aliasedParam(params, "taxYear", "tax_year");
    const quarter = params.get("quarter");
    const jurisdiction = params.get("jurisdiction");
    if (taxYear) items = items.filter((p) => p.taxYear === Number(taxYear));
    if (quarter) items = items.filter((p) => p.quarter === Number(quarter));
    if (jurisdiction)
      items = items.filter((p) => p.jurisdiction === jurisdiction);
    return items;
  },
  describeForDelete: (p) => ({
    taxYear: p.taxYear,
    quarter: p.quarter,
    jurisdiction: p.jurisdiction,
    amount: p.amount,
  }),
});

/* ------------------------------------------------------------------ */
/* rate cards                                                          */
/* ------------------------------------------------------------------ */

export const rateCardCrud = defineExtensionCrud<
  RateCard,
  RateCardCreate,
  RateCardPatch
>({
  entityName: "rate card",
  createSchema: rateCardCreateSchema,
  patchSchema: rateCardPatchSchema,
  store: {
    list: "listRateCards",
    get: "getRateCard",
    create: "createRateCard",
    update: "updateRateCard",
    remove: "removeRateCard",
  },
  sortFields: ["effectiveFrom", "name", "createdAt"],
  defaultSort: "-effectiveFrom",
  dateField: "effectiveFrom",
  searchAccessors: [(r) => r.name],
  filter: (items, params) => {
    const clientId = aliasedParam(params, "clientId", "client_id");
    const projectId = aliasedParam(params, "projectId", "project_id");
    const archived = params.get("archived");
    if (clientId) items = items.filter((r) => r.clientId === clientId);
    if (projectId) items = items.filter((r) => r.projectId === projectId);
    if (archived === "true") items = items.filter((r) => r.archived);
    else if (archived === "false") items = items.filter((r) => !r.archived);
    return items;
  },
  validateCreateRefs: validateClientProjectRefs,
  validatePatchRefs: validateClientProjectRefs,
  describeForDelete: (r) => ({ name: r.name }),
});
