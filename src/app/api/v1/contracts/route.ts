import { contractCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = contractCrud.list;
export const POST = contractCrud.create;
