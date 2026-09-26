import { taxPaymentCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const GET = taxPaymentCrud.get;
export const PATCH = taxPaymentCrud.patch;
export const DELETE = taxPaymentCrud.remove;
