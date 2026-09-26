import { rateCardCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = rateCardCrud.get;
export const PATCH = rateCardCrud.patch;
export const DELETE = rateCardCrud.remove;
