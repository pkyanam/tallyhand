/** Hand-rolled human output: compact aligned columns, no extra deps. */

export function table(headers: string[], rows: Array<Array<string | number | undefined | null>>): string {
  const str = rows.map((r) => r.map((c) => (c === undefined || c === null ? "" : String(c))));
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...str.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const out = [line(headers)];
  for (const r of str) out.push(line(r));
  return out.join("\n");
}

export function fmtMoney(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtCents(cents: number | undefined | null): string {
  if (cents === undefined || cents === null) return "-";
  return fmtMoney(cents / 100);
}

export function fmtDate(ms: number | undefined | null): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDay(ms: number | undefined | null): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function fmtHours(minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null) return "-";
  const h = minutes / 60;
  return `${h.toFixed(2)}h`;
}

/** Parse YYYY-MM-DD (local midnight) -> ms. Throws on bad input. */
export function parseDate(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Bad date "${s}" — expected YYYY-MM-DD.`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date "${s}".`);
  return d.getTime();
}

export function parseTags(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(",").map((t) => t.trim()).filter(Boolean);
}

export function parseJsonArray(s: string, what: string): any[] {
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    throw new Error(`${what} is not valid JSON.`);
  }
  if (!Array.isArray(v)) throw new Error(`${what} must be a JSON array.`);
  return v;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

/** Emit data: JSON when --json, otherwise the human formatter. */
export function emit(json: boolean, data: unknown, human: () => void): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    human();
  }
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown): string => {
    const s =
      v === null || v === undefined
        ? ""
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}
