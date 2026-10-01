import type { TallyhandBundleV1 } from "@/core/backup";
import { validateCloudBackup } from "@/core/cloud-backup";
async function payload(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? "Cloud data operation failed. Please try again.");
  if (!body?.data) throw new Error("Invalid cloud backup response.");
  return body.data;
}
export async function readCloudBackup(): Promise<{ bundle: TallyhandBundleV1; revision: number }> {
  return payload(await fetch("/api/v1/data", { cache: "no-store" }));
}
export async function replaceCloudData(action: "import" | "reset", expectedRevision: number, confirmation: string, bundle?: TallyhandBundleV1) {
  if (bundle) validateCloudBackup(bundle);
  return payload(await fetch("/api/v1/data", {
    method: "POST", headers: { "content-type": "application/json", "x-tallyhand-sync": "1", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ action, expectedRevision, confirmation, bundle }),
  }));
}
