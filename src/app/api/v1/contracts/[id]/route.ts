import { contractCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = contractCrud.get;
export const PATCH = contractCrud.patch;
export const DELETE = contractCrud.remove;
