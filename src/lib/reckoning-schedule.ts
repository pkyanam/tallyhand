/**
 * Most recent reckoning instant (local `dayOfWeek` at `hourOfDay`:00) that is <= nowMs.
 * `dayOfWeek` uses JS convention: 0 = Sunday … 5 = Friday.
 */
export function lastReckoningInstantMs(
  nowMs: number,
  dayOfWeek: number,
  hourOfDay: number,
): number {
  const target = new Date(nowMs);
  const startOfToday = new Date(target);
  startOfToday.setHours(0, 0, 0, 0);
  const off = (dayOfWeek - startOfToday.getDay() + 7) % 7;
  const thisWeek = new Date(startOfToday);
  thisWeek.setDate(startOfToday.getDate() + off);
  thisWeek.setHours(hourOfDay, 0, 0, 0);
  if (thisWeek.getTime() > nowMs) {
    thisWeek.setDate(thisWeek.getDate() - 7);
  }
  return thisWeek.getTime();
}

/** True when the scheduled reckoning time has occurred since `lastCompletedAtMs` (if any). */
export function isReckoningDue(
  nowMs: number,
  dayOfWeek: number,
  hourOfDay: number,
  lastCompletedAtMs: number | undefined,
): boolean {
  const anchor = lastReckoningInstantMs(nowMs, dayOfWeek, hourOfDay);
  if (lastCompletedAtMs == null) return true;
  return lastCompletedAtMs < anchor;
}
