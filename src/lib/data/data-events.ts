const DATA_CHANGED_EVENT = "tallyhand:data-changed";

export function notifyDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
  }
}

export function onDataChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DATA_CHANGED_EVENT, cb);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, cb);
}
