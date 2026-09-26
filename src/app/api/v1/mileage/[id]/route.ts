import { mileageCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = mileageCrud.get;
export const PATCH = mileageCrud.patch;
export const DELETE = mileageCrud.remove;
