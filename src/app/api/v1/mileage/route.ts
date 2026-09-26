import { mileageCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = mileageCrud.list;
export const POST = mileageCrud.create;
