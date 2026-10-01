const DATA_CHANGED_EVENT = "tallyhand:data-changed";

let dataRevision = 0;
export function getDataRevision(): number { return dataRevision; }

export function notifyDataChanged(): void {
  dataRevision += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
  }
}

export function onDataChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DATA_CHANGED_EVENT, cb);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, cb);
}

export function notifyDataLoadFailed(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("tallyhand:data-load-failed"));
}
