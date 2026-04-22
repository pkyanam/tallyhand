export function newId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${ts}${rand}`;
}

export function now(): number {
  return Date.now();
}
