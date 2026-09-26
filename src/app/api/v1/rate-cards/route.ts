import { rateCardCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = rateCardCrud.list;
export const POST = rateCardCrud.create;
