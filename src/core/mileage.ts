/**
 * Mileage — business-mileage tracking for sole proprietors.
 *
 * A mileage entry records one trip (or one day's trips); the deductible
 * amount is miles × the IRS standard rate in effect for the trip's year.
 * Pure: no storage, no network.
 */
import type { ID, Timestamped } from "./entities";

export interface MileageEntry extends Timestamped {
  id: ID;
  /** ms epoch of the trip. */
  date: number;
  miles: number;
  /** Dollars per mile applied to this entry. */
  rate: number;
  purpose: string;
  clientId?: ID;
  projectId?: ID;
  origin?: string;
  destination?: string;
  vehicleNote?: string;
  isBilled: boolean;
  invoiceId?: ID;
}

export type MileageEntryCreateInput = Omit<
  MileageEntry,
  "id" | "createdAt" | "updatedAt" | "isBilled" | "invoiceId" | "rate"
> & {
  id?: ID;
  isBilled?: boolean;
  invoiceId?: ID;
  /** Omitted → provider defaults to `mileageRateForDate(date)`. */
  rate?: number;
  createdAt?: number;
  updatedAt?: number;
};

/**
 * IRS standard mileage rates ($/mile) by calendar year.
 * Update when the IRS announces a new year's rate — entries keep the rate
 * they were recorded with, so this table only seeds new entries.
 */
export const IRS_MILEAGE_RATES: Record<number, number> = {
  2024: 0.67,
  2025: 0.7,
};

/** Fallback when the trip year has no published rate yet. */
export const DEFAULT_MILEAGE_RATE = 0.7;

/** Rate in effect for a given date (UTC year lookup, fallback to default). */
export function mileageRateForDate(dateMs: number): number {
  const year = new Date(dateMs).getUTCFullYear();
  return IRS_MILEAGE_RATES[year] ?? DEFAULT_MILEAGE_RATE;
}

/** Rate in effect for a calendar year (lookup, fallback to default). */
export function mileageRateForYear(year: number): number {
  return IRS_MILEAGE_RATES[year] ?? DEFAULT_MILEAGE_RATE;
}

/** Deductible dollars for one entry, rounded to cents. */
export function mileageDeduction(entry: Pick<MileageEntry, "miles" | "rate">): number {
  return Math.round(entry.miles * entry.rate * 100) / 100;
}

/** Total deduction across entries. */
export function totalMileageDeduction(
  entries: Pick<MileageEntry, "miles" | "rate">[],
): number {
  return (
    Math.round(entries.reduce((sum, e) => sum + e.miles * e.rate, 0) * 100) /
    100
  );
}

/** Sum of miles in a set of entries. */
export function totalMiles(entries: Pick<MileageEntry, "miles">[]): number {
  return entries.reduce((sum, e) => sum + e.miles, 0);
}