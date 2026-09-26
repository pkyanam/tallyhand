import { taxPaymentCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = taxPaymentCrud.list;
export const POST = taxPaymentCrud.create;
