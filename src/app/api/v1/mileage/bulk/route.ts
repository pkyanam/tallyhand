import { mileageCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const POST = mileageCrud.bulkCreate;
