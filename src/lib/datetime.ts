/**
 * Convert an epoch-ms timestamp to the "YYYY-MM-DDTHH:mm" string that
 * <input type="datetime-local"> expects, in the user's local timezone.
 */
export function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Parse a "YYYY-MM-DDTHH:mm" local-time string to epoch ms. Returns null on
 * malformed input.
 */
export function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** `YYYY-MM-DD` for `<input type="date">` from epoch ms (local calendar day). */
export function toDateInputValue(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` to epoch ms at local midnight (matches ledger date filters). */
export function fromDateInputValue(value: string): number | null {
  if (!value) return null;
  const [y, mo, d] = value.split("-").map(Number);
  if (!y || !mo || !d) return null;
  const ms = new Date(y, mo - 1, d).getTime();
  return Number.isFinite(ms) ? ms : null;
}
