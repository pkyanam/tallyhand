import { contractCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const POST = contractCrud.bulkCreate;
